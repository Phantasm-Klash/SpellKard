/**
 * `fetch`-based `HttpClient` for the lobby REST transport.
 */

import type { HttpClient, HttpResponseLike } from '../../core/net/lobby_client';

export class FetchHttpClient implements HttpClient {
  constructor(private readonly baseUrl = '', private readonly bearer = '') {}

  async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponseLike> {
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    };
    if (this.bearer !== '') {
      requestHeaders.Authorization = `Bearer ${this.bearer}`;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    let parsed: unknown = null;
    const text = await response.text();
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: response.status, body: parsed };
  }
}
