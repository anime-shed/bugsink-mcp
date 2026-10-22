import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startHttpServer } from '../src/index.js';

describe('MCP Server Multi-Transport HTTP/SSE/WebSocket Suite', () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    process.env.BUGSINK_URL = 'https://bugsink.test';
    process.env.BUGSINK_TOKEN = 'test-token';
    // Port 0 binds to a random available OS port
    server = await startHttpServer(0);
    const addr = server.address();
    if (typeof addr === 'object' && addr !== null) {
      port = addr.port;
      baseUrl = `http://127.0.0.1:${port}`;
      wsUrl = `ws://127.0.0.1:${port}`;
    } else {
      throw new Error('Failed to bind server address');
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves healthcheck endpoints with status 200 for Kubernetes probes', async () => {
    for (const path of ['/healthz', '/health', '/livez']) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; transports: string[] };
      expect(data.status).toBe('ok');
      expect(data.transports).toContain('streamable-http');
      expect(data.transports).toContain('sse');
      expect(data.transports).toContain('websocket');
    }
  });

  it('handles CORS preflight OPTIONS requests', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('handles Streamable HTTP POST /mcp initialization', async () => {
    const initPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    };

    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(initPayload),
    });

    const text = await res.text();
    expect(res.status).toBe(200);
    const data = JSON.parse(text) as { jsonrpc: string; id: number; result: any };
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result.serverInfo.name).toBe('bugsink-mcp');
  });

  it('establishes SSE stream connection via GET /sse', async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/sse`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Read initial endpoint event
    const reader = res.body?.getReader();
    if (reader) {
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('event: endpoint');
      expect(text).toContain('/messages?sessionId=');
    }
    controller.abort();
  });

  it('connects and communicates full-duplex over WebSocket transport via /ws', async () => {
    const ws = new WebSocket(`${wsUrl}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const initMessage = {
      jsonrpc: '2.0',
      id: 101,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ws-client', version: '1.0.0' },
      },
    };

    const responsePromise = new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString('utf8'));
        resolve(parsed);
      });
    });

    ws.send(JSON.stringify(initMessage));

    const response = await responsePromise;
    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(101);
    expect(response.result.serverInfo.name).toBe('bugsink-mcp');

    ws.close();
  });
});
