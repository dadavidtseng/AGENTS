/**
 * ArcadeDB Adapter
 *
 * Provides database operations for long-term memory storage using ArcadeDB.
 * Supports vertex/edge operations and Cypher queries with connection pooling.
 */

import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';
import type { DatabaseError } from '../common/types.js';
import { DatabaseErrorType } from '../common/types.js';

/**
 * ArcadeDB Query Response
 */
interface ArcadeDBQueryResponse {
  result?: any[];
  error?: string;
}

/**
 * ArcadeDB Client Configuration
 */
export interface ArcadeDBClientConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  timeout?: number;
}

/**
 * ArcadeDB Client
 *
 * Low-level HTTP client for ArcadeDB REST API
 * Handles connection, authentication, and query execution
 */
export class ArcadeDBClient {
  private connected: boolean = false;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly timeout: number;

  /**
   * Create ArcadeDB Client
   *
   * @param config - Client configuration
   */
  constructor(private readonly config: ArcadeDBClientConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    this.timeout = config.timeout || 30000;
  }

  /**
   * Connect to ArcadeDB
   *
   * Verifies connectivity by executing a test query
   *
   * @returns Result indicating connection success or error
   */
  async connect(): Promise<Result<void, DatabaseError>> {
    try {
      // Temporarily mark as connected to allow test query
      this.connected = true;

      // Test connection with simple query
      const result = await this.query('SELECT 1 as test');

      if (!result.success) {
        this.connected = false;
        return result;
      }

      return ok(undefined);
    } catch (error: any) {
      this.connected = false;
      return err({
        type: DatabaseErrorType.CONNECTION_ERROR,
        message: `Failed to connect to ArcadeDB: ${error.message}`,
        originalError: error,
      });
    }
  }

  /**
   * Disconnect from ArcadeDB
   *
   * Marks client as disconnected (no persistent connection to close)
   *
   * @returns Result indicating disconnect success
   */
  async disconnect(): Promise<Result<void, DatabaseError>> {
    this.connected = false;
    return ok(undefined);
  }

  /**
   * Check if client is connected
   *
   * @returns True if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Execute query
   *
   * Supports both SQL and Cypher languages
   *
   * @param command - Query command
   * @param params - Optional query parameters
   * @param language - Query language ('sql' or 'cypher'), defaults to 'sql'
   * @returns Result with query results or error
   */
  async query(
    command: string,
    params?: Record<string, any>,
    language: 'sql' | 'cypher' = 'sql'
  ): Promise<Result<any[], DatabaseError>> {
    if (!this.connected) {
      return err({
        type: DatabaseErrorType.NOT_CONNECTED,
        message: 'Client not connected. Call connect() first.',
        query: command,
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(
        `${this.baseUrl}/api/v1/query/${this.config.database}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${this.auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            language,
            command,
            ...(params && { params }),
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return err({
          type: DatabaseErrorType.QUERY_ERROR,
          message: `Query failed with status ${response.status}: ${errorText}`,
          query: command,
        });
      }

      const data: ArcadeDBQueryResponse = await response.json();

      if (data.error) {
        return err({
          type: DatabaseErrorType.QUERY_ERROR,
          message: `Query error: ${data.error}`,
          query: command,
        });
      }

      return ok(data.result || []);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return err({
          type: DatabaseErrorType.TIMEOUT,
          message: `Query timeout after ${this.timeout}ms`,
          query: command,
          originalError: error,
        });
      }

      return err({
        type: DatabaseErrorType.QUERY_ERROR,
        message: `Query execution failed: ${error.message}`,
        query: command,
        originalError: error,
      });
    }
  }
}

/**
 * Vertex properties
 */
export interface VertexProperties {
  [key: string]: any;
}

/**
 * Edge properties
 */
export interface EdgeProperties {
  [key: string]: any;
}

/**
 * Vertex result with @rid
 */
export interface VertexResult {
  '@rid': string;
  [key: string]: any;
}

/**
 * ArcadeDB Adapter
 *
 * High-level adapter for graph database operations
 * Provides vertex/edge operations using Cypher queries
 */
export class ArcadeDBAdapter {
  private client: ArcadeDBClient | null = null;

  /**
   * Create ArcadeDB Adapter
   *
   * @param dbUrl - Database connection URL (format: http://host:port/database)
   * @param username - Database username
   * @param password - Database password
   * @param timeout - Query timeout in milliseconds
   */
  constructor(
    private readonly dbUrl: string,
    private readonly username: string = 'root',
    private readonly password: string = 'root',
    private readonly timeout: number = 30000
  ) {}

  /**
   * Parse database URL into config
   *
   * @returns Client configuration
   */
  private parseDbUrl(): ArcadeDBClientConfig {
    const url = new URL(this.dbUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const database = pathParts[pathParts.length - 1];

    return {
      host: url.hostname,
      port: parseInt(url.port) || 2480,
      database,
      username: this.username,
      password: this.password,
      timeout: this.timeout,
    };
  }

  /**
   * Connect to database
   *
   * Creates client instance and establishes connection
   *
   * @returns Result indicating success or error
   */
  async connect(): Promise<Result<void, DatabaseError>> {
    if (this.client?.isConnected()) {
      return ok(undefined); // Already connected, reuse connection
    }

    try {
      const config = this.parseDbUrl();
      this.client = new ArcadeDBClient(config);
      return await this.client.connect();
    } catch (error: any) {
      return err({
        type: DatabaseErrorType.CONNECTION_ERROR,
        message: `Failed to parse database URL or connect: ${error.message}`,
        originalError: error,
      });
    }
  }

  /**
   * Disconnect from database
   *
   * @returns Result indicating success or error
   */
  async disconnect(): Promise<Result<void, DatabaseError>> {
    if (!this.client) {
      return ok(undefined);
    }

    const result = await this.client.disconnect();
    this.client = null;
    return result;
  }

  /**
   * Execute Cypher query
   *
   * @param cypher - Cypher query command
   * @param params - Optional query parameters
   * @returns Result with query results or error
   */
  async query(
    cypher: string,
    params?: Record<string, any>
  ): Promise<Result<any[], DatabaseError>> {
    if (!this.client || !this.client.isConnected()) {
      return err({
        type: DatabaseErrorType.NOT_CONNECTED,
        message: 'Not connected to database. Call connect() first.',
        query: cypher,
      });
    }

    return this.client.query(cypher, params, 'cypher');
  }

  /**
   * Create vertex
   *
   * @param type - Vertex type (label)
   * @param properties - Vertex properties
   * @returns Result with vertex @rid or error
   */
  async createVertex(
    type: string,
    properties: VertexProperties
  ): Promise<Result<string, DatabaseError>> {
    // Build property assignments with parameterization
    const propKeys = Object.keys(properties);
    const propAssignments = propKeys.map(key => `${key}: $${key}`).join(', ');

    const cypher = `CREATE VERTEX ${type} SET ${propAssignments} RETURN @rid`;
    const params = { ...properties };

    const result = await this.query(cypher, params);

    if (!result.success) {
      return result;
    }

    if (result.data.length === 0 || !result.data[0]['@rid']) {
      return err({
        type: DatabaseErrorType.QUERY_ERROR,
        message: 'Vertex created but @rid not returned',
        query: cypher,
      });
    }

    return ok(result.data[0]['@rid']);
  }

  /**
   * Create edge
   *
   * @param fromRid - Source vertex @rid
   * @param toRid - Target vertex @rid
   * @param type - Edge type (label)
   * @param properties - Optional edge properties
   * @returns Result with edge @rid or error
   */
  async createEdge(
    fromRid: string,
    toRid: string,
    type: string,
    properties?: EdgeProperties
  ): Promise<Result<string, DatabaseError>> {
    // Build Cypher query with parameterization
    let cypher: string;
    let params: Record<string, any>;

    if (properties && Object.keys(properties).length > 0) {
      const propKeys = Object.keys(properties);
      const propAssignments = propKeys.map(key => `${key}: $${key}`).join(', ');
      cypher = `CREATE EDGE ${type} FROM $fromRid TO $toRid SET ${propAssignments} RETURN @rid`;
      params = { fromRid, toRid, ...properties };
    } else {
      cypher = `CREATE EDGE ${type} FROM $fromRid TO $toRid RETURN @rid`;
      params = { fromRid, toRid };
    }

    const result = await this.query(cypher, params);

    if (!result.success) {
      return result;
    }

    if (result.data.length === 0 || !result.data[0]['@rid']) {
      return err({
        type: DatabaseErrorType.QUERY_ERROR,
        message: 'Edge created but @rid not returned',
        query: cypher,
      });
    }

    return ok(result.data[0]['@rid']);
  }
}
