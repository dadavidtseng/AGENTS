/**
 * Shutdown Manager - Phase 4 Implementation
 * 
 * Manages auto-shutdown functionality for S3HttpServer based on configurable triggers.
 * Provides graceful shutdown with download completion detection, timeout handling,
 * and manual override capabilities.
 * 
 * Features:
 * - Configurable shutdown triggers (completion, timeout, manual)
 * - Graceful shutdown sequence with download completion waiting
 * - Resource cleanup and server shutdown coordination
 * - Shutdown delay and warning notifications
 * - Manual shutdown override and cancellation
 * - Integration with DownloadMonitor for completion detection
 * - Process signal handling and cleanup
 */

import { EventEmitter } from 'events';
import fs from 'fs-extra';
import path from 'path';
import createDebug from 'debug';

const debug = createDebug('kadi:registry:shutdown');

class ShutdownManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Shutdown trigger configuration
      enableAutoShutdown: config.enableAutoShutdown !== false,
      shutdownTriggers: config.shutdownTriggers || ['completion', 'timeout'],

      // Completion-based shutdown
      shutdownOnCompletion: config.shutdownOnCompletion !== false,
      completionShutdownDelay: config.completionShutdownDelay || 30000, // 30 seconds
      waitForAllDownloads: config.waitForAllDownloads !== false,

      // Timeout-based shutdown
      maxIdleTime: config.maxIdleTime || 600000, // 10 minutes
      maxTotalTime: config.maxTotalTime || 3600000, // 1 hour
      idleCheckInterval: config.idleCheckInterval || 30000, // 30 seconds

      // Manual shutdown
      enableKeyboardShutdown: config.enableKeyboardShutdown !== false, // Ctrl+C handling
      enableApiShutdown: config.enableApiShutdown !== false, // /shutdown endpoint
      manualShutdownDelay: config.manualShutdownDelay || 5000, // 5 seconds

      // Graceful shutdown process
      gracefulShutdownTimeout: config.gracefulShutdownTimeout || 60000, // 1 minute
      forceShutdownTimeout: config.forceShutdownTimeout || 120000, // 2 minutes
      shutdownWarningTime: config.shutdownWarningTime || 10000, // 10 seconds

      // Cleanup settings
      cleanupTempFiles: config.cleanupTempFiles !== false,
      cleanupDownloads: config.cleanupDownloads !== false,
      saveShutdownLog: config.saveShutdownLog !== false,

      // Test mode - prevents process.exit() during testing
      testMode: config.testMode === true,

      ...config
    };

    // Internal state
    this.isMonitoring = false;
    this.isShuttingDown = false;
    this.shutdownScheduled = false;
    this.shutdownReason = null;
    this.shutdownTimer = null;
    this.warningTimer = null;
    this.idleTimer = null;
    this.forceShutdownTimer = null;

    // Monitoring state
    this.monitoringStartTime = null;
    this.lastActivityTime = new Date();
    this.shutdownHandlers = new Set(); // Set of cleanup functions

    // External dependencies (injected)
    this.downloadMonitor = null;
    this.s3Server = null;
    this.httpProvider = null;
    this.processManager = null;

    this.setupEventHandling();
  }

  // ============================================================================
  // CONFIGURATION AND SETUP
  // ============================================================================

  /**
   * Set external dependencies for shutdown coordination
   * @param {Object} dependencies - Object containing dependent services
   */
  setDependencies(dependencies = {}) {
    this.downloadMonitor = dependencies.downloadMonitor;
    this.s3Server = dependencies.s3Server;
    this.httpProvider = dependencies.httpProvider;
    this.processManager = dependencies.processManager;

    // Setup event listeners for dependencies
    if (this.downloadMonitor) {
      this.downloadMonitor.on('allDownloadsComplete', (info) => {
        this.handleDownloadCompletion(info);
      });
      this.downloadMonitor.on('downloadStarted', () => {
        this.updateActivity();
      });
      this.downloadMonitor.on('downloadProgress', () => {
        this.updateActivity();
      });
    }

    if (this.s3Server) {
      this.s3Server.on('request', () => {
        this.updateActivity();
      });
    }
  }

  /**
   * Register a cleanup handler to run during shutdown
   * @param {Function} handler - Cleanup function (can be async)
   * @param {string} description - Description of cleanup task
   * @returns {Function} Unregister function
   */
  registerCleanupHandler(handler, description = 'cleanup') {
    if (typeof handler !== 'function') {
      throw new Error('Cleanup handler must be a function');
    }

    const cleanupItem = { handler, description };
    this.shutdownHandlers.add(cleanupItem);

    // Return unregister function
    return () => this.shutdownHandlers.delete(cleanupItem);
  }

  // ============================================================================
  // MONITORING CONTROL
  // ============================================================================

  /**
   * Start shutdown monitoring
   * @param {Object} options - Monitoring options
   * @returns {Object} Start result
   */
  startMonitoring(options = {}) {
    if (this.isMonitoring) {
      return { success: false, error: 'Shutdown monitoring already started' };
    }

    if (!this.config.enableAutoShutdown) {
      return { success: false, error: 'Auto-shutdown is disabled' };
    }

    this.isMonitoring = true;
    this.monitoringStartTime = new Date();
    this.lastActivityTime = new Date();

    // Start idle time monitoring
    if (this.config.shutdownTriggers.includes('timeout')) {
      this.startIdleMonitoring();
    }

    // Setup process signal handlers for manual shutdown
    if (this.config.enableKeyboardShutdown) {
      this.setupProcessSignalHandlers();
    }

    this.emit('monitoringStarted', {
      startTime: this.monitoringStartTime,
      triggers: this.config.shutdownTriggers,
      config: this.config
    });

    return {
      success: true,
      startTime: this.monitoringStartTime,
      triggers: this.config.shutdownTriggers
    };
  }

  /**
   * Stop shutdown monitoring
   * @returns {Object} Stop result
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return { success: false, error: 'Shutdown monitoring not started' };
    }

    this.isMonitoring = false;

    // Clear timers
    this.clearAllTimers();

    const monitoringDuration = this.monitoringStartTime ?
      new Date() - this.monitoringStartTime : 0;

    this.emit('monitoringStopped', {
      stopTime: new Date(),
      duration: monitoringDuration
    });

    return {
      success: true,
      duration: monitoringDuration
    };
  }

  // ============================================================================
  // SHUTDOWN TRIGGERS
  // ============================================================================

  /**
   * Handle download completion event
   * @param {Object} completionInfo - Download completion information
   */
  handleDownloadCompletion(completionInfo) {
    if (!this.config.shutdownOnCompletion || !this.config.shutdownTriggers.includes('completion')) {
      return;
    }

    if (this.shutdownScheduled) {
      // Already scheduled, might extend or cancel
      this.emit('shutdownCompletionDetected', {
        ...completionInfo,
        alreadyScheduled: true
      });
      return;
    }

    // Schedule shutdown with delay
    this.scheduleShutdown(
      'download completion',
      this.config.completionShutdownDelay,
      {
        completionInfo,
        trigger: 'completion'
      }
    );
  }

  /**
   * Start idle time monitoring for timeout-based shutdown
   */
  startIdleMonitoring() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
    }

    this.idleTimer = setInterval(() => {
      this.checkIdleTimeout();
    }, this.config.idleCheckInterval);
  }

  /**
   * Check for idle timeout and total time limits
   */
  checkIdleTimeout() {
    const now = new Date();
    const idleTime = now - this.lastActivityTime;
    const totalTime = now - this.monitoringStartTime;

    // Check idle time limit
    if (idleTime >= this.config.maxIdleTime) {
      this.scheduleShutdown(
        'idle timeout',
        0, // Immediate shutdown
        {
          idleTime,
          maxIdleTime: this.config.maxIdleTime,
          trigger: 'idle'
        }
      );
      return;
    }

    // Check total time limit
    if (totalTime >= this.config.maxTotalTime) {
      this.scheduleShutdown(
        'maximum runtime exceeded',
        0, // Immediate shutdown
        {
          totalTime,
          maxTotalTime: this.config.maxTotalTime,
          trigger: 'maxtime'
        }
      );
      return;
    }

    // Emit timeout warnings
    const idleWarningThreshold = this.config.maxIdleTime * 0.8; // 80% of idle time
    const totalWarningThreshold = this.config.maxTotalTime * 0.9; // 90% of total time

    if (idleTime >= idleWarningThreshold) {
      this.emit('idleWarning', {
        idleTime,
        maxIdleTime: this.config.maxIdleTime,
        timeRemaining: this.config.maxIdleTime - idleTime
      });
    }

    if (totalTime >= totalWarningThreshold) {
      this.emit('maxTimeWarning', {
        totalTime,
        maxTotalTime: this.config.maxTotalTime,
        timeRemaining: this.config.maxTotalTime - totalTime
      });
    }
  }

  /**
   * Setup process signal handlers for manual shutdown
   */
  setupProcessSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

    signals.forEach(signal => {
      process.on(signal, () => {
        this.triggerManualShutdown(`${signal} signal`);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception:', error);
      this.triggerManualShutdown('uncaught exception', { error: error.message });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection:', reason);
      this.triggerManualShutdown('unhandled rejection', { reason: reason.toString() });
    });
  }

  /**
   * Trigger manual shutdown
   * @param {string} reason - Shutdown reason
   * @param {Object} metadata - Additional shutdown metadata
   * @returns {Object} Trigger result
   */
  triggerManualShutdown(reason, metadata = {}) {
    if (this.shutdownScheduled) {
      // Already scheduled, speed up the process
      this.executeShutdown();
      return { success: true, message: 'Shutdown execution accelerated' };
    }

    return this.scheduleShutdown(
      reason,
      this.config.manualShutdownDelay,
      {
        ...metadata,
        trigger: 'manual'
      }
    );
  }

  // ============================================================================
  // SHUTDOWN EXECUTION
  // ============================================================================

  /**
   * Schedule a shutdown with optional delay
   * @param {string} reason - Shutdown reason
   * @param {number} delay - Delay in milliseconds before shutdown
   * @param {Object} metadata - Additional shutdown metadata
   * @returns {Object} Schedule result
   */
  scheduleShutdown(reason, delay = 0, metadata = {}) {
    if (this.shutdownScheduled) {
      return { success: false, error: 'Shutdown already scheduled' };
    }

    this.shutdownScheduled = true;
    this.shutdownReason = reason;

    const shutdownTime = new Date(Date.now() + delay);

    // Emit shutdown scheduled event
    this.emit('shutdownScheduled', {
      reason,
      delay,
      shutdownTime,
      metadata
    });

    // Schedule warning if there's enough delay
    if (delay >= this.config.shutdownWarningTime + 1000) {
      const warningDelay = delay - this.config.shutdownWarningTime;
      this.warningTimer = setTimeout(() => {
        this.emit('shutdownWarning', {
          reason,
          timeRemaining: this.config.shutdownWarningTime,
          shutdownTime
        });
      }, warningDelay);
    }

    // Schedule actual shutdown
    if (delay > 0) {
      this.shutdownTimer = setTimeout(() => {
        this.executeShutdown();
      }, delay);
    } else {
      // Immediate shutdown
      setImmediate(() => {
        this.executeShutdown();
      });
    }

    return {
      success: true,
      reason,
      delay,
      shutdownTime,
      scheduled: true
    };
  }

  /**
   * Cancel a scheduled shutdown
   * @param {string} cancelReason - Reason for cancellation
   * @returns {Object} Cancel result
   */
  cancelShutdown(cancelReason = 'manual cancellation') {
    if (!this.shutdownScheduled) {
      return { success: false, error: 'No shutdown scheduled' };
    }

    this.clearAllTimers();
    this.shutdownScheduled = false;
    const previousReason = this.shutdownReason;
    this.shutdownReason = null;

    this.emit('shutdownCancelled', {
      previousReason,
      cancelReason,
      cancelTime: new Date()
    });

    return {
      success: true,
      previousReason,
      cancelReason,
      cancelled: true
    };
  }

  /**
   * Execute graceful shutdown
   * @returns {Promise<Object>} Shutdown result
   */
  async executeShutdown() {
    if (this.isShuttingDown) {
      debug('🔄 Shutdown already in progress...');
      return { success: false, error: 'Already shutting down' };
    }

    this.isShuttingDown = true;
    const shutdownStartTime = new Date();

    debug(`🔄 Starting graceful shutdown (${this.shutdownReason})...`);

    this.emit('shutdownStarted', {
      reason: this.shutdownReason,
      startTime: shutdownStartTime
    });

    // Set up force shutdown timer as safety net
    this.forceShutdownTimer = setTimeout(() => {
      debug('⚠️  Force shutdown after timeout');
      this.emit('forceShutdown', { reason: 'timeout' });
      if (!this.config.testMode) {
        process.exit(1);
      }
    }, this.config.forceShutdownTimeout);

    try {
      // Stop monitoring
      this.stopMonitoring();

      // Phase 1: Wait for active downloads if configured
      if (this.config.waitForAllDownloads && this.downloadMonitor) {
        await this.waitForDownloadCompletion();
      }

      // Phase 2: Stop accepting new connections
      await this.stopAcceptingConnections();

      // Phase 3: Run cleanup handlers
      await this.runCleanupHandlers();

      // Phase 4: Shutdown servers
      await this.shutdownServers();

      // Phase 5: Final cleanup
      await this.finalCleanup();

      const shutdownDuration = new Date() - shutdownStartTime;

      this.emit('shutdownCompleted', {
        reason: this.shutdownReason,
        duration: shutdownDuration,
        success: true
      });

      debug(`✅ Graceful shutdown completed in ${shutdownDuration}ms`);

      // Clear force shutdown timer
      if (this.forceShutdownTimer) {
        clearTimeout(this.forceShutdownTimer);
        this.forceShutdownTimer = null;
      }

      // Exit process
      if (!this.config.testMode) {
        process.exit(0);
      }

    } catch (error) {
      const shutdownDuration = new Date() - shutdownStartTime;

      this.emit('shutdownError', {
        reason: this.shutdownReason,
        duration: shutdownDuration,
        error: error.message
      });

      console.error('❌ Shutdown error:', error);

      // Force exit on error
      if (!this.config.testMode) {
        process.exit(1);
      }
    }
  }

  // ============================================================================
  // SHUTDOWN PHASES
  // ============================================================================

  /**
   * Wait for download completion before shutdown
   * @returns {Promise<void>}
   */
  async waitForDownloadCompletion() {
    if (!this.downloadMonitor) return;

    debug('   📥 Waiting for active downloads to complete...');

    const maxWaitTime = this.config.gracefulShutdownTimeout * 0.6; // 60% of total timeout
    const checkInterval = 1000; // 1 second
    let waitTime = 0;

    return new Promise((resolve) => {
      const checkDownloads = () => {
        const status = this.downloadMonitor.isAllDownloadsComplete();

        if (status.allComplete || status.activeCount === 0) {
          debug('   ✅ All downloads completed');
          resolve();
          return;
        }

        waitTime += checkInterval;
        if (waitTime >= maxWaitTime) {
          debug(`   ⚠️  Download wait timeout (${status.activeCount} still active)`);
          resolve();
          return;
        }

        debug(`   ⏳ Waiting for ${status.activeCount} downloads... (${Math.round((maxWaitTime - waitTime) / 1000)}s remaining)`);
        setTimeout(checkDownloads, checkInterval);
      };

      checkDownloads();
    });
  }

  /**
   * Stop accepting new connections
   * @returns {Promise<void>}
   */
  async stopAcceptingConnections() {
    debug('   🔒 Stopping new connections...');

    if (this.s3Server && typeof this.s3Server.stopAcceptingConnections === 'function') {
      await this.s3Server.stopAcceptingConnections();
    }

    debug('   ✅ Stopped accepting new connections');
  }

  /**
   * Run all registered cleanup handlers
   * @returns {Promise<void>}
   */
  async runCleanupHandlers() {
    if (this.shutdownHandlers.size === 0) return;

    debug('   🧹 Running cleanup handlers...');

    // Run cleanup handlers in reverse order (LIFO)
    const handlers = Array.from(this.shutdownHandlers).reverse();

    for (const { handler, description } of handlers) {
      try {
        debug(`     🧹 Running ${description}...`);
        await handler();
      } catch (error) {
        console.warn(`     ⚠️  ${description} failed: ${error.message}`);
      }
    }

    debug('   ✅ Cleanup handlers completed');
  }

  /**
   * Shutdown HTTP servers and services
   * @returns {Promise<void>}
   */
  async shutdownServers() {
    debug('   🛑 Shutting down servers...');

    try {
      // Shutdown S3 server
      if (this.s3Server && typeof this.s3Server.stop === 'function') {
        await this.s3Server.stop();
        debug('     ✅ S3 server stopped');
      }

      // Shutdown HTTP provider
      if (this.httpProvider && typeof this.httpProvider.stopAllServers === 'function') {
        await this.httpProvider.stopAllServers();
        debug('     ✅ HTTP servers stopped');
      }

    } catch (error) {
      console.warn('     ⚠️  Server shutdown error:', error.message);
    }

    debug('   ✅ Server shutdown completed');
  }

  /**
   * Final cleanup tasks
   * @returns {Promise<void>}
   */
  async finalCleanup() {
    debug('   🧹 Final cleanup...');

    try {
      // Use process manager if available
      if (this.processManager && typeof this.processManager.gracefulShutdown === 'function') {
        await this.processManager.gracefulShutdown(this.shutdownReason);
      }

      // Clear all timers
      this.clearAllTimers();

      // Save shutdown log if configured
      if (this.config.saveShutdownLog) {
        await this.saveShutdownLog();
      }

    } catch (error) {
      console.warn('     ⚠️  Final cleanup error:', error.message);
    }

    debug('   ✅ Final cleanup completed');
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Update last activity time
   */
  updateActivity() {
    this.lastActivityTime = new Date();
  }

  /**
   * Clear all shutdown timers
   */
  clearAllTimers() {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.forceShutdownTimer) {
      clearTimeout(this.forceShutdownTimer);
      this.forceShutdownTimer = null;
    }
  }

  /**
   * Save shutdown log for debugging
   * @returns {Promise<void>}
   */
  async saveShutdownLog() {
    try {
      const logData = {
        shutdownTime: new Date().toISOString(),
        reason: this.shutdownReason,
        config: this.config,
        statistics: this.downloadMonitor ? this.downloadMonitor.getStatistics() : null,
        uptime: this.monitoringStartTime ? new Date() - this.monitoringStartTime : 0
      };

      const logPath = path.join(process.cwd(), 'logs', `shutdown-${Date.now()}.json`);
      await fs.ensureDir(path.dirname(logPath));
      await fs.writeJson(logPath, logData, { spaces: 2 });

      debug(`     💾 Shutdown log saved: ${logPath}`);
    } catch (error) {
      console.warn('     ⚠️  Failed to save shutdown log:', error.message);
    }
  }

  /**
   * Setup event handling
   */
  setupEventHandling() {
    // Handle errors gracefully
    this.on('error', (errorInfo) => {
      console.error('🔄 ShutdownManager error:', errorInfo);
    });

    // Log major events in development
    if (process.env.NODE_ENV === 'development') {
      this.on('shutdownScheduled', (info) => {
        debug(`⏰ Shutdown scheduled: ${info.reason} in ${info.delay}ms`);
      });

      this.on('shutdownWarning', (info) => {
        debug(`⚠️  Shutdown warning: ${info.timeRemaining}ms remaining`);
      });

      this.on('shutdownCancelled', (info) => {
        debug(`❌ Shutdown cancelled: ${info.cancelReason}`);
      });
    }
  }

  /**
   * Get current shutdown status
   * @returns {Object} Current status
   */
  getStatus() {
    return {
      isMonitoring: this.isMonitoring,
      isShuttingDown: this.isShuttingDown,
      shutdownScheduled: this.shutdownScheduled,
      shutdownReason: this.shutdownReason,
      lastActivityTime: this.lastActivityTime,
      uptime: this.monitoringStartTime ? new Date() - this.monitoringStartTime : 0,
      config: this.config
    };
  }
}

export { ShutdownManager };
