/**
 * Thin HTTP client for the ArcadeDB REST API.
 *
 * Covers the three main interaction patterns:
 *   - **query**   -- read-only (SELECT, MATCH, TRAVERSE)
 *   - **command** -- write (DDL + DML)
 *   - **batch**   -- multiple commands inside a single transaction
 *
 * Authentication uses HTTP Basic auth derived from the server config.
 */

import { errorMessage } from './errors.js';
import type { ArcadeConfig, BatchCommand, BatchResult, QueryResult } from './types.js';

export class ArcadeHttpClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ArcadeConfig) {
    this.baseUrl = `http://${config.server.host}:${config.server.port}`;
    this.authHeader = 'Basic ' + Buffer.from(
      `${config.server.username}:${config.server.password}`
    ).toString('base64');
  }

  /** Check if ArcadeDB is accepting requests (GET /api/v1/ready -> 204). */
  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/ready`, {
        headers: { 'Authorization': this.authHeader },
      });
      return res.status === 204;
    } catch {
      return false;
    }
  }

  /**
   * Execute a read-only query (SELECT, MATCH, TRAVERSE).
   *
   * @param database - Target database name.
   * @param sql      - The query text.
   * @param params   - Optional parameterized-query bindings.
   * @param language - Query language (`sql`, `cypher`, `gremlin`).
   */
  async query(
    database: string,
    sql: string,
    params?: Record<string, unknown>,
    language = 'sql',
  ): Promise<QueryResult> {
    return this.post(`/api/v1/query/${encodeURIComponent(database)}`, {
      language,
      command: sql,
      ...(params ? { params } : {}),
    });
  }

  /**
   * Execute a write command (DDL or DML).
   *
   * @param database - Target database name.
   * @param sql      - The command text.
   * @param params   - Optional parameterized-query bindings.
   * @param language - Command language (`sql`, `cypher`, `gremlin`).
   */
  async command(
    database: string,
    sql: string,
    params?: Record<string, unknown>,
    language = 'sql',
  ): Promise<QueryResult> {
    return this.post(`/api/v1/command/${encodeURIComponent(database)}`, {
      language,
      command: sql,
      ...(params ? { params } : {}),
    });
  }

  /**
   * Execute multiple commands inside a single transaction.
   *
   * Opens a server-side session, executes each command sequentially, then
   * commits.  On any failure the transaction is rolled back (best-effort).
   *
   * Each item can be a plain SQL string **or** an object with a parameterized
   * `command` and optional `params` (see {@link BatchCommand}).
   */
  async batch(database: string, commands: BatchCommand[]): Promise<BatchResult> {
    const db = encodeURIComponent(database);
    let sessionId: string | null = null;

    try {
      // --- begin transaction ---
      const beginRes = await fetch(`${this.baseUrl}/api/v1/begin/${db}`, {
        method: 'POST',
        headers: { 'Authorization': this.authHeader },
      });
      if (!beginRes.ok) {
        const text = await beginRes.text();
        return { success: false, error: `Failed to begin transaction: ${text}` };
      }
      sessionId = beginRes.headers.get('arcadedb-session-id');

      // --- execute each command ---
      const results: unknown[] = [];
      for (const item of commands) {
        const sql = typeof item === 'string' ? item : item.command;
        const params = typeof item === 'string' ? undefined : item.params;

        const res = await fetch(`${this.baseUrl}/api/v1/command/${db}`, {
          method: 'POST',
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
            ...(sessionId ? { 'arcadedb-session-id': sessionId } : {}),
          },
          body: JSON.stringify({
            language: 'sql',
            command: sql,
            ...(params ? { params } : {}),
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Command failed: ${sql} -- ${text}`);
        }
        const data = await res.json() as { result?: unknown[] };
        results.push(...(data.result ?? []));
      }

      // --- commit ---
      await fetch(`${this.baseUrl}/api/v1/commit/${db}`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          ...(sessionId ? { 'arcadedb-session-id': sessionId } : {}),
        },
      });

      return { success: true, results, committed: true };
    } catch (err: unknown) {
      // Best-effort rollback
      if (sessionId) {
        try {
          await fetch(`${this.baseUrl}/api/v1/rollback/${db}`, {
            method: 'POST',
            headers: {
              'Authorization': this.authHeader,
              'arcadedb-session-id': sessionId,
            },
          });
        } catch { /* rollback is best-effort */ }
      }
      return { success: false, error: errorMessage(err), committed: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** POST JSON to an API path and normalise the response into a QueryResult. */
  private async post(path: string, body: unknown): Promise<QueryResult> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${text}` };
      }
      const data = await res.json() as { result?: unknown[] };
      const result = data.result ?? [];
      return { success: true, result, count: result.length };
    } catch (err: unknown) {
      return { success: false, error: errorMessage(err) };
    }
  }
}
