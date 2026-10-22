#!/usr/bin/env node

/**
 * Bugsink MCP Server
 *
 * A Model Context Protocol server for interacting with Bugsink error tracking.
 * Allows LLM tools like Claude and Cursor to query issues, events, and projects,
 * triage errors, inspect stacktraces, and manage releases.
 *
 * @see https://www.bugsink.com/
 * @see https://modelcontextprotocol.io/
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'node:http';
import * as zodModule from 'zod';
import { z as zodNamed } from 'zod';

const z =
  zodNamed ??
  (zodModule as any).z ??
  (zodModule as any).default?.z ??
  (zodModule as any).default ??
  zodModule;
import { BugsinkClient, type Issue, type Event, type Release } from './bugsink-client.js';
import {
  filterFrames,
  formatEventSummary,
  truncateText,
  extractEventExceptions,
  extractEventBreadcrumbs,
} from './presentation.js';

// Environment configuration
const BUGSINK_URL = process.env.BUGSINK_URL || '';
const BUGSINK_TOKEN = process.env.BUGSINK_TOKEN || '';
const BUGSINK_READ_ONLY = process.env.BUGSINK_READ_ONLY === 'true';
const BUGSINK_ALLOWED_PROJECTS = process.env.BUGSINK_ALLOWED_PROJECTS
  ? process.env.BUGSINK_ALLOWED_PROJECTS.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
  : undefined;

// Default client instance for production runtime
export const defaultClient = new BugsinkClient({
  baseUrl: BUGSINK_URL || 'http://localhost',
  apiToken: BUGSINK_TOKEN || 'token',
  readOnly: BUGSINK_READ_ONLY,
  allowedProjects: BUGSINK_ALLOWED_PROJECTS,
});

// Helper to derive status from issue flags
function getIssueStatus(issue: Issue): string {
  if (issue.is_resolved) return 'resolved';
  if (issue.is_muted) return 'muted';
  return 'unresolved';
}

// Helper to format issue for display
function formatIssue(issue: Issue): string {
  return [
    `[${issue.calculated_type}] ${issue.calculated_value}`,
    `  ID: ${issue.id}`,
    `  Status: ${getIssueStatus(issue)}`,
    `  Occurrences: ${issue.digested_event_count}`,
    `  First seen: ${issue.first_seen}`,
    `  Last seen: ${issue.last_seen}`,
    issue.transaction ? `  Transaction: ${issue.transaction}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// Helper to format event for display.
function formatEvent(event: Event, includeStacktrace = false): string {
  const lines = [
    `Event ID: ${event.id}`,
    `  Timestamp: ${event.timestamp}`,
    `  Ingested: ${event.ingested_at}`,
  ];

  if (event.data) {
    const data = event.data;

    if (data.level) {
      lines.push(`  Level: ${data.level}`);
    }
    if (data.platform) {
      lines.push(`  Platform: ${data.platform}`);
    }
    if (data.message) {
      lines.push(`  Message: ${data.message}`);
    }

    if (data.exception?.values) {
      lines.push('  Exception:');
      for (const exc of data.exception.values) {
        lines.push(`    ${exc.type}: ${exc.value}`);
        if (includeStacktrace && exc.stacktrace?.frames) {
          lines.push('    Stacktrace (most recent first):');
          const frames = [...exc.stacktrace.frames].reverse().slice(0, 15);
          for (const frame of frames) {
            const loc = frame.lineno ? `:${frame.lineno}` : '';
            const col = frame.colno ? `:${frame.colno}` : '';
            lines.push(`      ${frame.filename}${loc}${col} in ${frame.function}`);
            if (frame.context_line) {
              lines.push(`        > ${frame.context_line.trim()}`);
            }
          }
        }
      }
    }

    if (data.request?.url) {
      lines.push(`  Request: ${data.request.method || 'GET'} ${data.request.url}`);
    }

    if (data.browser?.name) {
      lines.push(`  Browser: ${data.browser.name} ${data.browser.version || ''}`);
    }

    if (data.os?.name) {
      lines.push(`  OS: ${data.os.name} ${data.os.version || ''}`);
    }
  }

  return lines.join('\n');
}

// Extract the opaque `cursor` value from a Bugsink-returned next/previous URL.
function extractCursor(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('cursor');
  } catch {
    return null;
  }
}

// Returns a leading "\nNext cursor: …\nPrevious cursor: …" block.
function formatPagination(response: { next: string | null; previous: string | null }): string {
  const next = extractCursor(response.next);
  const prev = extractCursor(response.previous);
  if (!next && !prev) return '';
  const lines: string[] = [];
  if (next) lines.push(`Next cursor: ${next}`);
  if (prev) lines.push(`Previous cursor: ${prev}`);
  return '\n' + lines.join('\n');
}

/**
 * Build a fully-configured MCP server.
 * Accepts an optional BugsinkClient instance (defaults to defaultClient).
 */
export function createServer(clientInstance: BugsinkClient = defaultClient): McpServer {
  const server = new McpServer({
    name: 'bugsink-mcp',
    version: '0.4.0',
  });

  // ============================================================================
  // Read Tools (Always Registered)
  // ============================================================================

  // List Projects
  server.registerTool(
    'list_projects',
    {
      description: 'List all projects in the Bugsink instance. Optionally filter by team UUID.',
      inputSchema: {
        cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor from a previous response's 'Next cursor' or 'Previous cursor'"
          ),
        team: z.string().optional().describe('Optional team UUID to filter projects by team'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cursor, team }) => {
      const response = await clientInstance.listProjects({ cursor, team });

      if (response.results.length === 0) {
        return {
          content: [{ type: 'text', text: 'No projects found.' }],
        };
      }

      const text = response.results
        .map(
          (p) =>
            `- ${p.name} (ID: ${p.id}, slug: ${p.slug})\n  Events: ${p.stored_event_count} stored, ${p.digested_event_count} digested`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${response.results.length} project(s):${formatPagination(response)}\n\n${text}`,
          },
        ],
      };
    }
  );

  // List Teams
  server.registerTool(
    'list_teams',
    {
      description: 'List all teams in the Bugsink instance',
      inputSchema: {
        cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor from a previous response's 'Next cursor' or 'Previous cursor'"
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ cursor }) => {
      const response = await clientInstance.listTeams({ cursor });

      if (response.results.length === 0) {
        return {
          content: [{ type: 'text', text: 'No teams found.' }],
        };
      }

      const text = response.results
        .map((t) => `- ${t.name} (ID: ${t.id}, visibility: ${t.visibility})`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${response.results.length} team(s):${formatPagination(response)}\n\n${text}`,
          },
        ],
      };
    }
  );

  // List Issues
  server.registerTool(
    'list_issues',
    {
      description:
        'List issues for a specific project. Issues represent grouped error occurrences.',
      inputSchema: {
        project_id: z.number().describe('The project ID to list issues for'),
        status: z
          .enum(['open', 'unresolved', 'resolved', 'muted', 'all'])
          .optional()
          .describe("Filter by status: 'open' / 'unresolved', 'resolved', 'muted', 'all'"),
        limit: z
          .number()
          .optional()
          .default(25)
          .describe('Maximum number of issues to return (default: 25)'),
        sort: z
          .enum(['digest_order', 'last_seen', 'digested_event_count'])
          .optional()
          .describe(
            "Sort mode: 'digest_order', 'last_seen', or 'digested_event_count' (default: digest_order)"
          ),
        order: z
          .enum(['asc', 'desc'])
          .optional()
          .describe("Sort order: 'asc' or 'desc' (default: desc)"),
        cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor from a previous response's 'Next cursor' or 'Previous cursor'"
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id, status, limit, sort, order, cursor }) => {
      const response = await clientInstance.listIssues(project_id, {
        status,
        limit,
        sort,
        order,
        cursor,
      });

      if (response.results.length === 0) {
        return {
          content: [{ type: 'text', text: `No issues found for project ${project_id}.` }],
        };
      }

      const text = response.results.map(formatIssue).join('\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${response.results.length} issue(s):${formatPagination(response)}\n\n${text}`,
          },
        ],
      };
    }
  );

  // Get Issue Details
  server.registerTool(
    'get_issue',
    {
      description: 'Get detailed information about a specific issue',
      inputSchema: {
        issue_id: z.string().describe('The issue ID (UUID or friendly ID) to retrieve'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ issue_id }) => {
      const issue = await clientInstance.getIssue(issue_id);
      const text = formatIssue(issue);

      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  // Analyze Issue Context (Smart Context)
  server.registerTool(
    'analyze_issue_context',
    {
      description:
        'Holistic analysis tool: retrieves issue details, recent events, and full stacktrace in one call.',
      inputSchema: {
        issue_id: z.string().describe('The issue ID (UUID or friendly ID) to analyze'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ issue_id }) => {
      const [issue, events] = await Promise.all([
        clientInstance.getIssue(issue_id),
        clientInstance.listEvents(issue_id, { limit: 5 }),
      ]);

      let output = `# Issue Analysis: ${issue.calculated_type}: ${issue.calculated_value}\n\n`;
      output += `## Issue Details\n${formatIssue(issue)}\n\n`;
      output += `## Recent Events (${events.results.length})\n`;

      if (events.results.length === 0) {
        output += '\nNo events found for this issue.';
      } else {
        const latestEvent = events.results[0];
        let stacktraceMd: string | null = null;
        try {
          stacktraceMd = await clientInstance.getEventStacktrace(latestEvent.id);
        } catch {
          // Stacktrace unavailable; fall back to formatted event
        }

        output += `\n### Latest Event\n${formatEvent(latestEvent, true)}`;
        if (stacktraceMd) {
          output += `\n\nMarkdown Stacktrace:\n${stacktraceMd}`;
        }

        if (events.results.length > 1) {
          output += `\n\n### Other Recent Events\n`;
          for (const e of events.results.slice(1)) {
            output += `\n---\n${formatEvent(e, false)}\n`;
          }
        }
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    }
  );

  // List Events
  server.registerTool(
    'list_events',
    {
      description:
        'List events (individual error occurrences) for a specific issue. Returns basic event info.',
      inputSchema: {
        issue_id: z.string().describe('The issue ID (UUID or friendly ID) to list events for'),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe('Maximum number of events to return (default: 10)'),
        cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor from a previous response's 'Next cursor' or 'Previous cursor'"
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ issue_id, limit, cursor }) => {
      const response = await clientInstance.listEvents(issue_id, { limit, cursor });

      if (response.results.length === 0) {
        return {
          content: [{ type: 'text', text: `No events found for issue ${issue_id}.` }],
        };
      }

      const text = response.results.map((e) => formatEvent(e, false)).join('\n\n---\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${response.results.length} event(s):${formatPagination(response)}\n\n${text}`,
          },
        ],
      };
    }
  );

  // Get Event Details (with section selection and application frame filtering)
  server.registerTool(
    'get_event',
    {
      description:
        'Get detailed information about a specific event. Supports filtering by section (summary, frames, exceptions, breadcrumbs, stacktrace, raw) and filtering application-only frames.',
      inputSchema: {
        event_id: z
          .string()
          .describe(
            'The event ID (UUID) to retrieve — use the `id` field from list_events, not `event_id`'
          ),
        section: z
          .enum(['summary', 'frames', 'exceptions', 'breadcrumbs', 'stacktrace', 'raw'])
          .optional()
          .default('summary')
          .describe(
            'Section to retrieve: summary (default), frames, exceptions, breadcrumbs, stacktrace, raw'
          ),
        application_only: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'When true, excludes vendor/ and node_modules/ frames from frames view (default: true)'
          ),
        include_source: z
          .boolean()
          .optional()
          .default(true)
          .describe('When true, includes source context lines in frames view (default: true)'),
        max_chars: z
          .number()
          .optional()
          .default(4000)
          .describe('Maximum character count for text/raw/stacktrace output (default: 4000)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ event_id, section, application_only, include_source, max_chars }) => {
      const event = await clientInstance.getEvent(event_id);

      if (section === 'frames') {
        const rawFrames = event.data?.exception?.values?.[0]?.stacktrace?.frames || [];
        const processed = filterFrames(rawFrames, application_only, include_source);
        return {
          content: [
            {
              type: 'text',
              text: truncateText(JSON.stringify(processed, null, 2), max_chars),
            },
          ],
        };
      }

      if (section === 'exceptions') {
        const exceptions = extractEventExceptions(event);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(exceptions, null, 2),
            },
          ],
        };
      }

      if (section === 'breadcrumbs') {
        const breadcrumbs = extractEventBreadcrumbs(event);
        return {
          content: [
            {
              type: 'text',
              text: truncateText(JSON.stringify(breadcrumbs, null, 2), max_chars),
            },
          ],
        };
      }

      if (section === 'stacktrace') {
        const markdown = await clientInstance.getEventStacktrace(event_id);
        return {
          content: [{ type: 'text', text: truncateText(markdown, max_chars) }],
        };
      }

      if (section === 'raw') {
        return {
          content: [
            {
              type: 'text',
              text: truncateText(JSON.stringify(event, null, 2), max_chars),
            },
          ],
        };
      }

      // Default: summary
      const summaryText = formatEventSummary(event);
      return {
        content: [{ type: 'text', text: summaryText }],
      };
    }
  );

  // Test Connection
  server.registerTool(
    'test_connection',
    {
      description: 'Test the connection to the Bugsink instance',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const result = await clientInstance.testConnection();

      return {
        content: [
          {
            type: 'text',
            text: result.success
              ? `Connection successful: ${result.message}`
              : `Connection failed: ${result.message}`,
          },
        ],
      };
    }
  );

  // Get Project Details
  server.registerTool(
    'get_project',
    {
      description: 'Get detailed information about a specific project including DSN',
      inputSchema: {
        project_id: z.number().describe('The project ID to retrieve'),
        expand: z
          .enum(['team'])
          .optional()
          .describe("Optional expansion: 'team' to include full team object"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id, expand }) => {
      const project = await clientInstance.getProject(project_id, { expand });

      const text = [
        `Project: ${project.name}`,
        `  ID: ${project.id}`,
        `  Slug: ${project.slug}`,
        `  Team: ${typeof project.team === 'object' ? JSON.stringify(project.team) : project.team}`,
        `  DSN: ${project.dsn}`,
        `  Visibility: ${project.visibility}`,
        `  Events: ${project.stored_event_count} stored, ${project.digested_event_count} digested`,
        `  Retention: ${project.retention_max_event_count} max events`,
        `  Alerts:`,
        `    New issue: ${project.alert_on_new_issue}`,
        `    Regression: ${project.alert_on_regression}`,
        `    Unmute: ${project.alert_on_unmute}`,
      ].join('\n');

      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  // Get Event Stacktrace (Markdown)
  server.registerTool(
    'get_stacktrace',
    {
      description:
        "Get an event's stacktrace as Markdown. Uses the Bugsink-internal event ID (the `id` field from list_events, not `event_id`).",
      inputSchema: {
        event_id: z
          .string()
          .describe(
            'The event ID (UUID) to get stacktrace for — use the `id` field from list_events'
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ event_id }) => {
      const markdown = await clientInstance.getEventStacktrace(event_id);

      return {
        content: [{ type: 'text', text: markdown }],
      };
    }
  );

  // Get Latest Event Stacktrace
  server.registerTool(
    'get_latest_event_stacktrace',
    {
      description:
        'Read the newest stored occurrence of an issue as rendered Markdown stacktrace, including source context and locals. Saves roundtrips by inspecting the newest event directly.',
      inputSchema: {
        issue_id: z.string().describe('The issue ID (UUID or friendly ID)'),
        max_chars: z
          .number()
          .optional()
          .default(4000)
          .describe('Maximum character count for rendered stacktrace output (default: 4000)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ issue_id, max_chars }) => {
      const markdown = await clientInstance.getLatestEventStacktrace(issue_id, max_chars);

      return {
        content: [{ type: 'text', text: markdown }],
      };
    }
  );

  // List Releases
  server.registerTool(
    'list_releases',
    {
      description:
        'List releases for a project. Releases help track which version introduced or fixed issues.',
      inputSchema: {
        project_id: z.number().describe('The project ID to list releases for'),
        cursor: z
          .string()
          .optional()
          .describe(
            "Pagination cursor from a previous response's 'Next cursor' or 'Previous cursor'"
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id, cursor }) => {
      const response = await clientInstance.listReleases(project_id, { cursor });

      if (response.results.length === 0) {
        return {
          content: [{ type: 'text', text: `No releases found for project ${project_id}.` }],
        };
      }

      const text = response.results
        .map((r) => `- ${r.version || '(empty)'} (ID: ${r.id})\n  Released: ${r.date_released}`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${response.results.length} release(s):${formatPagination(response)}\n\n${text}`,
          },
        ],
      };
    }
  );

  // Get Release Details
  server.registerTool(
    'get_release',
    {
      description: 'Get detailed information about a specific release',
      inputSchema: {
        release_id: z.string().describe('The release ID (UUID) to retrieve'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ release_id }) => {
      const release = await clientInstance.getRelease(release_id);

      const text = [
        `Release: ${release.version || '(empty)'}`,
        `  ID: ${release.id}`,
        `  Project: ${release.project}`,
        `  Released: ${release.date_released}`,
        release.semver ? `  Semver: ${release.semver}` : null,
        release.is_semver !== undefined ? `  Is Semver: ${release.is_semver}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        content: [{ type: 'text', text }],
      };
    }
  );

  // ============================================================================
  // Mutation Tools (Gated by BUGSINK_READ_ONLY)
  // ============================================================================

  if (!clientInstance.readOnly) {
    // Resolve Issue
    server.registerTool(
      'resolve_issue',
      {
        description:
          'Resolve an issue unconditionally, in the next release, or in the latest release.',
        inputSchema: {
          issue_id: z.string().describe('The issue ID (UUID or friendly ID) to resolve'),
          mode: z
            .enum(['unconditionally', 'next_release', 'latest_release'])
            .optional()
            .default('unconditionally')
            .describe('Resolution mode: unconditionally, next_release, or latest_release'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ issue_id, mode }) => {
        const issue = await clientInstance.resolveIssue(issue_id, mode);
        return {
          content: [
            {
              type: 'text',
              text: `Issue ${issue.id} marked as resolved (${mode}).\n${formatIssue(issue)}`,
            },
          ],
        };
      }
    );

    // Reopen Issue
    server.registerTool(
      'reopen_issue',
      {
        description: 'Reopen a resolved issue, making it unresolved again.',
        inputSchema: {
          issue_id: z.string().describe('The issue ID (UUID or friendly ID) to reopen'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ issue_id }) => {
        const issue = await clientInstance.reopenIssue(issue_id);
        return {
          content: [
            {
              type: 'text',
              text: `Issue ${issue.id} reopened successfully.\n${formatIssue(issue)}`,
            },
          ],
        };
      }
    );

    // Mute Issue
    server.registerTool(
      'mute_issue',
      {
        description:
          'Mute an issue indefinitely, for a period (e.g. 3 days), or until an occurrence threshold is reached.',
        inputSchema: {
          issue_id: z.string().describe('The issue ID (UUID or friendly ID) to mute'),
          mode: z
            .enum(['indefinite', 'for_period', 'until_threshold'])
            .optional()
            .default('indefinite')
            .describe('Mute mode: indefinite, for_period, or until_threshold'),
          period_name: z
            .enum(['minute', 'hour', 'day', 'week', 'month', 'year'])
            .optional()
            .describe(
              'Period unit: minute, hour, day, week, month, year (required for for_period and until_threshold)'
            ),
          nr_of_periods: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Number of periods (e.g., 3 for 3 days)'),
          gte_threshold: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('For until_threshold mode: unmute when occurrences reach this count'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ issue_id, mode, period_name, nr_of_periods, gte_threshold }) => {
        const options =
          mode === 'until_threshold' && period_name && nr_of_periods && gte_threshold
            ? { period_name, nr_of_periods, gte_threshold }
            : mode === 'for_period' && period_name && nr_of_periods
              ? { period_name, nr_of_periods }
              : undefined;

        const issue = await clientInstance.muteIssue(issue_id, options);
        return {
          content: [
            {
              type: 'text',
              text: `Issue ${issue.id} muted (${mode}).\n${formatIssue(issue)}`,
            },
          ],
        };
      }
    );

    // Unmute Issue
    server.registerTool(
      'unmute_issue',
      {
        description: 'Unmute an issue.',
        inputSchema: {
          issue_id: z.string().describe('The issue ID (UUID or friendly ID) to unmute'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ issue_id }) => {
        const issue = await clientInstance.unmuteIssue(issue_id);
        return {
          content: [
            {
              type: 'text',
              text: `Issue ${issue.id} unmuted successfully.\n${formatIssue(issue)}`,
            },
          ],
        };
      }
    );

    // Comment on Issue
    server.registerTool(
      'comment_on_issue',
      {
        description: 'Add a comment to an issue in Bugsink.',
        inputSchema: {
          issue_id: z.string().describe('The issue ID (UUID or friendly ID) to comment on'),
          comment: z.string().trim().min(1).max(4000).describe('The comment message text'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ issue_id, comment }) => {
        const result = await clientInstance.commentOnIssue(issue_id, comment);
        return {
          content: [
            {
              type: 'text',
              text: `Comment added to issue ${result.issue} (ID: ${result.id}, time: ${result.timestamp}):\n${result.comment}`,
            },
          ],
        };
      }
    );

    // Delete Issue
    server.registerTool(
      'delete_issue',
      {
        description:
          'Permanently delete an issue and all its events in Bugsink. Requires confirm=true.',
        inputSchema: {
          issue_id: z.string().describe('The issue ID (UUID or friendly ID) to permanently delete'),
          confirm: z
            .literal(true)
            .describe('Safety confirmation: must explicitly be set to true to execute deletion'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ issue_id }) => {
        const result = await clientInstance.deleteIssue(issue_id);
        return {
          content: [
            {
              type: 'text',
              text: `Issue ${result.issue_id} and all its events have been permanently deleted.`,
            },
          ],
        };
      }
    );

    // Create Project
    server.registerTool(
      'create_project',
      {
        description: 'Create a new project in a team',
        inputSchema: {
          team_id: z.string().describe('The team UUID to create the project in'),
          name: z.string().describe('The project name'),
          visibility: z
            .enum(['joinable', 'discoverable', 'team_members'])
            .optional()
            .default('team_members')
            .describe('Project visibility'),
          alert_on_new_issue: z
            .boolean()
            .optional()
            .default(true)
            .describe('Send alerts for new issues'),
          alert_on_regression: z
            .boolean()
            .optional()
            .default(true)
            .describe('Send alerts for regressions'),
          alert_on_unmute: z
            .boolean()
            .optional()
            .default(true)
            .describe('Send alerts when issues are unmuted'),
        },
        annotations: { destructiveHint: true },
      },
      async ({
        team_id,
        name,
        visibility,
        alert_on_new_issue,
        alert_on_regression,
        alert_on_unmute,
      }) => {
        const project = await clientInstance.createProject({
          team: team_id,
          name,
          visibility,
          alert_on_new_issue,
          alert_on_regression,
          alert_on_unmute,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Project created successfully:\n  Name: ${project.name}\n  ID: ${project.id}\n  DSN: ${project.dsn}`,
            },
          ],
        };
      }
    );

    // Update Project
    server.registerTool(
      'update_project',
      {
        description: "Update an existing project's settings",
        inputSchema: {
          project_id: z.number().describe('The project ID to update'),
          name: z.string().optional().describe('New project name'),
          visibility: z
            .enum(['joinable', 'discoverable', 'team_members'])
            .optional()
            .describe('Project visibility'),
          alert_on_new_issue: z.boolean().optional().describe('Send alerts for new issues'),
          alert_on_regression: z.boolean().optional().describe('Send alerts for regressions'),
          alert_on_unmute: z.boolean().optional().describe('Send alerts when issues are unmuted'),
          retention_max_event_count: z.number().optional().describe('Maximum events to retain'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ project_id, ...updates }) => {
        const input = Object.fromEntries(
          Object.entries(updates).filter(([_, v]) => v !== undefined)
        );

        const project = await clientInstance.updateProject(project_id, input);

        return {
          content: [
            {
              type: 'text',
              text: `Project updated successfully:\n  Name: ${project.name}\n  ID: ${project.id}\n  Visibility: ${project.visibility}`,
            },
          ],
        };
      }
    );

    // Create Team
    server.registerTool(
      'create_team',
      {
        description: 'Create a new team',
        inputSchema: {
          name: z.string().describe('The team name'),
          visibility: z
            .enum(['joinable', 'discoverable', 'hidden'])
            .optional()
            .default('discoverable')
            .describe('Team visibility'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ name, visibility }) => {
        const team = await clientInstance.createTeam({ name, visibility });

        return {
          content: [
            {
              type: 'text',
              text: `Team created successfully:\n  Name: ${team.name}\n  ID: ${team.id}\n  Visibility: ${team.visibility}`,
            },
          ],
        };
      }
    );

    // Update Team
    server.registerTool(
      'update_team',
      {
        description: 'Update an existing team',
        inputSchema: {
          team_id: z.string().describe('The team UUID to update'),
          name: z.string().optional().describe('New team name'),
          visibility: z
            .enum(['joinable', 'discoverable', 'hidden'])
            .optional()
            .describe('Team visibility'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ team_id, name, visibility }) => {
        const input = Object.fromEntries(
          Object.entries({ name, visibility }).filter(([_, v]) => v !== undefined)
        );

        const team = await clientInstance.updateTeam(team_id, input);

        return {
          content: [
            {
              type: 'text',
              text: `Team updated successfully:\n  Name: ${team.name}\n  ID: ${team.id}\n  Visibility: ${team.visibility}`,
            },
          ],
        };
      }
    );

    // Create Release
    server.registerTool(
      'create_release',
      {
        description: 'Create a new release for a project',
        inputSchema: {
          project_id: z.number().describe('The project ID to create the release for'),
          version: z.string().describe("The release version string (e.g., '1.0.0', 'v2.3.1')"),
          timestamp: z
            .string()
            .optional()
            .describe('Release timestamp (ISO 8601 format). Defaults to now.'),
        },
        annotations: { destructiveHint: true },
      },
      async ({ project_id, version, timestamp }) => {
        const release = await clientInstance.createRelease({
          project: project_id,
          version,
          timestamp,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Release created successfully:\n  Version: ${release.version}\n  ID: ${release.id}\n  Released: ${release.date_released}`,
            },
          ],
        };
      }
    );
  }

  return server;
}

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Serve over Streamable HTTP (stateless JSON mode).
 */
async function startHttpServer(port: number): Promise<void> {
  const authToken = process.env.MCP_HTTP_AUTH_TOKEN;

  const httpServer = http.createServer(async (req, res) => {
    if (authToken) {
      const presented = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (presented !== authToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      console.error('HTTP request handling failed:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(`Bugsink MCP server started (streamable-http) on port ${port}`);
    console.error(`Connected to: ${BUGSINK_URL}`);
  });
}

async function main() {
  if (!process.env.BUGSINK_URL || !process.env.BUGSINK_TOKEN) {
    console.error('Error: BUGSINK_URL and BUGSINK_TOKEN environment variables are required');
    console.error('');
    console.error('Set them in your MCP configuration:');
    console.error('  "env": {');
    console.error('    "BUGSINK_URL": "https://your-bugsink-instance.com",');
    console.error('    "BUGSINK_TOKEN": "your-api-token"');
    console.error('  }');
    process.exit(1);
  }

  const httpPort = process.env.MCP_HTTP_PORT || process.env.PORT;
  if (httpPort) {
    await startHttpServer(Number(httpPort));
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Bugsink MCP server started (stdio)');
  console.error(`Connected to: ${BUGSINK_URL}`);
}

// Only auto-run main() when executed directly as script, not when imported in tests
if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
