# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-24

Curated-fork release. Cherry-picks three enhancements from
[`razzaque/bugsink-mcp`](https://github.com/razzaque/bugsink-mcp) on top of
j-shelfwood's `v0.2.0` base, then refreshes documentation and metadata to
match. No breaking changes — stdio transport and the existing
`BUGSINK_URL` / `BUGSINK_TOKEN` environment variables behave exactly as before.

### Added

- **Streamable-HTTP transport** alongside stdio. Enable by setting `MCP_HTTP_PORT`
  or `PORT`; otherwise stdio remains the default. Stateless per-request
  `StreamableHTTPServerTransport` with `enableJsonResponse: true` so the server
  is safe behind a load balancer.
- **Optional bearer-token gate** for the HTTP transport via `MCP_HTTP_AUTH_TOKEN`.
  When set, every request must carry a matching `Authorization: Bearer ***`
  header; mismatched/missing values return `401`. The token is compared
  verbatim and is distinct from `BUGSINK_TOKEN` (the upstream API token).
- **Cloud Run–ready container image.** Multi-stage `Dockerfile` (Node 20-slim)
  builds TypeScript in a build stage and ships only `dist/` + production
  dependencies in the runtime stage. Defaults `PORT=8080` (the Cloud Run
  contract) and exposes it. `.dockerignore` keeps `node_modules`, `dist`,
  `.git`, and `*.log` out of the build context.
- **MCP tool annotations.** Every tool declares either `readOnlyHint: true`
  or `destructiveHint: true`, letting MCP clients (e.g. governed proxies)
  classify read-vs-write from `tools/list` without per-tool operator config.
- **Documentation refresh.** `README.md` rewritten with a Transports section
  (stdio vs Streamable-HTTP vs container), an expanded environment-variable
  table, the full tool inventory with `(read)` / `(write)` markers and
  pagination notes, Cloud Run deployment instructions, and a Contributors
  section crediting the four authors whose commits live in this repo's
  history. `CHANGELOG.md` introduced in this release.
- **Repository metadata updated.** `package.json` `repository.url` now points
  at the curated fork (`anime-shed/bugsink-mcp`).

### Attribution

The HTTP-transport, Dockerfile, and tool-annotation commits were authored by
**Brian Razzaque** (`razzaque@gmail.com`) on the
[`razzaque/bugsink-mcp`](https://github.com/razzaque/bugsink-mcp) fork and
cherry-picked onto `main` of this repository. Authorship, commit dates, and
`Co-Authored-By` trailers are preserved verbatim:

- `dfdfa29` — feat: add Streamable-HTTP transport (stateless) alongside stdio
- `0e0eee6` — feat: Cloud Run-ready container + listen on $PORT
- `d5fa449` — feat: declare tool annotations (readOnlyHint / destructiveHint)

### Notes

- The `fix(stacktrace): work around broken /stacktrace/ endpoint; add pagination`
  work was already present on `main` prior to this release (commit `0f54628`,
  authored by razzaque on the same fork and merged independently of j-shelfwood's
  history).
- Bumped to `0.3.0` rather than `0.2.1` because of the new `MCP_HTTP_*`
  environment-variable surface and the new Docker / HTTP deployment contract.
  Both are additive — no existing user of `npx bugsink-mcp` against stdio
  needs to change anything.

## [0.2.0]

Original release baseline carried into this fork. Mutation tools
(`create_project`, `update_project`, `create_team`, `update_team`,
`create_release`, `get_release`, `get_stacktrace`) and complete API
coverage via [j-shelfwood/bugsink-mcp](https://github.com/j-shelfwood/bugsink-mcp).
