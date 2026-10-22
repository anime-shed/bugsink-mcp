import { describe, expect, it, vi } from 'vitest';
import { BugsinkClient } from '../src/bugsink-client.js';

describe('BugsinkClient Access Controls', () => {
  it('rejects writes when readOnly is enabled', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new BugsinkClient(
      {
        baseUrl: 'https://bugsink.test',
        apiToken: 'test-token',
        readOnly: true,
      },
      fetcher
    );

    await expect(
      client.createProject({
        team: 'team-uuid',
        name: 'Forbidden Project',
      })
    ).rejects.toThrow(/Writes are disabled by BUGSINK_READ_ONLY/);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('enforces allowedProjects on project retrieval and filtering', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { id: 1, name: 'Project 1', team: 't1' },
            { id: 2, name: 'Project 2', team: 't2' },
            { id: 3, name: 'Project 3', team: 't3' },
          ],
          next: null,
          previous: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = new BugsinkClient(
      {
        baseUrl: 'https://bugsink.test',
        apiToken: 'test-token',
        allowedProjects: [2],
      },
      fetcher
    );

    // List projects should filter to only allowed projects
    const projects = await client.listProjects();
    expect(projects.results.map((p) => p.id)).toEqual([2]);

    // getProject for forbidden project should throw
    await expect(client.getProject(1)).rejects.toThrow(
      /Project access denied by BUGSINK_ALLOWED_PROJECTS/
    );

    // getProject for allowed project should succeed
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 2, name: 'Project 2', team: 't2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const proj2 = await client.getProject(2);
    expect(proj2.id).toBe(2);
  });

  it('enforces allowedProjects when querying issues for a project', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new BugsinkClient(
      {
        baseUrl: 'https://bugsink.test',
        apiToken: 'test-token',
        allowedProjects: [5],
      },
      fetcher
    );

    await expect(client.listIssues(2)).rejects.toThrow(
      /Project access denied by BUGSINK_ALLOWED_PROJECTS/
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
