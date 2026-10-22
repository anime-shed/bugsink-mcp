# Bugsink MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for interacting with [Bugsink](https://www.bugsink.com/) error tracking via LLMs.

This server enables AI assistants like Claude, Cursor, and other MCP-compatible tools to query and manage errors in your Bugsink instance.

## Features

- **Read tools** (`readOnlyHint: true`) — explore projects, teams, issues, events, releases, and stacktraces without side effects
- **Write & Triage tools** (`destructiveHint: true`) — resolve, reopen, mute (indefinite, relative duration, or threshold-based), unmute, comment, and delete issues; create/update projects, teams, and releases
- **Granular event inspection & diagnostics** — get compact summaries, filter out vendor/node_modules frames (`application_only`), extract breadcrumbs and exceptions, or fetch the latest event stacktrace directly via `get_latest_event_stacktrace`
- **Security & access controls** — restrict agent queries and triage actions to authorized projects via `BUGSINK_ALLOWED_PROJECTS`, or lock the server into read-only mode via `BUGSINK_READ_ONLY`
- **Cursor-based pagination** — `list_projects`, `list_teams`, `list_issues`, `list_events`, and `list_releases` all return `Next cursor` / `Previous cursor` so LLM agents can walk large result sets without losing filter context
- **Two transports** — stdio (default) for local clients, and Streamable-HTTP (stateless JSON) for remote MCP clients and gateways
- **Container-ready** — multi-stage Dockerfile publishes a Cloud Run–compatible image that listens on `$PORT`

## Installation

### Via npx (Recommended)

```bash
npx bugsink-mcp
```

### Global Install

```bash
npm install -g bugsink-mcp
```

### From Source

```bash
git clone https://github.com/anime-shed/bugsink-mcp.git
cd bugsink-mcp
bun install
bun run build
```

## Configuration

### Environment Variables

| Variable                   | Required           | Default | Description                                                                                                                                                                                                 |
| -------------------------- | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUGSINK_URL`              | Yes (read & write) | —       | Your Bugsink instance URL (e.g., `https://error-tracking.example.com`), with no trailing slash                                                                                                              |
| `BUGSINK_TOKEN`            | Yes (read & write) | —       | API token authenticating requests to the Bugsink API                                                                                                                                                        |
| `BUGSINK_READ_ONLY`        | No                 | `false` | When `true`, disables all mutating tools (`create_*`, `update_*`, `resolve_issue`, `reopen_issue`, `mute_issue`, `unmute_issue`, `comment_on_issue`, `delete_issue`), locking the server to read-only tools |
| `BUGSINK_ALLOWED_PROJECTS` | No                 | unset   | Comma-separated list of allowed integer project IDs (e.g. `1,2,5`). Restricts queries, events, and mutations strictly to the authorized projects                                                            |
| `MCP_HTTP_PORT`            | No                 | unset   | If set (any numeric port), the server runs in Streamable-HTTP mode instead of stdio. Absent → stdio (unchanged default)                                                                                     |
| `PORT`                     | No                 | `8080`  | Alternate HTTP-mode port. Read in addition to `MCP_HTTP_PORT`; either one enables HTTP mode. Cloud Run injects `PORT`, so a default of `8080` is set in the Dockerfile                                      |
| `MCP_HTTP_AUTH_TOKEN`      | No                 | unset   | If set, every HTTP request must carry `Authorization: Bearer <token>` with a matching value; otherwise the server returns `401`. Distinct from `BUGSINK_TOKEN` (the upstream API token)                     |

### Generating an API Token

```bash
# Via Bugsink management command
bugsink-manage create_auth_token
```

Or through the Bugsink web UI under Settings > API Tokens.

## Transports

The server automatically supports multiple transports based on environment variables and connection protocols. There is no separate command-line flag needed.

### 1. stdio (default)

When neither `MCP_HTTP_PORT` nor `PORT` is set, the server reads MCP JSON-RPC from stdin and writes responses to stdout. This is the mode used by Claude Desktop, Cursor, Claude Code, and most local MCP clients — they spawn the server as a subprocess.

```bash
# Run with Node.js
node dist/index.js

# Or run with Bun
bun dist/index.js
```

### 2. Streamable-HTTP (MCP Standard POST `/mcp` & `/`)

Set `PORT=8080` (or `MCP_HTTP_PORT=8080`). The server binds an HTTP listener supporting the latest MCP Streamable HTTP specification. Each request is processed with `StreamableHTTPServerTransport` with `enableJsonResponse: true`, making it fully stateless and safe behind load balancers, reverse proxies, and Kubernetes ingress controllers.

- **Endpoint**: `POST /mcp` (or `POST /`)
- **Required Headers**: `Content-Type: application/json`, `Accept: application/json, text/event-stream`

### 3. WebSockets (Full-Duplex Real-Time `/ws` & `/`)

For real-time streaming, interactive tools, and bidirectional push, the HTTP server accepts WebSocket connections on `/ws` (and root `/` upgrade).

- **WebSocket URL**: `ws://<host>:<port>/ws` (or `wss://<host>/ws` over HTTPS)
- **Subprotocol / Auth**: Provide `Authorization: Bearer <token>`, `Sec-WebSocket-Protocol: <token>`, or `?token=<token>` when `MCP_HTTP_AUTH_TOKEN` is enabled.

### 4. Server-Sent Events (SSE `/sse` & `/messages`)

For streaming responses and compatibility with classic MCP SSE clients:

- **Connect Stream**: `GET /sse` (returns `event: endpoint` with `/messages?sessionId=<id>`)
- **Send Messages**: `POST /messages?sessionId=<id>`

### 5. Healthcheck Probes (`/healthz`, `/health`, `/livez`)

Built-in HTTP GET health endpoints return `200 OK` with JSON service metadata:

```bash
curl http://localhost:8080/healthz
# {"status":"ok","service":"bugsink-mcp","version":"0.4.0","transports":["streamable-http","sse","websocket","stdio"],"bugsink_url":"..."}
```
Essential for Kubernetes liveness/readiness probes and Docker container healthchecks.

---

## Remote HTTPS & WSS Client Configuration

Once deployed behind an HTTPS reverse proxy or Kubernetes ingress (such as `mcp-bugsink.fieldassist.io`), configure your MCP clients using HTTPS and secure WebSockets (`wss://`).

### Streamable HTTP / SSE Client Config (e.g. Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "bugsink-remote": {
      "url": "https://mcp-bugsink.fieldassist.io/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_HTTP_AUTH_TOKEN"
      }
    }
  }
}
```

### WebSocket Client Config

```json
{
  "mcpServers": {
    "bugsink-ws": {
      "url": "wss://mcp-bugsink.fieldassist.io/ws",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_HTTP_AUTH_TOKEN"
      }
    }
  }
}
```

---

## Deployment in Kubernetes (`fa-common` Cluster, `mcp` Namespace)

The server is designed for deployment in the **`fa-common`** Azure Kubernetes (AKS) cluster inside the **`mcp`** namespace, connecting directly to Bugsink running in the same cluster via internal Kubernetes DNS.

### Architecture in `fa-common`

```
┌────────────────────────────────────────────────────────────────────────┐
│                        fa-common AKS Cluster                           │
│                                                                        │
│   [ Namespace: mcp ]                                                   │
│   mcp-bugsink.fieldassist.io (HTTPS / WSS via cert-manager TLS)        │
│       │                                                                │
│       ▼                                                                │
│   Ingress (nginx) ────► Service (mcp-bugsink:8080)                     │
│                             │                                          │
│                             ▼                                          │
│                       Pod (mcp-bugsink)                                │
│                             │                                          │
│                             │ (In-Cluster Internal Networking)         │
│                             ▼                                          │
│   [ Namespace: bugsink ]                                               │
│   http://bugsink-service.bugsink.svc.cluster.local:80                  │
│       │                                                                │
│       ▼                                                                │
│   Pod (bugsink-deployment) ◄──► MariaDB Cluster                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Deployment Steps

1. **Verify your AKS Context with `az` and `kubectl`:**
   ```bash
   # Ensure you are on the fa-common context
   kubectl config use-context fa-common
   ```

2. **Configure Secrets:**
   Copy [`k8s/secret.example.yaml`](file:///c:/Users/Animesh/Desktop/Reference_Projects/MCP/bugsink-mcp/k8s/secret.example.yaml) to `k8s/secret.yaml` and set your Bugsink token:
   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: mcp-bugsink-secret
     namespace: mcp
   type: Opaque
   stringData:
     BUGSINK_TOKEN: "your_bugsink_token_here"
     MCP_HTTP_AUTH_TOKEN: "your_secret_bearer_token_here"
   ```

3. **Deploy with Kustomize:**
   ```bash
   kubectl apply -k k8s/
   # or apply secret and kustomize
   kubectl apply -f k8s/secret.yaml
   kubectl apply -k k8s/
   ```

4. **Verify Deployment:**
   ```bash
   kubectl get pods,svc,ingress -n mcp -l app=mcp-bugsink
   ```

5. **Test In-Cluster or via HTTPS:**
   ```bash
   # Test healthcheck
   curl -k https://mcp-bugsink.fieldassist.io/healthz

   # Test Streamable HTTP over HTTPS
   curl -k -X POST https://mcp-bugsink.fieldassist.io/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
   ```

---

## Container Builds (Node & Bun Multi-Target)

The multi-stage [`Dockerfile`](file:///c:/Users/Animesh/Desktop/Reference_Projects/MCP/bugsink-mcp/Dockerfile) supports both Node.js and Bun runtimes:

```bash
# Build with default Node.js runtime
docker build -t ghcr.io/anime-shed/bugsink-mcp:latest .

# Build with Bun runtime (ultralight & fast)
docker build --target runtime-bun -t ghcr.io/anime-shed/bugsink-mcp:bun .

# Run locally
docker run --rm -p 8080:8080 \
  -e BUGSINK_URL=https://fa-bugsink.fieldassist.io \
  -e BUGSINK_TOKEN=your-token \
  -e MCP_HTTP_AUTH_TOKEN=secret \
  ghcr.io/anime-shed/bugsink-mcp:latest
```

---

## MCP Client Configuration (Local stdio)

## Available Tools

Each tool exposes an MCP `annotations` block:
- **Read tools** carry `readOnlyHint: true` — they only fetch state from Bugsink and never mutate it.
- **Write tools** carry `destructiveHint: true` — they create/update records in your Bugsink instance.

### Connection

#### `test_connection` _(read)_

Test connectivity to your Bugsink instance.

### Projects

#### `list_projects` _(read)_

List all projects. Paginated.

**Parameters:**
- `cursor` (string, optional): Opaque cursor from a previous response's `Next cursor` or `Previous cursor`

#### `get_project` _(read)_

Get detailed information about a specific project including DSN.

**Parameters:**
- `project_id` (number, required): The project ID

#### `create_project` _(write)_

Create a new project in a team.

**Parameters:**
- `team_id` (string, required): The team UUID
- `name` (string, required): The project name
- `visibility` (enum, optional): `joinable` | `discoverable` | `team_members` (default: `team_members`)
- `alert_on_new_issue` (boolean, optional, default `true`)
- `alert_on_regression` (boolean, optional, default `true`)
- `alert_on_unmute` (boolean, optional, default `true`)

#### `update_project` _(write)_

Update an existing project's settings.

**Parameters:**
- `project_id` (number, required): The project ID
- `name` (string, optional)
- `visibility` (enum, optional)
- `alert_on_new_issue` (boolean, optional)
- `alert_on_regression` (boolean, optional)
- `alert_on_unmute` (boolean, optional)
- `retention_max_event_count` (number, optional)

### Teams

#### `list_teams` _(read)_

List all teams. Paginated.

**Parameters:**
- `cursor` (string, optional)

#### `create_team` _(write)_

Create a new team.

**Parameters:**
- `name` (string, required)
- `visibility` (enum, optional): `joinable` | `discoverable` | `hidden` (default: `discoverable`)

#### `update_team` _(write)_

Update an existing team.

**Parameters:**
- `team_id` (string, required): The team UUID
- `name` (string, optional)
- `visibility` (enum, optional)

### Issues

#### `list_issues` _(read)_

List issues for a specific project. Paginated.

**Parameters:**
- `project_id` (number, required)
- `status` (enum, optional): `open` | `unresolved` | `resolved` | `muted` | `all`
- `limit` (number, optional, default `25`)
- `sort` (enum, optional): `digest_order` | `last_seen` | `digested_event_count`
- `order` (enum, optional): `asc` | `desc`
- `cursor` (string, optional)

#### `get_issue` _(read)_

Get detailed information about a specific issue.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

#### `resolve_issue` _(write)_

Resolve an issue unconditionally, in the next release, or in the latest release.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `mode` (enum, optional): `unconditionally` (default) | `next_release` | `latest_release`

#### `reopen_issue` _(write)_

Reopen a previously resolved issue, returning it to unresolved state.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

#### `mute_issue` _(write)_

Mute an issue indefinitely, for a relative period (e.g. 3 days), or until an occurrence threshold is reached.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `mode` (enum, optional): `indefinite` (default) | `for_period` | `until_threshold`
- `period_name` (enum, optional): `minute` | `hour` | `day` | `week` | `month` | `year`
- `nr_of_periods` (number, optional): Positive integer (e.g. 3)
- `gte_threshold` (number, optional): Integer threshold for `until_threshold` mode

#### `unmute_issue` _(write)_

Unmute a muted issue.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID

#### `comment_on_issue` _(write)_

Add a diagnostic or team comment visible in Bugsink's issue history.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `comment` (string, required): Comment text (1–4000 characters)

#### `delete_issue` _(write)_

Permanently delete an issue and all its events in Bugsink. Requires explicit safety confirmation.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `confirm` (literal `true`, required): Must be set to `true` to execute deletion

#### `analyze_issue_context` _(read)_

Holistic analysis tool — retrieves issue details, recent events, and the most recent full stacktrace in one call. Preferred when an LLM is investigating a single issue end-to-end.

**Parameters:**
- `issue_id` (string, required): The issue UUID

### Events

#### `list_events` _(read)_

List events (individual error occurrences) for a specific issue. Paginated.

**Parameters:**
- `issue_id` (string, required): The issue UUID
- `limit` (number, optional, default `10`)
- `cursor` (string, optional)

#### `get_event` _(read)_

Get detailed event information. Supports targeted section retrieval and filtering out framework/vendor stack frames.

**Parameters:**
- `event_id` (string, required): The Bugsink-internal event ID (use `id` from `list_events`, not `event_id`)
- `section` (enum, optional, default `summary`): `summary` | `frames` | `exceptions` | `breadcrumbs` | `stacktrace` | `raw`
- `application_only` (boolean, optional, default `true`): Excludes vendor/ and node_modules/ frames from frames view
- `include_source` (boolean, optional, default `true`): Includes source code context lines
- `max_chars` (number, optional, default `4000`): Maximum character limit for output text

#### `get_stacktrace` _(read)_

Get an event's stacktrace as Markdown. Uses the Bugsink-internal event ID (`id` field from `list_events`).

**Parameters:**
- `event_id` (string, required): The Bugsink-internal event ID

#### `get_latest_event_stacktrace` _(read)_

Read the newest stored occurrence of an issue directly as a rendered Markdown stacktrace, saving agent roundtrips.

**Parameters:**
- `issue_id` (string, required): The issue UUID or friendly ID
- `max_chars` (number, optional, default `4000`)

### Releases

#### `list_releases` _(read)_

List releases for a project. Paginated.

**Parameters:**
- `project_id` (number, required)
- `cursor` (string, optional)

#### `get_release` _(read)_

Get detailed information about a specific release.

**Parameters:**
- `release_id` (string, required): The release UUID

#### `create_release` _(write)_

Create a new release for a project.

**Parameters:**
- `project_id` (number, required)
- `version` (string, required): e.g. `1.0.0`, `v2.3.1`
- `timestamp` (string, optional): ISO 8601 timestamp; defaults to "now"

## Example Usage

Once configured, you can ask your AI assistant:
- "List all projects in Bugsink"
- "Show me the latest issues for project 1"
- "What's the stacktrace for the latest event on issue #42?"
- "Resolve issue APP-45 in the next release"
- "Mute issue 1234 for 3 days"
- "Comment on issue #10: 'Investigating potential memory leak in checkout loop'"
- "Analyze the context of this incident — pull the issue details, recent events, and stacktrace"
- "Mark release v2.3.1 for project 4"

## Development

```bash
# Install dependencies
bun install

# Run in development mode (stdio)
bun run dev

# Run in development mode with HTTP transport
MCP_HTTP_PORT=8080 bun run dev

# Build for production (bundles in ~20ms)
bun run build

# Run automated tests
bun test

# Typecheck with TypeScript
bun run typecheck

# Lint with Biome or Oxlint
bun run lint
bun run lint:oxlint

# Format with Biome
bun run format

# Run full verification (typecheck + biome check)
bun run check
```

The `dist/index.js` binary doubles as the npm package entrypoint. After `bun run build` you can invoke it directly with `node dist/index.js` or `bun dist/index.js`.

## API Compatibility

This server is designed for [Bugsink](https://www.bugsink.com/), a self-hosted error tracking platform. Bugsink uses its own REST API (`/api/canonical/0/`) which is different from Sentry's API.

**Note:** This server does NOT work with Sentry or Sentry-hosted services. For Sentry, use the official [sentry-mcp](https://github.com/getsentry/sentry-mcp) server.

## License

MIT

## Contributors

The original version of this server lives upstream at [`j-shelfwood/bugsink-mcp`](https://github.com/j-shelfwood/bugsink-mcp.git). This curated fork incorporates enhancements cherry-picked from [`razzaque/bugsink-mcp`](https://github.com/razzaque/bugsink-mcp.git), triage and access control capabilities from [`rexlManu/bugsink-mcp`](https://github.com/rexlManu/bugsink-mcp.git), direct Bugsink canonical mappings from [`draded/bugsink-mcp`](https://github.com/draded/bugsink-mcp.git), and ships them on top of j-shelfwood's base. Thanks to everyone who has contributed code, ideas, or reviews.

| Contributor                                                               | Role                    | Highlights                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Joris Schelfhout](https://github.com/j-shelfwood) (`joris@shelfwood.co`) | Original author         | Initial release, mutation tools, API coverage (`v0.1.0` → `v0.2.0`)                                                                                                          |
| [jacobfrantz1](https://github.com/jacobfrantz1)                           | Pagination contributor  | Filter-signature-aware cursors, spill cap raised to 5, ID disambiguation                                                                                                     |
| [Brian Razzaque](https://github.com/razzaque) (`razzaque@gmail.com`)      | Transports + UX         | Streamable-HTTP transport, Cloud Run–ready container, MCP tool annotations (`readOnlyHint` / `destructiveHint`), stacktrace workaround                                       |
| [Emmanuel Lampe](https://github.com/rexlManu) (`mail@emmanuel-lampe.de`)  | Triage & Governance     | Issue triage suite (resolve, reopen, mute, unmute, comment, delete), in-app stack frame filtering, project access controls (`BUGSINK_ALLOWED_PROJECTS`, `BUGSINK_READ_ONLY`) |
| [Domagoj Rade](https://github.com/draded) (`dom@bitreport.app`)           | API mapping contributor | Direct canonical Bugsink REST endpoint mapping reference                                                                                                                     |
| [Animesh](https://github.com/anime-shed) (`animesh@flick2know.com`)       | Fork maintainer         | Curated integration of upstream enhancements, OpenAPI 3.0 schema alignment, test suite, documentation                                                                        |

If you'd like to be listed here, open a PR — link it in the description and it'll be added on merge.

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/anime-shed/bugsink-mcp).
