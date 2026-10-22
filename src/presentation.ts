/**
 * Presentation and event diagnostic formatting helpers.
 *
 * Provides bounded pagination, application frame filtering (e.g., removing vendor/node_modules noise),
 * and security-conscious truncation of diagnostic payloads.
 */

import type { Event, StackFrame } from './bugsink-client.js';

export interface ProcessedFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  context_line?: string;
}

/**
 * Determines if a frame belongs to the user application rather than framework/library dependencies.
 */
export function isApplicationFrame(frame: StackFrame): boolean {
  if (frame.in_app === false) return false;
  const normalizedPath = (frame.filename || '').replace(/\\/g, '/');
  if (/(^|\/)(vendor|node_modules)\//i.test(normalizedPath)) {
    return false;
  }
  return true;
}

/**
 * Filter stacktrace frames, optionally excluding third-party vendor/node_modules frames
 * and stripping code context lines if source details were not requested.
 */
export function filterFrames(
  frames: StackFrame[],
  applicationOnly = true,
  includeSource = true
): ProcessedFrame[] {
  if (!Array.isArray(frames)) return [];

  return frames
    .filter((frame) => !applicationOnly || isApplicationFrame(frame))
    .map((frame) => {
      const processed: ProcessedFrame = {
        filename: frame.filename,
        function: frame.function,
        lineno: frame.lineno,
        colno: frame.colno,
        in_app: frame.in_app !== false,
      };

      if (includeSource && frame.context_line !== undefined) {
        processed.context_line = frame.context_line;
      }

      return processed;
    });
}

/**
 * Truncate long text strings to prevent overflowing LLM token context limits,
 * while preserving valid UTF-16 surrogate pairs.
 */
export function truncateText(text: string, maxChars = 4000): string {
  if (!text || text.length <= maxChars) return text;

  let end = maxChars;
  // Do not split a high surrogate pair character at the boundary
  if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) {
    end--;
  }

  return `${text.slice(0, end)}... [truncated]`;
}

/**
 * Format a concise summary of an event's diagnostic metadata for LLMs.
 */
export function formatEventSummary(event: Event): string {
  const lines = [
    `Event ID: ${event.id}`,
    `  Timestamp: ${event.timestamp}`,
    `  Ingested: ${event.ingested_at}`,
  ];

  if (event.data) {
    const { level, platform, message, request, browser, os, exception } = event.data;

    if (level) lines.push(`  Level: ${level}`);
    if (platform) lines.push(`  Platform: ${platform}`);
    if (message) lines.push(`  Message: ${message}`);

    if (request?.url) {
      lines.push(`  Request: ${request.method || 'GET'} ${request.url}`);
    }
    if (browser?.name) {
      lines.push(`  Browser: ${browser.name} ${browser.version || ''}`);
    }
    if (os?.name) {
      lines.push(`  OS: ${os.name} ${os.version || ''}`);
    }

    if (exception?.values?.length) {
      lines.push('  Exceptions:');
      for (const exc of exception.values) {
        lines.push(`    - ${exc.type}: ${exc.value}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Extract structured exception values from an event payload.
 */
export function extractEventExceptions(
  event: Event
): Array<{ type: string; value: string; module?: string }> {
  const values = event.data?.exception?.values;
  if (!Array.isArray(values)) return [];

  return values.map((exc) => {
    const raw = exc as unknown as Record<string, unknown>;
    return {
      type: exc.type,
      value: exc.value,
      ...(raw.module ? { module: String(raw.module) } : {}),
    };
  });
}

/**
 * Extract structured breadcrumbs from an event payload.
 */
export function extractEventBreadcrumbs(event: Event): Array<Record<string, unknown>> {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const fromContexts = (data.contexts as Record<string, unknown> | undefined)?.breadcrumbs;
  const fromDirect = data.breadcrumbs;

  const rawList = Array.isArray(fromContexts)
    ? fromContexts
    : Array.isArray((fromContexts as Record<string, unknown> | undefined)?.values)
      ? (fromContexts as Record<string, unknown>).values
      : Array.isArray(fromDirect)
        ? fromDirect
        : Array.isArray((fromDirect as Record<string, unknown> | undefined)?.values)
          ? (fromDirect as Record<string, unknown>).values
          : [];

  if (!Array.isArray(rawList)) return [];

  return rawList.map((item) => {
    if (typeof item === 'object' && item !== null) {
      return item as Record<string, unknown>;
    }
    return { value: item };
  });
}
