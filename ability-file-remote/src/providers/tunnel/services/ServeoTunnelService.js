/**
 * @fileoverview Serveo tunnel service implementation
 * Provides SSH-based tunneling through serveo.net
 *
 * Migrated from existing TunnelProvider logic while maintaining complete compatibility.
 */

import createDebug from 'debug';
import { BaseTunnelService } from '../BaseTunnelService.js';

const debug = createDebug('kadi:tunnel:serveo');
import { 
  TransientTunnelError, 
  PermanentTunnelError,
  SSHUnavailableError,
  ConnectionTimeoutError
} from '../errors.js';
import { spawn } from 'child_process';

/**
 * Serveo tunnel service implementation
 * 
 * Provides SSH-based tunneling through serveo.net with support for:
 * - Custom subdomains
 * - Automatic URL extraction from SSH output
 * - Process management and cleanup
 * - Comprehensive error handling
 * 
 * @extends BaseTunnelService
 */
export default class ServeoTunnelService extends BaseTunnelService {
  
  /**
   * Create a new Serveo tunnel service
   * @param {Object} config - Service configuration
   */
  constructor(config) {
    super(config);
    this.DEFAULT_TIMEOUT = 30000; // 30 seconds
  }

  /**
   * Service name identifier
   * @returns {string} The service name 'serveo'
   */
  get name() {
    return 'serveo';
  }

  /**
   * Establish a Serveo tunnel connection
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
      throw new PermanentTunnelError('Port number is required for Serveo tunnel');
    }

    const tunnelId = this._generateTunnelId();
    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    
    this._emitProgress('connecting', 'Establishing Serveo tunnel...', tunnelId);

    return new Promise((resolve, reject) => {
      let resolved = false;
      let sshProcess = null;
      let timeoutHandle = null;

      // Construct SSH command arguments based on subdomain presence
      const sshArgs = this._buildSSHArgs(options.subdomain, options.port);

      debug(`🔗 Creating Serveo tunnel: ssh ${sshArgs.join(' ')}`);

      try {
        // Spawn SSH process
        sshProcess = spawn('ssh', sshArgs, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Track process for cleanup
        const tunnelInfo = {
          id: tunnelId,
          serviceName: 'serveo',
          localPort: options.port,
          process: sshProcess,
          createdAt: new Date(),
          status: 'connecting'
        };

        this.activeTunnels.set(tunnelId, tunnelInfo);

        let output = '';
        let errorOutput = '';

        // Handle SSH stdout data
        sshProcess.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          debug('Serveo stdout:', text.trim());

          const publicUrl = this._extractServeoUrl(output);
          if (publicUrl && !resolved) {
            resolved = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);

            // Update tunnel info with successful connection
            const completedTunnelInfo = {
              id: tunnelId,
              publicUrl: publicUrl,
              serviceName: 'serveo',
              localPort: options.port,
              subdomain: options.subdomain || this._extractSubdomain(publicUrl),
              createdAt: new Date(),
              status: 'active',
              process: sshProcess
            };

            this.activeTunnels.set(tunnelId, completedTunnelInfo);
            this._emitProgress('connected', `Serveo tunnel active: ${publicUrl}`, tunnelId);
            this._emitTunnelCreated(completedTunnelInfo);
            
            resolve(completedTunnelInfo);
          }
        });

        // Handle SSH stderr data (Serveo often sends URLs via stderr)
        sshProcess.stderr.on('data', (data) => {
          const text = data.toString();
          errorOutput += text;
          output += text; // Include stderr in output for URL extraction
          debug('Serveo stderr:', text.trim());

          const publicUrl = this._extractServeoUrl(output);
          if (publicUrl && !resolved) {
            resolved = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);

            const completedTunnelInfo = {
              id: tunnelId,
              publicUrl: publicUrl,
              serviceName: 'serveo',
              localPort: options.port,
              subdomain: options.subdomain || this._extractSubdomain(publicUrl),
              createdAt: new Date(),
              status: 'active',
              process: sshProcess
            };

            this.activeTunnels.set(tunnelId, completedTunnelInfo);
            this._emitProgress('connected', `Serveo tunnel active: ${publicUrl}`, tunnelId);
            this._emitTunnelCreated(completedTunnelInfo);
            
            resolve(completedTunnelInfo);
          }
        });

        // Handle SSH process errors
        sshProcess.on('error', (error) => {
          if (!resolved) {
            resolved = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            this.activeTunnels.delete(tunnelId);

            if (error.code === 'ENOENT') {
              const sshError = new SSHUnavailableError();
              this._emitError(sshError, tunnelId);
              reject(sshError);
            } else {
              const tunnelError = new TransientTunnelError(`Serveo SSH process error: ${error.message}`, error);
              this._emitError(tunnelError, tunnelId);
              reject(tunnelError);
            }
          }
        });

        // Handle SSH process exit
        sshProcess.on('exit', (code) => {
          if (!resolved) {
            resolved = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            this.activeTunnels.delete(tunnelId);

            const errorMessage = `Serveo tunnel exited with code ${code}. Output: ${errorOutput}`;
            const tunnelError = new TransientTunnelError(errorMessage);
            this._emitError(tunnelError, tunnelId);
            reject(tunnelError);
          }
        });

        // Set up connection timeout
        timeoutHandle = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.activeTunnels.delete(tunnelId);
            
            if (sshProcess) {
              sshProcess.kill('SIGTERM');
            }

            const timeoutError = new ConnectionTimeoutError('serveo', timeout);
            timeoutError.message = `Serveo tunnel creation timeout. Output: ${output}`;
            this._emitError(timeoutError, tunnelId);
            reject(timeoutError);
          }
        }, timeout);

      } catch (error) {
        if (!resolved) {
          resolved = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          this.activeTunnels.delete(tunnelId);
          
          const tunnelError = new TransientTunnelError(`Failed to create Serveo tunnel: ${error.message}`, error);
          this._emitError(tunnelError, tunnelId);
          reject(tunnelError);
        }
      }
    });
  }

  /**
   * Disconnect and destroy a Serveo tunnel
   * 
   * @param {string} tunnelId - Unique identifier of the tunnel to destroy
   * @returns {Promise<void>} Promise that resolves when tunnel is destroyed
   * @throws {Error} If tunnel ID is not found
   */
  async disconnect(tunnelId) {
    const tunnelInfo = this.activeTunnels.get(tunnelId);
    
    if (!tunnelInfo) {
      throw new Error(`Serveo tunnel '${tunnelId}' not found`);
    }

    this._emitProgress('disconnecting', 'Destroying Serveo tunnel...', tunnelId);

    try {
      // Kill the SSH process if it exists
      if (tunnelInfo.process) {
        tunnelInfo.process.kill('SIGTERM');
      }

      // Remove from active tunnels
      this.activeTunnels.delete(tunnelId);

      this._emitProgress('disconnected', 'Serveo tunnel destroyed', tunnelId);
      this._emitTunnelDestroyed(tunnelId);

    } catch (error) {
      const tunnelError = new TransientTunnelError(`Failed to destroy Serveo tunnel: ${error.message}`, error);
      this._emitError(tunnelError, tunnelId);
      throw tunnelError;
    }
  }

  /**
   * Get current service status
   * 
   * @returns {Object} Current status of the Serveo service
   */
  getStatus() {
    const activeTunnelCount = this.activeTunnels.size;
    const tunnelDetails = Array.from(this.activeTunnels.values()).map(tunnel => ({
      id: tunnel.id,
      publicUrl: tunnel.publicUrl,
      localPort: tunnel.localPort,
      status: tunnel.status,
      createdAt: tunnel.createdAt
    }));

    return {
      serviceName: 'serveo',
      available: true,
      activeTunnels: activeTunnelCount,
      tunnels: tunnelDetails,
      status: activeTunnelCount > 0 ? 'active' : 'idle',
      description: 'SSH-based tunneling through serveo.net'
    };
  }

  /**
   * Build SSH command arguments for Serveo connection
   * Migrated from existing TunnelProvider logic
   * 
   * @private
   * @param {string} [subdomain] - Optional subdomain to request
   * @param {number} port - Local port to tunnel
   * @returns {string[]} SSH command arguments
   */
  _buildSSHArgs(subdomain, port) {
    let sshArgs;

    if (subdomain) {
      // With subdomain: ssh -R subdomain.serveo.net:80:localhost:PORT serveo.net [options]
      sshArgs = [
        '-R', `${subdomain}.serveo.net:80:localhost:${port}`,
        'serveo.net',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ExitOnForwardFailure=yes'
      ];
    } else {
      // Without subdomain: ssh -R 80:localhost:PORT serveo.net [options]
      sshArgs = [
        '-R', `80:localhost:${port}`,
        'serveo.net',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ExitOnForwardFailure=yes'
      ];
    }

    return sshArgs;
  }

  /**
   * Extract Serveo public URL from SSH output
   * Migrated from existing TunnelProvider logic with multiple pattern support
   * 
   * @private
   * @param {string} output - SSH process output (stdout + stderr combined)
   * @returns {string|null} Extracted public URL or null if not found
   */
  _extractServeoUrl(output) {
    // Serveo can output URLs in different formats - check multiple patterns
    const patterns = [
      /Forwarding HTTP traffic from (https:\/\/[a-zA-Z0-9-]+\.serveo\.net)/,
      /Forwarding to (https:\/\/[a-zA-Z0-9-]+\.serveo\.net)/,
      /(https:\/\/[a-zA-Z0-9-]+\.serveo\.net)/
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1] || match[0];
      }
    }
    
    return null;
  }

  /**
   * Extract subdomain from public URL
   * 
   * @private
   * @param {string} publicUrl - Public URL to extract subdomain from
   * @returns {string|null} Extracted subdomain or null if not found
   */
  _extractSubdomain(publicUrl) {
    if (!publicUrl) return null;
    
    const match = publicUrl.match(/https:\/\/([a-zA-Z0-9-]+)\.serveo\.net/);
    return match ? match[1] : null;
  }
}
