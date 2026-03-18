/**
 * @fileoverview LocalTunnel service implementation
 * Provides tunneling through localtunnel npm package
 *
 * Migrated from CLI spawn approach to use localtunnel npm package directly for better portability.
 */

import createDebug from 'debug';
import { BaseTunnelService } from '../BaseTunnelService.js';

const debug = createDebug('kadi:tunnel:localtunnel');
import { 
  TransientTunnelError, 
  PermanentTunnelError,
  ConnectionTimeoutError
} from '../errors.js';
import localtunnel from 'localtunnel';

/**
 * LocalTunnel service implementation
 * 
 * Provides tunneling through localtunnel with support for:
 * - Custom subdomain support via --subdomain flag
 * - Automatic npm package validation
 * - URL extraction from localtunnel output
 * - Process management and cleanup
 * - Comprehensive error handling
 * 
 * @extends BaseTunnelService
 */
export default class LocalTunnelService extends BaseTunnelService {
  
  /**
   * Create a new LocalTunnel service
   * @param {Object} config - Service configuration
   */
  constructor(config) {
    super(config);
    this.DEFAULT_TIMEOUT = 30000; // 30 seconds
  }

  /**
   * Service name identifier
   * @returns {string} The service name 'localtunnel'
   */
  get name() {
    return 'localtunnel';
  }

  /**
   * Establish a LocalTunnel connection
   * 
   * @param {Object} options - Connection options
   * @param {number} options.port - Local port to tunnel
   * @param {string} [options.subdomain] - Requested subdomain
   * @param {number} [options.timeout=30000] - Connection timeout in milliseconds
   * @returns {Promise<Object>} Tunnel information object
   * 
   * @throws {PermanentTunnelError} If localtunnel is not installed or port is invalid
   * @throws {ConnectionTimeoutError} If connection times out
   * @throws {TransientTunnelError} For temporary connection failures
   */
  async connect(options) {
    // Validate required options
    if (!options || typeof options.port !== 'number') {
      throw new PermanentTunnelError('Port number is required for LocalTunnel');
    }

    if (options.port < 1 || options.port > 65535) {
      throw new PermanentTunnelError(`Invalid port number: ${options.port}. Must be between 1-65535`);
    }

    const tunnelId = this._generateTunnelId();
    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    
    this._emitProgress('connecting', 'Establishing LocalTunnel connection...', tunnelId);

    try {
      // Build localtunnel options
      const ltOptions = {
        port: options.port,
        subdomain: options.subdomain || undefined, // Only include if specified
        host: 'https://localtunnel.me' // Default localtunnel host
      };

      debug(`🔗 Creating LocalTunnel: port ${options.port}${options.subdomain ? ` subdomain ${options.subdomain}` : ''}`);

      // Create tunnel with timeout
      const tunnel = await Promise.race([
        localtunnel(ltOptions),
        new Promise((_, reject) => 
          setTimeout(() => reject(new ConnectionTimeoutError(this.name, timeout)), timeout)
        )
      ]);

      // Store tunnel information
      const tunnelInfo = {
        id: tunnelId,
        serviceName: 'localtunnel',
        localPort: options.port,
        subdomain: options.subdomain,
        url: tunnel.url,
        tunnel: tunnel, // Store tunnel object for cleanup
        createdAt: new Date(),
        status: 'active'
      };

      this.activeTunnels.set(tunnelId, tunnelInfo);

      // Emit events
      this._emitProgress('connected', 'LocalTunnel established', tunnelId);
      this._emitTunnelCreated(tunnelInfo);

      debug(`✅ LocalTunnel established: ${tunnel.url}`);

      return {
        tunnelId: tunnelId,
        url: tunnel.url,
        subdomain: this._extractSubdomain(tunnel.url),
        localPort: options.port,
        createdAt: new Date(),
        status: 'active',
        service: 'localtunnel'
      };

    } catch (error) {
      // Clean up tunnel tracking
      this.activeTunnels.delete(tunnelId);

      // Classify and throw appropriate error
      if (error instanceof ConnectionTimeoutError) {
        throw error;
      }

      const errorMessage = error.message || error.toString();

      // Check for subdomain errors
      if (errorMessage.includes('subdomain') && errorMessage.includes('not available')) {
        throw new PermanentTunnelError(
          'Subdomain is not available. Try a different subdomain or remove subdomain requirement.'
        );
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
      throw new TransientTunnelError(`LocalTunnel creation failed: ${errorMessage}`);
    }
  }

  /**
   * Disconnect a LocalTunnel
   * 
   * @param {string} tunnelId - The tunnel ID to disconnect
   * @returns {Promise<boolean>} True if tunnel was disconnected, false if not found
   */
  async disconnect(tunnelId) {
    const tunnelInfo = this.activeTunnels.get(tunnelId);
    
    if (!tunnelInfo) {
      return false;
    }

    this._emitProgress('disconnecting', 'Destroying LocalTunnel...', tunnelId);

    try {
      // Close the tunnel using the npm package API
      if (tunnelInfo.tunnel && typeof tunnelInfo.tunnel.close === 'function') {
        tunnelInfo.tunnel.close();
        debug(`🔌 LocalTunnel disconnected: ${tunnelInfo.url}`);
      }
      
      this.activeTunnels.delete(tunnelId);
      this._emitProgress('disconnected', 'LocalTunnel destroyed', tunnelId);
      this._emitTunnelDestroyed(tunnelId);

      debug(`✅ LocalTunnel ${tunnelId} disconnected`);
      return true;
    } catch (error) {
      console.error(`❌ Error disconnecting LocalTunnel ${tunnelId}:`, error.message);
      
      // Still clean up our tracking even if close failed
      this.activeTunnels.delete(tunnelId);
      this._emitTunnelDestroyed(tunnelId);
      
      throw error;
    }
  }

  /**
   * Get the current status of the service
   * 
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      serviceName: 'localtunnel',
      isActive: this.activeTunnels.size > 0,
      activeTunnels: this.activeTunnels.size,
      available: true, // LocalTunnel is available as an npm package
      tunnels: Array.from(this.activeTunnels.values()).map(tunnel => ({
        id: tunnel.id,
        url: tunnel.url,
        localPort: tunnel.localPort,
        status: tunnel.status,
        createdAt: tunnel.createdAt
      }))
    };
  }

  // === Private Helper Methods ===

  /**
   * Extract subdomain from a LocalTunnel URL
   * 
   * @private
   * @param {string} url - The tunnel URL  /**
   * Extract LocalTunnel URL from process output
   * 
   * @private
   * @param {string} output - Process output
   * @returns {string|null} Extracted URL or null if not found
   */
  _extractLocalTunnelUrl(output) {
    // LocalTunnel outputs: "your url is: https://abc123.loca.lt"
    const match = output.match(/your url is:\s*(https:\/\/[a-zA-Z0-9-]+\.loca\.lt)/);
    return match ? match[1] : null;
  }

  /**
   * Extract subdomain from a LocalTunnel URL
   * 
   * @private
   * @param {string} url - The tunnel URL
   * @returns {string|null} Extracted subdomain or null
   */
  _extractSubdomain(url) {
    const match = url.match(/https:\/\/([a-zA-Z0-9-]+)\.loca\.lt/);
    return match ? match[1] : null;
  }
}
