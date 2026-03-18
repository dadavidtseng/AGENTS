/**
 * @fileoverview Abstract base class for all tunnel services
 * Based on TunnelManagerSpec.md Section 3.2 specification
 */

import EventEmitter from 'events';
import { 
  TransientTunnelError, 
  PermanentTunnelError, 
  CriticalTunnelError,
  ConfigurationError,
  SSHUnavailableError,
  ConnectionTimeoutError,
  AuthenticationFailedError
} from './errors.js';

/**
 * Abstract base class that defines the contract for all tunnel service implementations.
 * This class MUST NOT be instantiated directly - it serves as an interface specification.
 * 
 * All concrete tunnel services must extend this class and implement its abstract methods.
 * 
 * @abstract
 * @extends EventEmitter
 */
export class BaseTunnelService extends EventEmitter {
  /**
   * Constructor for the base tunnel service
   * @param {Object} config - Global tunnel configuration object
   * @throws {Error} If instantiated directly (must be subclassed)
   */
  constructor(config) {
    super();
    
    // Prevent direct instantiation of abstract class
    if (this.constructor === BaseTunnelService) {
      throw new Error('BaseTunnelService is abstract and cannot be instantiated directly');
    }
    
    this.config = config || {};
    this.activeTunnels = new Map();
    this.isShuttingDown = false;
    
    // Validate that subclass implements required abstract methods
    this._validateImplementation();
  }

  /**
   * Validates that the subclass properly implements all abstract methods
   * @private
   */
  _validateImplementation() {
    const requiredMethods = ['name', 'connect', 'disconnect', 'getStatus'];
    
    for (const method of requiredMethods) {
      if (method === 'name') {
        // Check getter exists and returns string
        const descriptor = Object.getOwnPropertyDescriptor(this.constructor.prototype, method);
        if (!descriptor || !descriptor.get) {
          throw new Error(`Subclass must implement getter '${method}'`);
        }
      } else {
        // Check method exists and is not the abstract implementation
        if (typeof this[method] !== 'function' || this[method] === BaseTunnelService.prototype[method]) {
          throw new Error(`Subclass must implement method '${method}'`);
        }
      }
    }
  }

  /**
   * Abstract getter that returns the unique service name identifier
   * @abstract
   * @returns {string} The service name (e.g., 'serveo', 'pinggy', 'localtunnel')
   * @throws {Error} Must be implemented by subclass
   */
  get name() {
    throw new Error('Abstract getter "name" must be implemented by subclass');
  }

  /**
   * Abstract method to establish a tunnel connection
   * @abstract
   * @param {Object} options - Connection options specific to the service
   * @param {number} options.port - Local port to tunnel
   * @param {string} [options.subdomain] - Requested subdomain (if supported)
   * @param {string} [options.region] - Preferred region (if supported)
   * @param {number} [options.timeout=30000] - Connection timeout in milliseconds
   * @returns {Promise<Object>} Promise that resolves with tunnel information
   * @property {string} id - Unique tunnel identifier
   * @property {string} publicUrl - Public URL for accessing the tunnel
   * @property {string} serviceName - Name of the service that created the tunnel
   * @property {number} localPort - Local port being tunneled
   * @property {string} [subdomain] - Actual subdomain used (if applicable)
   * @property {Date} createdAt - Tunnel creation timestamp
   * @throws {TransientTunnelError} For temporary failures that should trigger fallback
   * @throws {PermanentTunnelError} For permanent failures that should not trigger fallback
   * @throws {CriticalTunnelError} For critical failures that should stop all operations
   */
  async connect(options) {
    throw new Error('Abstract method "connect" must be implemented by subclass');
  }

  /**
   * Abstract method to disconnect and destroy a tunnel
   * @abstract
   * @param {string} tunnelId - Unique identifier of the tunnel to destroy
   * @returns {Promise<void>} Promise that resolves when tunnel is destroyed
   * @throws {Error} If tunnel ID is not found or destruction fails
   */
  async disconnect(tunnelId) {
    throw new Error('Abstract method "disconnect" must be implemented by subclass');
  }

  /**
   * Abstract method to get current service status
   * @abstract
   * @returns {Object} Current status of the service
   * @property {string} serviceName - Name of this service
   * @property {number} activeTunnels - Number of active tunnels
   * @property {boolean} available - Whether the service is currently available
   * @property {string} [status] - Additional status information
   */
  getStatus() {
    throw new Error('Abstract method "getStatus" must be implemented by subclass');
  }

  /**
   * Shutdown method for cleanup when service is no longer needed
   * Can be overridden by subclasses for specific cleanup logic
   * @returns {Promise<void>} Promise that resolves when shutdown is complete
   */
  async shutdown() {
    this.isShuttingDown = true;
    
    // Disconnect all active tunnels
    const disconnectPromises = Array.from(this.activeTunnels.keys()).map(tunnelId => 
      this.disconnect(tunnelId).catch(error => {
        debug(`Warning: Failed to disconnect tunnel ${tunnelId} during shutdown:`, error.message);
      })
    );
    
    await Promise.allSettled(disconnectPromises);
    this.activeTunnels.clear();
    this.removeAllListeners();
  }

  /**
   * Validates configuration object for the service
   * Can be overridden by subclasses for service-specific validation
   * @param {Object} config - Configuration to validate
   * @throws {ConfigurationError} If configuration is invalid
   */
  validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new ConfigurationError('Configuration must be an object');
    }
    
    // Base validation - subclasses can override for specific requirements
    if (config.timeout !== undefined && (typeof config.timeout !== 'number' || config.timeout <= 0)) {
      throw new ConfigurationError('Timeout must be a positive number', 'timeout', config.timeout);
    }
  }

  /**
   * Determines if an error is transient (should trigger fallback)
   * @param {Error} error - Error to categorize
   * @returns {boolean} True if error is transient
   */
  isTransientError(error) {
    // Check error type first
    if (error instanceof TransientTunnelError) return true;
    if (error instanceof PermanentTunnelError || error instanceof CriticalTunnelError) return false;
    
    // Check error message patterns for common transient errors
    const message = error.message ? error.message.toLowerCase() : '';
    const transientPatterns = [
      'timeout',
      'connection refused',
      'network unreachable',
      'host unreachable', 
      'temporarily unavailable',
      'service unavailable',
      'econnrefused',
      'enotfound',
      'etimedout'
    ];
    
    return transientPatterns.some(pattern => message.includes(pattern));
  }

  /**
   * Determines if an error is permanent (should not trigger fallback)
   * @param {Error} error - Error to categorize
   * @returns {boolean} True if error is permanent
   */
  isPermanentError(error) {
    // Check error type first
    if (error instanceof PermanentTunnelError) return true;
    if (error instanceof TransientTunnelError) return false;
    
    // Check error message patterns for common permanent errors
    const message = error.message ? error.message.toLowerCase() : '';
    const permanentPatterns = [
      'ssh: command not found',
      'permission denied',
      'authentication failed', 
      'invalid configuration',
      'command not found',
      'access denied',
      'unauthorized',
      'forbidden',
      'invalid subdomain',
      'malformed',
      'eacces'
    ];
    
    return permanentPatterns.some(pattern => message.includes(pattern));
  }

  /**
   * Determines if an error is critical (should stop all operations)
   * @param {Error} error - Error to categorize  
   * @returns {boolean} True if error is critical
   */
  isCriticalError(error) {
    if (error instanceof CriticalTunnelError) return true;
    
    const message = error.message ? error.message.toLowerCase() : '';
    const criticalPatterns = [
      'out of memory',
      'file descriptor',
      'resource exhaustion',
      'security violation',
      'corrupted',
      'system error',
      'emfile',
      'enomem'
    ];
    
    return criticalPatterns.some(pattern => message.includes(pattern));
  }

  /**
   * Generates a unique tunnel ID
   * @protected
   * @returns {string} Unique tunnel identifier
   */
  _generateTunnelId() {
    return `tunnel_${this.name}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Emits a standardized progress event
   * @protected
   * @param {string} status - Status identifier (e.g., 'connecting', 'connected', 'disconnecting')
   * @param {string} message - Human-readable progress message
   * @param {string} [tunnelId] - Associated tunnel ID if applicable
   */
  _emitProgress(status, message, tunnelId = null) {
    this.emit('tunnelProgress', {
      service: this.name,
      status,
      message,
      tunnelId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Emits a standardized error event
   * @protected
   * @param {Error} error - Error that occurred
   * @param {string} [tunnelId] - Associated tunnel ID if applicable
   */
  _emitError(error, tunnelId = null) {
    this.emit('tunnelError', {
      service: this.name,
      error: error.message,
      type: error.constructor.name,
      tunnelId,
      timestamp: new Date().toISOString(),
      isTransient: this.isTransientError(error),
      isPermanent: this.isPermanentError(error),
      isCritical: this.isCriticalError(error)
    });
  }

  /**
   * Emits a tunnel created event
   * @protected
   * @param {Object} tunnelInfo - Information about the created tunnel
   */
  _emitTunnelCreated(tunnelInfo) {
    this.emit('tunnelCreated', {
      ...tunnelInfo,
      service: this.name,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Emits a tunnel destroyed event
   * @protected  
   * @param {string} tunnelId - ID of the destroyed tunnel
   */
  _emitTunnelDestroyed(tunnelId) {
    this.emit('tunnelDestroyed', {
      service: this.name,
      tunnelId,
      timestamp: new Date().toISOString()
    });
  }
}
