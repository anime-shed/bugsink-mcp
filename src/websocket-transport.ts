/**
 * WebSocket Server Transport for Model Context Protocol (MCP).
 * Provides full-duplex JSON-RPC 2.0 communication over WebSocket connections.
 * Fully compatible with both Node.js (18+) and Bun runtimes.
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { RawData, WebSocket } from 'ws';

export class WebSocketServerTransport implements Transport {
  private ws: WebSocket;
  public sessionId?: string;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;
  public onmessage?: (message: JSONRPCMessage) => void;

  constructor(ws: WebSocket, sessionId?: string) {
    this.ws = ws;
    this.sessionId = sessionId;

    this.ws.on('message', (data: RawData) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const parsed = JSON.parse(text) as JSONRPCMessage;
        this.onmessage?.(parsed);
      } catch (err) {
        this.onerror?.(err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.ws.on('close', () => {
      this.onclose?.();
    });

    this.ws.on('error', (err: Error) => {
      this.onerror?.(err);
    });
  }

  async start(): Promise<void> {
    // The underlying WebSocket is already open when passed from the HTTP upgrade event
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    if (this.ws.readyState === 0 /* CONNECTING */ || this.ws.readyState === 1 /* OPEN */) {
      this.ws.close();
    }
    this.onclose?.();
  }
}
