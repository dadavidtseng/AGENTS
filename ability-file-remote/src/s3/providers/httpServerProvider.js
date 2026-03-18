import { createServer } from 'http';
import path from 'path';
import crypto from 'crypto';
import EventEmitter from 'events';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import createDebug from 'debug';

const debug = createDebug('kadi:http');

/**
 * HTTP Server Provider
 * 
 * Provides generic HTTP server capabilities for serving files and handling routes.
 * Integrates with the existing tunnel infrastructure for public access.
 * 
 * Features:
 * - Multiple server management
 * - Custom route registration
 * - Middleware support
 * - Static directory serving
 * - Tunnel integration
 * - Range request support
 */
class HttpServerProvider extends EventEmitter {
  constructor(config) {
    super();
    this.config = config || {};

    // Server management
    this.servers = new Map(); // serverId -> server info
    this.routes = new Map(); // serverId -> routes array
    this.middlewares = new Map(); // serverId -> middleware array
    this.staticPaths = new Map(); // serverId -> static path config
    this.serverCount = 0;

    // Configuration options
    this.maxServers = this.config.maxServers || 10;
    this.defaultPort = this.config.defaultPort || 8000;
    this.requestTimeout = this.config.requestTimeout || 30000; // 30 seconds

    // Security and performance settings
    this.maxRequestSize = this.config.maxRequestSize || '100mb';
    this.enableCORS = this.config.enableCORS || false;
    this.rateLimiting = this.config.rateLimiting || false;

    // Static file serving options
    this.staticFileOptions = {
      dotfiles: 'ignore',
      etag: true,
      extensions: false,
      index: false,
      maxAge: '1d',
      redirect: false,
      ...this.config.staticFileOptions
    };

    // Tunnel integration (will be set by LocalRemoteManager)
    this.tunnelProvider = null;

    debug('🌐 HTTP Server Provider initialized');
  }

  // ============================================================================
  // SERVER LIFECYCLE MANAGEMENT
  // ============================================================================

  /**
   * Create a new HTTP server
   * @param {number} port - Port to bind to (0 for dynamic)
   * @param {string} rootDirectory - Root directory for serving files
   * @param {object} options - Server options
   * @returns {Promise<object>} Server information
   */
  async createHttpServer(port = 0, rootDirectory = process.cwd(), options = {}) {
    if (this.servers.size >= this.maxServers) {
      throw new Error(`Maximum number of servers (${this.maxServers}) reached`);
    }

    const serverId = this.generateServerId();

    try {
      // Validate root directory
      const stats = await fs.stat(rootDirectory);
      if (!stats.isDirectory()) {
        throw new Error(`Root directory '${rootDirectory}' is not a valid directory`);
      }

      // Create server instance
      const server = createServer((req, res) => {

        // Node.js calls THIS arrow function when a request arrives
        // and passes in:
        // - req: the request object (URL, headers, body, etc.)
        // - res: the response object (to send data back)

        // Track connections
        this.trackConnection(serverId, true);

        // Handle connection close
        res.on('close', () => {
          this.trackConnection(serverId, false);
        });

        // Set request timeout
        if (options.requestTimeout || this.requestTimeout) {
          req.setTimeout(options.requestTimeout || this.requestTimeout, () => {
            if (!res.headersSent) {
              res.statusCode = 408;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Request Timeout' }));
            }
          });
        }

        this.handleRequest(serverId, req, res);
      });

      // Configure server
      server.timeout = this.requestTimeout;
      server.keepAliveTimeout = 5000;
      server.headersTimeout = 60000;

      // Start server
      const actualPort = await this.startServer(server, port);

      // Store server information
      const serverInfo = {
        serverId,
        server,
        config: {
          port: actualPort,
          bindAddress: options.bindAddress || '0.0.0.0',
          maxConnections: options.maxConnections,
          maxRequestSize: options.maxRequestSize,
          requestTimeout: options.requestTimeout,
          security: options.security || {}
        },
        rootDirectory: path.resolve(rootDirectory),
        options,
        status: 'running',
        createdAt: new Date(),
        startTime: new Date(),
        lastActivity: new Date(),
        requests: 0,
        errors: 0,
        activeConnections: 0,
        totalConnections: 0,
        peakConnections: 0,
        tunnelId: null,
        tunnelUrl: null
      };

      this.servers.set(serverId, serverInfo);
      this.routes.set(serverId, []);
      this.middlewares.set(serverId, []);
      this.staticPaths.set(serverId, {
        localDirectory: rootDirectory,
        options: {
          directoryListing: false,
          ...options.staticOptions
        }
      });

      debug(`✅ HTTP server created: ${serverId} on port ${actualPort}`);
      debug(`   Root directory: ${rootDirectory}`);

      this.emit('serverCreated', {
        serverId,
        port: actualPort,
        rootDirectory,
        timestamp: new Date()
      });

      return serverId;

    } catch (error) {
      console.error(`❌ Failed to create HTTP server: ${error.message}`);
      throw new Error(`Failed to create HTTP server: ${error.message}`);
    }
  }

  /**
   * Start server on specified port
   * @private
   */
  async startServer(server, port) {
    return new Promise((resolve, reject) => {
      server.listen(port, 'localhost', () => {
        const actualPort = server.address().port;
        resolve(actualPort);
      });

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(new Error(`Server error: ${error.message}`));
        }
      });
    });
  }

  /**
   * Stop a specific server
   * @param {string} serverId - Server ID to stop
   */
  async stopServer(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      throw new Error(`Server '${serverId}' not found`);
    }

    // Stop tunnel if it exists
    if (serverInfo.tunnelId || serverInfo.tunnelStatus) {
      try {
        await this.stopTunnel(serverId);
      } catch (error) {
        console.error(`Failed to stop tunnel for ${serverId}:`, error.message);
        // Continue with server shutdown even if tunnel cleanup fails
      }
    }

    return new Promise((resolve) => {
      debug(`🔄 Stopping server: ${serverId}`);

      // Update server status
      serverInfo.status = 'stopping';

      serverInfo.server.close(() => {
        // Clean up server data
        this.servers.delete(serverId);
        this.routes.delete(serverId);
        this.middlewares.delete(serverId);
        this.staticPaths.delete(serverId);

        debug(`🔴 Server stopped: ${serverId}`);

        this.emit('serverStopped', {
          serverId,
          timestamp: new Date()
        });

        resolve();
      });
    });
  }

  /**
   * Stop all servers
   */
  async stopAllServers() {
    const serverIds = Array.from(this.servers.keys());
    const stopPromises = serverIds.map(serverId => this.stopServer(serverId));

    await Promise.all(stopPromises);
    debug(`🔴 All HTTP servers stopped (${serverIds.length} servers)`);

    // CRITICAL: Shutdown tunnel provider to clean up child processes and local server
    // Without this, the tunnelProvider's local HTTP server and any SSH child processes
    // keep running, preventing Node.js from exiting
    if (this.tunnelProvider) {
      try {
        await this.tunnelProvider.shutdown();
      } catch (error) {
        debug('⚠️  Error shutting down tunnel provider:', error.message);
      }
      this.tunnelProvider = null;
    }

    this.emit('allServersStopped', {
      serverCount: serverIds.length,
      timestamp: new Date()
    });
  }

  /**
   * Get health status of a server
   * @param {string} serverId - Server ID
   */
  getServerHealth(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      return { status: 'not_found' };
    }

    const uptime = Date.now() - serverInfo.createdAt.getTime();
    const timeSinceActivity = Date.now() - serverInfo.lastActivity.getTime();

    let health = 'healthy';
    if (timeSinceActivity > 300000) { // 5 minutes
      health = 'stale';
    }
    if (serverInfo.status !== 'running') {
      health = 'unhealthy';
    }

    return {
      status: health,
      uptime,
      timeSinceActivity,
      requestRate: serverInfo.requests / (uptime / 1000), // requests per second
      errorRate: serverInfo.errors / Math.max(serverInfo.requests, 1)
    };
  }

  /**
   * Perform health check on all servers
   */
  async performHealthCheck() {
    const healthReport = {
      timestamp: new Date(),
      totalServers: this.servers.size,
      healthy: 0,
      stale: 0,
      unhealthy: 0,
      servers: {}
    };

    for (const serverId of this.servers.keys()) {
      const health = this.getServerHealth(serverId);
      healthReport.servers[serverId] = health;
      healthReport[health.status]++;
    }

    this.emit('healthCheck', healthReport);
    return healthReport;
  }

  // ============================================================================
  // ROUTE REGISTRATION SYSTEM
  // ============================================================================

  /**
   * Add a custom route to a server
   * @param {string} serverId - Server ID
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} path - Route path (supports parameters like /:bucket/:key)
   * @param {function} handler - Route handler function
   * @param {Object} options - Route options (priority, etc.)
   * @returns {string} Route ID
   */
  async addCustomRoute(serverId, method, path, handler, options = {}) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    if (typeof handler !== 'function') {
      throw new Error('Route handler must be a function');
    }

    const routeId = this.generateRouteId();
    const routes = this.routes.get(serverId);

    // Check for route conflicts
    const existingRoute = routes.find(r =>
      r.method === method.toUpperCase() &&
      this.pathsMatch(r.path, path)
    );

    if (existingRoute) {
      debug(`⚠️ Route conflict detected: ${method} ${path} (overriding existing route)`);
    }

    const route = {
      routeId,
      method: method.toUpperCase(),
      path,
      handler,
      pathRegex: this.createPathRegex(path),
      paramNames: this.extractParamNames(path),
      priority: options.priority || 0, // Higher numbers = higher priority
      createdAt: new Date(),
      requestCount: 0,
      errorCount: 0
    };

    routes.push(route);

    // Sort routes by priority (descending) to ensure high-priority routes are checked first
    routes.sort((a, b) => b.priority - a.priority);

    const priorityInfo = options.priority ? ` (priority: ${options.priority})` : '';
    debug(`➕ Route added: ${method.toUpperCase()} ${path} -> ${serverId}${priorityInfo}`);

    this.emit('routeAdded', {
      serverId,
      routeId,
      method: method.toUpperCase(),
      path,
      timestamp: new Date()
    });

    return routeId;
  }

  /**
   * Remove a route from a server
   * @param {string} serverId - Server ID
   * @param {string} routeId - Route ID to remove
   */
  async removeRoute(serverId, routeId) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const routes = this.routes.get(serverId);
    const routeIndex = routes.findIndex(r => r.routeId === routeId);

    if (routeIndex === -1) {
      throw new Error(`Route '${routeId}' not found`);
    }

    const removedRoute = routes.splice(routeIndex, 1)[0];

    debug(`➖ Route removed: ${removedRoute.method} ${removedRoute.path}`);

    this.emit('routeRemoved', {
      serverId,
      routeId,
      method: removedRoute.method,
      path: removedRoute.path,
      timestamp: new Date()
    });
  }

  /**
   * List all routes for a server
   * @param {string} serverId - Server ID
   */
  listRoutes(serverId) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const routes = this.routes.get(serverId);
    return routes.map(route => ({
      routeId: route.routeId,
      method: route.method,
      path: route.path,
      requestCount: route.requestCount,
      errorCount: route.errorCount,
      createdAt: route.createdAt
    }));
  }

  /**
   * Find matching route for a request
   * @private
   */
  findMatchingRoute(serverId, method, url) {
    const routes = this.routes.get(serverId);
    if (!routes) return null;

    for (const route of routes) {
      if (route.method !== method.toUpperCase()) continue;

      const match = url.match(route.pathRegex);
      if (match) {
        // Extract parameters
        const params = {};
        route.paramNames.forEach((paramName, index) => {
          params[paramName] = match[index + 1];
        });

        return { route, params };
      }
    }

    return null;
  }

  /**
   * Check for route conflicts
   * @private
   */
  checkRouteConflicts(serverId, method, path) {
    const routes = this.routes.get(serverId);
    const conflicts = routes.filter(r =>
      r.method === method.toUpperCase() &&
      this.pathsMatch(r.path, path)
    );

    return conflicts;
  }

  // ============================================================================
  // MIDDLEWARE SUPPORT
  // ============================================================================

  /**
   * Add authentication middleware to a server
   * @param {string} serverId - Server ID
   * @param {function} authFunction - Authentication function
   */
  async addAuthMiddleware(serverId, authFunction) {
    return this.addMiddleware(serverId, 'authentication', async (req, res, next) => {
      try {
        const result = await authFunction(req, res, next);
        if (result === false) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized');
          return;
        }
        // If result is not false, the auth function should have called next() itself
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Authentication error');
      }
    });
  }

  /**
   * Add middleware to a server
   * @param {string} serverId - Server ID
   * @param {string} name - Middleware name
   * @param {function} handler - Middleware function
   * @param {object} options - Middleware options
   * @returns {string} Middleware ID
   */
  async addMiddleware(serverId, name, handler, options = {}) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    if (typeof handler !== 'function') {
      throw new Error('Middleware handler must be a function');
    }

    const middlewareId = this.generateMiddlewareId();
    const middlewares = this.middlewares.get(serverId);

    const middleware = {
      middlewareId,
      name,
      handler,
      priority: options.priority || 0,
      enabled: options.enabled !== false,
      path: options.path || '/',
      methods: options.methods || ['*'],
      createdAt: new Date(),
      executionCount: 0,
      errorCount: 0,
      totalDuration: 0
    };

    middlewares.push(middleware);

    // Sort by priority (higher priority executes first)
    middlewares.sort((a, b) => b.priority - a.priority);

    debug(`🔧 Middleware added: ${name} (priority: ${middleware.priority}) -> ${serverId}`);

    this.emit('middlewareAdded', {
      serverId,
      middlewareId,
      name,
      priority: middleware.priority,
      timestamp: new Date()
    });

    return middlewareId;
  }

  /**
   * Remove middleware from a server
   * @param {string} serverId - Server ID
   * @param {string} middlewareId - Middleware ID to remove
   */
  async removeMiddleware(serverId, middlewareId) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const middlewares = this.middlewares.get(serverId);
    const middlewareIndex = middlewares.findIndex(m => m.middlewareId === middlewareId);

    if (middlewareIndex === -1) {
      throw new Error(`Middleware '${middlewareId}' not found`);
    }

    const removedMiddleware = middlewares.splice(middlewareIndex, 1)[0];

    debug(`🔧 Middleware removed: ${removedMiddleware.name}`);

    this.emit('middlewareRemoved', {
      serverId,
      middlewareId,
      name: removedMiddleware.name,
      timestamp: new Date()
    });
  }

  /**
   * Enable/disable middleware
   * @param {string} serverId - Server ID
   * @param {string} middlewareId - Middleware ID
   * @param {boolean} enabled - Enable/disable state
   */
  async toggleMiddleware(serverId, middlewareId, enabled) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const middlewares = this.middleware.get(serverId);
    const middleware = middlewares.find(m => m.middlewareId === middlewareId);

    if (!middleware) {
      throw new Error(`Middleware '${middlewareId}' not found`);
    }

    middleware.enabled = enabled;

    debug(`🔧 Middleware ${enabled ? 'enabled' : 'disabled'}: ${middleware.name}`);

    this.emit('middlewareToggled', {
      serverId,
      middlewareId,
      name: middleware.name,
      enabled,
      timestamp: new Date()
    });
  }

  /**
   * List all middleware for a server
   * @param {string} serverId - Server ID
   */
  listMiddleware(serverId) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const middlewares = this.middlewares.get(serverId);
    return middlewares.map(middleware => ({
      middlewareId: middleware.middlewareId,
      name: middleware.name,
      priority: middleware.priority,
      enabled: middleware.enabled,
      path: middleware.path,
      methods: middleware.methods,
      executionCount: middleware.executionCount,
      errorCount: middleware.errorCount,
      averageDuration: middleware.executionCount > 0 ?
        (middleware.totalDuration / middleware.executionCount).toFixed(2) : 0,
      createdAt: middleware.createdAt
    }));
  }

  /**
   * Get middleware statistics
   * @param {string} serverId - Server ID
   */
  getMiddlewareStats(serverId) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const middlewares = this.middlewares.get(serverId);

    return {
      total: middlewares.length,
      enabled: middlewares.filter(m => m.enabled).length,
      disabled: middlewares.filter(m => !m.enabled).length,
      totalExecutions: middlewares.reduce((sum, m) => sum + m.executionCount, 0),
      totalErrors: middlewares.reduce((sum, m) => sum + m.errorCount, 0),
      averageDuration: middlewares.length > 0 ?
        middlewares.reduce((sum, m) => sum + (m.totalDuration / Math.max(m.executionCount, 1)), 0) / middlewares.length : 0
    };
  }

  // ============================================================================
  // STATIC DIRECTORY SERVING
  // ============================================================================

  /**
   * Serve static files from a directory
   * @param {string} serverId - Server ID
   * @param {string} urlPath - URL path prefix
   * @param {string} localDirectory - Local directory to serve
   */
  async serveStaticDirectory(serverId, urlPath, localDirectory) {
    // Validate directory exists
    const stats = await fs.stat(localDirectory);
    if (!stats.isDirectory()) {
      throw new Error(`Directory '${localDirectory}' not found`);
    }

    const resolvedDirectory = path.resolve(localDirectory);

    return this.addCustomRoute(serverId, 'GET', `${urlPath}/*`, async (req, res, params) => {
      const relativePath = params['*'] || '';
      const filePath = path.join(resolvedDirectory, relativePath);

      // Security: prevent directory traversal
      if (!filePath.startsWith(resolvedDirectory)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: Path traversal detected');
        return;
      }

      try {
        const fileStats = await fs.stat(filePath);

        if (fileStats.isFile()) {
          await this.serveFile(filePath, req, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      } catch (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  generateServerId() {
    return `http_server_${++this.serverCount}_${crypto.randomBytes(4).toString('hex')}`;
  }

  generateRouteId() {
    return `route_${crypto.randomBytes(6).toString('hex')}`;
  }

  generateMiddlewareId() {
    return `middleware_${crypto.randomBytes(4).toString('hex')}`;
  }

  createPathRegex(path) {
    // Convert Express-style paths to regex
    const regexPath = path
      .replace(/:[^/]+/g, '([^/]+)')  // :param -> capture group
      .replace(/\*/g, '(.*)');        // * -> capture everything

    return new RegExp(`^${regexPath}$`);
  }

  extractParamNames(path) {
    const params = [];
    const matches = path.match(/:([^/]+)/g);

    if (matches) {
      matches.forEach(match => {
        params.push(match.substring(1)); // Remove ':'
      });
    }

    // Handle wildcard
    if (path.includes('*')) {
      params.push('*');
    }

    return params;
  }

  pathsMatch(path1, path2) {
    return this.createPathRegex(path1).test(path2) ||
      this.createPathRegex(path2).test(path1);
  }

  /**
   * Get server status information
   * @param {string} serverId - Server ID
   */
  getServerStatus(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const routes = this.routes.get(serverId) || [];
    const middlewares = this.middlewares.get(serverId) || [];

    return {
      serverId,
      port: serverInfo.config.port,
      rootDirectory: serverInfo.rootDirectory,
      status: serverInfo.status,
      isActive: serverInfo.status === 'running',
      uptime: Date.now() - serverInfo.createdAt.getTime(),
      requests: serverInfo.requests,
      errors: serverInfo.errors,
      lastActivity: serverInfo.lastActivity,
      routeCount: routes.length,
      middlewareCount: middlewares.length,
      tunnelId: serverInfo.tunnelId,
      tunnelUrl: serverInfo.tunnelUrl,
      tunnelStatus: serverInfo.tunnelStatus,
      tunnelService: serverInfo.tunnelService,
      tunnelConfig: serverInfo.tunnelConfig
    };
  }

  // Placeholder for request handling (will be enhanced)
  /**
   * Handle incoming HTTP requests
   * @private
   */
  async handleRequest(serverId, req, res) {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server configuration error');
      return;
    }

    // Update statistics
    serverInfo.requests++;
    serverInfo.lastActivity = new Date();

    try {
      // Set default headers
      res.setHeader('X-Powered-By', 'Local-Remote-File-Manager');
      res.setHeader('X-Request-ID', requestId);

      // Log incoming request
      debug(`� ${req.method} ${req.url} [${requestId}]`);

      // Parse URL
      const urlParts = new URL(req.url, `http://${req.headers.host}`);
      const pathname = urlParts.pathname;

      // Execute middleware
      await this.executeMiddleware(serverId, req, res);

      // Check if response was already sent by middleware
      if (res.headersSent) {
        return;
      }

      // Find matching route
      const match = this.findMatchingRoute(serverId, req.method, pathname);

      if (match) {
        // Add route parameters to request
        req.params = match.params;
        req.query = Object.fromEntries(urlParts.searchParams);
        req.requestId = requestId;

        // Update route statistics
        match.route.requestCount++;

        try {
          // Execute route handler
          await match.route.handler(req, res);

          const duration = Date.now() - startTime;
          debug(`✅ ${req.method} ${req.url} [${requestId}] - ${res.statusCode} (${duration}ms)`);

        } catch (routeError) {
          match.route.errorCount++;
          throw routeError;
        }

      } else if (this.staticPaths.has(serverId)) {
        // Try to serve static files
        await this.serveStaticFile(serverId, pathname, req, res);

        const duration = Date.now() - startTime;
        debug(`📁 ${req.method} ${req.url} [${requestId}] - ${res.statusCode} (${duration}ms)`);

      } else {
        // No route found
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Not Found',
          message: `No route found for ${req.method} ${pathname}`,
          requestId
        }));

        const duration = Date.now() - startTime;
        debug(`❌ ${req.method} ${req.url} [${requestId}] - 404 (${duration}ms)`);
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`💥 ${req.method} ${req.url} [${requestId}] - Error (${duration}ms):`, error.message);

      if (!res.headersSent) {
        this.createErrorResponse(error, req, res, requestId);
      }

      this.emit('requestError', {
        serverId,
        requestId,
        method: req.method,
        url: req.url,
        error: error.message,
        duration,
        timestamp: new Date()
      });
    }
  }

  /**
   * Execute middleware chain for a request
   * @private
   */
  async executeMiddleware(serverId, req, res) {
    const middlewares = this.middlewares.get(serverId);
    if (!middlewares || middlewares.length === 0) {
      return;
    }

    // Filter enabled middleware that matches the request
    const applicableMiddleware = middlewares.filter(middleware => {
      if (!middleware.enabled) return false;

      // Check path matching
      if (middleware.path !== '/' && !req.url.startsWith(middleware.path)) {
        return false;
      }

      // Check method matching
      if (!middleware.methods.includes('*') && !middleware.methods.includes(req.method)) {
        return false;
      }

      return true;
    });

    let index = 0;

    const next = async (error) => {
      if (error) {
        throw error;
      }

      if (index >= applicableMiddleware.length) {
        return;
      }

      const middleware = applicableMiddleware[index++];
      const startTime = Date.now();

      try {
        middleware.executionCount++;
        await middleware.handler(req, res, next);

        const duration = Date.now() - startTime;
        middleware.totalDuration += duration;

      } catch (middlewareError) {
        const duration = Date.now() - startTime;
        middleware.totalDuration += duration;
        middleware.errorCount++;

        console.error(`Middleware error in '${middleware.name}':`, middlewareError.message);
        throw middlewareError;
      }
    };

    await next();
  }

  /**
   * Generate unique request ID
   * @private
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ============================================================================
  // STATIC FILE SERVING
  // ============================================================================

  /**
   * Serve a static file
   * @private
   */
  async serveStaticFile(serverId, pathname, req, res) {
    const staticPath = this.staticPaths.get(serverId);
    if (!staticPath) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Static serving not configured' }));
      return;
    }

    try {
      // Security check - prevent directory traversal
      const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
      const fullPath = path.join(staticPath.localDirectory, safePath);

      // Ensure the file is within the static directory
      if (!fullPath.startsWith(path.resolve(staticPath.localDirectory))) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
      }

      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        // Try to serve index.html if it exists
        const indexPath = path.join(fullPath, 'index.html');
        try {
          const indexStats = await fs.stat(indexPath);
          if (indexStats.isFile()) {
            await this.serveFile(indexPath, req, res);
            return;
          }
        } catch (indexError) {
          // Index file doesn't exist, serve directory listing if enabled
          if (staticPath.options.directoryListing) {
            await this.serveDirectoryListing(fullPath, pathname, res);
            return;
          }
        }

        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Directory access forbidden' }));
        return;
      }

      if (stats.isFile()) {
        await this.serveFile(fullPath, req, res);
      } else {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'File not found' }));
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'File not found' }));
      } else {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Server error', message: error.message }));
      }
    }
  }

  /**
   * Serve a file with proper headers and range support
   * @private
   */
  async serveFile(filePath, req, res) {
    const stats = await fs.stat(filePath);
    const mimeType = this.getMimeType(filePath);

    // Set basic headers
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    res.setHeader('ETag', `"${stats.size}-${stats.mtime.getTime()}"`);

    // Handle conditional requests
    const ifModifiedSince = req.headers['if-modified-since'];
    const ifNoneMatch = req.headers['if-none-match'];

    if (ifModifiedSince && new Date(ifModifiedSince) >= stats.mtime) {
      res.statusCode = 304;
      res.end();
      return;
    }

    if (ifNoneMatch && ifNoneMatch === res.getHeader('ETag')) {
      res.statusCode = 304;
      res.end();
      return;
    }

    // Handle range requests
    const range = req.headers.range;
    if (range) {
      await this.serveFileRange(filePath, range, stats, res);
    } else {
      // Serve entire file
      res.setHeader('Content-Length', stats.size);
      res.statusCode = 200;

      const readStream = fsSync.createReadStream(filePath);
      readStream.pipe(res);

      readStream.on('error', (error) => {
        console.error('File stream error:', error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      });
    }
  }

  /**
   * Serve file range for partial content requests
   * @private
   */
  async serveFileRange(filePath, range, stats, res) {
    const ranges = this.parseRangeHeader(range, stats.size);

    if (!ranges || ranges.length === 0) {
      res.statusCode = 416; // Range Not Satisfiable
      res.setHeader('Content-Range', `bytes */${stats.size}`);
      res.end();
      return;
    }

    if (ranges.length === 1) {
      // Single range
      const { start, end } = ranges[0];
      const contentLength = end - start + 1;

      res.statusCode = 206; // Partial Content
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', contentLength);

      const readStream = fsSync.createReadStream(filePath, { start, end });
      readStream.pipe(res);

      readStream.on('error', (error) => {
        console.error('Range stream error:', error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      });
    } else {
      // Multiple ranges - not commonly used, but included for completeness
      res.statusCode = 206;
      const boundary = `----HttpServerProviderBoundary${Date.now()}`;
      res.setHeader('Content-Type', `multipart/byteranges; boundary=${boundary}`);

      // This would require more complex implementation for multiple ranges
      // For now, just serve the first range
      const { start, end } = ranges[0];
      const contentLength = end - start + 1;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', contentLength);

      const readStream = fsSync.createReadStream(filePath, { start, end });
      readStream.pipe(res);
    }
  }

  /**
   * Parse HTTP Range header
   * @private
   */
  parseRangeHeader(range, fileSize) {
    const ranges = [];
    const rangeSpec = range.replace(/bytes=/, '').split(',');

    for (const spec of rangeSpec) {
      const rangeParts = spec.trim().split('-');
      let start = parseInt(rangeParts[0], 10);
      let end = parseInt(rangeParts[1], 10);

      if (isNaN(start) && !isNaN(end)) {
        // Suffix range: -500 (last 500 bytes)
        start = Math.max(0, fileSize - end);
        end = fileSize - 1;
      } else if (!isNaN(start) && isNaN(end)) {
        // Start range: 500- (from byte 500 to end)
        end = fileSize - 1;
      } else if (!isNaN(start) && !isNaN(end)) {
        // Full range: 500-999
        if (start > end || start >= fileSize) {
          continue; // Invalid range
        }
        end = Math.min(end, fileSize - 1);
      } else {
        continue; // Invalid range
      }

      if (start >= 0 && end >= start && start < fileSize) {
        ranges.push({ start, end });
      }
    }

    return ranges;
  }

  /**
   * Serve directory listing
   * @private
   */
  async serveDirectoryListing(dirPath, urlPath, res) {
    try {
      const files = await fs.readdir(dirPath);
      const fileStats = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          return {
            name: file,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            mtime: stats.mtime
          };
        })
      );

      // Sort: directories first, then files, both alphabetically
      fileStats.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      const html = this.generateDirectoryListingHtml(urlPath, fileStats);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Length', Buffer.byteLength(html));
      res.end(html);

    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to read directory' }));
    }
  }

  /**
   * Generate HTML for directory listing
   * @private
   */
  generateDirectoryListingHtml(urlPath, files) {
    const parentPath = urlPath === '/' ? '' : path.dirname(urlPath);

    const fileListHtml = files.map(file => {
      const icon = file.isDirectory ? '📁' : '📄';
      const size = file.isDirectory ? '-' : this.formatFileSize(file.size);
      const date = file.mtime.toLocaleDateString();
      const href = path.posix.join(urlPath, file.name);

      return `
        <tr>
          <td><a href="${href}">${icon} ${file.name}</a></td>
          <td>${size}</td>
          <td>${date}</td>
        </tr>
      `;
    }).join('');

    const parentLink = urlPath !== '/' ?
      `<tr><td><a href="${parentPath}">📁 ..</a></td><td>-</td><td>-</td></tr>` : '';

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Directory listing for ${urlPath}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        h1 { color: #333; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
        a { text-decoration: none; color: #0066cc; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Directory listing for ${urlPath}</h1>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Date</th>
            </tr>
        </thead>
        <tbody>
            ${parentLink}
            ${fileListHtml}
        </tbody>
    </table>
    <hr>
    <p><em>Powered by Local-Remote-File-Manager</em></p>
</body>
</html>
    `;
  }

  /**
   * Get MIME type for a file
   * @private
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.gz': 'application/gzip',
      '.tar': 'application/x-tar',
      '.xml': 'application/xml',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Format file size for display
   * @private
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
  }

  // ============================================================================
  // ERROR HANDLING & SECURITY
  // ============================================================================

  /**
   * Create comprehensive error response
   * @private
   */
  createErrorResponse(error, req, res, requestId) {
    const errorResponse = {
      error: error.name || 'Error',
      message: error.message || 'An error occurred',
      requestId,
      timestamp: new Date().toISOString(),
      path: req.url,
      method: req.method
    };

    // Add stack trace in development mode
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = error.stack;
    }

    // Set appropriate status code
    let statusCode = 500;
    if (error.code === 'ENOENT') statusCode = 404;
    if (error.code === 'EACCES') statusCode = 403;
    if (error.code === 'EMFILE' || error.code === 'ENFILE') statusCode = 503;
    if (error.name === 'ValidationError') statusCode = 400;
    if (error.name === 'AuthenticationError') statusCode = 401;
    if (error.name === 'AuthorizationError') statusCode = 403;
    if (error.name === 'RateLimitError') statusCode = 429;

    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(errorResponse, null, 2));

    return errorResponse;
  }

  /**
   * Validate server creation parameters
   * @private
   */
  validateServerParams(port, options = {}) {
    const errors = [];

    // Validate port
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('Port must be an integer between 1 and 65535');
    }

    // Validate bind address
    if (options.bindAddress && typeof options.bindAddress !== 'string') {
      errors.push('Bind address must be a string');
    }

    // Validate request size limit
    if (options.maxRequestSize && (!Number.isInteger(options.maxRequestSize) || options.maxRequestSize < 0)) {
      errors.push('Max request size must be a positive integer');
    }

    // Validate connection limit
    if (options.maxConnections && (!Number.isInteger(options.maxConnections) || options.maxConnections < 1)) {
      errors.push('Max connections must be a positive integer');
    }

    // Validate timeout values
    if (options.requestTimeout && (!Number.isInteger(options.requestTimeout) || options.requestTimeout < 1000)) {
      errors.push('Request timeout must be at least 1000ms');
    }

    if (errors.length > 0) {
      const error = new Error(`Validation failed: ${errors.join(', ')}`);
      error.name = 'ValidationError';
      error.validationErrors = errors;
      throw error;
    }
  }

  /**
   * Apply security headers to response
   * @private
   */
  applySecurityHeaders(res, options = {}) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', options.frameOptions || 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Enforce HTTPS (if configured)
    if (options.enforceHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Content Security Policy
    if (options.contentSecurityPolicy) {
      res.setHeader('Content-Security-Policy', options.contentSecurityPolicy);
    }

    // Referrer Policy
    res.setHeader('Referrer-Policy', options.referrerPolicy || 'strict-origin-when-cross-origin');

    // Remove server header
    res.removeHeader('Server');
  }

  /**
   * Check request size limits
   * @private
   */
  checkRequestSize(req, maxSize) {
    const contentLength = parseInt(req.headers['content-length'], 10);

    if (contentLength && contentLength > maxSize) {
      const error = new Error(`Request too large: ${contentLength} bytes exceeds limit of ${maxSize} bytes`);
      error.name = 'RequestTooLargeError';
      throw error;
    }
  }

  /**
   * Rate limiting middleware
   * @private
   */
  createRateLimiter(options = {}) {
    const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
    const maxRequests = options.maxRequests || 100;
    const clients = new Map();

    return (req, res, next) => {
      const clientId = req.ip || req.connection.remoteAddress || 'unknown';
      const now = Date.now();

      // Clean up old entries
      for (const [id, data] of clients.entries()) {
        if (now - data.windowStart > windowMs) {
          clients.delete(id);
        }
      }

      // Get or create client record
      let clientData = clients.get(clientId);
      if (!clientData || (now - clientData.windowStart) > windowMs) {
        clientData = {
          windowStart: now,
          requests: 0
        };
        clients.set(clientId, clientData);
      }

      // Check rate limit
      if (clientData.requests >= maxRequests) {
        const error = new Error(`Rate limit exceeded: ${maxRequests} requests per ${windowMs}ms`);
        error.name = 'RateLimitError';
        throw error;
      }

      // Increment request count
      clientData.requests++;

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - clientData.requests));
      res.setHeader('X-RateLimit-Reset', new Date(clientData.windowStart + windowMs).toISOString());

      next();
    };
  }

  /**
   * Handle malformed requests
   * @private
   */
  handleMalformedRequest(error, req, res, requestId) {
    console.error(`Malformed request [${requestId}]:`, error.message);

    const errorResponse = {
      error: 'Bad Request',
      message: 'Malformed request',
      requestId,
      timestamp: new Date().toISOString()
    };

    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(errorResponse));
  }

  // ============================================================================
  // SERVER MONITORING & STATUS
  // ============================================================================

  /**
   * List all active servers
   */
  listActiveServers() {
    return Array.from(this.servers.keys()).map(serverId => {
      const status = this.getServerStatus(serverId);
      return {
        serverId: status.serverId,
        status: status.status,
        port: status.port,
        uptime: status.uptime,
        requests: status.requests,
        routeCount: status.routeCount,
        middlewareCount: status.middlewareCount
      };
    });
  }

  /**
   * Get comprehensive server metrics
   * @param {string} serverId - Server ID
   */
  getServerMetrics(serverId) {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const serverInfo = this.servers.get(serverId);
    const routes = this.routes.get(serverId);
    const middlewares = this.middlewares.get(serverId);

    const now = Date.now();
    const uptimeMs = now - serverInfo.startTime.getTime();
    const uptimeSeconds = Math.floor(uptimeMs / 1000);

    return {
      serverId,
      timestamp: new Date(),
      uptime: {
        milliseconds: uptimeMs,
        seconds: uptimeSeconds,
        minutes: Math.floor(uptimeSeconds / 60),
        hours: Math.floor(uptimeSeconds / 3600),
        days: Math.floor(uptimeSeconds / 86400),
        formatted: this.formatUptime(uptimeMs)
      },
      requests: {
        total: serverInfo.requests,
        perSecond: serverInfo.requests / Math.max(uptimeSeconds, 1),
        perMinute: (serverInfo.requests / Math.max(uptimeSeconds, 1)) * 60,
        perHour: (serverInfo.requests / Math.max(uptimeSeconds, 1)) * 3600
      },
      connections: {
        active: serverInfo.activeConnections,
        total: serverInfo.totalConnections,
        peak: serverInfo.peakConnections || serverInfo.activeConnections
      },
      routes: routes.map(route => ({
        routeId: route.routeId,
        method: route.method,
        path: route.path,
        requests: route.requestCount,
        errors: route.errorCount,
        errorRate: route.requestCount > 0 ? (route.errorCount / route.requestCount) * 100 : 0
      })),
      middleware: middlewares.map(middleware => ({
        middlewareId: middleware.middlewareId,
        name: middleware.name,
        enabled: middleware.enabled,
        executions: middleware.executionCount,
        errors: middleware.errorCount,
        averageDuration: middleware.executionCount > 0 ?
          (middleware.totalDuration / middleware.executionCount).toFixed(2) : 0
      })),
      memory: process.memoryUsage(),
      lastActivity: serverInfo.lastActivity
    };
  }

  /**
   * Track connection count
   * @private
   */
  trackConnection(serverId, increment = true) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) return;

    if (increment) {
      serverInfo.activeConnections++;
      serverInfo.totalConnections++;
      serverInfo.peakConnections = Math.max(
        serverInfo.peakConnections || 0,
        serverInfo.activeConnections
      );
    } else {
      serverInfo.activeConnections = Math.max(0, serverInfo.activeConnections - 1);
    }

    // Emit connection events
    this.emit('connectionChange', {
      serverId,
      activeConnections: serverInfo.activeConnections,
      totalConnections: serverInfo.totalConnections,
      increment
    });

    // Check connection limits
    if (serverInfo.config.maxConnections &&
      serverInfo.activeConnections >= serverInfo.config.maxConnections) {
      this.emit('connectionLimitReached', {
        serverId,
        activeConnections: serverInfo.activeConnections,
        maxConnections: serverInfo.config.maxConnections
      });
    }
  }

  /**
   * Check server health
   * @private
   */
  checkServerHealth(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      return { status: 'unknown', issues: ['Server not found'] };
    }

    const issues = [];
    const warnings = [];

    // Check if server is running
    if (serverInfo.status !== 'running') {
      issues.push(`Server status is ${serverInfo.status}`);
    }

    // Check last activity (if no requests for 5 minutes, it might be idle)
    const timeSinceLastActivity = Date.now() - serverInfo.lastActivity.getTime();
    if (timeSinceLastActivity > 5 * 60 * 1000) {
      warnings.push(`No activity for ${Math.floor(timeSinceLastActivity / 60000)} minutes`);
    }

    // Check connection count
    if (serverInfo.config.maxConnections) {
      const connectionUsage = (serverInfo.activeConnections / serverInfo.config.maxConnections) * 100;
      if (connectionUsage > 90) {
        issues.push(`High connection usage: ${connectionUsage.toFixed(1)}%`);
      } else if (connectionUsage > 75) {
        warnings.push(`Moderate connection usage: ${connectionUsage.toFixed(1)}%`);
      }
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const heapUsage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (heapUsage > 90) {
      issues.push(`High memory usage: ${heapUsage.toFixed(1)}%`);
    } else if (heapUsage > 75) {
      warnings.push(`Moderate memory usage: ${heapUsage.toFixed(1)}%`);
    }

    // Determine overall health status
    let status = 'healthy';
    if (issues.length > 0) {
      status = 'unhealthy';
    } else if (warnings.length > 0) {
      status = 'warning';
    }

    return {
      status,
      issues,
      warnings,
      checkedAt: new Date()
    };
  }

  /**
   * Create status endpoint for a server
   * @param {string} serverId - Server ID
   * @param {string} statusPath - Path for status endpoint (default: '/status')
   */
  async createStatusEndpoint(serverId, statusPath = '/status') {
    return this.addCustomRoute(serverId, 'GET', statusPath, async (req, res) => {
      try {
        const status = this.getServerStatus(serverId);
        const metrics = this.getServerMetrics(serverId);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          server: status,
          metrics: metrics,
          timestamp: new Date().toISOString()
        }, null, 2));

      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Failed to get server status',
          message: error.message
        }));
      }
    });
  }

  /**
   * Format uptime duration
   * @private
   */
  formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // ============================================================================
  // TUNNEL INTEGRATION
  // ============================================================================

  /**
   * Creates an HTTP server on localhost and exposes it to the internet via a tunnel.
   * 
   * This is a convenience function that combines two operations:
   * 1. Starts an HTTP server listening on a local port (e.g., localhost:3000)
   * 2. Spawns a tunnel service (ngrok/serveo) that creates a public URL forwarding to that port
   * 
   * Local Server (localhost:3000) ← Tunnel Bridge → Public Internet (https://xyz.ngrok.io)
   * 
   * @param {number} port - Local port for the HTTP server (e.g., 3000)
   * @param {string} rootDirectory - Directory to serve files from
   * @param {object} tunnelOptions - Tunnel configuration (service, authToken, region, etc.)
   * @param {object} serverOptions - HTTP server configuration
   * @returns {Promise<string>} The serverId for tracking this server+tunnel combination
   */
  async createTunneledServer(port, rootDirectory, tunnelOptions = {}, serverOptions = {}) {
    try {
      // Create the local HTTP server that will handle requests
      // This server only listens on localhost and isn't accessible from the internet yet
      const serverId = await this.createHttpServer(port, rootDirectory, serverOptions);
      const serverInfo = this.servers.get(serverId);

      // Store tunnel configuration even if tunnel creation is disabled
      serverInfo.tunnelConfig = tunnelOptions;

      // Check if tunnel creation is disabled (for testing)
      if (tunnelOptions.enableTunnel === false || tunnelOptions.service === 'mock') {
        debug(`🚇 Tunnel creation disabled for server ${serverId} (testing mode)`);
        serverInfo.tunnelStatus = 'disabled';
        return serverId; // Return just the serverId for consistency
      }

      // Initialize the tunnel provider if this is the first tunnel
      // TunnelProvider manages multiple tunnel services (ngrok, serveo) and handles fallbacks
      if (!this.tunnelProvider) {
        const { TunnelProvider } = await import('./tunnelProvider.js');
        // Enforce ngrok-only for reliability and predictable behavior
        // Disable auto-fallback so failures surface clearly (e.g., missing NGROK_AUTH_TOKEN)
        this.tunnelProvider = new TunnelProvider({
          service: 'ngrok',
          fallbackServices: '',
          autoFallback: false
        });
      }

      debug(`🚇 Creating tunnel for server ${serverId} on port ${serverInfo.config.port}...`);

      // Configure tunnel options to point at our local server's port
      const tunnelConfig = {
        // The port our HTTP server is listening on
        localPort: serverInfo.config.port,

        // Default to ngrok for reliability
        service: tunnelOptions.service || 'ngrok',

        // Optional: request specific subdomain (paid feature)
        // Instead of: "https://a1b2c3d4.ngrok.io" you get: "https://myapp.ngrok.io"
        subdomain: tunnelOptions.subdomain,

        // Normalize auth option naming for ngrok
        // Prefer explicit authToken, fall back to ngrokAuthToken, then generic auth
        authToken: tunnelOptions.authToken || tunnelOptions.ngrokAuthToken || tunnelOptions.auth,
        
        // Geographic region for tunnel endpoint
        region: tunnelOptions.region,
        protocol: tunnelOptions.protocol || 'http',
        
        // Tells TunnelProvider we're tunneling to an existing server, not creating one
        useExternalServer: true,
        ...tunnelOptions
      };

      // Create the tunnel and get a public URL
      // Now, traffic sent to the tunnel URL will be forwarded to the port
      // the HTTP server is listening on.
      const tunnelResult = await this.tunnelProvider.createTunnel(tunnelConfig);

      // Store tunnel information
      serverInfo.tunnelId = tunnelResult.tunnelId;
      serverInfo.tunnelUrl = tunnelResult.url; // Use 'url' not 'publicUrl'
      serverInfo.tunnelService = tunnelResult.service;
      serverInfo.tunnelStatus = 'connected';

      debug(`✅ Tunnel created: ${tunnelResult.url}`);

      // Set up tunnel monitoring
      this.setupTunnelMonitoring(serverId);

      this.emit('tunnelCreated', {
        serverId,
        tunnelId: tunnelResult.tunnelId,
        publicUrl: tunnelResult.url, // Use 'url' from tunnel result
        service: tunnelResult.service,
        timestamp: new Date()
      });

      return serverId; // Return just the serverId for consistency

    } catch (error) {
      console.error(`❌ Failed to create tunneled server: ${error.message}`);
      throw new Error(`Failed to create tunneled server: ${error.message}`);
    }
  }

  /**
   * Get tunnel URL for a server
   * @param {string} serverId - Server ID
   * @returns {string} Public tunnel URL
   */
  getTunnelUrl(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      throw new Error(`Server '${serverId}' not found`);
    }

    if (!serverInfo.tunnelUrl) {
      throw new Error(`Server '${serverId}' does not have a tunnel`);
    }

    return serverInfo.tunnelUrl;
  }

  /**
   * Get tunnel status for a server
   * @param {string} serverId - Server ID
   * @returns {object} Tunnel status information
   */
  async getTunnelStatus(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      throw new Error(`Server '${serverId}' not found`);
    }

    if (!serverInfo.tunnelId) {
      return { status: 'no_tunnel', message: 'Server does not have a tunnel' };
    }

    try {
      const tunnelStatus = await this.tunnelProvider.getTunnelStatus(serverInfo.tunnelId);

      // Update local status
      serverInfo.tunnelStatus = tunnelStatus.status;

      return {
        tunnelId: serverInfo.tunnelId,
        publicUrl: serverInfo.tunnelUrl,
        service: serverInfo.tunnelService,
        status: tunnelStatus.status,
        connected: tunnelStatus.status === 'connected',
        lastChecked: new Date(),
        details: tunnelStatus
      };

    } catch (error) {
      console.error(`Failed to get tunnel status for ${serverId}:`, error.message);
      serverInfo.tunnelStatus = 'error';

      return {
        tunnelId: serverInfo.tunnelId,
        status: 'error',
        connected: false,
        error: error.message,
        lastChecked: new Date()
      };
    }
  }

  /**
   * Setup tunnel monitoring and failover
   * @private
   */
  setupTunnelMonitoring(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo || !serverInfo.tunnelId) return;

    // Monitor tunnel every 30 seconds
    const monitoringInterval = setInterval(async () => {
      try {
        const status = await this.getTunnelStatus(serverId);

        if (!status.connected && serverInfo.tunnelStatus === 'connected') {
          debug(`⚠️ Tunnel disconnected for server ${serverId}, attempting recovery...`);

          this.emit('tunnelDisconnected', {
            serverId,
            tunnelId: serverInfo.tunnelId,
            timestamp: new Date()
          });

          // Attempt tunnel recovery
          await this.recoverTunnel(serverId);
        }

      } catch (error) {
        console.error(`Tunnel monitoring error for ${serverId}:`, error.message);
      }
    }, 30000);

    // Store monitoring interval for cleanup
    serverInfo.tunnelMonitoringInterval = monitoringInterval;
  }

  /**
   * Recover a failed tunnel
   * @private
   */
  async recoverTunnel(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) return;

    try {
      debug(`🔄 Attempting tunnel recovery for server ${serverId}...`);

      // Try to recreate the tunnel with same configuration
      const tunnelConfig = {
        localPort: serverInfo.config.port,
        service: serverInfo.tunnelService || 'ngrok'
      };

      const tunnelResult = await this.tunnelProvider.createTunnel(tunnelConfig);

      // Update tunnel information
      const oldTunnelId = serverInfo.tunnelId;
      serverInfo.tunnelId = tunnelResult.tunnelId;
      serverInfo.tunnelUrl = tunnelResult.publicUrl;
      serverInfo.tunnelStatus = 'connected';

      debug(`✅ Tunnel recovered: ${tunnelResult.publicUrl}`);

      this.emit('tunnelRecovered', {
        serverId,
        oldTunnelId,
        newTunnelId: tunnelResult.tunnelId,
        newPublicUrl: tunnelResult.publicUrl,
        timestamp: new Date()
      });

    } catch (error) {
      console.error(`❌ Tunnel recovery failed for ${serverId}:`, error.message);
      serverInfo.tunnelStatus = 'failed';

      this.emit('tunnelRecoveryFailed', {
        serverId,
        error: error.message,
        timestamp: new Date()
      });
    }
  }

  /**
   * Stop tunnel for a server
   * @param {string} serverId - Server ID
   */
  async stopTunnel(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      throw new Error(`Server '${serverId}' not found`);
    }

    // Handle case where tunnel was disabled or never created
    if (!serverInfo.tunnelId || serverInfo.tunnelStatus === 'disabled') {
      debug(`🚇 No tunnel to stop for server ${serverId} (was disabled or never created)`);
      return;
    }

    // Check if tunnelProvider exists
    if (!this.tunnelProvider) {
      debug(`⚠️ No tunnel provider available for server ${serverId}`);
      return;
    }

    try {
      // Stop tunnel monitoring
      if (serverInfo.tunnelMonitoringInterval) {
        clearInterval(serverInfo.tunnelMonitoringInterval);
        serverInfo.tunnelMonitoringInterval = null;
      }

      // Stop the tunnel if stopTunnel method exists
      if (typeof this.tunnelProvider.destroyTunnel === 'function') {
        await this.tunnelProvider.destroyTunnel(serverInfo.tunnelId);
      } else {
        debug(`⚠️ TunnelProvider.destroyTunnel method not available`);
      }

      debug(`🛑 Tunnel stopped for server ${serverId}`);

      this.emit('tunnelStopped', {
        serverId,
        tunnelId: serverInfo.tunnelId,
        timestamp: new Date()
      });

      // Clear tunnel information
      serverInfo.tunnelId = null;
      serverInfo.tunnelUrl = null;
      serverInfo.tunnelService = null;
      serverInfo.tunnelStatus = null;

    } catch (error) {
      console.error(`Failed to stop tunnel for ${serverId}:`, error.message);
      // Don't throw - just log the error so server cleanup can continue
    }
  }

  /**
   * List all servers with tunnel information
   */
  listTunneledServers() {
    const servers = this.listActiveServers();

    return servers.map(server => ({
      ...server,
      tunnel: server.tunnelUrl ? {
        url: server.tunnelUrl,
        service: server.tunnelService,
        status: server.tunnelStatus
      } : null
    }));
  }

  /**
   * Enhanced server stop that also stops tunnels
   */
  async stopServer(serverId) {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      throw new Error(`Server '${serverId}' not found`);
    }

    try {
      // Stop tunnel first if it exists
      if (serverInfo.tunnelId) {
        await this.stopTunnel(serverId);
      }

      // Stop the HTTP server with force-close timeout
      // Node.js server.close() waits for all connections to finish gracefully
      // This can take MINUTES with keep-alive connections!
      // We force-close after 2 seconds to prevent hanging

      // First, try to close all connections immediately (Node 18.2+)
      if (typeof serverInfo.server.closeAllConnections === 'function') {
        serverInfo.server.closeAllConnections();
      }

      await new Promise((resolve, reject) => {
        const forceCloseTimeout = setTimeout(() => {
          // Timeout reached, just resolve
          resolve();
        }, 2000); // Force close after 2 seconds

        serverInfo.server.close((error) => {
          clearTimeout(forceCloseTimeout);
          // Ignore errors and resolve anyway
          resolve();
        });
      });

      // Update server status
      serverInfo.status = 'stopped';

      debug(`🛑 Server stopped: ${serverId}`);

      this.emit('serverStopped', {
        serverId,
        timestamp: new Date()
      });

      // Clean up
      this.servers.delete(serverId);
      this.routes.delete(serverId);
      this.middlewares.delete(serverId);
      this.staticPaths.delete(serverId);

      // CRITICAL: If this was the last server, shutdown tunnel provider
      // The tunnel provider creates a local HTTP server and may spawn child processes (SSH tunnels)
      // Without cleanup, these keep Node.js from exiting
      if (this.servers.size === 0 && this.tunnelProvider) {
        try {
          await this.tunnelProvider.shutdown();
          this.tunnelProvider = null;
        } catch (tunnelError) {
          debug('⚠️  Error shutting down tunnel provider:', tunnelError.message);
        }
      }

    } catch (error) {
      console.error(`❌ Failed to stop server '${serverId}': ${error.message}`);
      throw new Error(`Failed to stop server: ${error.message}`);
    }
  }
}

export { HttpServerProvider };
