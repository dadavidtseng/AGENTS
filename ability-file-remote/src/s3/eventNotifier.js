/**
 * Event Notifier - Phase 4 Implementation
 * 
 * Event notification system for S3HttpServer download lifecycle and server status changes.
 * Provides a centralized event system with multiple notification channels,
 * event filtering, and customizable notification formats.
 * 
 * Features:
 * - Centralized event aggregation from multiple sources
 * - Multiple notification channels (console, file, webhook, email)
 * - Event filtering and priority-based routing
 * - Customizable notification templates and formats
 * - Rate limiting and debouncing for noisy events
 * - Event history and audit logging
 * - Real-time event streaming for monitoring
 * - Integration with DownloadMonitor and ShutdownManager
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import url from 'url';
import createDebug from 'debug';

const debug = createDebug('kadi:registry:events');

class EventNotifier extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Notification channels
      enableConsoleNotifications: config.enableConsoleNotifications !== false,
      enableFileNotifications: config.enableFileNotifications || false,
      enableWebhookNotifications: config.enableWebhookNotifications || false,
      enableEmailNotifications: config.enableEmailNotifications || false,

      // Console notifications
      consoleLevel: config.consoleLevel || 'info', // 'debug', 'info', 'warn', 'error'
      consoleFormat: config.consoleFormat || 'detailed', // 'simple', 'detailed', 'json'
      enableConsoleColors: config.enableConsoleColors !== false,

      // File notifications
      logFilePath: config.logFilePath || path.join(process.cwd(), 'logs', 'events.log'),
      logFormat: config.logFormat || 'json', // 'json', 'text', 'csv'
      logRotation: config.logRotation || false,
      maxLogSize: config.maxLogSize || 10 * 1024 * 1024, // 10MB
      maxLogFiles: config.maxLogFiles || 5,

      // Event filtering
      eventFilter: config.eventFilter || null, // Function to filter events
      eventPriorities: config.eventPriorities || {
        'error': 5,
        'shutdown': 4,
        'downloadFailed': 3,
        'downloadCompleted': 2,
        'downloadStarted': 1,
        'progress': 0
      },
      minPriorityLevel: config.minPriorityLevel || 0,

      // Rate limiting
      enableRateLimiting: config.enableRateLimiting !== false,
      rateLimitWindow: config.rateLimitWindow || 60000, // 1 minute
      maxEventsPerWindow: config.maxEventsPerWindow || 100,
      debounceInterval: config.debounceInterval || 1000, // 1 second

      // Event history
      keepEventHistory: config.keepEventHistory !== false,
      maxHistorySize: config.maxHistorySize || 1000,
      historyRetentionTime: config.historyRetentionTime || 3600000, // 1 hour

      // Webhook settings
      webhookUrl: config.webhookUrl,
      webhookTimeout: config.webhookTimeout || 5000,
      webhookRetries: config.webhookRetries || 3,

      // Email settings (basic)
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort || 587,
      smtpUser: config.smtpUser,
      smtpPass: config.smtpPass,
      emailFrom: config.emailFrom,
      emailTo: config.emailTo,

      ...config
    };

    // Internal state
    this.isActive = false;
    this.eventHistory = [];
    this.eventCounts = new Map(); // eventType -> count
    this.rateLimitCounts = new Map(); // eventType -> { count, windowStart }
    this.debouncedEvents = new Map(); // eventKey -> timeout

    // Event source tracking
    this.eventSources = new Set(); // Set of registered event sources
    this.sourceListeners = new Map(); // source -> listener function map

    // Color codes for console output
    this.colors = this.config.enableConsoleColors ? {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    } : {};

    this.setupEventHandling();
  }

  // ============================================================================
  // EVENT SOURCE MANAGEMENT
  // ============================================================================

  /**
   * Register an event source for monitoring
   * @param {EventEmitter} source - Event source to monitor
   * @param {string} sourceName - Name of the event source
   * @param {Object} eventMap - Mapping of source events to notification events
   * @returns {Function} Unregister function
   */
  registerEventSource(source, sourceName, eventMap = {}) {
    if (!source || typeof source.on !== 'function') {
      throw new Error('Event source must be an EventEmitter');
    }

    if (this.eventSources.has(source)) {
      return () => { }; // Already registered
    }

    this.eventSources.add(source);
    const listeners = new Map();

    // Setup listeners for mapped events
    for (const [sourceEvent, notificationEvent] of Object.entries(eventMap)) {
      const listener = (eventData) => {
        this.notifyEvent(notificationEvent, {
          ...eventData,
          source: sourceName,
          sourceEvent,
          timestamp: new Date()
        });
      };

      source.on(sourceEvent, listener);
      listeners.set(sourceEvent, listener);
    }

    this.sourceListeners.set(source, listeners);

    // Return unregister function
    return () => {
      this.unregisterEventSource(source);
    };
  }

  /**
   * Unregister an event source
   * @param {EventEmitter} source - Event source to unregister
   */
  unregisterEventSource(source) {
    if (!this.eventSources.has(source)) {
      return;
    }

    const listeners = this.sourceListeners.get(source);
    if (listeners) {
      // Remove all listeners
      for (const [eventName, listener] of listeners) {
        source.removeListener(eventName, listener);
      }
    }

    this.eventSources.delete(source);
    this.sourceListeners.delete(source);
  }

  /**
   * Setup standard event source registrations
   * @param {Object} sources - Object containing standard sources
   */
  setupStandardSources(sources = {}) {
    // Download Monitor events
    if (sources.downloadMonitor) {
      this.registerEventSource(sources.downloadMonitor, 'DownloadMonitor', {
        'downloadStarted': 'downloadStarted',
        'downloadProgress': 'downloadProgress',
        'downloadCompleted': 'downloadCompleted',
        'downloadFailed': 'downloadFailed',
        'downloadRetry': 'downloadRetry',
        'allDownloadsComplete': 'allDownloadsComplete',
        'progressUpdate': 'progressUpdate',
        'error': 'downloadMonitorError'
      });
    }

    // Shutdown Manager events
    if (sources.shutdownManager) {
      this.registerEventSource(sources.shutdownManager, 'ShutdownManager', {
        'shutdownScheduled': 'shutdownScheduled',
        'shutdownWarning': 'shutdownWarning',
        'shutdownCancelled': 'shutdownCancelled',
        'shutdownStarted': 'shutdownStarted',
        'shutdownCompleted': 'shutdownCompleted',
        'shutdownError': 'shutdownError',
        'monitoringStarted': 'shutdownMonitoringStarted',
        'monitoringStopped': 'shutdownMonitoringStopped'
      });
    }

    // S3 Server events
    if (sources.s3Server) {
      this.registerEventSource(sources.s3Server, 'S3Server', {
        'serverStarted': 'serverStarted',
        'serverStopped': 'serverStopped',
        'request': 'serverRequest',
        'download': 'serverDownload',
        'error': 'serverError'
      });
    }

    // Monitoring Dashboard events
    if (sources.monitoringDashboard) {
      this.registerEventSource(sources.monitoringDashboard, 'MonitoringDashboard', {
        'displayStarted': 'dashboardStarted',
        'displayStopped': 'dashboardStopped',
        'error': 'dashboardError'
      });
    }
  }

  // ============================================================================
  // EVENT NOTIFICATION
  // ============================================================================

  /**
   * Send a notification for an event
   * @param {string} eventType - Type of event
   * @param {Object} eventData - Event data
   * @param {Object} options - Notification options
   */
  notifyEvent(eventType, eventData = {}, options = {}) {
    try {
      // Create event object
      const event = {
        type: eventType,
        timestamp: new Date(),
        priority: this.getEventPriority(eventType),
        id: this.generateEventId(),
        ...eventData
      };

      // Apply event filtering
      if (!this.shouldProcessEvent(event)) {
        return;
      }

      // Rate limiting check
      if (!this.checkRateLimit(eventType)) {
        return;
      }

      // Debouncing for noisy events
      if (this.shouldDebounce(eventType, event)) {
        this.scheduleDebounced(eventType, event);
        return;
      }

      // Process the event
      this.processEvent(event, options);

    } catch (error) {
      this.emit('error', { type: 'notifyEvent', error: error.message });
    }
  }

  /**
   * Process an event through all notification channels
   * @param {Object} event - Event to process
   * @param {Object} options - Processing options
   */
  processEvent(event, options = {}) {
    // Add to event history
    if (this.config.keepEventHistory) {
      this.addToHistory(event);
    }

    // Update event counts
    this.updateEventCounts(event.type);

    // Send to notification channels
    if (this.config.enableConsoleNotifications) {
      this.sendConsoleNotification(event, options);
    }

    if (this.config.enableFileNotifications) {
      this.sendFileNotification(event, options);
    }

    if (this.config.enableWebhookNotifications && this.config.webhookUrl) {
      this.sendWebhookNotification(event, options);
    }

    if (this.config.enableEmailNotifications && this.config.emailTo) {
      this.sendEmailNotification(event, options);
    }

    // Emit processed event
    this.emit('eventProcessed', event);
  }

  // ============================================================================
  // NOTIFICATION CHANNELS
  // ============================================================================

  /**
   * Send console notification
   * @param {Object} event - Event to notify
   * @param {Object} options - Notification options
   */
  sendConsoleNotification(event, options = {}) {
    const level = this.getConsoleLevel(event);
    if (!this.shouldLogLevel(level)) {
      return;
    }

    const message = this.formatConsoleMessage(event);
    const coloredMessage = this.applyConsoleColors(message, level, event.type);

    // Output to appropriate stream
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(coloredMessage + '\n');
  }

  /**
   * Send file notification
   * @param {Object} event - Event to notify
   * @param {Object} options - Notification options
   */
  async sendFileNotification(event, options = {}) {
    try {
      const logEntry = this.formatFileLogEntry(event);
      const logPath = this.config.logFilePath;

      // Ensure log directory exists
      await fs.ensureDir(path.dirname(logPath));

      // Check for log rotation
      if (this.config.logRotation) {
        await this.checkLogRotation(logPath);
      }

      // Append to log file
      await fs.appendFile(logPath, logEntry + '\n');

    } catch (error) {
      this.emit('error', { type: 'fileNotification', error: error.message });
    }
  }

  /**
   * Send webhook notification
   * @param {Object} event - Event to notify
   * @param {Object} options - Notification options
   */
  async sendWebhookNotification(event, options = {}) {
    try {
      const payload = this.formatWebhookPayload(event);

      // Use fetch if available, fallback to http module
      if (typeof fetch !== 'undefined') {
        await this.sendWebhookWithFetch(payload);
      } else {
        await this.sendWebhookWithHttp(payload);
      }

    } catch (error) {
      this.emit('error', { type: 'webhookNotification', error: error.message });
    }
  }

  /**
   * Send email notification (basic implementation)
   * @param {Object} event - Event to notify
   * @param {Object} options - Notification options
   */
  async sendEmailNotification(event, options = {}) {
    try {
      // Basic email implementation placeholder
      // In a real implementation, you would use nodemailer or similar
      const emailContent = this.formatEmailContent(event);

      debug('📧 Email notification (not implemented):', emailContent.subject);

    } catch (error) {
      this.emit('error', { type: 'emailNotification', error: error.message });
    }
  }

  // ============================================================================
  // FORMATTING METHODS
  // ============================================================================

  /**
   * Format console message
   * @param {Object} event - Event to format
   * @returns {string} Formatted message
   */
  formatConsoleMessage(event) {
    const timestamp = event.timestamp.toISOString();

    switch (this.config.consoleFormat) {
      case 'simple':
        return `[${timestamp}] ${event.type}: ${this.getEventSummary(event)}`;

      case 'json':
        return JSON.stringify(event);

      case 'detailed':
      default:
        const icon = this.getEventIcon(event.type);
        const summary = this.getEventSummary(event);
        return `${icon} [${timestamp}] ${event.type}: ${summary}`;
    }
  }

  /**
   * Format file log entry
   * @param {Object} event - Event to format
   * @returns {string} Formatted log entry
   */
  formatFileLogEntry(event) {
    switch (this.config.logFormat) {
      case 'text':
        return `${event.timestamp.toISOString()} [${event.type}] ${this.getEventSummary(event)}`;

      case 'csv':
        return `"${event.timestamp.toISOString()}","${event.type}","${this.getEventSummary(event).replace(/"/g, '""')}"`;

      case 'json':
      default:
        return JSON.stringify(event);
    }
  }

  /**
   * Format webhook payload
   * @param {Object} event - Event to format
   * @returns {Object} Webhook payload
   */
  formatWebhookPayload(event) {
    return {
      timestamp: event.timestamp.toISOString(),
      eventType: event.type,
      priority: event.priority,
      summary: this.getEventSummary(event),
      data: event,
      source: 'S3HttpServer'
    };
  }

  /**
   * Format email content
   * @param {Object} event - Event to format
   * @returns {Object} Email content
   */
  formatEmailContent(event) {
    const priority = event.priority >= 3 ? 'HIGH' : 'NORMAL';

    return {
      subject: `[S3Server] ${event.type} - ${priority} Priority`,
      body: `
Event: ${event.type}
Time: ${event.timestamp.toISOString()}
Priority: ${event.priority}
Summary: ${this.getEventSummary(event)}

Details:
${JSON.stringify(event, null, 2)}
      `.trim()
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get event priority
   * @param {string} eventType - Event type
   * @returns {number} Priority level
   */
  getEventPriority(eventType) {
    return this.config.eventPriorities[eventType] || 0;
  }

  /**
   * Get console level for event
   * @param {Object} event - Event object
   * @returns {string} Console level
   */
  getConsoleLevel(event) {
    if (event.priority >= 5) return 'error';
    if (event.priority >= 3) return 'warn';
    if (event.priority >= 1) return 'info';
    return 'debug';
  }

  /**
   * Check if should log level
   * @param {string} level - Log level
   * @returns {boolean} Should log
   */
  shouldLogLevel(level) {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = this.config.consoleLevel;
    return levels.indexOf(level) >= levels.indexOf(configLevel);
  }

  /**
   * Get event icon
   * @param {string} eventType - Event type
   * @returns {string} Icon character
   */
  getEventIcon(eventType) {
    const icons = {
      'downloadStarted': '📥',
      'downloadCompleted': '✅',
      'downloadFailed': '❌',
      'downloadProgress': '📊',
      'allDownloadsComplete': '🎉',
      'shutdownScheduled': '⏰',
      'shutdownWarning': '⚠️',
      'shutdownStarted': '🔄',
      'shutdownCompleted': '🛑',
      'serverStarted': '🚀',
      'serverStopped': '🛑',
      'error': '💥'
    };
    return icons[eventType] || '📝';
  }

  /**
   * Get event summary
   * @param {Object} event - Event object
   * @returns {string} Event summary
   */
  getEventSummary(event) {
    switch (event.type) {
      case 'downloadStarted':
        return `Download started: ${event.id || event.downloadId}`;
      case 'downloadCompleted':
        return `Download completed: ${event.downloadId} (${event.completedInfo?.duration}ms)`;
      case 'downloadFailed':
        return `Download failed: ${event.downloadId} - ${event.failedInfo?.error}`;
      case 'allDownloadsComplete':
        return `All downloads complete: ${event.totalCompleted}/${event.totalExpected}`;
      case 'shutdownScheduled':
        return `Shutdown scheduled: ${event.reason} in ${event.delay}ms`;
      case 'shutdownCompleted':
        return `Shutdown completed: ${event.reason} (${event.duration}ms)`;
      default:
        return JSON.stringify(event).substring(0, 100) + '...';
    }
  }

  /**
   * Apply console colors
   * @param {string} message - Message to color
   * @param {string} level - Log level
   * @param {string} eventType - Event type
   * @returns {string} Colored message
   */
  applyConsoleColors(message, level, eventType) {
    if (!this.config.enableConsoleColors) {
      return message;
    }

    let color = this.colors.white;

    switch (level) {
      case 'error':
        color = this.colors.red;
        break;
      case 'warn':
        color = this.colors.yellow;
        break;
      case 'info':
        color = this.colors.cyan;
        break;
      case 'debug':
        color = this.colors.dim;
        break;
    }

    return `${color}${message}${this.colors.reset}`;
  }

  /**
   * Generate unique event ID
   * @returns {string} Event ID
   */
  generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Check if event should be processed
   * @param {Object} event - Event to check
   * @returns {boolean} Should process
   */
  shouldProcessEvent(event) {
    // Priority filter
    if (event.priority < this.config.minPriorityLevel) {
      return false;
    }

    // Custom filter function
    if (typeof this.config.eventFilter === 'function') {
      return this.config.eventFilter(event);
    }

    return true;
  }

  /**
   * Check rate limiting
   * @param {string} eventType - Event type
   * @returns {boolean} Can process
   */
  checkRateLimit(eventType) {
    if (!this.config.enableRateLimiting) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;

    let rateLimitData = this.rateLimitCounts.get(eventType);
    if (!rateLimitData || rateLimitData.windowStart < windowStart) {
      rateLimitData = { count: 0, windowStart: now };
      this.rateLimitCounts.set(eventType, rateLimitData);
    }

    if (rateLimitData.count >= this.config.maxEventsPerWindow) {
      return false;
    }

    rateLimitData.count++;
    return true;
  }

  /**
   * Check if event should be debounced
   * @param {string} eventType - Event type
   * @param {Object} event - Event object
   * @returns {boolean} Should debounce
   */
  shouldDebounce(eventType, event) {
    // Only debounce high-frequency events
    const debounceEvents = ['downloadProgress', 'progressUpdate'];
    return debounceEvents.includes(eventType);
  }

  /**
   * Schedule debounced event
   * @param {string} eventType - Event type
   * @param {Object} event - Event object
   */
  scheduleDebounced(eventType, event) {
    const eventKey = `${eventType}_${event.downloadId || 'global'}`;

    // Clear existing timeout
    const existingTimeout = this.debouncedEvents.get(eventKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new timeout
    const timeout = setTimeout(() => {
      this.processEvent(event);
      this.debouncedEvents.delete(eventKey);
    }, this.config.debounceInterval);

    this.debouncedEvents.set(eventKey, timeout);
  }

  /**
   * Add event to history
   * @param {Object} event - Event to add
   */
  addToHistory(event) {
    this.eventHistory.push(event);

    // Enforce max history size
    if (this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Clean old events
    const cutoff = new Date(Date.now() - this.config.historyRetentionTime);
    this.eventHistory = this.eventHistory.filter(e => e.timestamp > cutoff);
  }

  /**
   * Update event counts
   * @param {string} eventType - Event type
   */
  updateEventCounts(eventType) {
    const current = this.eventCounts.get(eventType) || 0;
    this.eventCounts.set(eventType, current + 1);
  }

  /**
   * Check log rotation
   * @param {string} logPath - Log file path
   */
  async checkLogRotation(logPath) {
    try {
      const stats = await fs.stat(logPath);

      if (stats.size >= this.config.maxLogSize) {
        // Rotate logs
        for (let i = this.config.maxLogFiles - 1; i > 0; i--) {
          const oldPath = `${logPath}.${i}`;
          const newPath = `${logPath}.${i + 1}`;

          if (await fs.pathExists(oldPath)) {
            await fs.move(oldPath, newPath);
          }
        }

        // Move current log to .1
        await fs.move(logPath, `${logPath}.1`);
      }
    } catch (error) {
      // Log file doesn't exist or other error - ignore
    }
  }

  // ============================================================================
  // WEBHOOK IMPLEMENTATIONS
  // ============================================================================

  /**
   * Send webhook with fetch API
   * @param {Object} payload - Webhook payload
   */
  async sendWebhookWithFetch(payload) {
    const response = await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      timeout: this.config.webhookTimeout
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Send webhook with HTTP module
   * @param {Object} payload - Webhook payload
   */
  async sendWebhookWithHttp(payload) {
    return new Promise((resolve, reject) => {
      const webhookUrl = new URL(this.config.webhookUrl);
      const postData = JSON.stringify(payload);

      const options = {
        hostname: webhookUrl.hostname,
        port: webhookUrl.port,
        path: webhookUrl.pathname + webhookUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: this.config.webhookTimeout
      };

      const req = https.request(options, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Webhook failed: ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.on('timeout', () => reject(new Error('Webhook timeout')));
      req.write(postData);
      req.end();
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Start event notification system
   * @returns {Object} Start result
   */
  start() {
    if (this.isActive) {
      return { success: false, error: 'Event notifier already active' };
    }

    this.isActive = true;

    this.emit('started', {
      startTime: new Date(),
      config: this.config
    });

    return { success: true, startTime: new Date() };
  }

  /**
   * Stop event notification system
   * @returns {Object} Stop result
   */
  stop() {
    if (!this.isActive) {
      return { success: false, error: 'Event notifier not active' };
    }

    this.isActive = false;

    // Clear debounced events
    for (const timeout of this.debouncedEvents.values()) {
      clearTimeout(timeout);
    }
    this.debouncedEvents.clear();

    // Unregister all event sources
    for (const source of this.eventSources) {
      this.unregisterEventSource(source);
    }

    this.emit('stopped', {
      stopTime: new Date()
    });

    return { success: true, stopTime: new Date() };
  }

  /**
   * Get event statistics
   * @returns {Object} Event statistics
   */
  getStatistics() {
    return {
      isActive: this.isActive,
      eventCounts: Object.fromEntries(this.eventCounts),
      totalEvents: Array.from(this.eventCounts.values()).reduce((sum, count) => sum + count, 0),
      eventSources: this.eventSources.size,
      historySize: this.eventHistory.length,
      rateLimitCounts: Object.fromEntries(this.rateLimitCounts),
      config: this.config
    };
  }

  /**
   * Get event history
   * @param {number} limit - Maximum number of events to return
   * @returns {Array} Event history
   */
  getEventHistory(limit = 100) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Setup event handling
   */
  setupEventHandling() {
    // Handle errors gracefully
    this.on('error', (errorInfo) => {
      console.error('📢 EventNotifier error:', errorInfo);
    });
  }
}

export { EventNotifier };
