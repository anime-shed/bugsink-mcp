# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Streamable-HTTP transport** alongside stdio. Enable by setting `MCP_HTTP_PORT`
  or `PORT`; otherwise stdio remains the default. Stateless per-request
  `StreamableHTTPServerTransport` with `enableJsonResponse: true` so the server
  is safe behind a load balancer.
- **Optional bearer-token gate** for the HTTP transport via `MCP_HTTP_AUTH_TOKEN`.
  When set, every request must carry `Authorization: Bearer ***  returning
  `401` otherwise. Distinct from `BUGSINK_TOKEN` (the upstream API token).
- **Cloud Run–ready container image.** Multi-stage `Dockerfile` (Node 20-slim)
  builds TypeScript in a build stage, ships only `dist/` + production deps in the
  runtime stage, defaults `PORT=8080`, and exposes it.
- **MCP tool annotations.** Every tool now declares either `readOnlyHint: true`
  or `destructiveHint: true`, so MCP clients can classify read-vs-write from the
  tool list itself instead of per-tool operator config.
- **Documentation:** `README.md` rewritten with a Transports section, expanded
  environment-variable table, the full tool inventory (with `(read)` / `(write)`
  markers and pagination notes), and Cloud Run deployment instructions.

### Attribution

The HTTP transport, Dockerfile, and tool-annotation commits were authored by
**Brian Razzaque** (`razzaque@gmail.com`) on the
[`razzaque/bugsink-mcp`](https://github.com/razzaque/bugsink-mcp) fork and
cherry-picked verbatim onto `main` of this repository so that authorship,
commit dates, and `Co-Authored-By` trailers are preserved.

- `dfdfa29` — feat: add Streamable-HTTP transport (stateless) alongside stdio
- `0e0eee6` — feat: Cloud Run-ready container + listen on $PORT
- `d5fa449` — feat: declare tool annotations (readOnlyHint / destructiveHint)

### Notes

- The `fix(stacktrace): work around broken /stacktrace/ endpoint; add pagination`
  work was already present on `main` prior to this release (commit `0f54628`).
- No version bump yet — waiting on a maintainer triage of the new `MCP_HTTP_*`
  environment surface before tagging `0.3.0`.
