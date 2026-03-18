/**
 * @fileoverview Service registration and management interface for tunnel services
 * Based on TunnelManagerSpec.md Section 3.3 specification
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import createDebug from 'debug';
import { BaseTunnelService } from './BaseTunnelService.js';
import { ConfigurationError, ServiceUnavailableError } from './errors.js';

const debug = createDebug('kadi:tunnel');

/**
 * TunnelService class for managing and registering tunnel service implementations.
 * This class provides service discovery, registration, and validation capabilities.
 */
export class TunnelService {
  /**
   * Creates a new TunnelService instance
   * @param {Object} config - Global tunnel configuration
   */
  constructor(config = {}) {
    this.config = config;
    this.services = new Map();
    this.serviceInstances = new Map();
    this.isInitialized = false;
  }

  /**
   * Initializes the service by discovering and loading all available services
   * @param {string} [servicesDir] - Directory to scan for service files (optional)
   * @returns {Promise<void>}
   */
  async initialize(servicesDir = null) {
    if (this.isInitialized) {
      return;
    }

    // Default to the services directory relative to this file
    if (!servicesDir) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      servicesDir = path.join(__dirname, 'services');
    }

    await this.discoverServices(servicesDir);
    this.isInitialized = true;
  }

  /**
   * Discovers and loads all service modules from the specified directory
   * @param {string} servicesDir - Directory to scan for service files
   * @returns {Promise<void>}
   */
  async discoverServices(servicesDir) {
    try {
      // Check if services directory exists
      const stats = await fs.stat(servicesDir);
      if (!stats.isDirectory()) {
        debug(`Services directory ${servicesDir} is not a directory`);
        return;
      }

      // Read all files in the services directory
      const files = await fs.readdir(servicesDir);
      
      // Filter for JavaScript files that likely contain services
      const serviceFiles = files.filter(file => 
        file.endsWith('.js') && 
        file.includes('Service') && 
        !file.includes('.test.') && 
        !file.includes('.spec.')
      );

      debug(`🔍 Discovering tunnel services in ${servicesDir}`);
      debug(`   Found ${serviceFiles.length} potential service files: ${serviceFiles.join(', ')}`);

      // Load each service module
      for (const file of serviceFiles) {
        try {
          await this.loadService(path.join(servicesDir, file));
        } catch (error) {
          debug(`⚠️  Failed to load service from ${file}: ${error.message}`);
        }
      }

      debug(`✅ Loaded ${this.services.size} tunnel services: ${Array.from(this.services.keys()).join(', ')}`);
    } catch (error) {
      debug(`Warning: Could not access services directory ${servicesDir}: ${error.message}`);
    }
  }

  /**
   * Loads a single service module and registers it
   * @param {string} servicePath - Full path to the service module file
   * @returns {Promise<void>}
   */
  async loadService(servicePath) {
    try {
      // Dynamic import of the service module - convert to absolute path and file URL
      const absolutePath = path.isAbsolute(servicePath) ? servicePath : path.resolve(servicePath);
      const importPath = `file://${absolutePath}`;
      const serviceModule = await import(importPath);
      
      // Look for the default export or a named export that extends BaseTunnelService
      let ServiceClass = null;
      
      if (serviceModule.default && this.isValidServiceClass(serviceModule.default)) {
        ServiceClass = serviceModule.default;
      } else {
        // Look for named exports that extend BaseTunnelService
        for (const [name, exportedClass] of Object.entries(serviceModule)) {
          if (this.isValidServiceClass(exportedClass)) {
            ServiceClass = exportedClass;
            break;
          }
        }
      }

      if (!ServiceClass) {
        throw new Error(`No valid service class found in ${servicePath}`);
      }

      // Register the service class
      this.registerService(ServiceClass);
      
    } catch (error) {
      throw new Error(`Failed to load service from ${servicePath}: ${error.message}`);
    }
  }

  /**
   * Validates that a class is a proper tunnel service implementation
   * @param {Function} ServiceClass - Class to validate
   * @returns {boolean} True if class is a valid service
   */
  isValidServiceClass(ServiceClass) {
    // Must be a function (class constructor)
    if (typeof ServiceClass !== 'function') {
      return false;
    }

    // Must extend BaseTunnelService
    if (!ServiceClass.prototype || !(ServiceClass.prototype instanceof BaseTunnelService)) {
      return false;
    }

    return true;
  }

  /**
   * Registers a service class for use
   * @param {Function} ServiceClass - Service class that extends BaseTunnelService
   * @throws {ConfigurationError} If service class is invalid
   */
  registerService(ServiceClass) {
    if (!this.isValidServiceClass(ServiceClass)) {
      throw new ConfigurationError('Service class must extend BaseTunnelService');
    }

    // Create a temporary instance to get the service name
    let serviceName;
    try {
      const tempInstance = new ServiceClass(this.config);
      serviceName = tempInstance.name;
      
      // Validate that name is a non-empty string
      if (!serviceName || typeof serviceName !== 'string') {
        throw new ConfigurationError('Service name must be a non-empty string');
      }
      
      // Clean up temporary instance
      tempInstance.removeAllListeners();
    } catch (error) {
      throw new ConfigurationError(`Failed to instantiate service for registration: ${error.message}`);
    }

    // Register the service class
    this.services.set(serviceName, ServiceClass);
    debug(`📝 Registered tunnel service: ${serviceName}`);
  }

  /**
   * Gets a service instance by name, creating it if necessary
   * @param {string} serviceName - Name of the service to get
   * @returns {BaseTunnelService} Service instance
   * @throws {ServiceUnavailableError} If service is not found
   */
  getService(serviceName) {
    if (!this.services.has(serviceName)) {
      throw new ServiceUnavailableError(serviceName, `Service '${serviceName}' is not registered`);
    }

    // Return existing instance if available
    if (this.serviceInstances.has(serviceName)) {
      return this.serviceInstances.get(serviceName);
    }

    // Create new instance
    const ServiceClass = this.services.get(serviceName);
    const instance = new ServiceClass(this.config);
    
    this.serviceInstances.set(serviceName, instance);
    return instance;
  }

  /**
   * Checks if a service is available
   * @param {string} serviceName - Name of the service to check
   * @returns {boolean} True if service is available
   */
  hasService(serviceName) {
    return this.services.has(serviceName);
  }

  /**
   * Gets a list of all registered service names
   * @returns {string[]} Array of service names
   */
  getAvailableServices() {
    return Array.from(this.services.keys());
  }

  /**
   * Gets status information for all services
   * @returns {Object} Status information keyed by service name
   */
  getServicesStatus() {
    const status = {};
    
    for (const serviceName of this.services.keys()) {
      try {
        if (this.serviceInstances.has(serviceName)) {
          const instance = this.serviceInstances.get(serviceName);
          const serviceStatus = instance.getStatus();
          status[serviceName] = {
            ...serviceStatus,
            loaded: true
          };
        } else {
          status[serviceName] = {
            serviceName,
            available: true,
            loaded: false,
            activeTunnels: 0
          };
        }
      } catch (error) {
        status[serviceName] = {
          serviceName,
          available: false,
          error: error.message,
          loaded: this.serviceInstances.has(serviceName)
        };
      }
    }
    
    return status;
  }

  /**
   * Validates a service configuration
   * @param {string} serviceName - Name of the service
   * @param {Object} config - Configuration to validate
   * @throws {ServiceUnavailableError} If service is not found
   * @throws {ConfigurationError} If configuration is invalid
   */
  validateServiceConfig(serviceName, config) {
    if (!this.hasService(serviceName)) {
      throw new ServiceUnavailableError(serviceName);
    }

    const service = this.getService(serviceName);
    service.validateConfig(config);
  }

  /**
   * Shuts down all service instances and cleans up resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    debug('🔄 Shutting down tunnel services...');
    
    // Shutdown all service instances
    const shutdownPromises = Array.from(this.serviceInstances.values()).map(instance =>
      instance.shutdown().catch(error => {
        debug(`Warning: Failed to shutdown service ${instance.name}:`, error.message);
      })
    );

    await Promise.allSettled(shutdownPromises);
    
    // Clear all registrations
    this.services.clear();
    this.serviceInstances.clear();
    this.isInitialized = false;
    
    debug('✅ All tunnel services shut down');
  }
}
