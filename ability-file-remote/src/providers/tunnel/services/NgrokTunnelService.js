/**
 * @fileoverview Ngrok tunnel service implementation
 * Provides HTTP/HTTPS tunneling through ngrok.com with support for authentication,
 * custom subdomains, regions, and advanced features for paid accounts.
 * 
 * Features:
 * - HTTP/HTTPS tunneling with automatic HTTPS
 * - Custom subdomain support (paid accounts)
 * - Region selection (us, eu, ap, au, sa, jp, in)
 * - Authentication token support
 * - Detailed tunnel information and analytics
 * - Automatic reconnection handling
 * - Web inspection interface
 */

import createDebug from 'debug';
import { BaseTunnelService } from '../BaseTunnelService.js';

const debug = createDebug('kadi:tunnel:ngrok');
import { 
  TransientTunnelError, 
  PermanentTunnelError,
  ConnectionTimeoutError,
  AuthenticationFailedError
} from '../errors.js';
import ngrok from 'ngrok';

/**
 * Ngrok tunnel service implementation
 * 
 * Provides ngrok-based tunneling with support for:
 * - HTTP/HTTPS tunnels with automatic SSL
 * - Custom subdomains (requires paid account)
 * - Multiple regions for optimal performance
 * - Authentication token management
 * - Web inspection interface on local port 4040
 * - Advanced tunnel configuration options
 * 
 * @extends BaseTunnelService
 */
/**
 * NgrokTunnelService
 *
 * Provides an HTTP/HTTPS tunnel via ngrok (v4 SDK).
 * Exposes a service-like connect/disconnect API used by the TunnelProvider.
 *
 * Design notes:
 * - Defensive cleanup (disconnect/kill) before connecting to avoid "already exists" errors
 * - Single retry on stale/invalid config conditions
 * - Emits progress and lifecycle events via BaseTunnelService helpers
 */
export default class NgrokTunnelService extends BaseTunnelService {
  
  constructor(config) {
    super(config);
    this.DEFAULT_TIMEOUT = 45000; // 45 seconds (ngrok can be slower to start)
    this.INSPECTION_PORT = 4040; // Ngrok web interface port
    this.authToken = config.ngrokAuthToken || config.authToken || null;
    this.region = config.region || 'us';
  }

  /**
   * Service name identifier
   * @returns {string} The service name 'ngrok'
   */
  get name() {
    return 'ngrok';
  }

  /**
   * Establish an Ngrok tunnel connection
   * 
   * @param {Object} options - Connection options
   * @param {number} options.port - Local port to tunnel
   * @param {string} [options.subdomain] - Requested subdomain (requires paid account)
   * @param {string} [options.region] - Preferred region (us, eu, ap, au, sa, jp, in)
   * @param {string} [options.authToken] - Ngrok auth token (overrides config)
   * @param {string} [options.protocol='http'] - Protocol type (http, https, tcp)
   * @param {Object} [options.ngrokOptions] - Additional ngrok CLI options
   * @param {number} [options.timeout=45000] - Connection timeout in milliseconds
   * @returns {Promise<Object>} Tunnel information object
   * 
   * @throws {PermanentTunnelError} If ngrok command is not available or config is invalid
   * @throws {AuthenticationFailedError} If authentication fails
   * @throws {ConnectionTimeoutError} If connection times out
   * @throws {TransientTunnelError} For temporary connection failures
   */
  /**
   * Establish an ngrok tunnel.
   *
   * Steps:
   * 1) Validate options (port bounds)
   * 2) Build ngrok v4 options from service config + call options
   * 3) Disconnect/kill any stale tunnel sessions defensively
   * 4) Attempt connect with a timeout guard; if stale/invalid -> cleanup + retry once
   * 5) On success, persist tunnel info and emit lifecycle events
   */
  async connect(options) {
    // Validate required options
    if (!options || typeof options.port !== 'number') {
      throw new PermanentTunnelError('Port number is required for Ngrok tunnel');
    }

    if (options.port < 1 || options.port > 65535) {
      throw new PermanentTunnelError(`Invalid port number: ${options.port}. Must be between 1-65535`);
    }

    const tunnelId = this._generateTunnelId();
    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    const authToken = options.authToken || this.authToken;
    const region = options.region || this.region;
    const protocol = options.protocol || 'http';
    
    this._emitProgress('connecting', 'Establishing Ngrok tunnel...', tunnelId);

    try {
      // Step 2: Build ngrok v4-compatible options
      const ngrokOptions = {
        addr: options.port,
        proto: 'http',
        authtoken: authToken || undefined,
        // Only include region if explicitly provided and not default
        region: region && region !== 'us' ? region : undefined,
        // Only include subdomain if explicitly provided (paid feature)
        subdomain: options.subdomain || undefined,
        ...(options.ngrokOptions || {})
      };

      debug(`🔗 Creating Ngrok tunnel: http ${options.port}${region ? ` (${region})` : ''}`);
      if (options.subdomain) {
        debug(`   📍 Custom subdomain: ${options.subdomain}`);
      }

      // Step 3: Defensive cleanup: disconnect any stale tunnels before connecting
      try { await ngrok.disconnect(); } catch {}
      try { await ngrok.kill(); } catch {}

      // Step 4: Create tunnel with timeout (attempt 1)
      let url;
      try {
        url = await Promise.race([
          ngrok.connect(ngrokOptions),
          new Promise((_, reject) =>
            setTimeout(() => reject(new ConnectionTimeoutError(this.name, timeout)), timeout)
          )
        ]);
      } catch (firstError) {
        const msg = (firstError && (firstError.msg || firstError.message)) || String(firstError);
        const rawBody = firstError && (firstError.body || (firstError.response && firstError.response.body));
        let bodyString = '';
        if (typeof rawBody === 'string') bodyString = rawBody;
        else if (rawBody) {
          try { bodyString = JSON.stringify(rawBody); } catch { bodyString = ''; }
        }
        const alreadyExists = msg.includes('already exists') || bodyString.includes('already exists');
        const invalidConfig = msg.includes('invalid tunnel configuration') || bodyString.includes('invalid tunnel configuration');

        if (alreadyExists || invalidConfig) {
          // Stale tunnel present in local agent; try a forced cleanup and one retry
          try { await ngrok.disconnect(); } catch {}
          try { await ngrok.kill(); } catch {}
          await new Promise((r) => setTimeout(r, 500));

          url = await Promise.race([
            ngrok.connect(ngrokOptions),
            new Promise((_, reject) =>
              setTimeout(() => reject(new ConnectionTimeoutError(this.name, timeout)), timeout)
            )
          ]);
        } else {
          throw firstError;
        }
      }

      // Step 5: Store tunnel information
      const tunnelInfo = {
        id: tunnelId,
        serviceName: 'ngrok',
        localPort: options.port,
        region: region,
        protocol: protocol,
        url: url,
        ngrokUrl: url, // Store the ngrok URL for disconnect
        createdAt: new Date(),
        status: 'active',
        inspectionUrl: `http://localhost:${this.INSPECTION_PORT}`
      };

      this.activeTunnels.set(tunnelId, tunnelInfo);

      // Emit events
      this._emitProgress('connected', 'Ngrok tunnel established', tunnelId);
      this._emitTunnelCreated(tunnelInfo);

      debug(`✅ Ngrok tunnel established: ${url}`);
      debug(`🔍 Inspection interface: http://localhost:${this.INSPECTION_PORT}`);

      return {
        tunnelId: tunnelId,
        url: url,
        subdomain: this._extractSubdomain(url),
        localPort: options.port,
        createdAt: new Date(),
        status: 'active',
        service: 'ngrok',
        region: region,
        protocol: protocol,
        inspectionUrl: `http://localhost:${this.INSPECTION_PORT}`
      };

    } catch (error) {
      // Clean up tunnel tracking
      this.activeTunnels.delete(tunnelId);

      // Classify and throw appropriate error
      if (error instanceof ConnectionTimeoutError) {
        throw error;
      }

      const errorMessage = error.message || error.toString();

      // Check for authentication errors
      if (errorMessage.includes('authentication') || errorMessage.includes('authtoken') || errorMessage.includes('invalid token')) {
        throw new AuthenticationFailedError(
          this.name, 
          'Ngrok authentication failed. Please check your auth token.'
        );
      }

      // Check for subdomain errors (paid feature)
      if (errorMessage.includes('subdomain') && (errorMessage.includes('reserved') || errorMessage.includes('unavailable'))) {
        throw new PermanentTunnelError(
          'Subdomain is reserved or unavailable. Try a different subdomain or remove subdomain requirement.'
        );
      }

      // Check for region errors
      if (errorMessage.includes('region') && errorMessage.includes('invalid')) {
        throw new PermanentTunnelError(`Invalid region: ${region}. Valid regions: us, eu, ap, au, sa, jp, in`);
      }

      // Check for port errors
      if (errorMessage.includes('port') && errorMessage.includes('in use')) {
        throw new TransientTunnelError(`Port ${options.port} is already in use`);
      }

      // Check for network errors
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('network') || errorMessage.includes('timeout')) {
        throw new TransientTunnelError(`Network error: ${errorMessage}`);
      }

      // Generic error handling
      throw new TransientTunnelError(`Ngrok tunnel creation failed: ${errorMessage}`);
    }
  }

  /**
   * Disconnect an Ngrok tunnel
   * 
   * @param {string} tunnelId - Unique tunnel identifier
   * @returns {Promise<void>}
   */
  /**
   * Disconnect an ngrok tunnel by id. If the SDK reports an error,
   * we still clear local state to avoid leaks.
   */
  async disconnect(tunnelId) {
    const tunnel = this.activeTunnels.get(tunnelId);
    if (!tunnel) {
      throw new Error(`Tunnel ${tunnelId} not found`);
    }

    this._emitProgress('disconnecting', 'Destroying Ngrok tunnel...', tunnelId);

    try {
      // Disconnect the specific tunnel using the ngrok package
      if (tunnel.ngrokUrl) {
        await ngrok.disconnect(tunnel.ngrokUrl);
        debug(`🔌 Ngrok tunnel disconnected: ${tunnel.ngrokUrl}`);
      } else {
        // Fallback: disconnect all if URL not found
        await ngrok.disconnect();
        debug(`🔌 All Ngrok tunnels disconnected (fallback)`);
      }

      // Remove from active tunnels
      this.activeTunnels.delete(tunnelId);

      // CRITICAL: If this was the last tunnel, kill the ngrok process
      // ngrok.disconnect() only closes tunnel URLs - the child process keeps running!
      // This prevents Node.js from exiting because the ChildProcess handle stays alive
      if (this.activeTunnels.size === 0) {
        try {
          await ngrok.kill();
          debug('✅ Ngrok process terminated');
        } catch (killError) {
          debug('Warning during ngrok process kill:', killError.message);
        }
      }

      // Emit events
      this._emitProgress('disconnected', 'Ngrok tunnel destroyed', tunnelId);
      this._emitTunnelDestroyed(tunnelId);

      debug(`✅ Ngrok tunnel ${tunnelId} disconnected`);
    } catch (error) {
      console.error(`❌ Error disconnecting Ngrok tunnel ${tunnelId}:`, error.message);

      // Still clean up our tracking even if ngrok disconnect failed
      this.activeTunnels.delete(tunnelId);
      this._emitTunnelDestroyed(tunnelId);
      
      throw error;
    }
  }

  /**
   * Get current service status including active tunnels and ngrok info
   * 
   * @returns {Object} Current service status
   */
  getStatus() {
    return {
      serviceName: this.name,
      activeTunnels: this.activeTunnels.size,
      available: true,
      status: `${this.activeTunnels.size} active tunnels`,
      inspectionUrl: `http://localhost:${this.INSPECTION_PORT}`,
      region: this.region,
      authConfigured: !!this.authToken
    };
  }

  // === Private Helper Methods ===

  /**
   * Extract subdomain from URL
   * @private
   */
  _extractSubdomain(url) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      
      // For ngrok URLs like https://abc123.ngrok.io
      if (hostname.includes('.ngrok.io')) {
        const parts = hostname.split('.');
        return parts.length > 2 ? parts[0] : null;
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Override shutdown to clean up all tunnels
   */
  /**
   * Disconnect all tunnels during service shutdown, then delegate to base.
   */
  async shutdown() {
    debug('🛑 Shutting down Ngrok service...');

    try {
      // Disconnect all ngrok tunnels
      await ngrok.disconnect();
      debug('✅ All Ngrok tunnels disconnected');
    } catch (error) {
      debug('Warning during ngrok disconnect:', error.message);
    }

    try {
      // CRITICAL: Kill the ngrok child process
      // ngrok.disconnect() only closes tunnel URLs - the child process keeps running!
      // This prevents Node.js from exiting because the ChildProcess handle stays alive
      await ngrok.kill();
      debug('✅ Ngrok process terminated');
    } catch (error) {
      debug('Warning during ngrok process kill:', error.message);
    }

    await super.shutdown();
  }
}
