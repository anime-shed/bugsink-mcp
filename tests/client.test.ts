import { describe, expect, it, vi } from 'vitest';
import { BugsinkClient } from '../src/bugsink-client.js';

describe('BugsinkClient OpenAPI Schema Alignments', () => {
  it('passes team filter in listProjects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ results: [], next: null, previous: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: 'https://bugsink.test', apiToken: 'test-token' },
      fetcher
    );

    await client.listProjects({ team: 'team-uuid-123' });
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://bugsink.test/api/canonical/0/projects/?team=team-uuid-123',
      expect.anything()
    );
  });

  it('passes expand=team parameter in getProject', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: 1, name: 'Proj', team: { id: 't1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: 'https://bugsink.test', apiToken: 'test-token' },
      fetcher
    );

    await client.getProject(1, { expand: 'team' });
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://bugsink.test/api/canonical/0/projects/1/?expand=team',
      expect.anything()
    );
  });

  it('supports digested_event_count sort in listIssues', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ results: [], next: null, previous: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: 'https://bugsink.test', apiToken: 'test-token' },
      fetcher
    );

    await client.listIssues(1, { sort: 'digested_event_count' });
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.stringContaining('sort=digested_event_count'),
      expect.anything()
    );
  });

  it('retrieves the latest event stacktrace directly via getLatestEventStacktrace', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/events/?')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'latest-evt-uuid',
                event_id: 'sdk-id',
                issue: 'iss-1',
                timestamp: '2026-06-24T12:00:00Z',
              },
            ],
            next: null,
            previous: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (urlStr.includes('/events/latest-evt-uuid/')) {
        return new Response(
          JSON.stringify({
            id: 'latest-evt-uuid',
            stacktrace_md: '### Traceback\nException: Boom!',
            data: { message: 'Boom!' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const client = new BugsinkClient(
      { baseUrl: 'https://bugsink.test', apiToken: 'test-token' },
      fetcher
    );

    const stacktrace = await client.getLatestEventStacktrace('iss-1');
    expect(stacktrace).toContain('Exception: Boom!');
  });

  it('returns notice when getLatestEventStacktrace finds no events for issue', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ results: [], next: null, previous: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: 'https://bugsink.test', apiToken: 'test-token' },
      fetcher
    );

    const result = await client.getLatestEventStacktrace('iss-empty');
    expect(result).toBe('No stored events found for this issue.');
  });
});
