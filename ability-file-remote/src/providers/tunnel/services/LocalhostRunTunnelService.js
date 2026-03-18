/**
 * @fileoverview LocalhostRun tunnel service implementation
 * Provides SSH-based tunneling through localhost.run
 *
 * Migrated from existing TunnelProvider logic while maintaining complete compatibility.
 */

import createDebug from 'debug';
import { BaseTunnelService } from '../BaseTunnelService.js';

const debug = createDebug('kadi:tunnel:localhost.run');
import { 
  TransientTunnelError, 
  PermanentTunnelError,
  SSHUnavailableError,
  ConnectionTimeoutError
} from '../errors.js';
import { spawn } from 'child_process';

/**
 * LocalhostRun tunnel service implementation
 * 
 * Provides SSH-based tunneling through localhost.run with support for:
 * - Automatic URL extraction from SSH output
 * - Email verification handling
 * - Process management and cleanup
 * - Comprehensive error handling
 * 
 * @extends BaseTunnelService
 */
export default class LocalhostRunTunnelService extends BaseTunnelService {
  
  /**
   * Create a new LocalhostRun tunnel service
   * @param {Object} config - Service configuration
   */
  constructor(config) {
    super(config);
    this.DEFAULT_TIMEOUT = 30000; // 30 seconds
  }

  /**
   * Service name identifier
   * @returns {string} The service name 'localhost.run'
   */
  get name() {
    return 'localhost.run';
  }

  /**
   * Establish a LocalhostRun tunnel connection
   * 
   * @param {Object} options - Connection options
   * @param {number} options.port - Local port to tunnel
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
      throw new PermanentTunnelError('Port number is required for LocalhostRun tunnel');
    }

    const tunnelId = this._generateTunnelId();
    const timeout = options.timeout || this.DEFAULT_TIMEOUT;
    
    this._emitProgress('connecting', 'Establishing LocalhostRun tunnel...', tunnelId);

    return new Promise((resolve, reject) => {
      let resolved = false;
      let sshProcess = null;
      let timeoutHandle = null;

      // Construct SSH command arguments
      const sshArgs = this._buildSSHArgs(options.port);

      debug(`🔗 Creating localhost.run tunnel: ssh ${sshArgs.join(' ')}`);

      try {
        // Spawn SSH process
        sshProcess = spawn('ssh', sshArgs, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Track process for cleanup
        const tunnelInfo = {
          id: tunnelId,
          serviceName: 'localhost.run',
          localPort: options.port,
          process: sshProcess,
          createdAt: new Date(),
          status: 'connecting'
        };

        this.activeTunnels.set(tunnelId, tunnelInfo);

        let output = '';
        let tunnelUrl = null;

        // Handle SSH process output (both stdout and stderr can contain URL)
        const handleOutput = (data) => {
          const text = data.toString();
          output += text;
          debug('LocalhostRun output:', text.trim());

          // Extract URL from output
          tunnelUrl = this._extractLocalhostRunUrl(output);
          if (tunnelUrl && !resolved) {
            resolved = true;
            
            // Clear timeout
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }

            // Update tunnel info
            tunnelInfo.status = 'active';
            tunnelInfo.url = tunnelUrl;

            // Emit events
            this._emitProgress('connected', 'LocalhostRun tunnel established', tunnelId);
            this._emitTunnelCreated(tunnelId, tunnelUrl, options.port);

            resolve({
              tunnelId: tunnelId,
              url: tunnelUrl,
              subdomain: this._extractSubdomain(tunnelUrl),
              localPort: options.port,
              createdAt: new Date(),
              status: 'active',
              service: 'localhost.run'
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
            this._emitError('connection_failed', `LocalhostRun tunnel failed: ${error.message}`, tunnelId);

            if (error.code === 'ENOENT') {
              reject(new SSHUnavailableError('SSH command not found. Please ensure SSH is installed and available in PATH.'));
            } else {
              reject(new TransientTunnelError(`LocalhostRun tunnel failed: ${error.message}`));
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
            this._emitError('connection_failed', `LocalhostRun tunnel exited with code ${code}`, tunnelId);

            if (code !== 0) {
              reject(new TransientTunnelError(`LocalhostRun tunnel exited with code ${code}`));
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
            this._emitError('connection_timeout', 'LocalhostRun tunnel creation timeout', tunnelId);
            
            reject(new ConnectionTimeoutError('LocalhostRun tunnel creation timeout'));
          }
        }, timeout);

      } catch (error) {
        if (!resolved) {
          resolved = true;
          this._emitError('connection_failed', `Failed to start LocalhostRun tunnel: ${error.message}`, tunnelId);
          reject(new TransientTunnelError(`Failed to start LocalhostRun tunnel: ${error.message}`));
        }
      }
    });
  }

  /**
   * Disconnect a LocalhostRun tunnel
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
      console.error(`Error disconnecting LocalhostRun tunnel ${tunnelId}:`, error);
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
      serviceName: 'localhost.run',
      available: true, // SSH-based service, available if SSH is installed
      isActive: this.activeTunnels.size > 0,
      activeTunnels: this.activeTunnels.size,
      tunnels: Array.from(this.activeTunnels.values()).map(tunnel => ({
        id: tunnel.id,
        url: tunnel.url,
        localPort: tunnel.localPort,
        status: tunnel.status,
        createdAt: tunnel.createdAt
      }))
    };
  }

  /**
   * Build SSH command arguments for LocalhostRun
   * 
   * @private
   * @param {number} port - Local port to tunnel
   * @returns {Array<string>} SSH command arguments
   */
  _buildSSHArgs(port) {
    return [
      '-R', `80:localhost:${port}`,
      'ssh.localhost.run',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes'
    ];
  }

  /**
   * Extract LocalhostRun URL from SSH output
   * 
   * @private
   * @param {string} output - SSH process output
   * @returns {string|null} Extracted URL or null if not found
   */
  _extractLocalhostRunUrl(output) {
    // localhost.run outputs: "Connect to https://randomstring.localhost.run"
    const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.localhost\.run/);
    return match ? match[0] : null;
  }

  /**
   * Extract subdomain from a LocalhostRun URL
   * 
   * @private
   * @param {string} url - The tunnel URL
   * @returns {string|null} Extracted subdomain or null
   */
  _extractSubdomain(url) {
    const match = url.match(/https:\/\/([a-zA-Z0-9-]+)\.localhost\.run/);
    return match ? match[1] : null;
  }
}
