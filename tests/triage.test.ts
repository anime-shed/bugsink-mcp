import { describe, it, expect, vi } from "vitest";
import { BugsinkClient } from "../src/bugsink-client.js";

describe("BugsinkClient Issue Triage Methods", () => {
  it("resolves an issue unconditionally, next release, or latest release", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "iss-1", is_resolved: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: "https://bugsink.test", apiToken: "test-token" },
      fetcher
    );

    await client.resolveIssue("iss-1");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/resolve/",
      expect.objectContaining({ method: "POST" })
    );

    await client.resolveIssue("iss-1", "next_release");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/resolve-next/",
      expect.objectContaining({ method: "POST" })
    );

    await client.resolveIssue("iss-1", "latest_release");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/resolve-latest/",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reopens and unmutes issues", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "iss-1", is_resolved: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: "https://bugsink.test", apiToken: "test-token" },
      fetcher
    );

    await client.reopenIssue("iss-1");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/reopen/",
      expect.objectContaining({ method: "POST" })
    );

    await client.unmuteIssue("iss-1");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/unmute/",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("mutes an issue indefinitely, for a period, or until a threshold", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "iss-1", is_muted: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );

    const client = new BugsinkClient(
      { baseUrl: "https://bugsink.test", apiToken: "test-token" },
      fetcher
    );

    // Indefinite
    await client.muteIssue("iss-1");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/mute/",
      expect.objectContaining({ method: "POST" })
    );

    // For period
    await client.muteIssue("iss-1", { period_name: "day", nr_of_periods: 3 });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/mute-for/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ period_name: "day", nr_of_periods: 3 }),
      })
    );

    // Until threshold
    await client.muteIssue("iss-1", {
      period_name: "hour",
      nr_of_periods: 1,
      gte_threshold: 10,
    });
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/mute-until/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          period_name: "hour",
          nr_of_periods: 1,
          gte_threshold: 10,
        }),
      })
    );
  });

  it("comments on an issue", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 10,
          issue: "iss-1",
          project: 1,
          timestamp: "2026-06-24T12:00:00Z",
          comment: "Investigating root cause",
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const client = new BugsinkClient(
      { baseUrl: "https://bugsink.test", apiToken: "test-token" },
      fetcher
    );

    const comment = await client.commentOnIssue("iss-1", "Investigating root cause");
    expect(comment.id).toBe(10);
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issue-comments/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          issue: "iss-1",
          comment: "Investigating root cause",
        }),
      })
    );
  });

  it("deletes an issue", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 })
    );

    const client = new BugsinkClient(
      { baseUrl: "https://bugsink.test", apiToken: "test-token" },
      fetcher
    );

    const res = await client.deleteIssue("iss-1");
    expect(res.deleted).toBe(true);
    expect(res.issue_id).toBe("iss-1");
    expect(fetcher).toHaveBeenLastCalledWith(
      "https://bugsink.test/api/canonical/0/issues/iss-1/",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("verifies project ownership for triage mutations when allowedProjects is set", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes("/issues/iss-forbidden/")) {
        return new Response(
          JSON.stringify({ id: "iss-forbidden", project: 99 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ id: "iss-ok", project: 2 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const client = new BugsinkClient(
      {
        baseUrl: "https://bugsink.test",
        apiToken: "test-token",
        allowedProjects: [2],
      },
      fetcher
    );

    await expect(client.resolveIssue("iss-forbidden")).rejects.toThrow(
      /Project access denied by BUGSINK_ALLOWED_PROJECTS/
    );

    await expect(client.resolveIssue("iss-ok")).resolves.toBeDefined();
  });
});
