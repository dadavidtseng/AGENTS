/**
 * Akash Container Log Streaming
 *
 * Streams container logs in real-time from Akash deployments using WebSocket
 * connections with mTLS authentication.
 *
 * Key responsibilities:
 * - Establish WebSocket connection to provider with certificate authentication
 * - Parse and normalize log messages from provider format
 * - Emit typed log events for consumption
 * - Support filtering by service name and tail functionality
 *
 * @module targets/akash/logs
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import https from 'node:https';
import createDebug from 'debug';
import stripAnsi from 'strip-ansi';
import type { AkashDeploymentData } from '../../types/index.js';
import type { WalletContext } from './types.js';
import type { AkashProviderTlsCertificate } from './types.js';
import type { Network } from '../../types/common.js';

// Initialize debug logging
// Usage: DEBUG=deploy-ability:logs:* to see log parsing details
const debug = createDebug('deploy-ability:logs');

// ========================================
// Type Definitions
// ========================================

/**
 * Options for streaming deployment logs
 */
export interface StreamLogsOptions {
  /** Deployment data returned from deployToAkash() */
  readonly deployment: AkashDeploymentData;

  /** Wallet context (for provider address verification) */
  readonly wallet: WalletContext;

  /** Akash certificate (for mTLS authentication) */
  readonly certificate: AkashProviderTlsCertificate;

  /** Network (mainnet or testnet) */
  readonly network: Network;

  /** Optional: Filter logs by service names (default: all services) */
  readonly services?: readonly string[];

  /** Keep connection open and stream new logs (default: true) */
  readonly follow?: boolean;

  /** Show last N lines before streaming (default: 100) */
  readonly tail?: number;

  /** Optional: Custom logger for debugging */
  readonly logger?: {
    readonly debug?: (msg: string) => void;
    readonly warn?: (msg: string) => void;
    readonly error?: (msg: string) => void;
  };
}

/**
 * Options for getting logs as an array (non-streaming)
 */
export interface GetLogsOptions extends Omit<StreamLogsOptions, 'follow'> {
  /** Maximum logs to retrieve (default: 1000) */
  readonly maxLogs?: number;

  /** Timeout in milliseconds (default: 30000) */
  readonly timeout?: number;
}

/**
 * Parsed log entry from Akash provider
 */
export interface LogEntry {
  /** Service name (e.g., "ollama", "vllm") */
  readonly service: string;

  /** Log message content */
  readonly message: string;

  /** Raw log data from provider */
  readonly raw: {
    /** Full service name with replica suffix */
    readonly name: string;

    /** Original message before parsing */
    readonly message: string;

    /** ISO timestamp from provider */
    readonly timestamp?: string;
  };

  /** When this log was received by deploy-ability */
  readonly receivedAt: Date;
}

/**
 * Log stream emitter
 *
 * Events:
 * - 'log': Emitted for each log line
 * - 'connected': WebSocket connection established
 * - 'error': Connection or parsing error
 * - 'end': Stream ended (natural or via close())
 */
export interface LogStream extends EventEmitter {
  /** Close the stream and disconnect */
  close(): void;

  /** Check if stream is currently connected */
  isConnected(): boolean;

  // Event emitter methods (for type safety)
  on(event: 'log', listener: (log: LogEntry) => void): this;
  on(event: 'connected', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: () => void): this;

  once(event: 'log', listener: (log: LogEntry) => void): this;
  once(event: 'connected', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'end', listener: () => void): this;

  off(event: 'log', listener: (log: LogEntry) => void): this;
  off(event: 'connected', listener: () => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'end', listener: () => void): this;
}

/**
 * Internal raw log message from Akash provider
 */
export interface RawProviderLogMessage {
  readonly name: string;
  readonly message: string;
  readonly timestamp?: string;
}

// ========================================
// Implementation
// ========================================

/**
 * Implementation of LogStream using EventEmitter
 */
class LogStreamImpl extends EventEmitter implements LogStream {
  private ws: WebSocket | null = null;
  private connected = false;
  private logger: StreamLogsOptions['logger'];

  constructor(
    private readonly options: StreamLogsOptions
  ) {
    super();
    this.logger = options.logger;
  }

  /**
   * Start the WebSocket connection and begin streaming
   */
  async start(): Promise<void> {
    const { deployment, certificate, services, follow, tail } = this.options;

    // Extract lease information from deployment
    const { dseq, gseq, oseq } = deployment;
    const providerUri = deployment.providerUri;

    // Build WebSocket URL
    // Format: wss://{provider-host}/lease/{dseq}/{gseq}/{oseq}/logs
    // Normalize provider URI by removing trailing slash to avoid double-slash path
    // (e.g., "https://provider.example.com:8443/" → "wss://provider.example.com:8443")
    const normalizedUri = providerUri.replace(/\/$/, ''); // Remove trailing slash
    const wsUrl = normalizedUri.replace('https://', 'wss://');
    let logsPath = `/lease/${dseq}/${gseq}/${oseq}/logs`;

    // Add query parameters
    const params = new URLSearchParams();
    if (follow !== false) {
      params.append('follow', 'true');
    }
    if (typeof tail === 'number') {
      params.append('tail', tail.toString());
    }
    if (services && services.length > 0) {
      params.append('service', services.join(','));
    }

    const fullUrl = `${wsUrl}${logsPath}?${params.toString()}`;
    this.logger?.debug?.(`Connecting to: ${fullUrl}`);

    // Create WebSocket with mTLS authentication
    // We use the Akash certificate for client authentication
    this.ws = new WebSocket(fullUrl, {
      cert: certificate.cert,
      key: certificate.privateKey,
      agent: new https.Agent({
        // Do not use TLS session resumption for websocket
        sessionTimeout: 0,
        // Accept self-signed certificates (Akash providers use self-signed certs)
        rejectUnauthorized: false,
        // Disable SNI for mTLS authentication
        servername: ''
      })
    });

    this.setupEventHandlers();
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      this.logger?.debug?.('WebSocket connection established');
      this.connected = true;
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      // handleMessage now handles parsing errors internally,
      // so we don't need to wrap it in try/catch here
      this.handleMessage(data);
    });

    this.ws.on('error', (error: Error) => {
      this.logger?.error?.(`WebSocket error: ${error.message}`);
      this.emit('error', error);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      this.logger?.debug?.(`WebSocket closed: ${code} ${reason.toString()}`);
      this.connected = false;
      this.emit('end');
    });
  }

  /**
   * Handle incoming WebSocket message
   *
   * Akash providers send messages in the format:
   * {"name":"service-xyz-replica-hash","message":"timestamp log-level: actual log message"}
   *
   * When using tail parameter, provider may send:
   * - Sentinel null frame: "null"
   * - Batched messages: "null\n{...}\n{...}"
   * - Concatenated: null{"name":"...","message":"..."}
   * We handle these gracefully by parsing each line separately.
   */
  private handleMessage(data: WebSocket.Data): void {
    const text = data.toString().trim();

    // Skip empty messages
    if (!text) {
      return;
    }

    // Log raw message for debugging
    debug(`[RAW] ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);

    // Handle potentially batched messages (newline-separated)
    // Provider may send multiple JSON objects separated by newlines
    // When using tail, provider sends: null{"name":"...","message":"..."} (sentinel glued to JSON)
    const lines = text.split('\n');

    for (const line of lines) {
      let trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) {
        continue;
      }

      // Strip leading "null" sentinel if present
      // Provider concatenates null with first JSON chunk: null{"name":"...","message":"..."}
      if (trimmed.startsWith('null')) {
        debug(`[STRIP] Removing null prefix from: ${trimmed.substring(0, 50)}...`);
        trimmed = trimmed.substring(4); // Remove "null" prefix
      }

      // Skip if nothing left after removing null
      if (!trimmed) {
        continue;
      }

      try {
        // Parse JSON - provider sends: {"name":"service-replica","message":"log text"}
        const logData = JSON.parse(trimmed) as RawProviderLogMessage;

        if (!logData.name || !logData.message) {
          debug('[SKIP] Missing name or message field');
          continue;
        }

        // Strip ANSI color codes from message
        // Provider logs contain codes like \u001b[32minfo\u001b[39m
        const cleanMessage = stripAnsi(logData.message);

        debug(`[PARSED] ${cleanMessage}`);

        // Extract service name from full service name
        // Format: "service-name-replica-hash" -> "service-name"
        const serviceName = this.extractServiceName(logData.name);

        // Create parsed log entry with cleaned message
        const logEntry: LogEntry = {
          service: serviceName,
          message: cleanMessage,
          raw: {
            name: logData.name,
            message: cleanMessage, // Use cleaned message
            timestamp: logData.timestamp
          },
          receivedAt: new Date()
        };

        this.emit('log', logEntry);
      } catch (parseError) {
        // Silently skip unparseable frames (e.g., null sentinel, malformed JSON)
        // This matches Akash Console behavior
        debug(
          `[ERROR] Skipping unparseable log frame: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
        );
      }
    }
  }

  /**
   * Extract service name from full service name with replica suffix
   *
   * Examples:
   * - "ollama-abc123" -> "ollama"
   * - "vllm-xyz789" -> "vllm"
   * - "gateway" -> "gateway"
   */
  private extractServiceName(fullName: string): string {
    // Split by hyphen and take first part
    // This works because Kubernetes appends replica hash after hyphen
    const parts = fullName.split('-');
    return parts[0] || fullName;
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    if (this.ws) {
      this.logger?.debug?.('Closing WebSocket connection');
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /**
   * Check if stream is currently connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Stream container logs from an Akash deployment in real-time
 *
 * Returns an EventEmitter that emits parsed log lines as they arrive.
 *
 * @example
 * ```typescript
 * const stream = streamDeploymentLogs({
 *   deployment: deploymentData,
 *   wallet: walletContext,
 *   certificate: certData,
 *   network: 'mainnet',
 *   services: ['ollama'],
 *   follow: true,
 *   tail: 100
 * });
 *
 * stream.on('log', (log) => {
 *   console.log(`[${log.service}] ${log.message}`);
 * });
 *
 * stream.on('connected', () => {
 *   console.log('Connected to provider');
 * });
 *
 * stream.on('error', (error) => {
 *   console.error('Stream error:', error);
 * });
 *
 * stream.on('end', () => {
 *   console.log('Stream ended');
 * });
 *
 * // Stop streaming
 * stream.close();
 * ```
 */
export function streamDeploymentLogs(options: StreamLogsOptions): LogStream {
  const stream = new LogStreamImpl(options);

  // Start connection asynchronously
  // Errors will be emitted via 'error' event
  stream.start().catch((error) => {
    stream.emit('error', error);
  });

  return stream;
}

/**
 * Get deployment logs as a complete array (non-streaming)
 *
 * Useful for downloading full logs or one-time log retrieval.
 * Connects, collects logs until maxLogs is reached or timeout occurs, then disconnects.
 *
 * @example
 * ```typescript
 * const logs = await getDeploymentLogs({
 *   deployment: deploymentData,
 *   wallet: walletContext,
 *   certificate: certData,
 *   network: 'mainnet',
 *   tail: 1000,
 *   maxLogs: 1000
 * });
 *
 * logs.forEach(log => {
 *   console.log(`[${log.service}] ${log.message}`);
 * });
 * ```
 */
export async function getDeploymentLogs(
  options: GetLogsOptions
): Promise<LogEntry[]> {
  const { maxLogs = 1000, timeout = 30000 } = options;
  const logs: LogEntry[] = [];

  return new Promise((resolve, reject) => {
    // Create stream with follow disabled
    const stream = streamDeploymentLogs({
      ...options,
      follow: false
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      stream.close();
      resolve(logs);
    }, timeout);

    // Collect logs
    stream.on('log', (log) => {
      logs.push(log);

      // Stop if we've collected enough logs
      if (logs.length >= maxLogs) {
        clearTimeout(timeoutId);
        stream.close();
        resolve(logs);
      }
    });

    // Handle errors
    stream.on('error', (error) => {
      clearTimeout(timeoutId);
      stream.close();
      reject(error);
    });

    // Handle end (stream closed naturally)
    stream.on('end', () => {
      clearTimeout(timeoutId);
      resolve(logs);
    });
  });
}
