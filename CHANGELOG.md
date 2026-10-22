# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-22

Comprehensive feature update incorporating the issue triage suite and project access controls from [`rexlManu/bugsink-mcp`](https://github.com/rexlManu/bugsink-mcp), direct REST endpoint mappings inspired by [`draded/bugsink-mcp`](https://github.com/draded/bugsink-mcp), alignment with the live Bugsink canonical OpenAPI 3.0.3 schema, an ultra-fast Bun build pipeline, and an automated Vitest test suite.

### Added

- **Issue triage tools** (`destructiveHint: true`):
  - `resolve_issue` — supports resolving unconditionally, in the next release (`/issues/{id}/resolve-next/`), or in the latest release (`/issues/{id}/resolve-latest/`).
  - `reopen_issue` — marks a resolved issue as unresolved again (`/issues/{id}/reopen/`).
  - `mute_issue` — mutes an issue indefinitely, for a period (e.g. 3 days), or until a threshold of occurrences is reached (`/issues/{id}/mute-until/`, with `gte_threshold`).
  - `unmute_issue` — unmutes an issue (`/issues/{id}/unmute/`).
  - `comment_on_issue` — creates an issue comment in Bugsink (`POST /api/canonical/0/issue-comments/`).
  - `delete_issue` — permanently deletes an issue and all its events, protected by a mandatory `confirm: true` parameter.
- **Granular event inspection & diagnostic tools**:
  - `get_latest_event_stacktrace` (`readOnlyHint: true`) — directly fetches the newest occurrence's rendered Markdown stacktrace for an issue, saving agent roundtrips.
  - Enhanced `get_event` — adds `section` selection (`summary`, `frames`, `exceptions`, `breadcrumbs`, `stacktrace`, `raw`), `application_only: boolean` (filtering framework/vendor frames like `vendor/` or `node_modules/`), and output character budget caps.
- **Project access controls and read-only gate**:
  - `BUGSINK_ALLOWED_PROJECTS` — comma-separated list of allowed project IDs; restricts queries, issue triage, and mutations strictly to authorized projects.
  - `BUGSINK_READ_ONLY` — locks down the server by disabling all mutating tools (`create_*`, `update_*`, triage actions) when set to `true` (defaults to `false` for full backward compatibility).
- **OpenAPI 3.0.3 schema alignments**:
  - `list_projects`: added optional `team` UUID query parameter.
  - `get_project`: added optional `expand=team` query parameter.
  - `list_issues`: added `digested_event_count` sort mode.
- **Ultra-fast build pipeline**:
  - Migrated build script to `bun build` with external dependency flags, reducing compilation time from hours of `tsc` deadlocks down to ~15ms.
- **Automated test suite**:
  - Added 21 automated unit tests across 5 test suites (`tests/access.test.ts`, `tests/client.test.ts`, `tests/event.test.ts`, `tests/tools.test.ts`, `tests/triage.test.ts`) covering all triage actions, access control boundaries, frame filtering, and tool registration hints.
- **Biome & Oxlint toolchain with TypeScript type checker**:
  - Replaced Prettier with `@biomejs/biome` for sub-30ms formatting and linting (`biome format`, `biome check`).
  - Added `oxlint` for high-speed multi-threaded lint verification.
  - Added fast, non-blocking `tsc --noEmit` type checking (`bun run typecheck` and `bun run check`).

### Attribution

- Issue triage tools, application frame filtering concepts, and project allowlist patterns incorporated from **Emmanuel Lampe** ([`rexlManu/bugsink-mcp`](https://github.com/rexlManu/bugsink-mcp)).
- Direct Bugsink canonical REST endpoint mapping references incorporated from **Domagoj Rade** ([`draded/bugsink-mcp`](https://github.com/draded/bugsink-mcp)).
- Original authorship maintained for **Joris Schelfhout** (`j-shelfwood`).

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
