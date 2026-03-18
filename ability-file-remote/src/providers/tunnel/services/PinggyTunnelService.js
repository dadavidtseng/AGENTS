/**
 * @fileoverview Pinggy tunnel service implementation
 * Provides SSH-based tunneling through pinggy.io
 *
 * Migrated from existing TunnelProvider logic while maintaining complete compatibility.
 */

import createDebug from 'debug';
import { BaseTunnelService } from '../BaseTunnelService.js';

const debug = createDebug('kadi:tunnel:pinggy');
import { 
  TransientTunnelError, 
  PermanentTunnelError,
  SSHUnavailableError,
  ConnectionTimeoutError
} from '../errors.js';
import { spawn } from 'child_process';

/**
 * Pinggy tunnel service implementation
 * 
 * Provides SSH-based tunneling through pinggy.io with support for:
 * - Custom subdomains with {subdomain}.a.pinggy.io format
 * - 60-minute timeout warnings for free accounts
 * - Automatic URL extraction from SSH output
 * - Process management and cleanup
 * - Comprehensive error handling
 * 
 * @extends BaseTunnelService
 */
export default class PinggyTunnelService extends BaseTunnelService {
  
  /**
   * Create a new Pinggy tunnel service
   * @param {Object} config - Service configuration
   */
  constructor(config) {
    super(config);
    this.DEFAULT_TIMEOUT = 30000; // 30 seconds
  }

  /**
   * Service name identifier
   * @returns {string} The service name 'pinggy'
   */
  get name() {
    return 'pinggy';
  }

  /**
   * Establish a Pinggy tunnel connection
   * 
   * @param {Object} options - Connection options
   * @param {number} options.port - Local port to tunnel
   * @param {string} [options.subdomain] - Requested subdomain
   * @param {number} [options.timeout=30000] - Connection timeout in milliseconds
   * @returns {Promise<Object>} Tunnel information object
   * 
   * @throws {SSHUnavailableError} If SSH command is not available
   * @throws {ConnectionTimeoutError} If connection times out
   * @throws {TransientTunnelError} For temporary connection failures
   * @throws {PermanentTunnelError} For permanent configuration errors
   */
  async connect(options) {
    // Validate required options
    if (!options || typeof options.port !== 'number') {
      throw new PermanentTunnelError('Port number is required for Pinggy tunnel');
    }

    const tunnelId = this._generateTunnelId();
    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    
    this._emitProgress('connecting', 'Establishing Pinggy tunnel...', tunnelId);

    return new Promise((resolve, reject) => {
      let resolved = false;
      let sshProcess = null;
      let timeoutHandle = null;

      // Construct SSH command arguments based on subdomain presence
      const sshArgs = this._buildSSHArgs(options.subdomain, options.port);

      debug(`🔗 Creating Pinggy tunnel: ssh ${sshArgs.join(' ')}`);

      try {
        // Spawn SSH process
        sshProcess = spawn('ssh', sshArgs, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Track process for cleanup
        const tunnelInfo = {
          id: tunnelId,
          serviceName: 'pinggy',
          localPort: options.port,
          process: sshProcess,
          createdAt: new Date(),
          status: 'connecting'
        };

        this.activeTunnels.set(tunnelId, tunnelInfo);

        let output = '';
        let tunnelUrl = null;
        let errorOutput = '';

        // Handle SSH process output (both stdout and stderr can contain URL)
        const handleOutput = (data) => {
          const text = data.toString();
          output += text;
          debug('Pinggy output:', text.trim());

          // Extract URL from output
          tunnelUrl = this._extractPinggyUrl(output);
          if (tunnelUrl && !resolved) {
            resolved = true;
            
            // Clear timeout
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }

            // Update tunnel info
            tunnelInfo.status = 'active';
            tunnelInfo.url = tunnelUrl;
            tunnelInfo.timeoutWarning = 'Tunnel will timeout after 60 minutes on free plan';

            // Emit events
            this._emitProgress('connected', 'Pinggy tunnel established', tunnelId);
            this._emitTunnelCreated(tunnelId, tunnelUrl, options.port);

            debug('⚠️  Note: Pinggy free tunnels timeout after 60 minutes');

            resolve({
              id: tunnelId,
              publicUrl: tunnelUrl,
              serviceName: 'pinggy',
              localPort: options.port,
              subdomain: this._extractSubdomain(tunnelUrl),
              createdAt: new Date(),
              status: 'active',
              timeoutWarning: 'Tunnel will timeout after 60 minutes on free plan'
            });
          }
        };

        sshProcess.stdout.on('data', handleOutput);
        sshProcess.stderr.on('data', handleOutput);

        // Handle process errors
        sshProcess.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }

            this.activeTunnels.delete(tunnelId);
            this._emitError('connection_failed', `Pinggy tunnel failed: ${error.message}`, tunnelId);

            if (error.code === 'ENOENT') {
              reject(new SSHUnavailableError('SSH command not found. Please ensure SSH is installed and available in PATH.'));
            } else {
              reject(new TransientTunnelError(`Pinggy tunnel failed: ${error.message}`));
            }
          }
        });

        // Handle process exit
        sshProcess.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }

            this.activeTunnels.delete(tunnelId);
            this._emitError('connection_failed', `Pinggy tunnel exited with code ${code}`, tunnelId);

            if (code !== 0) {
              reject(new TransientTunnelError(`Pinggy tunnel exited with code ${code}. This might be due to the 60-minute timeout.`));
            }
          } else {
            // Process exited after successful connection - tunnel was terminated
            this.activeTunnels.delete(tunnelId);
            this._emitTunnelDestroyed(tunnelId);
          }
        });

        // Set connection timeout
        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            
            if (sshProcess && !sshProcess.killed) {
              sshProcess.kill();
            }
            
            this.activeTunnels.delete(tunnelId);
            this._emitError('connection_timeout', 'Pinggy tunnel creation timeout', tunnelId);
            
            reject(new ConnectionTimeoutError('Pinggy tunnel creation timeout'));
          }
        }, timeout);

      } catch (error) {
        if (!resolved) {
          resolved = true;
          this._emitError('connection_failed', `Failed to start Pinggy tunnel: ${error.message}`, tunnelId);
          reject(new TransientTunnelError(`Failed to start Pinggy tunnel: ${error.message}`));
        }
      }
    });
  }

  /**
   * Disconnect a Pinggy tunnel
   * 
   * @param {string} tunnelId - The tunnel ID to disconnect
   * @returns {Promise<boolean>} True if tunnel was disconnected, false if not found
   */
  async disconnect(tunnelId) {
    const tunnelInfo = this.activeTunnels.get(tunnelId);
    
    if (!tunnelInfo) {
      return false;
    }

    try {
      if (tunnelInfo.process && !tunnelInfo.process.killed) {
        tunnelInfo.process.kill();
      }
      
      this.activeTunnels.delete(tunnelId);
      this._emitTunnelDestroyed(tunnelId);
      
      return true;
    } catch (error) {
      console.error(`Error disconnecting Pinggy tunnel ${tunnelId}:`, error);
      this.activeTunnels.delete(tunnelId); // Clean up even if kill fails
      return false;
    }
  }

  /**
   * Get the current status of the service
   * 
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      serviceName: 'pinggy',
      available: true, // SSH-based service, available if SSH is installed
      isActive: this.activeTunnels.size > 0,
      activeTunnels: this.activeTunnels.size,
      tunnels: Array.from(this.activeTunnels.values()).map(tunnel => ({
        id: tunnel.id,
        url: tunnel.url,
        localPort: tunnel.localPort,
        status: tunnel.status,
        createdAt: tunnel.createdAt,
        timeoutWarning: tunnel.timeoutWarning
      }))
    };
  }

  /**
   * Build SSH command arguments for Pinggy
   * 
   * @private
   * @param {string} [subdomain] - Optional subdomain
   * @param {number} port - Local port to tunnel
   * @returns {Array<string>} SSH command arguments
   */
  _buildSSHArgs(subdomain, port) {
    const host = subdomain ? `${subdomain}.a.pinggy.io` : 'a.pinggy.io';
    
    return [
      '-p', '443',
      '-R', `0:localhost:${port}`,
      `qr@${host}`,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes'
    ];
  }

  /**
   * Extract Pinggy URL from SSH output
   * 
   * @private
   * @param {string} output - SSH process output
   * @returns {string|null} Extracted URL or null if not found
   */
  _extractPinggyUrl(output) {
    // Pinggy outputs URLs like: 
    // "https://randomstring.a.free.pinggy.link" (free plan)
    // "https://randomstring.a.pinggy.io" (paid plan)
    const patterns = [
      /https:\/\/[a-zA-Z0-9-]+\.a\.free\.pinggy\.link/,  // Free plan pattern
      /https:\/\/[a-zA-Z0-9-]+\.a\.pinggy\.io/,          // Paid plan pattern
      /http:\/\/[a-zA-Z0-9-]+\.a\.free\.pinggy\.link/,   // HTTP free plan
      /http:\/\/[a-zA-Z0-9-]+\.a\.pinggy\.io/            // HTTP paid plan
    ];
    
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    return null;
  }

  /**
   * Extract subdomain from a Pinggy URL
   * 
   * @private
   * @param {string} url - The tunnel URL
   * @returns {string|null} Extracted subdomain or null
   */
  _extractSubdomain(url) {
    // Handle both free and paid plan URL patterns
    const patterns = [
      /https?:\/\/([a-zA-Z0-9-]+)\.a\.free\.pinggy\.link/,  // Free plan
      /https?:\/\/([a-zA-Z0-9-]+)\.a\.pinggy\.io/           // Paid plan
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return null;
  }
}
