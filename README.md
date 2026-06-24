# Bugsink MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for interacting with [Bugsink](https://www.bugsink.com/) error tracking via LLMs.

This server enables AI assistants like Claude, Cursor, and other MCP-compatible tools to query and manage errors in your Bugsink instance.

## Features

- **Read tools** (`readOnlyHint: true`) — explore projects, teams, issues, events, releases, and stacktraces without side effects
- **Write tools** (`destructiveHint: true`) — create/update projects and teams, mark releases
- **Cursor-based pagination** — `list_projects`, `list_teams`, `list_issues`, `list_events`, and `list_releases` all return `Next cursor` / `Previous cursor` so LLM agents can walk large result sets without losing the filter context
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
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BUGSINK_URL` | Yes (read & write) | — | Your Bugsink instance URL (e.g., `https://error-tracking.example.com`), with no trailing slash |
| `BUGSINK_TOKEN` | Yes (read & write) | — | API token authenticating requests to the Bugsink API |
| `MCP_HTTP_PORT` | No | unset | If set (any numeric port), the server runs in Streamable-HTTP mode instead of stdio. Absent → stdio (unchanged default) |
| `PORT` | No | `8080` | Alternate HTTP-mode port. Read in addition to `MCP_HTTP_PORT`; either one enables HTTP mode. Cloud Run injects `PORT`, so a default of `8080` is set in the Dockerfile |
| `MCP_HTTP_AUTH_TOKEN` | No | unset | If set, every HTTP request must carry `Authorization: Bearer <token>` with a matching value; otherwise the server returns `401`. Distinct from `BUGSINK_TOKEN` (the upstream API token) |

### Generating an API Token

```bash
# Via Bugsink management command
bugsink-manage create_auth_token
```

Or through the Bugsink web UI under Settings > API Tokens.

## Transports

The server picks a transport at startup based on environment variables. There is no separate command-line flag.

### stdio (default)

When neither `MCP_HTTP_PORT` nor `PORT` is set, the server reads MCP JSON-RPC from stdin and writes responses to stdout. This is the mode used by Claude Desktop, Cursor, Claude Code, and most local MCP clients — they spawn the server as a subprocess.

### Streamable-HTTP (stateless)

Set `MCP_HTTP_PORT` (or `PORT`) and the server binds a plain Node `http` listener. Each request gets a fresh server + `StreamableHTTPServerTransport` pair (`enableJsonResponse: true`), so the server is fully stateless and safe behind a load balancer or in a Cloud Run service.

Clients must send `Accept: application/json, text/event-stream` and `Content-Type: application/json`. A `POST` is required for every MCP request; other methods return `405`. A fresh body parser accepts one JSON object per request.

If `MCP_HTTP_AUTH_TOKEN` is set, every request must include `Authorization: Bearer <token>` matching the environment value. The token is compared verbatim; mismatched/missing headers return `401 unauthorized`. Use this when fronting the server with an MCP gateway you trust to handle user authentication.

### Container (Cloud Run / any OCI runtime)

```bash
docker build -t bugsink-mcp .
docker run --rm -p 8080:8080 \
  -e BUGSINK_URL=https://your-bugsink.example.com \
  -e BUGSINK_TOKEN=your-api-token \
  -e MCP_HTTP_AUTH_TOKEN=$(openssl rand -hex 32) \
  bugsink-mcp
```

The image is multi-stage (Node 20-slim): TypeScript is compiled in the build stage and only `dist/` + production dependencies land in the runtime image. `PORT=8080` is the default, matching Cloud Run's contract; override at deploy time if your platform uses a different port.

For Cloud Run, deploy with both `BUGSINK_TOKEN` and `MCP_HTTP_AUTH_TOKEN` stored as Secret Manager secrets and injected as env vars. Allow unauthenticated invocations only if you intend to publicly expose the server (not recommended).

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop configuration (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bugsink": {
      "command": "npx",
      "args": ["bugsink-mcp"],
      "env": {
        "BUGSINK_URL": "https://your-bugsink-instance.com",
        "BUGSINK_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add bugsink -- npx bugsink-mcp
```

Then set environment variables in your shell or `.env` file.

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "bugsink": {
      "command": "npx",
      "args": ["bugsink-mcp"],
      "env": {
        "BUGSINK_URL": "https://your-bugsink-instance.com",
        "BUGSINK_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Remote HTTP client (e.g. an MCP gateway)

Point the client at `http://<host>:<MCP_HTTP_PORT>` with `Authorization: Bearer <MCP_HTTP_AUTH_TOKEN>` if configured.

## Available Tools

Each tool exposes an MCP `annotations` block:

- **Read tools** carry `readOnlyHint: true` — they only fetch state from Bugsink and never mutate it.
- **Write tools** carry `destructiveHint: true` — they create/update records in your Bugsink instance.

### Connection

#### `test_connection` *(read)*
Test connectivity to your Bugsink instance.

### Projects

#### `list_projects` *(read)*
List all projects. Paginated.

**Parameters:**
- `cursor` (string, optional): Opaque cursor from a previous response's `Next cursor` or `Previous cursor`

#### `get_project` *(read)*
Get detailed information about a specific project including DSN.

**Parameters:**
- `project_id` (number, required): The project ID

#### `create_project` *(write)*
Create a new project in a team.

**Parameters:**
- `team_id` (string, required): The team UUID
- `name` (string, required): The project name
- `visibility` (enum, optional): `joinable` | `discoverable` | `team_members` (default: `team_members`)
- `alert_on_new_issue` (boolean, optional, default `true`)
- `alert_on_regression` (boolean, optional, default `true`)
- `alert_on_unmute` (boolean, optional, default `true`)

#### `update_project` *(write)*
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

#### `list_teams` *(read)*
List all teams. Paginated.

**Parameters:**
- `cursor` (string, optional)

#### `create_team` *(write)*
Create a new team.

**Parameters:**
- `name` (string, required)
- `visibility` (enum, optional): `joinable` | `discoverable` | `hidden` (default: `discoverable`)

#### `update_team` *(write)*
Update an existing team.

**Parameters:**
- `team_id` (string, required): The team UUID
- `name` (string, optional)
- `visibility` (enum, optional)

### Issues

#### `list_issues` *(read)*
List issues for a specific project. Paginated.

**Parameters:**
- `project_id` (number, required)
- `status` (string, optional): e.g. `unresolved`, `resolved`, `muted`
- `limit` (number, optional, default `25`)
- `sort` (enum, optional): `digest_order` | `last_seen`
- `order` (enum, optional): `asc` | `desc`
- `cursor` (string, optional)

#### `get_issue` *(read)*
Get detailed information about a specific issue.

**Parameters:**
- `issue_id` (string, required): The issue UUID

#### `analyze_issue_context` *(read)*
Holistic analysis tool — retrieves issue details, recent events, and the most recent full stacktrace in one call. Preferred when an LLM is investigating a single issue end-to-end.

**Parameters:**
- `issue_id` (string, required): The issue UUID

### Events

#### `list_events` *(read)*
List events (individual error occurrences) for a specific issue. Paginated.

**Parameters:**
- `issue_id` (string, required): The issue UUID
- `limit` (number, optional, default `10`)
- `cursor` (string, optional)

#### `get_event` *(read)*
Get detailed event information including full stacktrace and context.

**Parameters:**
- `event_id` (string, required): The event UUID

#### `get_stacktrace` *(read)*
Get an event's stacktrace as Markdown. The `event_id` here is the Bugsink-internal event ID (the `id` field returned by `list_events`), **not** the application-level `event_id`.

**Parameters:**
- `event_id` (string, required): The Bugsink-internal event ID

### Releases

#### `list_releases` *(read)*
List releases for a project. Paginated.

**Parameters:**
- `project_id` (number, required)
- `cursor` (string, optional)

#### `get_release` *(read)*
Get detailed information about a specific release.

**Parameters:**
- `release_id` (string, required): The release UUID

#### `create_release` *(write)*
Create a new release for a project.

**Parameters:**
- `project_id` (number, required)
- `version` (string, required): e.g. `1.0.0`, `v2.3.1`
- `timestamp` (string, optional): ISO 8601 timestamp; defaults to "now"

## Example Usage

Once configured, you can ask your AI assistant:

- "List all projects in Bugsink"
- "Show me the latest issues for project 1"
- "What's the stacktrace for issue #42?"
- "Analyze the context of this incident — pull the issue details, recent events, and stacktrace"
- "Mark release v2.3.1 for project 4"
- "Get the details of the most recent error event"

## Development

```bash
# Install dependencies
npm install

# Run in development mode (stdio)
npm run dev

# Run in development mode with HTTP transport
MCP_HTTP_PORT=8080 npm run dev

# Build for production
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format
```

The `dist/index.js` binary doubles as the npm package entrypoint. After `npm run build` you can invoke it directly with `node dist/index.js` and the same env-var-driven transport selection applies.

## API Compatibility

This server is designed for [Bugsink](https://www.bugsink.com/), a self-hosted error tracking platform. Bugsink uses its own REST API (`/api/canonical/0/`) which is different from Sentry's API.

**Note:** This server does NOT work with Sentry or Sentry-hosted services. For Sentry, use the official [sentry-mcp](https://github.com/getsentry/sentry-mcp) server.

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/anime-shed/bugsink-mcp).
