/**
 * S3-Compatible HTTP Server
 * 
 * Generic S3-compatible HTTP server that provides object storage functionality
 * by implementing S3-compatible GET/HEAD endpoints with proper authentication,
 * bucket/key path mapping, and flexible MIME type handling.
 * 
 * Built on top of HttpServerProvider for server management and FileStreamingUtils
 * for efficient file serving with range request support.
 * 
 * Features:
 * - S3-compatible GET/HEAD endpoints for object storage
 * - Flexible bucket/key to local file path mapping
 * - Temporary credential generation and validation
 * - Comprehensive MIME type detection (including container formats)
 * - Download progress tracking and analytics
 * - Auto-shutdown based on download completion
 * - Tunnel integration for public access
 * - Optimized for container registries, file storage, and media serving
 */

import { EventEmitter } from 'events';
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';
import createDebug from 'debug';

// Create debug instances for different components
const debug = createDebug('kadi:registry:s3');
const debugAuth = createDebug('kadi:registry:s3:auth');
const debugShutdown = createDebug('kadi:registry:s3:shutdown');
const debugDashboard = createDebug('kadi:registry:s3:dashboard');
import fs from 'fs/promises';
import { statSync, accessSync, constants } from 'fs';
import { HttpServerProvider } from './providers/httpServerProvider.js';
import { FileStreamingUtils, FileStreamer } from './utils/fileStreamingUtils.js';
import { DownloadMonitor } from './downloadMonitor.js';
import { ShutdownManager } from './shutdownManager.js';
import { MonitoringDashboard } from './monitoringDashboard.js';
import { EventNotifier } from './eventNotifier.js';

class S3HttpServer extends EventEmitter {
  constructor(config) {
    super();

    this.config = {
      // Server configuration
      port: config.port || 5000,
      host: config.host || '0.0.0.0',

      // S3 server settings
      serverName: config.serverName || 'local-s3-server',
      bucketMapping: config.bucketMapping || new Map(),
      rootDirectory: config.rootDirectory || process.cwd(),

      // Bucket access control settings
      bucketAccessControl: config.bucketAccessControl || new Map(), // bucket -> permissions object
      defaultBucketPermissions: config.defaultBucketPermissions || { read: true, write: false },
      allowNewBuckets: config.allowNewBuckets !== false, // Default allow
      maxPathDepth: config.maxPathDepth || 10,
      allowedFileExtensions: config.allowedFileExtensions || new Set([
        // Generic file types
        '.txt', '.json', '.xml', '.yaml', '.yml', '.csv', '.log',
        // Archive formats (useful for containers and general storage)
        '.tar', '.gz', '.zip', '.7z', '.bz2', '.xz',
        // Media formats
        '.jpg', '.jpeg', '.png', '.gif', '.svg', '.pdf', '.mp4', '.mp3',
        // Development formats
        '.js', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.c',
        // Container registry formats (critical for container support)
        '.bin', '.layer', '.manifest', '.config', '.blob', '.data',
        // Files without extensions (common in container registries)
        ''
      ]),

      // Authentication settings
      enableAuth: config.enableAuth !== false, // Default enabled
      tempCredentialExpiry: config.tempCredentialExpiry || 3600, // 1 hour
      allowAnonymousRead: config.allowAnonymousRead || false,
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024 * 1024, // 10GB default

      // S3 compatibility settings  
      enableCORS: config.enableCORS !== false, // Default enabled for web access
      customHeaders: config.customHeaders || new Map(),

      // Performance and caching
      enableETag: config.enableETag !== false,
      enableLastModified: config.enableLastModified !== false,
      cacheMaxAge: config.cacheMaxAge || 3600, // 1 hour default
      maxConcurrentDownloads: config.maxConcurrentDownloads || 10,
      enableProgressTracking: config.enableProgressTracking !== false,
      enableDownloadAnalytics: config.enableDownloadAnalytics !== false,

      // Auto-shutdown settings
      enableAutoShutdown: config.enableAutoShutdown || false,
      shutdownTimeout: config.shutdownTimeout || 300, // 5 minutes
      shutdownOnCompletion: config.shutdownOnCompletion || false,
      shutdownTriggers: config.shutdownTriggers || ['completion', 'timeout'],
      completionShutdownDelay: config.completionShutdownDelay || 30000, // 30 seconds
      maxIdleTime: config.maxIdleTime || 600000, // 10 minutes
      maxTotalTime: config.maxTotalTime || 3600000, // 1 hour

      // Phase 4: Monitoring and Dashboard settings
      enableRealTimeMonitoring: config.enableRealTimeMonitoring || false,
      monitoringUpdateInterval: config.monitoringUpdateInterval || 1000, // 1 second
      enableDownloadTracking: config.enableDownloadTracking !== false,

      // Phase 4: Event notification settings
      enableEventNotifications: config.enableEventNotifications !== false,
      notificationChannels: config.notificationChannels || ['console'],
      webhookUrl: config.webhookUrl,
      emailNotifications: config.emailNotifications || {},

      // Tunnel integration
      enableTunnel: config.enableTunnel || false,
      tunnelOptions: config.tunnelOptions || {},

      ...config
    };

    // Internal state
    this.serverId = null;
    this.server = null;
    this.tunnelUrl = null;
    this.isRunning = false;
    this.startTime = null;

    // Authentication and credentials
    this.credentials = new Map(); // credential_id -> { accessKey, secretKey, expiry, permissions }
    this.activeSessions = new Map(); // session_id -> session_info

    // Download tracking
    this.activeDownloads = new Map(); // download_id -> download_info
    this.downloadStats = {
      totalDownloads: 0,
      totalBytes: 0,
      completedDownloads: 0,
      failedDownloads: 0
    };

    // Expected downloads for auto-shutdown
    this.expectedDownloads = new Set(); // Set of expected file paths
    this.completedDownloads = new Set(); // Set of completed file paths

    // Initialize providers
    this.httpProvider = new HttpServerProvider(this.config);
    this.fileUtils = new FileStreamingUtils({
      enableETag: true,
      enableLastModified: true,
      enableCaching: true,
      progressInterval: 64 * 1024 // 64KB progress updates
    });
    this.fileStreamer = new FileStreamer(this.fileUtils, {
      bufferSize: 64 * 1024,
      progressInterval: 1024 * 1024,
      timeout: 30000
    });

    // Phase 4: Initialize monitoring and auto-shutdown components
    this.downloadMonitor = new DownloadMonitor({
      trackPartialDownloads: this.config.enableDownloadTracking,
      progressUpdateInterval: this.config.monitoringUpdateInterval,
      completionCheckInterval: 2000
    });

    this.shutdownManager = new ShutdownManager({
      enableAutoShutdown: this.config.enableAutoShutdown,
      shutdownTriggers: this.config.shutdownTriggers,
      shutdownOnCompletion: this.config.shutdownOnCompletion,
      completionShutdownDelay: this.config.completionShutdownDelay,
      maxIdleTime: this.config.maxIdleTime,
      maxTotalTime: this.config.maxTotalTime,
      testMode: this.config.testMode // Pass test mode to prevent process.exit()
    });

    this.monitoringDashboard = new MonitoringDashboard({
      updateInterval: this.config.monitoringUpdateInterval,
      showServerStats: true,
      showDownloadProgress: true,
      showActiveDownloads: true,
      showShutdownStatus: true
    });

    this.eventNotifier = new EventNotifier({
      enableConsoleNotifications: this.config.notificationChannels.includes('console'),
      enableFileNotifications: this.config.notificationChannels.includes('file'),
      enableWebhookNotifications: this.config.notificationChannels.includes('webhook'),
      webhookUrl: this.config.webhookUrl,
      consoleLevel: 'info'
    });

    // Dashboard tracking variables for in-place updates
    this.dashboardStarted = false;
    this.dashboardLineCount = 0;

    // Setup Phase 4 integrations
    this.setupPhase4Integration();

    // Setup event forwarding
    this.setupEventHandling();
  }

  // ============================================================================
  // AUTHENTICATION MIDDLEWARE
  // ============================================================================

  /**
   * Validate AWS-style signature or token-based authentication
   * @param {Object} req - Express request object
   * @returns {Object} Authentication result with user info or error
   */
  async validateAuthentication(req) {
    // Skip authentication if disabled
    if (!this.config.enableAuth) {
      return { success: true, user: { anonymous: true, permissions: new Set(['read']) } };
    }

    // Check for Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      // Allow anonymous read if configured
      if (this.config.allowAnonymousRead && req.method === 'GET') {
        return { success: true, user: { anonymous: true, permissions: new Set(['read']) } };
      }
      return { success: false, error: 'Missing Authorization header', code: 401 };
    }

    try {
      // Parse different auth types
      if (authHeader.startsWith('AWS4-HMAC-SHA256')) {
        return await this.validateAWSSignature(req, authHeader);
      } else if (authHeader.startsWith('Bearer ')) {
        return await this.validateTokenAuth(req, authHeader);
      } else if (authHeader.startsWith('Basic ')) {
        return await this.validateBasicAuth(req, authHeader);
      } else {
        return { success: false, error: 'Unsupported authentication method', code: 401 };
      }
    } catch (error) {
      console.error('🔒 Authentication validation error:', error);
      return { success: false, error: 'Authentication validation failed', code: 401 };
    }
  }

  /**
   * Validate AWS-style signature (simplified implementation)
   * @param {Object} req - Express request object
   * @param {string} authHeader - Authorization header value
   * @returns {Object} Validation result
   */
  async validateAWSSignature(req, authHeader) {
    // Parse AWS signature components
    const signatureRegex = /AWS4-HMAC-SHA256 Credential=([^,]+),SignedHeaders=([^,]+),Signature=([a-f0-9]+)/;
    const match = authHeader.match(signatureRegex);

    if (!match) {
      return { success: false, error: 'Invalid AWS signature format', code: 401 };
    }

    const [, credentialString, signedHeaders, providedSignature] = match;
    const [accessKey] = credentialString.split('/');

    // Check if credential exists and is valid
    const credential = this.credentials.get(accessKey);
    if (!credential) {
      return { success: false, error: 'Invalid access key', code: 401 };
    }

    // Check expiry
    if (new Date() > credential.expiry) {
      this.credentials.delete(accessKey);
      return { success: false, error: 'Credentials expired', code: 401 };
    }

    // Check rate limits
    if (!this.checkRateLimit(credential)) {
      return { success: false, error: 'Rate limit exceeded', code: 429 };
    }

    // For simplified implementation, we'll skip full signature validation
    // In production, this would verify the signature against the request

    // Update usage tracking
    credential.lastUsed = new Date();
    credential.usageCount++;

    return {
      success: true,
      user: {
        accessKey: credential.accessKey,
        permissions: new Set(credential.permissions),
        allowedBuckets: credential.buckets, // buckets -> allowedBuckets
        sessionName: credential.sessionName,
        sessionToken: credential.sessionToken
      }
    };
  }

  /**
   * Validate Bearer token authentication
   * @param {Object} req - Express request object  
   * @param {string} authHeader - Authorization header value
   * @returns {Object} Validation result
   */
  async validateTokenAuth(req, authHeader) {
    const token = authHeader.replace('Bearer ', '');

    // Look for matching session or credential by token
    for (const [accessKey, credential] of this.credentials.entries()) {
      if (credential.sessionToken === token || credential.accessKey === token) {
        // Check expiry
        if (new Date() > credential.expiry) {
          this.credentials.delete(accessKey);
          return { success: false, error: 'Token expired', code: 401 };
        }

        // Check rate limits
        if (!this.checkRateLimit(credential)) {
          return { success: false, error: 'Rate limit exceeded', code: 429 };
        }

        // Update usage
        credential.lastUsed = new Date();
        credential.usageCount++;

        return {
          success: true,
          user: {
            accessKey: credential.accessKey,
            permissions: new Set(credential.permissions),
            allowedBuckets: credential.buckets, // buckets -> allowedBuckets
            sessionName: credential.sessionName,
            sessionToken: credential.sessionToken
          }
        };
      }
    }

    return { success: false, error: 'Invalid token', code: 401 };
  }

  /**
   * Validate Basic authentication (access key as username, secret as password)
   * @param {Object} req - Express request object
   * @param {string} authHeader - Authorization header value
   * @returns {Object} Validation result
   */
  async validateBasicAuth(req, authHeader) {
    const credentials = Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString('utf-8');
    const [accessKey, secretKey] = credentials.split(':');

    if (!accessKey || !secretKey) {
      return { success: false, error: 'Invalid basic auth format', code: 401 };
    }

    const credential = this.credentials.get(accessKey);
    if (!credential || credential.secretKey !== secretKey) {
      return { success: false, error: 'Invalid credentials', code: 401 };
    }

    // Check expiry
    if (new Date() > credential.expiry) {
      this.credentials.delete(accessKey);
      return { success: false, error: 'Credentials expired', code: 401 };
    }

    // Check rate limits
    if (!this.checkRateLimit(credential)) {
      return { success: false, error: 'Rate limit exceeded', code: 429 };
    }

    // Update usage
    credential.lastUsed = new Date();
    credential.usageCount++;

    return {
      success: true,
      user: {
        accessKey: credential.accessKey,
        permissions: new Set(credential.permissions),
        allowedBuckets: credential.buckets, // buckets -> allowedBuckets
        sessionName: credential.sessionName,
        sessionToken: credential.sessionToken
      }
    };
  }

  /**
   * Check rate limiting for a credential
   * @param {Object} credential - Credential object
   * @returns {boolean} Whether request is within rate limits
   */
  checkRateLimit(credential) {
    const now = Date.now();

    // Reset rate limit window if needed
    if (now > credential.rateLimit.resetTime) {
      credential.rateLimit.requests = 0;
      credential.rateLimit.resetTime = now + 60000; // Next minute
    }

    // Check if limit exceeded (100 requests per minute by default)
    const maxRequests = this.config.rateLimit || 100;
    if (credential.rateLimit.requests >= maxRequests) {
      return false;
    }

    // Increment request count
    credential.rateLimit.requests++;
    return true;
  }

  /**
   * Validate user permissions for requested action
   * @param {Object} user - User object from authentication
   * @param {string} action - Requested action ('read', 'write', 'delete')
   * @param {string} bucket - Target bucket name
   * @returns {boolean} Whether action is allowed
   */
  validatePermissions(user, action, bucket) {
    // Handle case where user is undefined (shouldn't happen but be defensive)
    if (!user) {
      // If auth is disabled, allow read access
      if (!this.config.enableAuth && action === 'read') {
        return true;
      }
      return false;
    }

    // Anonymous users can only read if allowed
    if (user.anonymous) {
      return action === 'read' && this.config.allowAnonymousRead;
    }

    // Check if user has required permission
    if (!user.permissions.has(action)) {
      return false;
    }

    // Check bucket access (wildcard or specific bucket)
    // allowedBuckets is now consistently an Array
    const hasAccess = user.allowedBuckets.includes('*') || user.allowedBuckets.includes(bucket);

    if (!hasAccess) {
      return false;
    }

    return true;
  }

  /**
   * Get current authentication statistics
   * @returns {Object} Authentication stats
   */
  getAuthenticationStats() {
    const stats = {
      totalCredentials: this.credentials.size,
      activeCredentials: 0,
      expiredCredentials: 0,
      totalUsage: 0,
      credentialsByPermission: {
        read: 0,
        write: 0,
        delete: 0
      }
    };

    const now = new Date();
    for (const credential of this.credentials.values()) {
      if (now > credential.expiry) {
        stats.expiredCredentials++;
      } else {
        stats.activeCredentials++;
      }

      stats.totalUsage += credential.usageCount;

      credential.permissions.forEach(permission => {
        if (stats.credentialsByPermission[permission] !== undefined) {
          stats.credentialsByPermission[permission]++;
        }
      });
    }

    return stats;
  }

  /**
   * Clean up expired credentials
   * @returns {number} Number of credentials cleaned up
   */
  cleanupExpiredCredentials() {
    const now = new Date();
    let cleanedCount = 0;

    for (const [accessKey, credential] of this.credentials.entries()) {
      if (now > credential.expiry) {
        this.credentials.delete(accessKey);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired credentials`);
    }

    return cleanedCount;
  }

  // ============================================================================
  // SERVER LIFECYCLE MANAGEMENT
  // ============================================================================

  /**
   * Start the container HTTP server
   * @param {Object} options - Startup options
   * @returns {Promise<Object>} Server info with URLs and configuration
   */
  /**
   * Start the S3-compatible HTTP server.
   *
   * Steps:
   * 1) Boot the underlying HTTP provider (tunneled/plain)
   * 2) Register S3 routes and auth middleware
   * 3) Optionally set up a public tunnel
   * 4) Enable auto-shutdown + monitoring (Phase 4)
   * 5) Emit server:started with runtime metadata
   */
  async start(options = {}) {
    if (this.isRunning) {
      throw new Error('Container server is already running');
    }

    try {
      // Validate configuration
      await this.validateConfiguration();

      // Create HTTP server using HttpServerProvider - use tunneled server if enabled
      let serverId;
      if (this.config.enableTunnel && this.config.tunnelOptions) {
        console.log('🚇 Creating tunneled S3 server...');
        serverId = await this.httpProvider.createTunneledServer(
          this.config.port,
          this.config.rootDirectory,
          this.config.tunnelOptions,
          {
            host: this.config.host,
            enableCORS: true,
            middleware: [],
            staticFiles: false // We'll handle file serving manually
          }
        );
      } else {
        serverId = await this.httpProvider.createHttpServer(
          this.config.port,
          this.config.rootDirectory,
          {
            host: this.config.host,
            enableCORS: true,
            middleware: [],
            staticFiles: false, // We'll handle file serving manually
            tunnelOptions: this.config.enableTunnel ? this.config.tunnelOptions : null
          }
        );
      }

      this.serverId = serverId;

      // Get server instance from provider
      const serverInfo = this.httpProvider.getServerStatus(serverId);
      this.server = serverInfo.server;

      // Step 2: Register S3-compatible routes
      await this.registerS3Routes();

      // Step 2: Register authentication middleware
      await this.registerAuthMiddleware();

      // Step 3: Setup tunnel if enabled
      if (this.config.enableTunnel) {
        await this.setupTunnel();
      }

      // Mark as running
      this.isRunning = true;
      this.startTime = new Date();

      // Step 4: Setup auto-shutdown if enabled
      if (this.config.enableAutoShutdown) {
        this.setupAutoShutdown();
      }

      // Step 4: Start Phase 4 monitoring systems
      const phase4Result = this.startPhase4Monitoring(options);
      if (!phase4Result.success) {
        debug('⚠️  Some Phase 4 monitoring components failed to start:', phase4Result.message);
      }

      const result = {
        serverId: this.serverId,
        port: serverInfo.port, // Use actual assigned port
        localUrl: `http://localhost:${serverInfo.port}`,
        tunnelUrl: this.tunnelUrl,
        serverName: this.config.serverName,
        authEnabled: this.config.enableAuth,
        startTime: this.startTime,
        phase4Monitoring: phase4Result
      };

      // Step 5: Notify listeners with server metadata
      this.emit('server:started', result);
      return result;

    } catch (error) {
      this.emit('server:error', error);
      throw error;
    }
  }

  /**
   * Stop the container HTTP server
   * @param {Object} options - Shutdown options
   * @returns {Promise<void>}
   */
  async stop(options = {}) {
    if (!this.isRunning) {
      return;
    }

    try {
      const graceful = options.graceful !== false; // Default graceful
      const timeout = options.timeout || 30000; // 30 second timeout

      this.emit('server:stopping', { graceful, timeout });

      // Step 1: Stop Phase 4 monitoring systems
      const phase4Result = this.stopPhase4Monitoring();
      if (!phase4Result.success) {
        debug('⚠️  Some Phase 4 monitoring components failed to stop:', phase4Result.message);
      }

      if (graceful) {
        // Wait for active downloads to complete or timeout
        await this.waitForActiveDownloads(timeout);
      }

      // Step 2: Stop HTTP server
      if (this.serverId) {
        await this.httpProvider.stopServer(this.serverId);
      }

      // Step 3: Cleanup in-memory resources
      await this.cleanup();

      // Reset state
      this.isRunning = false;
      this.serverId = null;
      this.server = null;
      this.tunnelUrl = null;

      // Step 4: Notify listeners
      this.emit('server:stopped');

    } catch (error) {
      this.emit('server:error', error);
      throw error;
    }
  }

  /**
   * Get current server status
   * @returns {Object} Server status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      serverId: this.serverId,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      activeDownloads: this.activeDownloads.size,
      totalDownloads: this.downloadStats.totalDownloads,
      completedDownloads: this.downloadStats.completedDownloads,
      failedDownloads: this.downloadStats.failedDownloads,
      totalBytesServed: this.downloadStats.totalBytes,
      activeSessions: this.activeSessions.size,
      activeCredentials: this.credentials.size,
      tunnelUrl: this.tunnelUrl,
      expectedDownloads: this.expectedDownloads.size,
      completedExpectedDownloads: this.completedDownloads.size
    };
  }

  // ============================================================================
  // BUCKET/KEY TO FILE PATH MAPPING
  // ============================================================================

  /**
   * Map S3 bucket/key to local file path with security validation
   * @param {string} bucket - S3 bucket name
   * @param {string} key - S3 object key
   * @returns {Object} Mapping result with file path and metadata
   */
  // ============================================================================
  // BUCKET/KEY PATH MAPPING (Phase 3.5)
  // ============================================================================

  /**
   * Enhanced bucket/key to file path mapping with security and validation
   * @param {string} bucket - Bucket name
   * @param {string} key - Object key
   * @param {Object} options - Additional options for path mapping
   * @returns {Object} Path mapping result with security validation
   */
  mapBucketKeyToPath(bucket, key, options = {}) {
    try {
      const {
        validateAccess = false,
        checkExistence = true,
        requireReadPermission = false
      } = options;

      // Normalize and validate inputs
      const normalizedBucket = this.normalizeBucketName(bucket);

      // Validate object key early for security
      let normalizedKey;
      try {
        normalizedKey = this.normalizeObjectKey(key);
      } catch (error) {
        return {
          success: false,
          error: `Security violation: ${error.message}`,
          bucket: normalizedBucket,
          key: key
        };
      }

      // Validate bucket access permissions (only if explicitly requested)
      if (validateAccess && !this.validateBucketAccess(normalizedBucket)) {
        return {
          success: false,
          error: `Access denied to bucket: ${normalizedBucket}`,
          bucket: normalizedBucket,
          key: normalizedKey
        };
      }

      // Check if bucket exists in config or is allowed to be created
      if (!this.isBucketAllowed(normalizedBucket)) {
        return {
          success: false,
          error: `Bucket not allowed: ${normalizedBucket}`,
          bucket: normalizedBucket,
          key: normalizedKey
        };
      }

      // Validate file extension (if configured)
      if (!this.isFileExtensionAllowed(normalizedKey)) {
        return {
          success: false,
          error: `File extension not allowed: ${path.extname(normalizedKey)}`,
          bucket: normalizedBucket,
          key: normalizedKey
        };
      }

      // Validate path depth
      if (!this.isPathDepthAllowed(normalizedKey)) {
        return {
          success: false,
          error: `Path exceeds maximum depth: ${normalizedKey}`,
          bucket: normalizedBucket,
          key: normalizedKey
        };
      }

      // Get base path for bucket (with configurable mapping)
      const basePath = this.resolveBucketPath(normalizedBucket);

      // Construct and secure file path
      const filePath = this.constructSecureFilePath(basePath, normalizedKey);

      // Validate path security (prevent traversal attacks)
      try {
        this.validatePathSecurity(filePath, basePath);
      } catch (error) {
        return {
          success: false,
          error: `Security violation: ${error.message}`,
          bucket: normalizedBucket,
          key: normalizedKey
        };
      }

      // Optional: Check file existence
      let fileExists = null;
      if (checkExistence) {
        fileExists = this.checkFileExistence(filePath);
      }

      // Optional: Validate read permissions (only if file exists and explicitly requested)
      if (requireReadPermission && fileExists) {
        try {
          this.validateFileAccessPermissions(filePath, 'read');
        } catch (error) {
          return {
            success: false,
            error: `Read access denied for file: ${filePath}`,
            bucket: normalizedBucket,
            key: normalizedKey
          };
        }
      }

      return {
        success: true,
        bucket: normalizedBucket,
        key: normalizedKey,
        filePath: filePath,
        basePath: path.resolve(basePath),
        relativePath: path.relative(path.resolve(basePath), filePath),
        exists: fileExists,
        accessValidated: validateAccess,
        permissions: requireReadPermission ? ['read'] : []
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        bucket: bucket,
        key: key,
        securityViolation: error.message.includes('traversal') || error.message.includes('Access denied')
      };
    }
  }

  /**
   * Resolve bucket name to base directory path
   * @param {string} bucket - Normalized bucket name
   * @returns {string} Base path for the bucket
   */
  resolveBucketPath(bucket) {
    // Check for explicit bucket mapping in configuration
    if (this.config.bucketMapping && this.config.bucketMapping.has(bucket)) {
      const mappedPath = this.config.bucketMapping.get(bucket);

      // Ensure mapped path is absolute
      if (path.isAbsolute(mappedPath)) {
        return mappedPath;
      } else {
        return path.resolve(this.config.rootDirectory, mappedPath);
      }
    }

    // Default mapping: bucket as subdirectory under root
    return path.join(this.config.rootDirectory, bucket);
  }

  /**
   * Construct secure file path from base path and key
   * @param {string} basePath - Base directory path
   * @param {string} key - Normalized object key
   * @returns {string} Constructed file path
   */
  constructSecureFilePath(basePath, key) {
    // Split key into components for individual validation
    const keyComponents = key.split('/').filter(component => component.length > 0);

    // Validate each path component
    for (const component of keyComponents) {
      if (!this.isValidPathComponent(component)) {
        throw new Error(`Invalid path component: ${component}`);
      }
    }

    // Construct path using secure join
    return path.resolve(basePath, key);
  }

  /**
   * Validate that a path component is safe
   * @param {string} component - Path component to validate
   * @returns {boolean} Whether the component is safe
   */
  isValidPathComponent(component) {
    // Reject empty components
    if (!component || component.length === 0) {
      return false;
    }

    // Reject dangerous patterns
    if (component === '.' || component === '..' || component === '~') {
      return false;
    }

    // Reject components with null bytes or control characters
    if (/[\x00-\x1f\x7f]/.test(component)) {
      return false;
    }

    // Reject components that could be Windows device names
    const windowsDeviceNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    if (windowsDeviceNames.includes(component.toUpperCase())) {
      return false;
    }

    return true;
  }

  /**
   * Validate bucket access permissions
   * @param {string} bucket - Bucket name to validate access for
   * @returns {boolean} Whether access is allowed
   */
  validateBucketAccess(bucket) {
    // Check bucket access control configuration first
    if (this.config.bucketAccessControl && this.config.bucketAccessControl.has(bucket)) {
      const permissions = this.config.bucketAccessControl.get(bucket);
      return permissions.read === true;
    }

    // Check if bucket is in allowed list (if configured)
    if (this.config.allowedBuckets && this.config.allowedBuckets.length > 0) {
      if (!this.config.allowedBuckets.includes(bucket) && !this.config.allowedBuckets.includes('*')) {
        return false;
      }
    }

    // Check if bucket is in denied list (if configured)
    if (this.config.deniedBuckets && this.config.deniedBuckets.includes(bucket)) {
      return false;
    }

    // Use default permissions
    return this.config.defaultBucketPermissions ? this.config.defaultBucketPermissions.read !== false : true;
  }

  /**
   * Check if bucket is allowed (exists in mapping or new buckets are allowed)
   * @param {string} bucket - Bucket name
   * @returns {boolean} Whether bucket is allowed
   */
  isBucketAllowed(bucket) {
    // Check if bucket exists in mapping
    if (this.config.bucketMapping && this.config.bucketMapping.has(bucket)) {
      return true;
    }

    // Check if bucket has access control configured
    if (this.config.bucketAccessControl && this.config.bucketAccessControl.has(bucket)) {
      return true;
    }

    // Check if new buckets are allowed
    return this.config.allowNewBuckets !== false;
  }

  /**
   * Check if file extension is allowed
   * @param {string} key - Object key
   * @returns {boolean} Whether file extension is allowed
   */
  isFileExtensionAllowed(key) {
    // If no extension restrictions configured, allow all
    if (!this.config.allowedFileExtensions || this.config.allowedFileExtensions.size === 0) {
      return true;
    }

    const extension = path.extname(key).toLowerCase();

    // Check if the extension (or lack thereof) is in the allowed set
    // Empty string for files without extensions
    return this.config.allowedFileExtensions.has(extension);
  }

  /**
   * Check if path depth is within allowed limits
   * @param {string} key - Object key
   * @returns {boolean} Whether path depth is allowed
   */
  isPathDepthAllowed(key) {
    if (!this.config.maxPathDepth) {
      return true;
    }

    const depth = key.split('/').length;
    return depth <= this.config.maxPathDepth;
  }

  /**
   * Validate path security to prevent traversal attacks
   * @param {string} filePath - File path to validate
   * @param {string} basePath - Base path that file should be under
   * @throws {Error} If path security validation fails
   */
  validatePathSecurity(filePath, basePath) {
    const resolvedFilePath = path.resolve(filePath);
    const resolvedBasePath = path.resolve(basePath);

    // Ensure file path is within base path
    if (!resolvedFilePath.startsWith(resolvedBasePath + path.sep) && resolvedFilePath !== resolvedBasePath) {
      throw new Error('Path traversal attack detected: file path outside allowed directory');
    }

    // Additional check for symbolic link traversal
    if (resolvedFilePath.includes('..')) {
      throw new Error('Path traversal attack detected: relative path components not allowed');
    }
  }

  /**
   * Check if file exists
   * @param {string} filePath - File path to check
   * @returns {boolean} Whether file exists
   */
  checkFileExistence(filePath) {
    try {
      const stats = statSync(filePath);
      return stats.isFile();
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate file access permissions
   * @param {string} filePath - File path to check permissions for
   * @param {string} accessType - Type of access ('read', 'write', 'execute')
   * @throws {Error} If access validation fails
   */
  validateFileAccessPermissions(filePath, accessType = 'read') {
    try {

      switch (accessType) {
        case 'read':
          accessSync(filePath, constants.R_OK);
          break;
        case 'write':
          accessSync(filePath, constants.W_OK);
          break;
        case 'execute':
          accessSync(filePath, constants.X_OK);
          break;
        default:
          throw new Error(`Unknown access type: ${accessType}`);
      }
    } catch (error) {
      throw new Error(`${accessType} access denied for file: ${filePath}`);
    }
  }

  /**
   * Normalize bucket name for consistent and secure mapping
   * @param {string} bucket - Raw bucket name
   * @returns {string} Normalized bucket name
   */
  normalizeBucketName(bucket) {
    if (!bucket || typeof bucket !== 'string') {
      throw new Error('Invalid bucket name: must be a non-empty string');
    }

    // Remove leading/trailing whitespace and slashes
    let normalized = bucket.trim().replace(/^\/+|\/+$/g, '');

    // Convert to lowercase for consistency and replace underscores/dots with hyphens
    normalized = normalized.toLowerCase().replace(/[_.]/g, '-');

    // Collapse multiple consecutive hyphens into single hyphens
    normalized = normalized.replace(/-+/g, '-');

    // Remove leading and trailing hyphens
    normalized = normalized.replace(/^-+|-+$/g, '');

    // Validate bucket name format (S3-compatible rules)
    if (normalized.length < 3 || normalized.length > 63) {
      throw new Error('Bucket name must be between 3 and 63 characters');
    }

    // Check for valid characters (alphanumeric, hyphens, dots, underscores for compatibility)
    if (!/^[a-z0-9._-]+$/.test(normalized)) {
      throw new Error('Bucket name contains invalid characters');
    }

    // Additional S3-compatible validations (relaxed for testing)
    if (normalized.startsWith('.') || normalized.endsWith('.')) {
      throw new Error('Bucket name cannot start or end with dots');
    }

    // Prevent consecutive dots
    if (normalized.includes('..')) {
      throw new Error('Bucket name cannot contain consecutive dots');
    }

    // Prevent IP address format
    if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
      throw new Error('Bucket name cannot be in IP address format');
    }

    return normalized;
  }

  /**
   * Normalize object key for safe file path construction
   * @param {string} key - Raw object key
   * @returns {string} Normalized and safe object key
   */
  normalizeObjectKey(key) {
    if (!key || typeof key !== 'string') {
      throw new Error('Invalid object key: must be a non-empty string');
    }

    // Decode URL-encoded characters to catch encoded path traversal attempts
    let decodedKey = key;
    try {
      decodedKey = decodeURIComponent(key);
    } catch (error) {
      // If decoding fails, use original key
    }

    // Check for dangerous patterns BEFORE normalization (on both original and decoded)
    if (key.includes('..') || key.includes('~') || key.match(/^[a-zA-Z]:\\/) ||
      decodedKey.includes('..') || decodedKey.includes('~') || decodedKey.match(/^[a-zA-Z]:\\/)) {
      throw new Error('Object key contains invalid path traversal patterns');
    }

    // Block absolute paths that reference system directories
    if (key.match(/^\/+(etc|usr|bin|sbin|root|home|var|proc|sys|dev|tmp|boot|opt|srv)\//i) ||
      decodedKey.match(/^\/+(etc|usr|bin|sbin|root|home|var|proc|sys|dev|tmp|boot|opt|srv)\//i)) {
      throw new Error('Object key contains invalid path traversal patterns');
    }

    // Remove leading slashes and ./ patterns, trailing whitespace
    let normalized = key.replace(/^(\/+|\.\/+)/, '').trimEnd();

    if (normalized.length === 0) {
      throw new Error('Object key cannot be empty after normalization');
    }

    // Validate key length (S3 limit is 1024 characters)
    if (normalized.length > 1024) {
      throw new Error('Object key too long (maximum 1024 characters)');
    }

    // Replace multiple consecutive slashes with single slash
    normalized = normalized.replace(/\/+/g, '/');

    // Check for null bytes and control characters
    if (/[\x00-\x1f\x7f]/.test(normalized)) {
      throw new Error('Object key contains invalid control characters');
    }

    // Ensure key doesn't end with slash (remove trailing slashes)
    if (normalized.endsWith('/')) {
      normalized = normalized.replace(/\/+$/, '');
    }

    // Check if key became empty after removing trailing slashes
    if (normalized.length === 0) {
      throw new Error('Object key cannot be empty after normalization');
    }

    return normalized;
  }

  // ============================================================================
  // TEMPORARY CREDENTIAL GENERATION
  // ============================================================================

  /**
   * Generate temporary access credentials for S3-compatible authentication
   * @param {Object} options - Credential generation options
   * @returns {Object} Generated credentials with access key, secret, and metadata
   */
  generateTemporaryCredentials(options = {}) {
    const {
      expirySeconds = options.expiryMinutes ? options.expiryMinutes * 60 : this.config.tempCredentialExpiry,
      permissions = ['read'], // ['read', 'write', 'delete']
      buckets = ['*'], // Bucket access list
      sessionName = 'container-download-session'
    } = options;

    // Generate credential identifiers
    const accessKey = this.generateAccessKey();
    const secretKey = this.generateSecretKey();
    const sessionToken = this.generateSessionToken();

    // Calculate expiry time
    const expiry = new Date(Date.now() + (expirySeconds * 1000));

    // Create credential object
    const credential = {
      accessKey,
      secretKey,
      sessionToken,
      expiry,
      permissions,
      buckets,
      sessionName,
      createdAt: new Date(),
      usageCount: 0,
      lastUsed: null,
      rateLimit: {
        requests: 0,
        resetTime: Date.now() + 60000 // Next minute
      }
    };

    // Store credential
    this.credentials.set(accessKey, credential);

    // Note: We don't auto-delete expired credentials to allow proper
    // expiry error handling during authentication

    this.emit('credential:generated', {
      accessKey,
      sessionName,
      expiry,
      permissions
    });

    return {
      accessKey,
      secretKey,
      sessionToken,
      expiry: expiry.toISOString(),
      region: 'us-east-1', // Default region for compatibility
      buckets,
      permissions
    };
  }

  /**
   * Validate authentication credentials
   * @param {Object} authInfo - Authentication information from request
   * @returns {Object} Validation result
   */
  validateCredentials(authInfo) {
    const { accessKey, signature, timestamp, authorization } = authInfo;

    // Check if authentication is required
    if (!this.config.enableAuth) {
      return { valid: true, anonymous: true };
    }

    // Allow anonymous read access if configured
    if (!accessKey && this.config.allowAnonymousRead) {
      return { valid: true, anonymous: true, permissions: ['read'] };
    }

    // Validate access key exists
    const credential = this.credentials.get(accessKey);
    if (!credential) {
      return { valid: false, error: 'Invalid access key' };
    }

    // Check expiry
    if (new Date() > credential.expiry) {
      this.credentials.delete(accessKey);
      return { valid: false, error: 'Credentials expired' };
    }

    // Update usage statistics
    credential.usageCount++;
    credential.lastUsed = new Date();

    return {
      valid: true,
      credential,
      permissions: credential.permissions,
      buckets: credential.buckets
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Generate cryptographically secure access key
   * @returns {string} Access key
   */
  generateAccessKey() {
    return 'AKIA' + crypto.randomBytes(12).toString('hex').toUpperCase();
  }

  /**
   * Generate cryptographically secure secret key
   * @returns {string} Secret key
   */
  generateSecretKey() {
    return crypto.randomBytes(20).toString('base64');
  }

  /**
   * Generate cryptographically secure session token for temporary credentials
   * @returns {string} Session token
   */
  generateSessionToken() {
    return crypto.randomBytes(32).toString('base64');
  }

  /**
   * Generate unique request ID
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Validate server configuration before startup
   * @returns {Promise<void>}
   */
  async validateConfiguration() {
    // Validate port availability (allow 0 for random port assignment)
    if (this.config.port < 0 || this.config.port > 65535) {
      throw new Error('Invalid port number. Must be between 0 and 65535');
    }

    // Validate root directory exists and is accessible
    try {
      const stats = await fs.stat(this.config.rootDirectory);
      if (!stats.isDirectory()) {
        throw new Error('Root directory must be a directory');
      }
    } catch (error) {
      throw new Error(`Root directory not accessible: ${error.message}`);
    }

    // Validate bucket mappings
    for (const [bucket, relativePath] of this.config.bucketMapping) {
      try {
        const fullPath = path.join(this.config.rootDirectory, relativePath);
        const stats = await fs.stat(fullPath);
        if (!stats.isDirectory()) {
          throw new Error(`Bucket mapping path for '${bucket}' is not a directory: ${fullPath}`);
        }
      } catch (error) {
        throw new Error(`Bucket mapping path for '${bucket}' not accessible: ${error.message}`);
      }
    }
  }

  /**
   * Register S3-compatible routes with HTTP server
   * @returns {Promise<void>}
   */
  async registerS3Routes() {
    // GET /:bucket/* - Download object (wildcard matches rest of path)
    await this.httpProvider.addCustomRoute(
      this.serverId,
      'GET',
      '/:bucket/*',
      (req, res) => this.handleGetObject(req, res)
    );

    // HEAD /:bucket/* - Get object metadata
    await this.httpProvider.addCustomRoute(
      this.serverId,
      'HEAD',
      '/:bucket/*',
      (req, res) => this.handleHeadObject(req, res)
    );

    // GET / - Server health check
    await this.httpProvider.addCustomRoute(
      this.serverId,
      'GET',
      '/',
      (req, res) => this.handleHealthCheck(req, res)
    );
  }

  /**
   * Register authentication middleware
   * @returns {Promise<void>}
   */
  async registerAuthMiddleware() {
    // Always register auth middleware, but behavior depends on enableAuth config
    await this.httpProvider.addAuthMiddleware(
      this.serverId,
      (req, res, next) => this.handleAuthentication(req, res, next)
    );
  }

  /**
   * Setup tunnel integration if enabled
   * @returns {Promise<void>}
   */
  async setupTunnel() {
    if (!this.config.enableTunnel) {
      return;
    }

    // Get tunnel URL from HTTP server provider
    const serverInfo = await this.httpProvider.getServerStatus(this.serverId);
    this.tunnelUrl = serverInfo.tunnelUrl;

    if (this.tunnelUrl) {
      console.log(`🌐 Tunnel ready: ${this.tunnelUrl}`);
      this.emit('tunnel:ready', { url: this.tunnelUrl });
    } else {
      console.log('⚠️  No tunnel URL available from server provider');
      this.emit('tunnel:error', { message: 'No tunnel URL available' });
    }
  }

  /**
   * Setup auto-shutdown monitoring
   * @returns {void}
   */
  setupAutoShutdown() {
    // Implementation will be added in Phase 4
    this.emit('auto-shutdown:enabled', {
      timeout: this.config.shutdownTimeout,
      onCompletion: this.config.shutdownOnCompletion
    });
  }

  /**
   * Wait for active downloads to complete
   * @param {number} timeout - Maximum wait time in milliseconds
   * @returns {Promise<void>}
   */
  async waitForActiveDownloads(timeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkDownloads = () => {
        if (this.activeDownloads.size === 0 || Date.now() - startTime > timeout) {
          resolve();
        } else {
          setTimeout(checkDownloads, 1000); // Check every second
        }
      };

      checkDownloads();
    });
  }

  /**
   * Cleanup server resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Stop real-time monitoring interval (if running)
    this.stopRealTimeMonitoring();

    // Clear credentials
    this.credentials.clear();

    // Clear active sessions
    this.activeSessions.clear();

    // Clear active downloads
    this.activeDownloads.clear();

    // Reset expected downloads
    this.expectedDownloads.clear();
    this.completedDownloads.clear();
  }

  /**
   * Generate S3-compatible response headers
   * @param {Object} fileInfo - File information from FileStreamingUtils
   * @param {Object} options - Additional options for header generation
   * @returns {Object} S3-compatible headers
   */
  generateS3Headers(fileInfo, options = {}) {
    const { isRangeRequest = false, ranges = null, bucket = null, key = null } = options;

    const headers = {
      // Basic file headers
      'Content-Type': this.detectContentType(fileInfo.filePath, fileInfo.fileName),
      'Content-Length': isRangeRequest && ranges
        ? (ranges.end - ranges.start + 1).toString()
        : fileInfo.size.toString(),

      // S3-compatible caching headers
      'ETag': this.generateS3ETag(fileInfo),
      'Last-Modified': this.formatRFC7231Date(fileInfo.mtime || new Date()),

      // S3 standard headers
      'Accept-Ranges': 'bytes',
      'Server': 'ContainerRegistry/1.0 (S3-Compatible)',

      // S3-specific headers (x-amz-*)
      'x-amz-request-id': this.generateRequestId(),
      'x-amz-id-2': this.generateRequestId(), // Extended request ID
      'x-amz-server-side-encryption': 'none', // Not encrypted at rest
      'x-amz-storage-class': 'STANDARD',

      // Container registry specific headers
      'x-s3-server-name': this.config.serverName,
      'x-container-registry-version': '1.0',

      // CORS headers for browser compatibility
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type, x-amz-*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag, x-amz-*'
    };

    // Add bucket and key information if provided
    if (bucket) {
      headers['x-amz-bucket-region'] = 'us-east-1'; // Default region
      headers['x-container-bucket'] = bucket;
    }

    if (key) {
      headers['x-container-key'] = key;
    }

    // Add range headers for partial content
    if (isRangeRequest && ranges) {
      headers['Content-Range'] = this.fileUtils.formatContentRange(
        ranges.start,
        ranges.end,
        fileInfo.size
      );
      headers['x-amz-content-range'] = headers['Content-Range']; // S3-specific
    }

    // Add container-specific headers
    if (this.isContainerFile(fileInfo.filePath)) {
      const fileType = this.getContainerFileType(fileInfo.filePath);
      headers['x-container-file-type'] = fileType;
      headers['x-amz-meta-container-type'] = fileType; // S3 metadata format

      // Add special headers for different container file types
      switch (fileType) {
        case 'manifest':
          headers['x-amz-meta-docker-content-digest'] = this.calculateSHA256Placeholder(fileInfo);
          headers['Content-Type'] = 'application/vnd.docker.distribution.manifest.v2+json';
          break;
        case 'config':
          headers['Content-Type'] = 'application/vnd.docker.container.image.v1+json';
          break;
        case 'layer':
          headers['Content-Type'] = 'application/vnd.docker.image.rootfs.diff.tar.gzip';
          headers['x-amz-meta-docker-layer'] = 'true';
          break;
        case 'blob':
          headers['Content-Type'] = 'application/octet-stream';
          headers['x-amz-meta-docker-blob'] = 'true';
          break;
      }
    }

    return headers;
  }

  /**
   * Send S3-compatible error response
   * @param {Object} res - HTTP response object
   * @param {string} code - S3 error code
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   */
  sendS3Error(res, code, message, statusCode = 400) {
    const errorResponse = {
      Error: {
        Code: code,
        Message: message,
        RequestId: this.generateRequestId(),
        Resource: res.req ? res.req.url : 'unknown'
      }
    };

    res.writeHead(statusCode, {
      'Content-Type': 'application/xml',
      'Server': 'ContainerRegistry/1.0'
    });

    // Send XML-formatted error (S3 compatible)
    const xmlError = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${code}</Code>
  <Message>${message}</Message>
  <RequestId>${errorResponse.Error.RequestId}</RequestId>
  <Resource>${errorResponse.Error.Resource}</Resource>
</Error>`;

    res.end(xmlError);
  }

  /**
   * Calculate download speed for progress tracking
   * @param {Object} downloadInfo - Download information
   * @returns {number} Download speed in bytes per second
   */
  calculateDownloadSpeed(downloadInfo) {
    if (!downloadInfo.bytesTransferred || !downloadInfo.startTime) {
      return 0;
    }

    const currentTime = downloadInfo.endTime || Date.now();
    const durationSeconds = (currentTime - downloadInfo.startTime) / 1000;

    if (durationSeconds <= 0) {
      return 0;
    }

    return Math.round(downloadInfo.bytesTransferred / durationSeconds);
  }

  /**
   * Check if file is a container-related file
   * @param {string} filePath - File path to check
   * @returns {boolean} True if container file
   */
  isContainerFile(filePath) {
    const containerExtensions = ['.json', '.tar', '.tar.gz', '.tgz', '.layer'];
    const containerNames = ['manifest', 'config', 'layer', 'blob'];

    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath, ext).toLowerCase();

    return containerExtensions.includes(ext) ||
      containerNames.some(name => basename.includes(name));
  }

  /**
   * Get container file type for headers
   * @param {string} filePath - File path
   * @returns {string} Container file type
   */
  getContainerFileType(filePath) {
    const basename = path.basename(filePath).toLowerCase();

    if (basename.includes('manifest')) return 'manifest';
    if (basename.includes('config')) return 'config';
    if (basename.includes('layer') || basename.includes('.tar')) return 'layer';
    if (basename.includes('blob')) return 'blob';

    return 'unknown';
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Setup event handling for provider communication
   * @returns {void}
   */
  setupEventHandling() {
    // Forward HTTP server events
    this.httpProvider.on('server:request', (data) => {
      this.emit('request', data);
    });

    this.httpProvider.on('server:error', (error) => {
      this.emit('error', error);
    });

    // Forward file streaming events
    this.fileUtils.on('progress', (data) => {
      this.emit('download:progress', data);
    });

    this.fileUtils.on('complete', (data) => {
      this.emit('download:complete', data);
    });

    this.fileUtils.on('error', (error) => {
      this.emit('download:error', error);
    });
  }

  // ============================================================================
  // S3 ENDPOINT HANDLERS (Stub implementations for Phase 3.2 and 3.3)
  // ============================================================================

  /**
   * Handle S3 GET object requests
   * @param {Object} req - HTTP request
   * @param {Object} res - HTTP response  
   * @returns {Promise<void>}
   */
  async handleGetObject(req, res) {
    const downloadId = this.generateRequestId();
    const startTime = Date.now();

    try {
      // Extract bucket and key from request parameters
      let bucket, key;
      try {
        bucket = req.params.bucket;
        key = req.params['*']; // Wildcard parameter for the key
      } catch (paramError) {
        console.error('🔍 Parameter extraction error:', paramError);
        return this.sendS3Error(res, 'InvalidRequest', 'Failed to extract parameters', 400);
      }

      if (!bucket || !key) {
        return this.sendS3Error(res, 'InvalidRequest', 'Missing bucket or key parameter', 400);
      }

      // Validate permissions for read access
      if (!this.validatePermissions(req.user, 'read', bucket)) {
        return this.sendS3Error(res, 'AccessDenied', 'Insufficient permissions for read access', 403);
      }

      // Map bucket/key to file path
      const pathMapping = this.mapBucketKeyToPath(bucket, key);
      if (!pathMapping.success) {
        return this.sendS3Error(res, 'InvalidRequest', pathMapping.error, 400);
      }

      // Check if file exists and get file info
      let fileStats;
      try {
        fileStats = await fs.stat(pathMapping.filePath);
        if (!fileStats.isFile()) {
          return this.sendS3Error(res, 'NoSuchKey', 'The specified key does not exist', 404);
        }
      } catch (error) {
        return this.sendS3Error(res, 'NoSuchKey', 'The specified key does not exist', 404);
      }

      // Get detailed file information using file streaming utils
      const fileInfo = await this.fileUtils.getFileInfo(pathMapping.filePath);

      // Parse range header if present
      const rangeHeader = req.headers.range;
      let ranges = null;
      let isRangeRequest = false;

      if (rangeHeader) {
        try {
          ranges = this.fileUtils.parseRangeHeader(rangeHeader, fileInfo.size);
          isRangeRequest = ranges && ranges.length > 0;
        } catch (error) {
          return this.sendS3Error(res, 'InvalidRange', 'Range header is invalid', 416);
        }
      }

      // Generate S3-compatible headers
      const headers = this.generateS3Headers(fileInfo, {
        isRangeRequest,
        ranges: ranges ? ranges[0] : null, // Support single range for now
        bucket,
        key
      });

      // Track download
      const downloadInfo = {
        downloadId,
        bucket,
        key,
        filePath: pathMapping.filePath,
        fileSize: fileInfo.size,
        startTime,
        isRangeRequest,
        ranges,
        userAgent: req.headers['user-agent'] || 'unknown',
        clientIP: req.ip || req.connection.remoteAddress
      };

      this.activeDownloads.set(downloadId, downloadInfo);
      this.downloadStats.totalDownloads++;

      // Add download to expected downloads if this is a container file
      this.expectedDownloads.add(pathMapping.relativePath);

      // Phase 4: Start download monitoring
      if (this.downloadMonitor) {
        this.downloadMonitor.startDownload(downloadId, {
          path: pathMapping.relativePath,
          bucket,
          key,
          size: fileInfo.size,
          type: this.getFileType(key),
          startTime: startTime
        });
      }

      this.emit('download:started', {
        downloadId,
        bucket,
        key,
        fileSize: fileInfo.size,
        isRangeRequest
      });

      // Create file stream with range support
      const streamOptions = isRangeRequest && ranges ? {
        range: rangeHeader // Pass the raw range header
      } : {};

      const streamResult = await this.fileStreamer.createReadStream(pathMapping.filePath, streamOptions);
      const fileStream = streamResult.stream;

      // Set response status and headers
      const statusCode = isRangeRequest ? 206 : 200;
      res.writeHead(statusCode, headers);

      // Setup progress tracking
      let bytesTransferred = 0;
      const totalBytes = isRangeRequest ? (ranges[0].end - ranges[0].start + 1) : fileInfo.size;

      fileStream.on('data', (chunk) => {
        bytesTransferred += chunk.length;
        downloadInfo.bytesTransferred = bytesTransferred;
        downloadInfo.progress = Math.round((bytesTransferred / totalBytes) * 100);

        // Phase 4: Update download progress
        if (this.downloadMonitor) {
          this.downloadMonitor.updateDownloadProgress(downloadId, {
            bytesTransferred,
            expectedSize: totalBytes
          });
        }

        // Emit progress events
        if (bytesTransferred % this.fileUtils.options.progressInterval === 0 ||
          bytesTransferred === totalBytes) {
          this.emit('download:progress', {
            downloadId,
            bucket,
            key,
            bytesTransferred,
            totalBytes,
            progress: downloadInfo.progress,
            speed: this.calculateDownloadSpeed(downloadInfo)
          });
        }
      });

      fileStream.on('end', () => {
        downloadInfo.endTime = Date.now();
        downloadInfo.completed = true;
        downloadInfo.duration = downloadInfo.endTime - downloadInfo.startTime;

        this.downloadStats.completedDownloads++;
        this.downloadStats.totalBytes += bytesTransferred;
        this.activeDownloads.delete(downloadId);

        // Mark as completed in expected downloads
        this.completedDownloads.add(pathMapping.relativePath);

        // Phase 4: Complete download monitoring
        if (this.downloadMonitor) {
          this.downloadMonitor.completeDownload(downloadId, {
            finalSize: bytesTransferred,
            duration: downloadInfo.duration,
            success: true
          });
        }

        this.emit('download:complete', {
          downloadId,
          bucket,
          key,
          bytesTransferred,
          duration: downloadInfo.duration,
          speed: this.calculateDownloadSpeed(downloadInfo)
        });

        // Check if all expected downloads are complete
        this.checkAutoShutdown();
      });

      fileStream.on('error', (error) => {
        downloadInfo.error = error.message;
        downloadInfo.failed = true;

        this.downloadStats.failedDownloads++;
        this.activeDownloads.delete(downloadId);

        // Phase 4: Fail download monitoring
        if (this.downloadMonitor) {
          this.downloadMonitor.failDownload(downloadId, {
            error: error.message,
            retryable: true
          });
        }

        this.emit('download:error', {
          downloadId,
          bucket,
          key,
          error: error.message
        });

        if (!res.headersSent) {
          this.sendS3Error(res, 'InternalError', 'An error occurred while reading the file', 500);
        }
      });

      // Handle client disconnect
      req.on('close', () => {
        if (!downloadInfo.completed && !downloadInfo.failed) {
          downloadInfo.cancelled = true;
          this.activeDownloads.delete(downloadId);

          this.emit('download:cancelled', {
            downloadId,
            bucket,
            key,
            bytesTransferred
          });
        }
      });

      // Pipe file stream to response
      fileStream.pipe(res);

    } catch (error) {
      // Clean up tracking if error occurs
      this.activeDownloads.delete(downloadId);
      this.downloadStats.failedDownloads++;

      console.error('🔍 handleGetObject error:', error.message);
      console.error('🔍 Error stack:', error.stack);

      // Use safely extracted bucket/key for event emission
      const safeBucket = typeof bucket !== 'undefined' ? bucket : 'unknown';
      const safeKey = typeof key !== 'undefined' ? key : 'unknown';

      this.emit('download:error', {
        downloadId,
        bucket: safeBucket,
        key: safeKey,
        error: error.message
      });

      return this.sendS3Error(res, 'InternalError', 'An internal error occurred', 500);
    }
  }

  /**
   * Handle S3 HEAD object requests
   * @param {Object} req - HTTP request
   * @param {Object} res - HTTP response
   * @returns {Promise<void>}
   */
  async handleHeadObject(req, res) {
    try {
      // Extract bucket and key from request parameters  
      let bucket, key;
      try {
        bucket = req.params.bucket;
        key = req.params['*']; // Wildcard parameter for the key
      } catch (paramError) {
        console.error('🔍 HEAD Parameter extraction error:', paramError);
        return this.sendS3Error(res, 'InvalidRequest', 'Failed to extract parameters', 400);
      }

      if (!bucket || !key) {
        return this.sendS3Error(res, 'InvalidRequest', 'Missing bucket or key parameter', 400);
      }

      // Validate permissions for read access
      if (!this.validatePermissions(req.user, 'read', bucket)) {
        return this.sendS3Error(res, 'AccessDenied', 'Insufficient permissions for read access', 403);
      }

      // Map bucket/key to file path
      const pathMapping = this.mapBucketKeyToPath(bucket, key);
      if (!pathMapping.success) {
        return this.sendS3Error(res, 'InvalidRequest', pathMapping.error, 400);
      }

      // Check if file exists and get file stats (efficient stat-only check)
      let fileStats;
      try {
        fileStats = await fs.stat(pathMapping.filePath);
        if (!fileStats.isFile()) {
          return this.sendS3Error(res, 'NoSuchKey', 'The specified key does not exist', 404);
        }
      } catch (error) {
        return this.sendS3Error(res, 'NoSuchKey', 'The specified key does not exist', 404);
      }

      // Get lightweight file information (HEAD should be fast)
      const fileInfo = {
        filePath: pathMapping.filePath,
        size: fileStats.size,
        mtime: fileStats.mtime,
        etag: `"${fileStats.size.toString(16)}-${fileStats.mtime.getTime().toString(16)}"`,
        lastModified: fileStats.mtime.toUTCString()
      };

      // Generate S3-compatible headers (no range support for HEAD)
      const headers = this.generateS3Headers(fileInfo, {
        isRangeRequest: false,
        ranges: null,
        bucket,
        key
      });

      // Set response headers and send 200 OK with no body
      res.writeHead(200, headers);
      res.end();

      // Log HEAD request for analytics
      this.emit('head:request', {
        bucket,
        key,
        filePath: pathMapping.filePath,
        fileSize: fileInfo.size,
        userAgent: req.headers['user-agent'] || 'unknown',
        clientIP: req.ip || req.connection.remoteAddress,
        timestamp: new Date()
      });

    } catch (error) {
      this.emit('head:error', {
        bucket: req.params.bucket,
        key: req.params['*'],
        error: error.message
      });

      return this.sendS3Error(res, 'InternalError', 'An internal error occurred', 500);
    }
  }

  /**
   * Handle health check requests
   * @param {Object} req - HTTP request
   * @param {Object} res - HTTP response
   * @returns {Promise<void>}
   */
  async handleHealthCheck(req, res) {
    const status = this.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'container-registry',
      version: '1.0.0',
      uptime: status.uptime,
      activeDownloads: status.activeDownloads,
      totalDownloads: status.totalDownloads
    }));
  }

  /**
   * Handle authentication middleware
   * @param {Object} req - HTTP request
   * @param {Object} res - HTTP response
   * @param {Function} next - Next middleware function
   * @returns {Promise<void>}
   */
  async handleAuthentication(req, res, next) {
    try {
      // Validate authentication
      const authResult = await this.validateAuthentication(req);

      if (!authResult.success) {
        // Log authentication failure
        console.log(`🔒 Authentication failed: ${req.method} ${req.url} - ${authResult.error}`);

        // Send appropriate error response
        res.writeHead(authResult.code || 401, {
          'WWW-Authenticate': 'AWS4-HMAC-SHA256',
          'Content-Type': 'application/json'
        });

        const errorResponse = {
          error: authResult.error,
          code: 'AuthenticationRequired',
          message: 'Valid authentication credentials are required',
          timestamp: new Date().toISOString()
        };

        return res.end(JSON.stringify(errorResponse, null, 2));
      }

      // Store user info in request for later use
      req.user = authResult.user;

      // Log successful authentication
      if (!authResult.user.anonymous) {
        debugAuth(`🔑 Authenticated: ${authResult.user.accessKey} - ${req.method} ${req.url}`);
      }

      // Continue to next middleware
      next();

    } catch (error) {
      console.error('🔒 Authentication middleware error:', error);

      res.writeHead(500, {
        'Content-Type': 'application/json'
      });

      const errorResponse = {
        error: 'Internal authentication error',
        code: 'InternalError',
        message: 'Authentication system error',
        timestamp: new Date().toISOString()
      };

      res.end(JSON.stringify(errorResponse, null, 2));
    }
  }

  /**
   * Check if auto-shutdown conditions are met
   * @returns {void}
   */
  checkAutoShutdown() {
    // Implementation for auto-shutdown logic
    // This can be enhanced in later phases
    if (this.config.autoShutdown && this.activeDownloads.size === 0) {
      // Could implement auto-shutdown logic here
      console.log('🔄 Auto-shutdown check: no active downloads');
    }
  }

  // ============================================================================
  // S3-COMPATIBLE HEADER UTILITIES (Phase 3.4)
  // ============================================================================

  /**
   * Generate S3-compatible ETag for files
   * @param {Object} fileInfo - File information object
   * @returns {string} S3-compatible ETag
   */
  generateS3ETag(fileInfo) {
    if (fileInfo.etag) {
      // Remove quotes if present and re-add them for S3 compatibility
      return `"${fileInfo.etag.replace(/"/g, '')}"`;
    }

    // Generate ETag from file size and modification time (S3-style)
    const size = fileInfo.size || 0;
    const mtime = fileInfo.mtime ? fileInfo.mtime.getTime() : Date.now();
    const etag = `"${size.toString(16)}-${mtime.toString(16)}"`;

    return etag;
  }

  /**
   * Format date in RFC 7231 format (required by HTTP/S3)
   * @param {Date} date - Date to format
   * @returns {string} RFC 7231 formatted date string
   */
  formatRFC7231Date(date) {
    if (!date) date = new Date();

    // RFC 7231 format: "Wed, 21 Oct 2015 07:28:00 GMT"
    return date.toUTCString();
  }

  /**
   * Enhanced content type detection with support for container and general file formats
   * @param {string} filePath - Path to the file
   * @param {string} fileName - Name of the file
   * @returns {string} MIME type
   */
  detectContentType(filePath, fileName) {
    const name = fileName || path.basename(filePath);
    const ext = path.extname(name).toLowerCase();

    // Use FileStreamingUtils for comprehensive MIME type detection first
    const basicMimeType = this.fileUtils.getMimeType(filePath);

    // Container-specific MIME types (Docker registry compatibility)
    if (name === 'manifest.json' || name.includes('manifest')) {
      return 'application/vnd.docker.distribution.manifest.v2+json';
    }

    if (name === 'config.json' || name.includes('config')) {
      return 'application/vnd.docker.container.image.v1+json';
    }

    // Check for container layer files (tar/gzip archives)
    if ((ext === '.tar' || ext === '.tar.gz' || ext === '.tgz') && name.includes('layer')) {
      return 'application/vnd.docker.image.rootfs.diff.tar.gzip';
    }

    if (name.includes('blob')) {
      return 'application/octet-stream';
    }

    // Return detected MIME type if it's not the generic fallback
    if (basicMimeType && basicMimeType !== 'application/octet-stream') {
      return basicMimeType;
    }

    // Additional specific extensions for better detection
    const extensionTypes = {
      '.json': 'application/json',
      '.yaml': 'application/x-yaml',
      '.yml': 'application/x-yaml',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
      '.log': 'text/plain',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.zip': 'application/zip',
      '.7z': 'application/x-7z-compressed',
      '.bz2': 'application/x-bzip2',
      '.xz': 'application/x-xz'
    };

    if (extensionTypes[ext]) {
      return extensionTypes[ext];
    }

    // Default to octet-stream for unknown binary data
    return 'application/octet-stream';
  }

  /**
   * Calculate SHA256 placeholder for container files
   * @param {Object} fileInfo - File information
   * @returns {string} SHA256 placeholder
   */
  calculateSHA256Placeholder(fileInfo) {
    // For now, generate a placeholder based on file size and mtime
    // In a real implementation, this would calculate actual SHA256
    const size = fileInfo.size || 0;
    const mtime = fileInfo.mtime ? fileInfo.mtime.getTime() : Date.now();

    const hash = crypto.createHash('sha256');
    hash.update(`${size}-${mtime}-${fileInfo.filePath || ''}`);

    return `sha256:${hash.digest('hex')}`;
  }

  // ============================================================================
  // PHASE 3.7: DOWNLOAD PROGRESS & ANALYTICS
  // ============================================================================

  /**
   * Get current download statistics
   * @returns {Object} Download statistics
   */
  getDownloadStats() {
    return {
      ...this.downloadStats,
      activeDownloads: this.activeDownloads.size,
      expectedDownloads: this.expectedDownloads.size,
      completedDownloads: this.completedDownloads.size,
      averageSpeed: this.calculateAverageSpeed(),
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Get list of active downloads with progress
   * @returns {Array} Array of active download information
   */
  getActiveDownloads() {
    const activeDownloads = [];

    for (const [downloadId, downloadInfo] of this.activeDownloads.entries()) {
      const currentProgress = {
        downloadId,
        bucket: downloadInfo.bucket,
        key: downloadInfo.key,
        fileSize: downloadInfo.fileSize,
        bytesTransferred: downloadInfo.bytesTransferred || 0,
        progress: downloadInfo.progress || 0,
        startTime: downloadInfo.startTime,
        duration: Date.now() - downloadInfo.startTime,
        speed: this.calculateDownloadSpeed(downloadInfo),
        userAgent: downloadInfo.userAgent,
        clientIP: downloadInfo.clientIP,
        isRangeRequest: downloadInfo.isRangeRequest
      };

      activeDownloads.push(currentProgress);
    }

    return activeDownloads.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Get download history (completed downloads)
   * @param {Object} options - Query options
   * @returns {Array} Array of completed download records
   */
  getDownloadHistory(options = {}) {
    const { limit = 50, offset = 0, bucket = null, since = null } = options;

    // For now, return a basic structure
    // In a full implementation, this would read from persistent storage
    const history = [];

    // Add completed downloads info if available
    for (const completedFile of this.completedDownloads) {
      history.push({
        filePath: completedFile,
        completedAt: new Date().toISOString(),
        bucket: 'unknown', // Would track this in full implementation
        key: completedFile
      });
    }

    return history.slice(offset, offset + limit);
  }

  /**
   * Generate comprehensive analytics report
   * @param {Object} options - Analytics options
   * @returns {Object} Analytics report
   */
  generateDownloadAnalytics(options = {}) {
    const { timeframe = '24h', includeDetails = false } = options;

    const stats = this.getDownloadStats();
    const activeDownloads = this.getActiveDownloads();

    const analytics = {
      timeframe,
      generatedAt: new Date().toISOString(),
      summary: {
        totalDownloads: stats.totalDownloads,
        completedDownloads: stats.completedDownloads,
        failedDownloads: stats.failedDownloads,
        activeDownloads: stats.activeDownloads,
        totalBytesTransferred: stats.totalBytes,
        averageSpeed: stats.averageSpeed,
        successRate: stats.totalDownloads > 0 ?
          ((stats.completedDownloads / stats.totalDownloads) * 100).toFixed(2) + '%' : '0%',
        uptime: stats.uptime
      },
      performance: {
        averageDownloadSize: stats.completedDownloads > 0 ?
          Math.round(stats.totalBytes / stats.completedDownloads) : 0,
        totalThroughput: this.formatBytes(stats.totalBytes),
        averageThroughput: this.formatBytes(stats.averageSpeed) + '/s'
      },
      status: {
        serverRunning: this.isRunning,
        expectedFiles: Array.from(this.expectedDownloads),
        completedFiles: Array.from(this.completedDownloads),
        completionProgress: this.expectedDownloads.size > 0 ?
          ((this.completedDownloads.size / this.expectedDownloads.size) * 100).toFixed(2) + '%' : '0%'
      }
    };

    if (includeDetails) {
      analytics.activeDownloads = activeDownloads;
      analytics.recentHistory = this.getDownloadHistory({ limit: 20 });
    }

    return analytics;
  }

  /**
   * Get real-time dashboard data
   * @returns {Object} Dashboard data
   */
  getDownloadDashboard() {
    const stats = this.getDownloadStats();
    const activeDownloads = this.getActiveDownloads();

    return {
      timestamp: new Date().toISOString(),
      server: {
        status: this.isRunning ? 'running' : 'stopped',
        uptime: stats.uptime,
        port: this.config.port,
        url: this.serverUrl || 'http://localhost:' + this.config.port
      },
      downloads: {
        active: stats.activeDownloads,
        total: stats.totalDownloads,
        completed: stats.completedDownloads,
        failed: stats.failedDownloads,
        successRate: stats.totalDownloads > 0 ?
          Math.round((stats.completedDownloads / stats.totalDownloads) * 100) : 0
      },
      progress: {
        expected: this.expectedDownloads.size,
        completed: this.completedDownloads.size,
        remaining: this.expectedDownloads.size - this.completedDownloads.size,
        percentage: this.expectedDownloads.size > 0 ?
          Math.round((this.completedDownloads.size / this.expectedDownloads.size) * 100) : 0
      },
      performance: {
        totalBytes: stats.totalBytes,
        totalBytesFormatted: this.formatBytes(stats.totalBytes),
        averageSpeed: stats.averageSpeed,
        averageSpeedFormatted: this.formatBytes(stats.averageSpeed) + '/s',
        currentThroughput: this.calculateCurrentThroughput()
      },
      activeDownloads: activeDownloads.map(dl => ({
        id: dl.downloadId,
        file: `${dl.bucket}/${dl.key}`,
        progress: dl.progress,
        speed: this.formatBytes(dl.speed) + '/s',
        size: this.formatBytes(dl.fileSize),
        transferred: this.formatBytes(dl.bytesTransferred),
        eta: this.calculateETA(dl)
      }))
    };
  }

  /**
   * Calculate average download speed across all completed downloads
   * @returns {number} Average speed in bytes per second
   */
  calculateAverageSpeed() {
    if (this.downloadStats.completedDownloads === 0 || !this.startTime) {
      return 0;
    }

    const totalTime = Date.now() - this.startTime;
    const totalTimeSeconds = totalTime / 1000;

    if (totalTimeSeconds <= 0) {
      return 0;
    }

    return Math.round(this.downloadStats.totalBytes / totalTimeSeconds);
  }

  /**
   * Calculate current throughput from active downloads
   * @returns {number} Current throughput in bytes per second
   */
  calculateCurrentThroughput() {
    if (this.activeDownloads.size === 0) {
      return 0;
    }

    let totalSpeed = 0;
    for (const downloadInfo of this.activeDownloads.values()) {
      totalSpeed += this.calculateDownloadSpeed(downloadInfo);
    }

    return totalSpeed;
  }

  /**
   * Calculate estimated time of arrival for a download
   * @param {Object} downloadInfo - Download information
   * @returns {string} ETA formatted string
   */
  calculateETA(downloadInfo) {
    const speed = this.calculateDownloadSpeed(downloadInfo);
    if (speed <= 0 || !downloadInfo.fileSize || !downloadInfo.bytesTransferred) {
      return 'unknown';
    }

    const remainingBytes = downloadInfo.fileSize - downloadInfo.bytesTransferred;
    const etaSeconds = Math.round(remainingBytes / speed);

    if (etaSeconds < 60) {
      return `${etaSeconds}s`;
    } else if (etaSeconds < 3600) {
      return `${Math.round(etaSeconds / 60)}m`;
    } else {
      return `${Math.round(etaSeconds / 3600)}h`;
    }
  }

  /**
   * Format bytes to human readable format
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Create a visual progress bar
   * @param {number} percentage - Progress percentage (0-100)
   * @param {number} width - Width of the progress bar
   * @returns {string} Progress bar string
   */
  createProgressBar(percentage, width = 30) {
    const filled = Math.floor((percentage / 100) * width);
    const empty = width - filled;
    const bar = '='.repeat(filled) + ' '.repeat(empty);
    const percent = `${Math.round(percentage)}%`;
    return `${bar} ${percent}`;
  }

  /**
   * Start real-time monitoring (console-based dashboard)
   * @param {Object} options - Monitoring options
   */
  startRealTimeMonitoring(options = {}) {
    const { interval = 5000, enableConsole = true } = options;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      const dashboard = this.getDownloadDashboard();

      this.emit('dashboard:update', dashboard);

      if (enableConsole) {
        this.displayConsoleDashboard(dashboard);
      }
    }, interval);

    this.emit('monitoring:started', { interval, enableConsole });
  }

  /**
   * Stop real-time monitoring
   */
  stopRealTimeMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.emit('monitoring:stopped');
    }
  }

  /**
   * Display console dashboard
   * @param {Object} dashboard - Dashboard data
   */
  displayConsoleDashboard(dashboard) {
    // If this is the first dashboard display, mark the position
    if (!this.dashboardStarted) {
      this.dashboardStarted = true;
      debugDashboard(''); // Add a line before the dashboard
      debugDashboard(chalk.gray('📊 Dashboard (updates in place below):'));
      debugDashboard('─'.repeat(80));
      this.dashboardLineCount = 0;
    }

    // Move cursor up to overwrite previous dashboard content
    if (this.dashboardLineCount > 0) {
      process.stdout.write(`\u001b[${this.dashboardLineCount}A`); // Move cursor up
      process.stdout.write('\u001b[0J'); // Clear from cursor to end of screen
    }

    // Build the dashboard content
    const dashboardLines = [];

    // Create a nice bordered table-like display
    const tableWidth = 99;
    const border = '+-' + '-'.repeat(tableWidth - 4) + '-+';
    const emptyLine = '| ' + ' '.repeat(tableWidth - 4) + ' |';

    dashboardLines.push(border);
    dashboardLines.push(`| ${chalk.cyan.bold('S3 Object Storage Server').padEnd(tableWidth - 4)} |`);
    dashboardLines.push(border);
    dashboardLines.push(`|Status: ${dashboard.server.status.padEnd(40)}Uptime: ${Math.round(dashboard.server.uptime / 1000) + 's'.padEnd(tableWidth - 54)}|`);
    dashboardLines.push(`|Port: ${(dashboard.server.port || 'N/A').toString().padEnd(42)}${' '.repeat(tableWidth - 54)}|`);
    dashboardLines.push(border);

    // Downloads Progress section
    const progressBar = this.createProgressBar(dashboard.progress.percentage, 30);
    dashboardLines.push(`|Downloads Progress${' '.repeat(tableWidth - 22)}|`);
    dashboardLines.push(`|${progressBar.padEnd(tableWidth - 4)}|`);
    dashboardLines.push(`|Active Downloads: ${dashboard.downloads.active.toString().padEnd(14)}Completed: ${dashboard.downloads.completed.toString().padEnd(7)}Failed: ${dashboard.downloads.failed.toString().padEnd(tableWidth - 47)}|`);
    dashboardLines.push(`|Speed: ${dashboard.performance.averageSpeedFormatted.padEnd(22)}Total: ${dashboard.performance.totalBytesFormatted.padEnd(tableWidth - 35)}|`);
    dashboardLines.push(border);

    // Active Downloads section
    dashboardLines.push(`|Active Downloads${' '.repeat(tableWidth - 19)}|`);
    if (dashboard.activeDownloads.length === 0) {
      dashboardLines.push(`|${chalk.gray('No active downloads').padEnd(tableWidth - 4)}|`);
    } else {
      dashboard.activeDownloads.slice(0, 5).forEach(dl => { // Show max 5 active downloads
        const fileName = dl.file.length > 30 ? dl.file.substring(0, 27) + '...' : dl.file;
        const progressInfo = `${dl.progress}% (${dl.speed})`;
        const line = `|${fileName.padEnd(35)}${progressInfo.padEnd(tableWidth - 39)}|`;
        dashboardLines.push(line);
      });
    }
    dashboardLines.push(border);

    // Auto-shutdown section
    const shutdownStatus = this.shutdownManager?.isEnabled() ? 'ON' : 'OFF';
    const shutdownTrigger = this.shutdownManager?.getTriggerDescription() || 'Completion + 30s';
    const nextCheck = this.shutdownManager?.getNextCheckTime() || '00:00:05';
    const shutdownState = this.shutdownManager?.getState() || 'Monitoring';

    dashboardLines.push(`|Auto-Shutdown: ${shutdownStatus.padEnd(25)}Trigger: ${shutdownTrigger.padEnd(tableWidth - 44)}|`);
    dashboardLines.push(`|Next Check: ${nextCheck.padEnd(27)}Status: ${shutdownState.padEnd(tableWidth - 46)}|`);
    dashboardLines.push(border);

    // Write all dashboard lines
    dashboardLines.forEach(line => {
      console.log(line);
    });

    // Keep track of how many lines we printed for next update
    this.dashboardLineCount = dashboardLines.length;
  }

  // ============================================================================
  // PHASE 4: AUTO-SHUTDOWN & MONITORING INTEGRATION
  // ============================================================================

  /**
   * Setup Phase 4 component integration
   */
  setupPhase4Integration() {
    // Set up dependencies between components
    this.shutdownManager.setDependencies({
      downloadMonitor: this.downloadMonitor,
      s3Server: this,
      httpProvider: this.httpProvider
    });

    this.monitoringDashboard.setDependencies({
      downloadMonitor: this.downloadMonitor,
      shutdownManager: this.shutdownManager,
      s3Server: this
    });

    // Setup event notifier with all sources
    this.eventNotifier.setupStandardSources({
      downloadMonitor: this.downloadMonitor,
      shutdownManager: this.shutdownManager,
      s3Server: this,
      monitoringDashboard: this.monitoringDashboard
    });

    // Register shutdown cleanup handlers
    this.shutdownManager.registerCleanupHandler(async () => {
      await this.cleanupActiveDownloads();
    }, 'active downloads cleanup');

    this.shutdownManager.registerCleanupHandler(async () => {
      if (this.tunnelUrl && this.serverId) {
        try {
          const serverExists = this.httpProvider.getServerStatus(this.serverId);
          if (serverExists) {
            await this.httpProvider.stopTunnel(this.serverId);
          }
        } catch (error) {
          // Server already cleaned up, ignore
        }
      }
    }, 'tunnel cleanup');

    this.shutdownManager.registerCleanupHandler(async () => {
      if (this.serverId) {
        try {
          const serverExists = this.httpProvider.getServerStatus(this.serverId);
          if (serverExists) {
            await this.httpProvider.stopServer(this.serverId);
          }
        } catch (error) {
          // Server already cleaned up, ignore
        }
      }
    }, 'HTTP server cleanup');
  }

  /**
   * Set expected downloads for monitoring and auto-shutdown
   * @param {Array} expectedDownloads - Array of expected download objects
   * @returns {Object} Setup result
   */
  setExpectedDownloads(expectedDownloads) {
    if (!this.downloadMonitor) {
      return { success: false, error: 'Download monitor not initialized' };
    }

    const result = this.downloadMonitor.setExpectedDownloads(expectedDownloads);

    if (result.success) {
      this.emit('expectedDownloadsSet', {
        count: result.expectedCount,
        totalBytes: result.totalBytes
      });
    }

    return result;
  }

  /**
   * Start Phase 4 monitoring systems
   * @param {Object} options - Monitoring options
   * @returns {Object} Start result
   */
  startPhase4Monitoring(options = {}) {
    const results = {
      downloadMonitor: { success: false },
      shutdownManager: { success: false },
      eventNotifier: { success: false },
      monitoringDashboard: { success: false }
    };

    try {
      // Start download monitor
      if (this.config.enableDownloadTracking && this.downloadMonitor) {
        results.downloadMonitor = this.downloadMonitor.startMonitoring() || { success: true };
      } else {
        results.downloadMonitor = { success: true, skipped: true };
      }

      // Start shutdown manager
      if (this.config.enableAutoShutdown && this.shutdownManager) {
        results.shutdownManager = this.shutdownManager.startMonitoring() || { success: true };
      } else {
        results.shutdownManager = { success: true, skipped: true };
      }

      // Start event notifications
      if (this.config.enableEventNotifications && this.eventNotifier) {
        results.eventNotifier = this.eventNotifier.start() || { success: true };
      } else {
        results.eventNotifier = { success: true, skipped: true };
      }

      // Start real-time dashboard (with optional delay)
      if ((this.config.enableRealTimeMonitoring || options.enableDashboard) && this.monitoringDashboard) {
        const delay = options.monitoringStartDelay || this.config.monitoringStartDelay || 0;
        if (delay > 0) {
          // Delay dashboard start to allow user to see important URLs/commands
          console.log(`\n📊 Monitoring dashboard will start in ${delay / 1000} seconds...`);
          setTimeout(() => {
            this.monitoringDashboard.startRealTimeDisplay();
          }, delay);
          results.monitoringDashboard = { success: true, delayed: true, delay };
        } else {
          results.monitoringDashboard = this.monitoringDashboard.startRealTimeDisplay() || { success: true };
        }
      } else {
        results.monitoringDashboard = { success: true, skipped: true };
      }

      const allSuccessful = Object.values(results).every(result =>
        result && (result.success === true || result.success !== false)
      );

      this.emit('phase4MonitoringStarted', {
        results,
        allSuccessful,
        timestamp: new Date()
      });

      return {
        success: allSuccessful,
        results,
        message: allSuccessful ? 'All Phase 4 monitoring started successfully' : 'Some Phase 4 components failed to start'
      };

    } catch (error) {
      this.emit('error', { type: 'phase4MonitoringStart', error: error.message });
      return { success: false, error: error.message, results };
    }
  }

  /**
   * Stop Phase 4 monitoring systems
   * @returns {Object} Stop result
   */
  stopPhase4Monitoring() {
    const results = {
      downloadMonitor: { success: false },
      shutdownManager: { success: false },
      eventNotifier: { success: false },
      monitoringDashboard: { success: false }
    };

    try {
      // Stop download monitor
      if (this.downloadMonitor) {
        results.downloadMonitor = this.downloadMonitor.stopMonitoring() || { success: true };
      } else {
        results.downloadMonitor = { success: true, skipped: true };
      }

      // Stop shutdown manager
      if (this.shutdownManager) {
        results.shutdownManager = this.shutdownManager.stopMonitoring() || { success: true };
      } else {
        results.shutdownManager = { success: true, skipped: true };
      }

      // Stop event notifications
      if (this.eventNotifier) {
        results.eventNotifier = this.eventNotifier.stop() || { success: true };
      } else {
        results.eventNotifier = { success: true, skipped: true };
      }

      // Stop real-time dashboard
      if (this.monitoringDashboard && this.config.enableRealTimeMonitoring) {
        results.monitoringDashboard = this.monitoringDashboard.stopRealTimeDisplay() || { success: true };
      } else {
        results.monitoringDashboard = { success: true, skipped: true };
      }

      const allSuccessful = Object.values(results).every(result =>
        result && (result.success === true || result.success !== false)
      );

      this.emit('phase4MonitoringStopped', {
        results,
        allSuccessful,
        timestamp: new Date()
      });

      return {
        success: allSuccessful,
        results,
        message: allSuccessful ? 'All Phase 4 monitoring stopped successfully' : 'Some Phase 4 components failed to stop'
      };

    } catch (error) {
      this.emit('error', { type: 'phase4MonitoringStop', error: error.message });
      return { success: false, error: error.message, results };
    }
  }

  /**
   * Get comprehensive Phase 4 status
   * @returns {Object} Phase 4 status
   */
  getPhase4Status() {
    return {
      downloadMonitor: this.downloadMonitor ? this.downloadMonitor.getStatistics() : null,
      shutdownManager: this.shutdownManager ? this.shutdownManager.getStatus() : null,
      eventNotifier: this.eventNotifier ? this.eventNotifier.getStatistics() : null,
      monitoringDashboard: this.monitoringDashboard ? this.monitoringDashboard.getStatus() : null,
      config: {
        enableAutoShutdown: this.config.enableAutoShutdown,
        enableRealTimeMonitoring: this.config.enableRealTimeMonitoring,
        enableDownloadTracking: this.config.enableDownloadTracking,
        enableEventNotifications: this.config.enableEventNotifications
      }
    };
  }

  /**
   * Trigger manual shutdown
   * @param {string} reason - Shutdown reason
   * @param {Object} options - Shutdown options
   * @returns {Object} Shutdown result
   */
  triggerShutdown(reason = 'manual trigger', options = {}) {
    if (!this.shutdownManager) {
      return { success: false, error: 'Shutdown manager not initialized' };
    }

    return this.shutdownManager.triggerManualShutdown(reason, options);
  }

  /**
   * Cancel scheduled shutdown
   * @param {string} reason - Cancellation reason
   * @returns {Object} Cancel result
   */
  cancelShutdown(reason = 'manual cancellation') {
    if (!this.shutdownManager) {
      return { success: false, error: 'Shutdown manager not initialized' };
    }

    return this.shutdownManager.cancelShutdown(reason);
  }

  /**
   * Clean up active downloads gracefully
   * @returns {Promise<void>}
   */
  async cleanupActiveDownloads() {
    debugShutdown('   🧹 Cleaning up active downloads...');

    // Wait for active downloads to complete or timeout
    const maxWaitTime = 30000; // 30 seconds
    const checkInterval = 1000; // 1 second
    let waitTime = 0;

    while (this.activeDownloads.size > 0 && waitTime < maxWaitTime) {
      debugShutdown(`     ⏳ Waiting for ${this.activeDownloads.size} downloads... (${Math.round((maxWaitTime - waitTime) / 1000)}s remaining)`);
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waitTime += checkInterval;
    }

    if (this.activeDownloads.size > 0) {
      console.log(`     ⚠️  ${this.activeDownloads.size} downloads still active - proceeding with shutdown`);
    } else {
      console.log('     ✅ All downloads completed');
    }
  }

  /**
   * Get file type from key/path
   * @param {string} key - File key/path
   * @returns {string} File type
   */
  getFileType(key) {
    if (key.includes('manifest')) return 'manifest';
    if (key.includes('layer') || key.includes('sha256:')) return 'layer';
    if (key.includes('config')) return 'config';
    if (key.endsWith('.json')) return 'manifest';
    if (key.endsWith('.tar') || key.endsWith('.gz')) return 'layer';
    return 'file';
  }
}

export { S3HttpServer };
