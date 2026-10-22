import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { BugsinkClient } from '../src/bugsink-client.js';
import { createServer } from '../src/index.js';

describe('MCP Server Tool Registrations', () => {
  async function connectTestServer(readOnly: boolean) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [], next: null, previous: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = new BugsinkClient(
      {
        baseUrl: 'https://bugsink.test',
        apiToken: 'test-token',
        readOnly,
      },
      fetcher
    );

    const server = createServer(client);
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    return {
      server,
      mcpClient,
      fetcher,
      close: async () => {
        await mcpClient.close();
        await server.close();
      },
    };
  }

  it('registers only read tools when readOnly is enabled', async () => {
    const session = await connectTestServer(true);
    try {
      const response = await session.mcpClient.listTools();
      const toolNames = response.tools.map((t) => t.name);

      expect(toolNames).toContain('list_projects');
      expect(toolNames).toContain('get_project');
      expect(toolNames).toContain('list_teams');
      expect(toolNames).toContain('list_issues');
      expect(toolNames).toContain('get_issue');
      expect(toolNames).toContain('analyze_issue_context');
      expect(toolNames).toContain('list_events');
      expect(toolNames).toContain('get_event');
      expect(toolNames).toContain('get_stacktrace');
      expect(toolNames).toContain('get_latest_event_stacktrace');
      expect(toolNames).toContain('test_connection');
      expect(toolNames).toContain('list_releases');
      expect(toolNames).toContain('get_release');

      // Mutation tools must NOT be present
      expect(toolNames).not.toContain('resolve_issue');
      expect(toolNames).not.toContain('reopen_issue');
      expect(toolNames).not.toContain('mute_issue');
      expect(toolNames).not.toContain('unmute_issue');
      expect(toolNames).not.toContain('comment_on_issue');
      expect(toolNames).not.toContain('delete_issue');
      expect(toolNames).not.toContain('create_project');
      expect(toolNames).not.toContain('update_project');
      expect(toolNames).not.toContain('create_team');
      expect(toolNames).not.toContain('update_team');
      expect(toolNames).not.toContain('create_release');

      // Verify readOnlyHint is true for all registered tools
      for (const tool of response.tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  it('registers mutation tools when readOnly is false', async () => {
    const session = await connectTestServer(false);
    try {
      const response = await session.mcpClient.listTools();
      const toolNames = response.tools.map((t) => t.name);

      expect(toolNames).toContain('resolve_issue');
      expect(toolNames).toContain('reopen_issue');
      expect(toolNames).toContain('mute_issue');
      expect(toolNames).toContain('unmute_issue');
      expect(toolNames).toContain('comment_on_issue');
      expect(toolNames).toContain('delete_issue');
      expect(toolNames).toContain('create_project');
      expect(toolNames).toContain('update_project');
      expect(toolNames).toContain('create_team');
      expect(toolNames).toContain('update_team');
      expect(toolNames).toContain('create_release');
      expect(toolNames).toContain('get_latest_event_stacktrace');

      const deleteTool = response.tools.find((t) => t.name === 'delete_issue');
      expect(deleteTool?.annotations?.destructiveHint).toBe(true);
    } finally {
      await session.close();
    }
  });
});
