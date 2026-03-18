import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import EventEmitter from 'events';
import createDebug from 'debug';

const debug = createDebug('kadi:tunnel:provider');
import { createServer } from 'http';
import { spawn, execSync } from 'child_process';
import { URL } from 'url';
import { TunnelService } from './tunnel/TunnelService.js';
import { TransientTunnelError, PermanentTunnelError, ConnectionTimeoutError, SSHUnavailableError } from './tunnel/errors.js';

class TunnelProvider extends EventEmitter {
  constructor(config) {
    super();
    this.config = config || {};

    // Initialize the new service architecture
    this.tunnelService = new TunnelService(this.config);
    this._servicesInitialized = false;

    // Configuration from ConfigManager.getTunnelConfig()
    this.primaryService = this.config.service || 'localtunnel';
    // Updated fallback order - LocalTunnel doesn't require SSH, pinggy/serveo need auth
    this.fallbackServices = this.parseFallbackServices(this.config.fallbackServices || 'pinggy,serveo');
    this.autoFallback = this.config.autoFallback !== false;
    this.subdomain = this.config.subdomain || '';
    this.region = this.config.region || 'us';
    this.localRoot = this.config.localRoot || process.cwd();

    // Rest of constructor stays the same...
    this.activeTunnels = new Map();
    this.activeUrls = new Map();
    this.localServer = null;
    this.serverPort = null;
    this.currentTunnelProcess = null;
    this.activeOperations = new Map();
    this.operationCount = 0;
    this.defaultExpiration = 60 * 60 * 1000; // 1 hour in ms
    this.allowedPaths = new Set();
    this.accessTokens = new Map();
    this.isServerRunning = false;
    this.currentTunnelUrl = null;

    // Updated service configurations
    this.serviceConfigs = {
      pinggy: {
        requiresAuth: false,
        requiresInstall: false,
        supportsBrowser: true,
        command: 'ssh',
        warningPage: false,
        freeLimit: '60 minutes timeout',
        notes: 'Best quality, 60min timeout on free plan'
      },
      serveo: {
        requiresAuth: false,
        requiresInstall: false,
        supportsBrowser: true,
        command: 'ssh',
        warningPage: false,
        freeLimit: 'Generous',
        notes: 'Reliable fallback, no time limits'
      },
      localtunnel: {
        requiresAuth: false,
        requiresInstall: true, // Requires npm install -g localtunnel
        supportsBrowser: true,
        command: 'lt',
        warningPage: false,
        freeLimit: 'Unlimited',
        notes: 'Requires npm install but very reliable'
      },
      'localhost.run': {
        requiresAuth: false,
        requiresInstall: false,
        supportsBrowser: true,
        command: 'ssh',
        warningPage: false,
        freeLimit: 'Email verification required',
        notes: 'Now requires email verification - less suitable'
      }
    };
  }

  /**
   * Initializes the tunnel service architecture if not already initialized
   * Sets up service discovery and event forwarding
   */
  async _initializeServices() {
    if (this._servicesInitialized) {
      return;
    }

    try {
      // Initialize TunnelService to discover and load services
      await this.tunnelService.initialize();
      
      // Set up event forwarding from services to TunnelProvider
      this._setupServiceEventForwarding();
      
      this._servicesInitialized = true;
    } catch (error) {
      console.warn('Warning: Failed to initialize tunnel services:', error.message);
      // Continue with fallback to legacy implementation for compatibility
    }
  }

  /**
   * Sets up event forwarding from tunnel services to TunnelProvider events
   * Maintains compatibility with existing event listeners
   */
  _setupServiceEventForwarding() {
    // When services are retrieved, set up their event forwarding
    const originalGetService = this.tunnelService.getService.bind(this.tunnelService);
    this.tunnelService.getService = (serviceName) => {
      const service = originalGetService(serviceName);
      
      // Only set up forwarding once per service instance
      if (!service._tunnelProviderEventsSetup) {
        // Forward tunnel lifecycle events
        service.on('tunnelCreated', (data) => {
          this.emit('tunnelProgress', {
            ...data,
            status: 'created',
            message: `Tunnel created successfully via ${serviceName}`
          });
        });
        
        service.on('tunnelDestroyed', (data) => {
          this.emit('tunnelProgress', {
            ...data,
            status: 'destroyed',
            message: `Tunnel destroyed via ${serviceName}`
          });
        });
        
        service.on('progress', (data) => {
          this.emit('tunnelProgress', {
            ...data,
            service: serviceName
          });
        });
        
        service.on('error', (data) => {
          this.emit('tunnelError', {
            ...data,
            service: serviceName
          });
        });
        
        service._tunnelProviderEventsSetup = true;
      }
      
      return service;
    };
  }

  // ============================================================================
  // CONNECTION AND VALIDATION (Required Pattern)
  // ============================================================================

  async testConnection() {
    try {
      // Test local root access
      const stats = await fs.stat(this.localRoot);
      if (!stats.isDirectory()) {
        throw new Error(`Local root '${this.localRoot}' is not a directory`);
      }

      // Test SSH availability
      await this.testSSHAvailability();

      // Test local server creation capability
      await this.testLocalServerCreation();

      return {
        provider: 'tunnel',
        service: this.primaryService,
        localRoot: this.localRoot,
        region: this.region,
        subdomain: this.subdomain,
        sshAvailable: true,
        activeTunnels: this.activeTunnels.size,
        activeUrls: this.activeUrls.size,
        serverRunning: this.isServerRunning,
        currentTunnelUrl: this.currentTunnelUrl,
        supportedServices: Object.keys(this.serviceConfigs),
        fallbackEnabled: this.autoFallback
      };
    } catch (error) {
      throw new Error(`Tunnel provider connection test failed: ${error.message}`);
    }
  }

  validateConfig() {
    const errors = [];
    const warnings = [];

    // Required configuration validation
    if (!this.localRoot) {
      errors.push('Local root directory is required for tunneling');
    }

    if (!this.primaryService) {
      errors.push('Primary tunnel service must be specified');
    }

    // Service availability validation
    if (!this.serviceConfigs[this.primaryService]) {
      errors.push(`Unsupported primary service: ${this.primaryService}`);
    }

    // SSH dependency check
    if (this.primaryService !== 'ngrok' && !this.isSSHAvailable()) {
      warnings.push('SSH not found in PATH. Required for most tunnel services.');
    }

    // Security warnings
    if (this.allowedPaths.size === 0) {
      warnings.push('No allowed paths configured. All files in local root will be shareable.');
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  // ============================================================================
  // TUNNEL LIFECYCLE MANAGEMENT
  // ============================================================================

  async createTunnel(options = {}) {
    const operationId = this.generateOperationId();
    const tunnelId = this.generateTunnelId();

    try {
      // Initialize services if not already done
      await this._initializeServices();

      this.trackOperation(operationId, 'createTunnel', { tunnelId });
      this.emit('tunnelProgress', {
        operationId,
        tunnelId,
        status: 'creating',
        message: 'Initializing tunnel creation...'
      });

      // Start local server if not running and not using external server
      if (!options.useExternalServer && !this.isServerRunning) {
        await this.startLocalServer();
      }

      // If using external server, use the provided localPort
      const targetPort = options.useExternalServer ? options.localPort : this.serverPort;

      // Try to create tunnel with primary service
      let tunnelInfo = null;
      try {
        tunnelInfo = await this.createServiceTunnel(this.primaryService, tunnelId, options, targetPort);
      } catch (error) {
        if (!this.autoFallback || this.fallbackServices.length === 0) {
          throw error;
        }

        // Try fallback services
        console.error(`⚠️ Primary service ${this.primaryService} failed, trying fallbacks...`);

        for (const fallbackService of this.fallbackServices) {
          try {
            console.error(`🔄 Trying ${fallbackService}...`);
            tunnelInfo = await this.createServiceTunnel(fallbackService, tunnelId, options, targetPort);
            console.error(`✅ Successfully connected via ${fallbackService}`);
            break;
          } catch (fallbackError) {
            console.warn(`❌ ${fallbackService} failed: ${fallbackError.message}`);
            continue;
          }
        }

        if (!tunnelInfo) {
          throw new Error(`All tunnel services failed. Primary: ${error.message}`);
        }
      }

      // Store tunnel information
      this.activeTunnels.set(tunnelId, tunnelInfo);
      this.currentTunnelUrl = tunnelInfo.url;

      this.emit('tunnelProgress', {
        operationId,
        tunnelId,
        status: 'created',
        url: tunnelInfo.url,
        service: tunnelInfo.service,
        message: `Tunnel created successfully via ${tunnelInfo.service}`
      });

      return {
        tunnelId: tunnelId,
        url: tunnelInfo.url,
        service: tunnelInfo.service,
        createdAt: new Date().toISOString(),
        operationId: operationId
      };

    } catch (error) {
      this.emit('tunnelError', { operationId, tunnelId, error: error.message });
      throw new Error(`Failed to create tunnel: ${error.message}`);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  async destroyTunnel(tunnelId) {
    const operationId = this.generateOperationId();

    try {
      this.trackOperation(operationId, 'destroyTunnel', { tunnelId });

      const tunnelInfo = this.activeTunnels.get(tunnelId);
      if (!tunnelInfo) {
        throw new Error(`Tunnel '${tunnelId}' not found`);
      }

      this.emit('tunnelProgress', {
        operationId,
        tunnelId,
        status: 'destroying',
        message: 'Destroying tunnel...'
      });

      // Handle destruction via new service architecture if applicable
      if (tunnelInfo.serviceInstance && tunnelInfo.serviceConnectionId) {
        try {
          await tunnelInfo.serviceInstance.disconnect(tunnelInfo.serviceConnectionId);
        } catch (error) {
          console.warn(`Warning: Failed to disconnect via service architecture: ${error.message}`);
          // Continue with legacy cleanup as fallback
        }
      }

      // Legacy SSH process cleanup (still needed for non-service tunnels)
      if (this.currentTunnelProcess) {
        this.currentTunnelProcess.kill('SIGTERM');
        this.currentTunnelProcess = null;
      }

      // Clean up associated URLs
      await this.cleanupTunnelUrls(tunnelId);

      // Remove from active tunnels
      this.activeTunnels.delete(tunnelId);

      if (this.currentTunnelUrl === tunnelInfo.url) {
        this.currentTunnelUrl = null;
      }

      this.emit('tunnelProgress', {
        operationId,
        tunnelId,
        status: 'destroyed',
        message: 'Tunnel destroyed successfully'
      });

      return { tunnelId, destroyedAt: new Date().toISOString() };

    } catch (error) {
      this.emit('tunnelError', { operationId, tunnelId, error: error.message });
      throw new Error(`Failed to destroy tunnel: ${error.message}`);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  // ============================================================================
  // SERVICE-SPECIFIC TUNNEL CREATION
  // ============================================================================

  async createServiceTunnel(serviceName, tunnelId, options = {}, targetPort = null) {
    const portToUse = targetPort || this.serverPort;

    // Ensure services are initialized
    if (!this._servicesInitialized) {
      throw new Error('Tunnel services not initialized. Call _initializeServices() first.');
    }

    // Use service architecture exclusively
    if (!this.tunnelService.hasService(serviceName)) {
      throw new Error(`Unsupported tunnel service: ${serviceName}. Available services: ${this.tunnelService.getAvailableServices().join(', ')}`);
    }

    return await this._createServiceTunnel(serviceName, tunnelId, options, portToUse);
  }

  /**
   * Creates a tunnel using a service instance
   */
  async _createServiceTunnel(serviceName, tunnelId, options, portToUse) {
    const service = this.tunnelService.getService(serviceName);
    
    // Prepare options in the format expected by the service
    const serviceOptions = {
      port: portToUse,
      subdomain: options.subdomain || this.subdomain,
      region: options.region || this.region,
      ...options
    };

    // Connect using the service
    const connectionResult = await service.connect(serviceOptions);
    
    // Convert service result to TunnelProvider format for compatibility
    return {
      tunnelId: tunnelId,
      url: connectionResult.url,
      localPort: portToUse,
      createdAt: new Date(),
      status: 'active',
      service: serviceName,
      // Store service reference for disconnect
      serviceInstance: service,
      serviceConnectionId: connectionResult.tunnelId || tunnelId
    };
  }

  // ============================================================================
  // TEMPORARY URL MANAGEMENT
  // ============================================================================

  // ============================================================================
  // TEMPORARY URL MANAGEMENT
  // ============================================================================

  async createTemporaryUrl(filePath, options = {}) {
    const operationId = this.generateOperationId();
    const urlId = this.generateUrlId();

    try {
      this.trackOperation(operationId, 'createUrl', { urlId, filePath });

      // Validate file path and access
      await this.validateFileAccess(filePath);

      // Set up URL configuration
      const expiresAt = options.expiresAt || new Date(Date.now() + this.defaultExpiration);
      const accessToken = this.generateAccessToken();
      const permissions = options.permissions || ['read'];

      // Ensure tunnel exists
      if (!this.currentTunnelUrl) {
        const tunnel = await this.createTunnel();
        this.currentTunnelUrl = tunnel.url;
      }

      // Create URL info
      const urlInfo = {
        urlId: urlId,
        filePath: this.normalizePath(filePath),
        tunnelUrl: this.currentTunnelUrl,
        accessToken: accessToken,
        expiresAt: expiresAt,
        permissions: permissions,
        createdAt: new Date(),
        accessCount: 0,
        lastAccessed: null
      };

      // Store URL and access token
      this.activeUrls.set(urlId, urlInfo);
      this.accessTokens.set(accessToken, {
        urlId: urlId,
        expiresAt: expiresAt,
        permissions: permissions
      });

      // Add to allowed paths
      this.allowedPaths.add(urlInfo.filePath);

      const shareableUrl = this.buildShareableUrl(urlInfo);

      this.emit('urlCreated', {
        operationId,
        urlId,
        shareableUrl,
        expiresAt,
        filePath: urlInfo.filePath
      });

      return {
        urlId: urlId,
        shareableUrl: shareableUrl,
        expiresAt: expiresAt,
        accessToken: accessToken,
        permissions: permissions,
        operationId: operationId
      };

    } catch (error) {
      this.emit('urlError', { operationId, urlId, error: error.message });
      throw new Error(`Failed to create temporary URL: ${error.message}`);
    } finally {
      this.activeOperations.delete(operationId);
    }
  }

  async revokeTemporaryUrl(urlId) {
    const urlInfo = this.activeUrls.get(urlId);
    if (!urlInfo) {
      throw new Error(`URL '${urlId}' not found`);
    }

    // Remove access token
    this.accessTokens.delete(urlInfo.accessToken);

    // Remove from active URLs
    this.activeUrls.delete(urlId);

    // Remove from allowed paths if no other URLs use it
    const pathStillUsed = Array.from(this.activeUrls.values())
      .some(url => url.filePath === urlInfo.filePath);

    if (!pathStillUsed) {
      this.allowedPaths.delete(urlInfo.filePath);
    }

    this.emit('urlRevoked', { urlId, filePath: urlInfo.filePath });

    return { urlId, revokedAt: new Date().toISOString() };
  }

  // ============================================================================
  // LOCAL SERVER MANAGEMENT (HTTP Server Implementation)
  // ============================================================================

  async startLocalServer() {
    if (this.isServerRunning) {
      return this.serverPort;
    }

    return new Promise((resolve, reject) => {
      this.localServer = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.localServer.listen(0, 'localhost', () => {
        this.serverPort = this.localServer.address().port;
        this.isServerRunning = true;

        console.error(`🌐 Local server started on port ${this.serverPort}`);
        resolve(this.serverPort);
      });

      this.localServer.on('error', (error) => {
        reject(new Error(`Failed to start local server: ${error.message}`));
      });
    });
  }

  async stopLocalServer() {
    if (!this.isServerRunning || !this.localServer) {
      return;
    }

    return new Promise((resolve) => {
      this.localServer.close(() => {
        this.isServerRunning = false;
        this.serverPort = null;
        this.localServer = null;
        console.error('🔴 Local server stopped');
        resolve();
      });
    });
  }

  async handleRequest(req, res) {
    const startTime = Date.now();

    try {
      // Log the request
      console.error(`📡 ${req.method} ${req.url} from ${req.connection.remoteAddress}`);

      // Parse URL
      const urlParts = new URL(req.url, `http://${req.headers.host}`);
      const pathname = urlParts.pathname;
      const query = urlParts.searchParams;

      // Set basic security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');

      // Handle different routes
      if (pathname === '/') {
        await this.handleRootRequest(req, res);
      } else if (pathname.startsWith('/share/')) {
        await this.handleShareRequest(req, res, pathname, query);
      } else if (pathname === '/status') {
        await this.handleStatusRequest(req, res);
      } else if (pathname === '/health') {
        await this.handleHealthRequest(req, res);
      } else {
        await this.handleNotFound(req, res);
      }

      // Log response time
      const duration = Date.now() - startTime;
      console.error(`📊 Request completed in ${duration}ms`);

    } catch (error) {
      console.error(`❌ Request handling error: ${error.message}`);
      await this.handleError(req, res, error);
    }
  }

  async handleShareRequest(req, res, pathname, query) {
    try {
      // Extract URL ID from path: /share/{urlId}
      const urlId = pathname.split('/')[2];
      if (!urlId) {
        throw new Error('Invalid share URL format');
      }

      console.error(`🔍 Share request for URL ID: ${urlId}`);

      // Get access token from query
      const token = query.get('token');
      if (!token) {
        throw new Error('Access token required');
      }

      console.error(`🔑 Token provided: ${token.substring(0, 8)}...`);

      // Validate access token
      const tokenInfo = this.accessTokens.get(token);
      if (!tokenInfo) {
        throw new Error('Invalid access token');
      }

      // Check token expiration
      if (new Date() > tokenInfo.expiresAt) {
        this.accessTokens.delete(token);
        throw new Error('Access token expired');
      }

      // Validate URL ID matches token
      if (tokenInfo.urlId !== urlId) {
        throw new Error('Token does not match requested URL');
      }

      // Get URL info
      const urlInfo = this.activeUrls.get(urlId);
      if (!urlInfo) {
        throw new Error('Shared URL not found or revoked');
      }

      console.error(`📄 File to serve: ${urlInfo.filePath}`);

      // Check URL expiration
      if (new Date() > urlInfo.expiresAt) {
        await this.revokeTemporaryUrl(urlId);
        throw new Error('Shared URL expired');
      }

      // Validate file still exists and is accessible
      try {
        await fs.access(urlInfo.filePath, fs.constants.R_OK);
        const stats = await fs.stat(urlInfo.filePath);
        if (!stats.isFile()) {
          throw new Error('Shared resource is not a file');
        }
        console.error(`✅ File verified: ${urlInfo.filePath} (${stats.size} bytes)`);
      } catch (fileError) {
        console.error(`❌ File access error: ${fileError.message}`);
        throw new Error(`File not accessible: ${fileError.message}`);
      }

      // Serve the file (this will handle all the stats and event emission)
      await this.serveFile(req, res, urlInfo.filePath, urlInfo);

    } catch (error) {
      console.error(`❌ Share request error: ${error.message}`);

      // Return appropriate error response
      if (error.message.includes('token') || error.message.includes('expired')) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized: ' + error.message);
      } else if (error.message.includes('not found') || error.message.includes('not accessible')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found: ' + error.message);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error: ' + error.message);
      }
    }
  }

  async serveFile(req, res, filePath, urlInfo) {
    const mimeTypes = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };

    console.error(`🚀 Starting file serve for: ${filePath}`);

    try {
      // Get file stats
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;
      const fileName = path.basename(filePath);
      const fileExt = path.extname(filePath).toLowerCase();
      const mimeType = mimeTypes[fileExt] || 'application/octet-stream';

      // Track download start
      const downloadId = this.generateOperationId();
      const startTime = Date.now();
      const clientIP = req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        'unknown';

      console.error(`📁 Starting download: ${fileName} (${this.formatBytes(fileSize)}) for ${clientIP}`);
      console.error(`📄 File path: ${filePath}`);
      console.error(`🎭 MIME type: ${mimeType}`);

      // Set response headers for download
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Download-ID', downloadId);

      // Handle range requests for resume support
      const range = req.headers.range;
      if (range) {
        console.error(`📊 Range request: ${range}`);
        return await this.serveFileRange(req, res, filePath, fileSize, range, urlInfo, downloadId);
      }

      // Serve complete file with proper streaming and error handling
      console.error(`📤 Starting file stream...`);
      res.writeHead(200);

      const stream = createReadStream(filePath);
      let bytesTransferred = 0;
      let lastProgressUpdate = 0;
      let downloadCompleted = false;
      let downloadStarted = false;

      // Track when streaming actually begins
      stream.on('open', () => {
        downloadStarted = true;
        console.error(`🌊 File stream opened successfully`);
      });

      // Track progress
      stream.on('data', (chunk) => {
        bytesTransferred += chunk.length;

        // Log first chunk
        if (bytesTransferred === chunk.length) {
          console.error(`📦 First chunk: ${chunk.length} bytes`);
          console.error(`📝 First 100 chars: ${chunk.toString().substring(0, 100)}...`);
        }

        // Emit progress every 1MB or 5% progress, whichever is more frequent
        const progressInterval = Math.min(1024 * 1024, fileSize * 0.05);
        if (bytesTransferred - lastProgressUpdate >= progressInterval) {
          this.emitDownloadProgress(urlInfo, downloadId, bytesTransferred, fileSize);
          lastProgressUpdate = bytesTransferred;
        }
      });

      // Handle successful completion
      stream.on('end', () => {
        if (downloadCompleted) return; // Prevent duplicate events
        downloadCompleted = true;

        const duration = Date.now() - startTime;
        const speed = fileSize / (duration / 1000); // bytes per second

        console.error(`✅ Download completed: ${fileName} (${this.formatBytes(fileSize)}) in ${this.formatDuration(duration)}`);
        console.error(`   Speed: ${this.formatBytes(speed)}/s | Client: ${clientIP}`);
        console.error(`   Bytes transferred: ${bytesTransferred}/${fileSize}`);

        // Update URL access statistics BEFORE emitting event
        this.updateUrlStats(urlInfo.urlId, fileSize, duration, clientIP);

        // Update URL info
        urlInfo.accessCount = (urlInfo.accessCount || 0) + 1;
        urlInfo.lastAccessed = new Date();
        this.activeUrls.set(urlInfo.urlId, urlInfo);

        // Emit download completion event AFTER successful completion
        this.emit('fileAccessed', {
          urlId: urlInfo.urlId,
          filePath: filePath,
          fileName: fileName,
          fileSize: fileSize,
          duration: duration,
          speed: speed,
          clientIP: clientIP,
          downloadId: downloadId,
          timestamp: new Date(),
          bytesTransferred: fileSize,
          success: true
        });
      });

      // Handle stream errors
      stream.on('error', (error) => {
        console.error(`❌ Stream error for ${fileName}: ${error.message}`);
        console.error(`   Error code: ${error.code}`);
        console.error(`   Bytes transferred before error: ${bytesTransferred}`);

        this.emit('downloadError', {
          urlId: urlInfo.urlId,
          filePath: filePath,
          error: error.message,
          downloadId: downloadId,
          bytesTransferred: bytesTransferred
        });

        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error: File read error');
        }
      });

      // Handle response errors (client disconnect, etc.)
      res.on('error', (error) => {
        console.error(`❌ Response error for ${fileName}: ${error.message}`);
        stream.destroy(); // Clean up the file stream
      });

      // Handle response finish (successful completion from client perspective)
      res.on('finish', () => {
        console.error(`🏁 Response finished for ${fileName}`);
      });

      // Handle client disconnect
      req.on('close', () => {
        if (!downloadCompleted && bytesTransferred < fileSize) {
          console.error(`⚠️  Download interrupted: ${fileName} (${this.formatBytes(bytesTransferred)}/${this.formatBytes(fileSize)})`);

          this.emit('downloadInterrupted', {
            urlId: urlInfo.urlId,
            filePath: filePath,
            downloadId: downloadId,
            bytesTransferred: bytesTransferred,
            totalSize: fileSize,
            percentComplete: (bytesTransferred / fileSize) * 100
          });

          stream.destroy(); // Clean up the file stream
        }
      });

      // Start streaming the file
      console.error(`🔄 Piping stream to response...`);
      stream.pipe(res);

    } catch (error) {
      console.error(`❌ File serving error: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);

      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error: ' + error.message);
      }

      throw new Error(`Failed to serve file: ${error.message}`);
    }
  }

  // Enhanced range request handling
  async serveFileRange(req, res, filePath, fileSize, range, urlInfo, downloadId) {
    try {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      console.error(`📊 Serving range: ${start}-${end}/${fileSize} (${this.formatBytes(chunkSize)})`);

      // Validate range
      if (start >= fileSize || end >= fileSize || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        res.end();
        return;
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream'
      });

      const stream = fs.createReadStream(filePath, { start, end });

      let bytesTransferred = 0;
      let rangeCompleted = false;

      stream.on('data', (chunk) => {
        bytesTransferred += chunk.length;
        console.error(`📦 Range chunk: ${chunk.length} bytes (total: ${bytesTransferred}/${chunkSize})`);
      });

      stream.on('end', () => {
        if (rangeCompleted) return;
        rangeCompleted = true;

        console.error(`✅ Range download completed: ${this.formatBytes(chunkSize)}`);

        // If this completes the entire file, emit completion event
        if (start === 0 && end === fileSize - 1) {
          urlInfo.accessCount = (urlInfo.accessCount || 0) + 1;
          urlInfo.lastAccessed = new Date();
          this.activeUrls.set(urlInfo.urlId, urlInfo);

          this.emit('fileAccessed', {
            urlId: urlInfo.urlId,
            filePath: filePath,
            fileName: path.basename(filePath),
            fileSize: fileSize,
            downloadId: downloadId,
            isRangeRequest: true,
            timestamp: new Date(),
            bytesTransferred: chunkSize,
            success: true
          });
        }
      });

      stream.on('error', (error) => {
        console.error(`❌ Range request error: ${error.message}`);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });

      stream.pipe(res);

    } catch (error) {
      console.error(`❌ Range request handling error: ${error.message}`);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
  }

  // Helper methods (add these if they don't exist)
  emitDownloadProgress(urlInfo, downloadId, bytesTransferred, totalSize) {
    const percentage = Math.round((bytesTransferred / totalSize) * 100);

    this.emit('downloadProgress', {
      urlId: urlInfo.urlId,
      downloadId: downloadId,
      progress: {
        percentage: percentage,
        transferred: this.formatBytes(bytesTransferred),
        total: this.formatBytes(totalSize),
        bytesTransferred: bytesTransferred,
        totalBytes: totalSize
      },
      timestamp: new Date()
    });
  }

  updateUrlStats(urlId, fileSize, duration, clientIP) {
    const urlInfo = this.activeUrls.get(urlId);
    if (!urlInfo) return;

    // Initialize stats if not present
    if (!urlInfo.stats) {
      urlInfo.stats = {
        totalDownloads: 0,
        totalBytes: 0,
        totalDuration: 0,
        averageSpeed: 0,
        firstAccess: null,
        lastAccess: null,
        uniqueIPs: new Set(),
        downloadHistory: []
      };
    }

    // Update statistics
    urlInfo.stats.totalDownloads++;
    urlInfo.stats.totalBytes += fileSize;
    urlInfo.stats.totalDuration += duration;
    urlInfo.stats.averageSpeed = urlInfo.stats.totalBytes / (urlInfo.stats.totalDuration / 1000);
    urlInfo.stats.uniqueIPs.add(clientIP);

    if (!urlInfo.stats.firstAccess) {
      urlInfo.stats.firstAccess = urlInfo.lastAccessed || new Date();
    }
    urlInfo.stats.lastAccess = new Date();

    // Add to download history (keep last 10 downloads)
    urlInfo.stats.downloadHistory.push({
      timestamp: new Date(),
      fileSize: fileSize,
      duration: duration,
      speed: fileSize / (duration / 1000),
      clientIP: clientIP
    });

    if (urlInfo.stats.downloadHistory.length > 10) {
      urlInfo.stats.downloadHistory.shift(); // Remove oldest
    }

    // Update the stored URL info
    this.activeUrls.set(urlId, urlInfo);
  }

  // Enhanced URL listing with download statistics
  listActiveUrls() {
    return Array.from(this.activeUrls.entries()).map(([id, info]) => {
      const baseInfo = {
        urlId: id,
        filePath: info.filePath,
        shareableUrl: this.buildShareableUrl(info),
        expiresAt: info.expiresAt,
        permissions: info.permissions,
        accessCount: info.accessCount || 0,
        lastAccessed: info.lastAccessed,
        createdAt: info.createdAt
      };

      // Add detailed stats if available
      if (info.stats) {
        baseInfo.downloadStats = {
          totalDownloads: info.stats.totalDownloads,
          totalDataTransferred: this.formatBytes(info.stats.totalBytes),
          averageSpeed: this.formatBytes(info.stats.averageSpeed) + '/s',
          uniqueClients: info.stats.uniqueIPs.size,
          firstAccess: info.stats.firstAccess,
          totalDuration: this.formatDuration(info.stats.totalDuration),
          recentDownloads: info.stats.downloadHistory.slice(-3).map(download => ({
            timestamp: download.timestamp,
            size: this.formatBytes(download.fileSize),
            duration: this.formatDuration(download.duration),
            speed: this.formatBytes(download.speed) + '/s'
          }))
        };
      }

      return baseInfo;
    });
  }

  // Enhanced tunnel status with download metrics
  getTunnelStatus() {
    const baseStatus = {
      activeTunnels: this.activeTunnels.size,
      activeUrls: this.activeUrls.size,
      serverRunning: this.isServerRunning,
      serverPort: this.serverPort,
      currentTunnelUrl: this.currentTunnelUrl,
      activeOperations: this.activeOperations.size,
      allowedPaths: this.allowedPaths.size,
      currentService: this.primaryService,
      fallbackEnabled: this.autoFallback
    };

    // Add download statistics
    let totalDownloads = 0;
    let totalDataTransferred = 0;
    let activeDownloads = 0;

    for (const [urlId, urlInfo] of this.activeUrls) {
      if (urlInfo.stats) {
        totalDownloads += urlInfo.stats.totalDownloads;
        totalDataTransferred += urlInfo.stats.totalBytes;
      }
    }

    baseStatus.downloadMetrics = {
      totalDownloads: totalDownloads,
      totalDataTransferred: this.formatBytes(totalDataTransferred),
      activeDownloads: activeDownloads,
      averageFileSize: totalDownloads > 0 ? this.formatBytes(totalDataTransferred / totalDownloads) : '0 Bytes'
    };

    return baseStatus;
  }

  // Add method to get download statistics for a specific URL
  getUrlDownloadStats(urlId) {
    const urlInfo = this.activeUrls.get(urlId);
    if (!urlInfo) {
      throw new Error(`URL '${urlId}' not found`);
    }

    return {
      urlId: urlId,
      filePath: urlInfo.filePath,
      fileName: path.basename(urlInfo.filePath),
      accessCount: urlInfo.accessCount || 0,
      lastAccessed: urlInfo.lastAccessed,
      createdAt: urlInfo.createdAt,
      expiresAt: urlInfo.expiresAt,
      isExpired: new Date() > new Date(urlInfo.expiresAt),
      stats: urlInfo.stats || null
    };
  }
  async handleRootRequest(req, res) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Local File Tunnel</title>
          <style>
              body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              h1 { color: #333; }
              .status { background: #e8f5e8; padding: 15px; border-radius: 4px; margin: 20px 0; }
              .info { color: #666; font-size: 14px; }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>🌐 Local File Tunnel</h1>
              <div class="status">
                  <strong>✅ Tunnel Active</strong><br>
                  This tunnel is serving files from your local system.
              </div>
              <div class="info">
                  <p><strong>Active URLs:</strong> ${this.activeUrls.size}</p>
                  <p><strong>Total Access Tokens:</strong> ${this.accessTokens.size}</p>
                  <p><strong>Tunnel Service:</strong> ${this.primaryService}</p>
                  <p><strong>Server Started:</strong> ${new Date().toISOString()}</p>
              </div>
              <p>To access files, use a valid shareable URL with proper authentication.</p>
          </div>
      </body>
      </html>
    `;

    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  }

  async handleStatusRequest(req, res) {
    const status = {
      tunnel: {
        provider: 'tunnel',
        service: this.primaryService,
        activeTunnels: this.activeTunnels.size,
        activeUrls: this.activeUrls.size,
        serverRunning: this.isServerRunning,
        serverPort: this.serverPort,
        currentTunnelUrl: this.currentTunnelUrl
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        platform: process.platform,
        nodeVersion: process.version
      },
      stats: {
        totalRequests: Array.from(this.activeUrls.values()).reduce((sum, url) => sum + url.accessCount, 0),
        allowedPaths: this.allowedPaths.size,
        activeOperations: this.activeOperations.size
      }
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(status, null, 2));
  }

  async handleHealthRequest(req, res) {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      tunnelActive: this.isServerRunning,
      serviceConnected: !!this.currentTunnelUrl
    };

    res.writeHead(200, {
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify(health));
  }

  async handleNotFound(req, res) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>404 - Not Found</title></head>
      <body style="font-family: Arial, sans-serif; margin: 40px; text-align: center;">
          <h1>🚫 404 - Not Found</h1>
          <p>The requested resource was not found on this tunnel.</p>
          <p><a href="/">← Back to Home</a></p>
      </body>
      </html>
    `;

    res.writeHead(404, {
      'Content-Type': 'text/html'
    });
    res.end(html);
  }

  async handleError(req, res, error) {
    if (res.headersSent) {
      return; // Response already sent
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>500 - Server Error</title></head>
      <body style="font-family: Arial, sans-serif; margin: 40px; text-align: center;">
          <h1>❌ 500 - Server Error</h1>
          <p>An internal server error occurred.</p>
          <p><a href="/">← Back to Home</a></p>
      </body>
      </html>
    `;

    res.writeHead(500, {
      'Content-Type': 'text/html'
    });
    res.end(html);
  }

  // ============================================================================
  // UTILITY METHODS (Following established patterns)
  // ============================================================================

  async testSSHAvailability() {
    return new Promise((resolve, reject) => {
      const testProcess = spawn('ssh', ['-V'], { stdio: ['pipe', 'pipe', 'pipe'] });

      testProcess.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error('SSH not available in PATH'));
        }
      });

      testProcess.on('error', () => {
        reject(new Error('SSH not found'));
      });

      setTimeout(() => {
        testProcess.kill();
        reject(new Error('SSH test timeout'));
      }, 5000);
    });
  }

  isSSHAvailable() {
    try {
      execSync('ssh -V', { stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    } catch (error) {
      return false;
    }
  }

  async testLocalServerCreation() {
    const testServer = createServer();
    return new Promise((resolve, reject) => {
      testServer.listen(0, 'localhost', () => {
        testServer.close(() => resolve());
      });
      testServer.on('error', reject);
    });
  }

  parseFallbackServices(fallbackString) {
    if (!fallbackString) return [];
    return fallbackString.split(',').map(s => s.trim()).filter(s => s);
  }

  generateOperationId() {
    return `tunnel_op_${++this.operationCount}_${Date.now()}`;
  }

  generateTunnelId() {
    return `tunnel_${crypto.randomBytes(8).toString('hex')}`;
  }

  generateUrlId() {
    return `url_${crypto.randomBytes(8).toString('hex')}`;
  }

  generateAccessToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  trackOperation(operationId, type, metadata = {}) {
    this.activeOperations.set(operationId, {
      type: type,
      startTime: Date.now(),
      metadata: metadata
    });
  }

  normalizePath(filePath) {
    // Handle absolute paths
    if (path.isAbsolute(filePath)) {
      return path.normalize(filePath);
    }

    // Handle relative paths starting with './'
    if (filePath.startsWith('./') || filePath.startsWith('../')) {
      // Resolve relative to current working directory (where the command was run)
      return path.resolve(process.cwd(), filePath);
    }

    // Handle simple relative paths - resolve relative to localRoot
    return path.resolve(this.localRoot, filePath);
  }

  async validateFileAccess(filePath) {
    const normalizedPath = this.normalizePath(filePath);

    console.error(`🔍 Path resolution debug:`);
    console.error(`   Input path: ${filePath}`);
    console.error(`   Local root: ${this.localRoot}`);
    console.error(`   Process CWD: ${process.cwd()}`);
    console.error(`   Normalized path: ${normalizedPath}`);

    // Ensure path is within local root OR within process.cwd() for relative paths
    const resolvedLocalRoot = path.resolve(this.localRoot);
    const resolvedCwd = path.resolve(process.cwd());

    const isWithinLocalRoot = normalizedPath.startsWith(resolvedLocalRoot);
    const isWithinCwd = normalizedPath.startsWith(resolvedCwd);

    if (!isWithinLocalRoot && !isWithinCwd) {
      throw new Error(`File path outside of allowed directories. Path: ${normalizedPath}`);
    }

    // Ensure file exists
    try {
      const stats = await fs.stat(normalizedPath);
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      console.error(`✅ File found: ${normalizedPath} (${stats.size} bytes)`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${normalizedPath}`);
      }
      throw error;
    }

    return normalizedPath;
  }

  buildShareableUrl(urlInfo) {
    const baseUrl = urlInfo.tunnelUrl;
    const token = urlInfo.accessToken;

    return `${baseUrl}/share/${urlInfo.urlId}?token=${token}`;
  }

  async cleanupTunnelUrls(tunnelId) {
    const tunnelInfo = this.activeTunnels.get(tunnelId);
    if (!tunnelInfo) return;

    // Find and revoke all URLs using this tunnel
    const urlsToRevoke = [];
    for (const [urlId, urlInfo] of this.activeUrls) {
      if (urlInfo.tunnelUrl === tunnelInfo.url) {
        urlsToRevoke.push(urlId);
      }
    }

    for (const urlId of urlsToRevoke) {
      await this.revokeTemporaryUrl(urlId);
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDuration(milliseconds) {
    if (milliseconds < 1000) {
      return `${milliseconds}ms`;
    }

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  // ============================================================================
  // SHUTDOWN (Required Pattern)
  // ============================================================================

  async shutdown() {
    console.error('🔄 Shutting down tunnel provider...');

    try {
      // Destroy all active tunnels
      const tunnelIds = Array.from(this.activeTunnels.keys());
      for (const tunnelId of tunnelIds) {
        try {
          await this.destroyTunnel(tunnelId);
        } catch (error) {
          console.warn(`⚠️  Failed to destroy tunnel ${tunnelId}: ${error.message}`);
        }
      }

      // Revoke all active URLs
      const urlIds = Array.from(this.activeUrls.keys());
      for (const urlId of urlIds) {
        try {
          await this.revokeTemporaryUrl(urlId);
        } catch (error) {
          console.warn(`⚠️  Failed to revoke URL ${urlId}: ${error.message}`);
        }
      }

      // Kill any active tunnel process
      if (this.currentTunnelProcess) {
        this.currentTunnelProcess.kill('SIGTERM');
        this.currentTunnelProcess = null;
      }

      // Stop local server
      await this.stopLocalServer();

      // Shutdown tunnel services
      if (this._servicesInitialized && this.tunnelService) {
        try {
          await this.tunnelService.shutdown();
        } catch (error) {
          console.warn(`⚠️  Failed to shutdown tunnel services: ${error.message}`);
        }
      }

      // Clear all data structures
      this.activeTunnels.clear();
      this.activeUrls.clear();
      this.accessTokens.clear();
      this.allowedPaths.clear();
      this.activeOperations.clear();

      // Remove all event listeners
      this.removeAllListeners();

      console.error('✅ Tunnel provider shutdown complete');

      return {
        provider: 'tunnel',
        tunnelsDestroyed: tunnelIds.length,
        urlsRevoked: urlIds.length,
        serverStopped: true
      };

    } catch (error) {
      console.error('❌ Error during tunnel provider shutdown:', error.message);
      throw error;
    }
  }

  // ============================================================================
  // STATUS AND QUERY METHODS
  // ============================================================================

  getTunnelStatus() {
    return {
      activeTunnels: this.activeTunnels.size,
      activeUrls: this.activeUrls.size,
      serverRunning: this.isServerRunning,
      serverPort: this.serverPort,
      currentTunnelUrl: this.currentTunnelUrl,
      activeOperations: this.activeOperations.size,
      allowedPaths: this.allowedPaths.size,
      currentService: this.primaryService,
      fallbackEnabled: this.autoFallback
    };
  }

  listActiveTunnels() {
    return Array.from(this.activeTunnels.entries()).map(([id, info]) => ({
      tunnelId: id,
      url: info.url,
      service: info.service,
      createdAt: info.createdAt,
      status: info.status
    }));
  }

  listActiveUrls() {
    return Array.from(this.activeUrls.entries()).map(([id, info]) => ({
      urlId: id,
      filePath: info.filePath,
      shareableUrl: this.buildShareableUrl(info),
      expiresAt: info.expiresAt,
      permissions: info.permissions,
      accessCount: info.accessCount,
      lastAccessed: info.lastAccessed
    }));
  }
}

export { TunnelProvider };