/**
 * Lightweight ArcadeDB HTTP client for ability-log.
 *
 * Modeled after ability-arcadedb's http-client.ts but stripped to essentials:
 * query (SELECT) and command (INSERT/CREATE/DELETE). No transactions needed —
 * log writes are fire-and-forget, not transactional.
 *
 * Config is loaded by `./config.ts` following KĀDI Convention Section 6:
 *   env vars > config.toml [arcadedb] section > defaults
 * Credentials come from secret-ability's arcadedb vault (env vars).
 */

export interface ArcadeClientConfig {
  host: string;
  port: number;
  protocol: string;
  username: string;
  password: string;
  database: string;
}

export interface QueryResult {
  success: boolean;
  result?: unknown[];
  count?: number;
  error?: string;
}

export class ArcadeClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly database: string;

  constructor(config: ArcadeClientConfig) {
    // For port 443 (HTTPS via gateway), omit port from URL
    const portSuffix = config.port === 443 ? '' : `:${config.port}`;
    this.baseUrl = `${config.protocol}://${config.host}${portSuffix}`;
    this.authHeader = 'Basic ' + Buffer.from(
      `${config.username}:${config.password}`,
    ).toString('base64');
    this.database = config.database;
  }

  /** Check if ArcadeDB is accepting requests. */
  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/ready`, {
        headers: { Authorization: this.authHeader },
      });
      return res.status === 204;
    } catch {
      return false;
    }
  }

  /** Execute a read-only query (SELECT). */
  async query(sql: string, params?: Record<string, unknown>): Promise<QueryResult> {
    return this.post(`/api/v1/query/${encodeURIComponent(this.database)}`, {
      language: 'sql',
      command: sql,
      ...(params ? { params } : {}),
    });
  }

  /** Execute a write command (CREATE, INSERT, UPDATE, DELETE). */
  async command(sql: string, params?: Record<string, unknown>): Promise<QueryResult> {
    return this.post(`/api/v1/command/${encodeURIComponent(this.database)}`, {
      language: 'sql',
      command: sql,
      ...(params ? { params } : {}),
    });
  }

  /** Create the database if it doesn't exist. */
  async ensureDatabase(): Promise<boolean> {
    try {
      // Check if database exists by trying a simple query
      const res = await fetch(
        `${this.baseUrl}/api/v1/query/${encodeURIComponent(this.database)}`,
        {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ language: 'sql', command: 'SELECT 1' }),
        },
      );
      if (res.ok) return true;

      // Database doesn't exist — create it
      const createRes = await fetch(
        `${this.baseUrl}/api/v1/server`,
        {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: `CREATE DATABASE ${this.database}`,
          }),
        },
      );
      return createRes.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async post(path: string, body: unknown): Promise<QueryResult> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        return { success: false, error: `HTTP ${res.status}: ${text}` };
      }
      const data = (await res.json()) as { result?: unknown[] };
      const result = data.result ?? [];
      return { success: true, result, count: result.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }
}
