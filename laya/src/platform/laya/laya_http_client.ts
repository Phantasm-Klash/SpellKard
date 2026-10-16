/**
 * `HttpClient` for LayaAir builds, backed by `XMLHttpRequest`.
 *
 * The browser bootstrap originally wired `FetchHttpClient` here, which works in a
 * browser but **not** in LayaNative: the native runtime ships
 * `XMLHttpRequest` (the engine's own `Laya.HttpRequest` is built on it) but no
 * `fetch`, so every REST-only lobby call threw
 * `ReferenceError: fetch is not defined`. `WsLobbyTransport` routes all
 * non-WS operations (`match.ready`, `battle.allocation`, `battle.ticket`,
 * matchmaking, check-in, shop, inventory) through its HTTP fallback, so on the
 * Windows exe the very first `ready()` surfaced as
 * `lobby_transport_error:match.ready`.
 *
 * `XMLHttpRequest` exists in both targets, so this adapter is used everywhere and
 * removes the browser-only dependency.
 */

import type { BinaryHttpResponseLike, HttpClient, HttpResponseLike } from '../../core/net/lobby_client';

/** Default per-request timeout: the lobby answers in milliseconds when healthy. */
const DEFAULT_TIMEOUT_MS = 15000;

/** Resolves `XMLHttpRequest` from the global scope or the Laya browser shim. */
function resolveXhrConstructor(): (new () => XMLHttpRequest) | null {
  const globalScope = globalThis as unknown as Record<string, unknown>;
  const direct = globalScope.XMLHttpRequest;
  if (typeof direct === 'function') {
    return direct as new () => XMLHttpRequest;
  }
  const laya = globalScope.Laya as { Browser?: { window?: Record<string, unknown> } } | undefined;
  const fromWindow = laya?.Browser?.window?.XMLHttpRequest;
  if (typeof fromWindow === 'function') {
    return fromWindow as new () => XMLHttpRequest;
  }
  return null;
}

export class LayaHttpClient implements HttpClient {
  constructor(
    private readonly baseUrl = '',
    private readonly bearer = '',
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponseLike> {
    return new Promise<HttpResponseLike>((resolve, reject) => {
      const Xhr = resolveXhrConstructor();
      if (Xhr === null) {
        reject(new Error('laya_http_unavailable'));
        return;
      }
      const xhr = new Xhr();
      let settled = false;
      const fail = (reason: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(reason));
      };

      xhr.open(method, `${this.baseUrl}${path}`, true);
      xhr.timeout = this.timeoutMs;
      try {
        xhr.setRequestHeader('Content-Type', 'application/json');
        if (this.bearer !== '') {
          xhr.setRequestHeader('Authorization', `Bearer ${this.bearer}`);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          xhr.setRequestHeader(key, value);
        }
      } catch {
        // Some native shims reject header writes before `open`; the request can
        // still proceed without them.
      }

      xhr.onreadystatechange = (): void => {
        // 4 === DONE. Native shims are not guaranteed to fire `onload`.
        if (xhr.readyState !== 4 || settled) {
          return;
        }
        settled = true;
        const text = xhr.responseText ?? '';
        let parsed: unknown = null;
        if (text !== '') {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }
        resolve({ status: xhr.status, body: parsed });
      };
      xhr.onerror = (): void => fail('laya_http_network_error');
      xhr.ontimeout = (): void => fail('laya_http_timeout');

      try {
        xhr.send(method === 'POST' ? JSON.stringify(body ?? {}) : null);
      } catch (error) {
        fail(`laya_http_send_failed:${String(error)}`);
      }
    });
  }

  /**
   * Raw-bytes GET for binary endpoints (the `.dem` download). Uses
   * `responseType = 'arraybuffer'`; the JSON `request` path above cannot carry
   * octet-stream without corrupting it through `responseText`.
   */
  requestBytes(
    method: 'GET',
    path: string,
    headers?: Record<string, string>,
  ): Promise<BinaryHttpResponseLike> {
    return new Promise<BinaryHttpResponseLike>((resolve, reject) => {
      const Xhr = resolveXhrConstructor();
      if (Xhr === null) {
        reject(new Error('laya_http_unavailable'));
        return;
      }
      const xhr = new Xhr();
      let settled = false;
      const fail = (reason: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(reason));
      };

      xhr.open(method, `${this.baseUrl}${path}`, true);
      xhr.timeout = this.timeoutMs;
      try {
        xhr.responseType = 'arraybuffer';
        if (this.bearer !== '') {
          xhr.setRequestHeader('Authorization', `Bearer ${this.bearer}`);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          xhr.setRequestHeader(key, value);
        }
      } catch {
        // Some native shims reject responseType/header writes before `open`.
      }

      xhr.onreadystatechange = (): void => {
        if (xhr.readyState !== 4 || settled) {
          return;
        }
        settled = true;
        const response = xhr.response as ArrayBuffer | null;
        const bytes = response === null ? new Uint8Array(0) : new Uint8Array(response);
        resolve({ status: xhr.status, bytes });
      };
      xhr.onerror = (): void => fail('laya_http_network_error');
      xhr.ontimeout = (): void => fail('laya_http_timeout');

      try {
        xhr.send(null);
      } catch (error) {
        fail(`laya_http_send_failed:${String(error)}`);
      }
    });
  }
}
