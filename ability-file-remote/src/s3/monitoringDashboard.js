/**
 * Monitoring Dashboard - Phase 4 Implementation
 * 
 * Real-time console-based monitoring dashboard for S3HttpServer download progress,
 * server statistics, and auto-shutdown status. Provides a fancy text-based UI
 * with progress bars, live updates, and comprehensive monitoring information.
 * 
 * Features:
 * - Real-time progress bars for individual and overall downloads
 * - Live server statistics and performance metrics
 * - Download speed monitoring and ETA calculations
 * - Auto-shutdown status and countdown timers
 * - Active download listing with detailed progress
 * - Console-based box UI with dynamic updates
 * - Color-coded status indicators and alerts
 * - Configurable update intervals and display options
 */

import { EventEmitter } from 'events';
import createDebug from 'debug';

const debug = createDebug('kadi:registry:dashboard');

class MonitoringDashboard extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Display settings
      updateInterval: config.updateInterval || 1000, // 1 second
      maxDisplayedDownloads: config.maxDisplayedDownloads || 10,
      progressBarWidth: config.progressBarWidth || 30,
      enableColors: config.enableColors !== false,
      enableUnicode: config.enableUnicode !== false,

      // Dashboard sections
      showServerStats: config.showServerStats !== false,
      showDownloadProgress: config.showDownloadProgress !== false,
      showActiveDownloads: config.showActiveDownloads !== false,
      showShutdownStatus: config.showShutdownStatus !== false,
      showPerformanceMetrics: config.showPerformanceMetrics !== false,

      // Auto-refresh settings
      autoRefresh: config.autoRefresh !== false,
      refreshOnEvents: config.refreshOnEvents !== false,
      clearConsoleOnUpdate: config.clearConsoleOnUpdate !== false,

      // Box drawing characters
      boxChars: config.enableUnicode ? {
        topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯',
        horizontal: '─', vertical: '│', cross: '┼',
        teeDown: '┬', teeUp: '┴', teeLeft: '┤', teeRight: '├'
      } : {
        topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+',
        horizontal: '-', vertical: '|', cross: '+',
        teeDown: '+', teeUp: '+', teeLeft: '+', teeRight: '+'
      },

      // Progress bar characters
      progressChars: config.enableUnicode ? {
        filled: '▓', empty: '░', partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉']
      } : {
        filled: '=', empty: ' ', partial: ['-']
      },

      ...config
    };

    // Internal state
    this.isDisplaying = false;
    this.displayTimer = null;
    this.lastUpdate = null;
    this.displayBuffer = [];
    this.terminalWidth = process.stdout.columns || 80;
    this.terminalHeight = process.stdout.rows || 24;

    // Dashboard rendering state for in-place updates
    this.hasRenderedOnce = false;
    this.dashboardLineCount = 0;
    this.lastDisplayContent = '';

    // Dashboard data
    this.serverStats = null;
    this.downloadProgress = null;
    this.shutdownStatus = null;
    this.activeDownloads = [];

    // External dependencies (injected)
    this.downloadMonitor = null;
    this.shutdownManager = null;
    this.s3Server = null;

    // Color codes (with fallbacks)
    this.colors = this.config.enableColors ? {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      bgRed: '\x1b[41m',
      bgGreen: '\x1b[42m',
      bgYellow: '\x1b[43m'
    } : {
      reset: '', bright: '', dim: '', red: '', green: '', yellow: '',
      blue: '', magenta: '', cyan: '', white: '', bgRed: '', bgGreen: '', bgYellow: ''
    };

    this.setupEventHandling();
    this.setupTerminalHandling();
  }

  // ============================================================================
  // CONFIGURATION AND SETUP
  // ============================================================================

  /**
   * Set external dependencies for dashboard data
   * @param {Object} dependencies - Object containing dependent services
   */
  setDependencies(dependencies = {}) {
    this.downloadMonitor = dependencies.downloadMonitor;
    this.shutdownManager = dependencies.shutdownManager;
    this.s3Server = dependencies.s3Server;

    // Setup event listeners if auto-refresh on events is enabled
    if (this.config.refreshOnEvents) {
      this.setupDataEventListeners();
    }
  }

  /**
   * Setup event listeners for automatic refresh
   */
  setupDataEventListeners() {
    if (this.downloadMonitor) {
      this.downloadMonitor.on('downloadStarted', () => this.refreshDisplay());
      this.downloadMonitor.on('downloadProgress', () => this.refreshDisplay());
      this.downloadMonitor.on('downloadCompleted', () => this.refreshDisplay());
      this.downloadMonitor.on('downloadFailed', () => this.refreshDisplay());
      this.downloadMonitor.on('allDownloadsComplete', () => this.refreshDisplay());
    }

    if (this.shutdownManager) {
      this.shutdownManager.on('shutdownScheduled', () => this.refreshDisplay());
      this.shutdownManager.on('shutdownWarning', () => this.refreshDisplay());
      this.shutdownManager.on('shutdownCancelled', () => this.refreshDisplay());
    }
  }

  // ============================================================================
  // DISPLAY CONTROL
  // ============================================================================

  /**
   * Start real-time dashboard display
   * @param {Object} options - Display options
   * @returns {Object} Start result
   */
  startRealTimeDisplay(options = {}) {
    if (this.isDisplaying) {
      return { success: false, error: 'Dashboard already displaying' };
    }

    this.isDisplaying = true;
    this.lastUpdate = new Date();

    // Initial display
    this.refreshDisplay();

    // Setup auto-refresh timer
    if (this.config.autoRefresh && this.config.updateInterval > 0) {
      this.displayTimer = setInterval(() => {
        this.refreshDisplay();
      }, this.config.updateInterval);
    }

    this.emit('displayStarted', {
      startTime: this.lastUpdate,
      config: this.config
    });

    return {
      success: true,
      startTime: this.lastUpdate,
      autoRefresh: this.config.autoRefresh,
      updateInterval: this.config.updateInterval
    };
  }

  /**
   * Stop real-time dashboard display
   * @returns {Object} Stop result
   */
  stopRealTimeDisplay() {
    if (!this.isDisplaying) {
      return { success: false, error: 'Dashboard not displaying' };
    }

    this.isDisplaying = false;

    // Clear timer
    if (this.displayTimer) {
      clearInterval(this.displayTimer);
      this.displayTimer = null;
    }

    const displayDuration = this.lastUpdate ?
      new Date() - this.lastUpdate : 0;

    this.emit('displayStopped', {
      stopTime: new Date(),
      duration: displayDuration
    });

    return {
      success: true,
      duration: displayDuration
    };
  }

  /**
   * Refresh the dashboard display
   * @param {boolean} force - Force refresh even if not displaying
   */
  refreshDisplay(force = false) {
    if (!this.isDisplaying && !force) return;

    try {
      // Collect current data
      this.collectDashboardData();

      // Build display buffer
      this.buildDisplayBuffer();

      // Render to console
      this.renderToConsole();

      this.lastUpdate = new Date();

    } catch (error) {
      this.emit('error', { type: 'refreshDisplay', error: error.message });
    }
  }

  // ============================================================================
  // DATA COLLECTION
  // ============================================================================

  /**
   * Collect current data from all sources
   */
  collectDashboardData() {
    // Collect server statistics
    this.serverStats = this.collectServerStats();

    // Collect download progress
    this.downloadProgress = this.collectDownloadProgress();

    // Collect shutdown status
    this.shutdownStatus = this.collectShutdownStatus();

    // Collect active downloads
    this.activeDownloads = this.collectActiveDownloads();
  }

  /**
   * Collect server statistics
   * @returns {Object} Server stats
   */
  collectServerStats() {
    const stats = {
      status: 'UNKNOWN',
      uptime: 0,
      port: 'N/A',
      publicUrl: null,
      requests: 0,
      connections: 0
    };

    if (this.s3Server) {
      try {
        stats.status = this.s3Server.isRunning ? 'RUNNING' : 'STOPPED';
        stats.uptime = this.s3Server.startTime ? new Date() - this.s3Server.startTime : 0;
        stats.port = this.s3Server.config?.port || 'N/A';
        stats.publicUrl = this.s3Server.tunnelUrl || (stats.port !== 'N/A' ? `http://localhost:${stats.port}` : null);
        stats.requests = this.s3Server.downloadStats?.totalDownloads || 0;
        stats.connections = this.s3Server.activeDownloads?.size || 0;
      } catch (error) {
        // Handle errors gracefully
        stats.status = 'ERROR';
      }
    }

    return stats;
  }

  /**
   * Collect download progress summary
   * @returns {Object} Download progress
   */
  collectDownloadProgress() {
    if (!this.downloadMonitor) {
      return {
        totalExpected: 0,
        totalCompleted: 0,
        totalFailed: 0,
        activeCount: 0,
        overallPercentage: 100,
        overallSpeed: 0,
        overallETA: null,
        totalBytes: 0,
        bytesTransferred: 0
      };
    }

    try {
      return this.downloadMonitor.getDownloadProgress();
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Collect shutdown manager status
   * @returns {Object} Shutdown status
   */
  collectShutdownStatus() {
    if (!this.shutdownManager) {
      return {
        enabled: false,
        scheduled: false,
        reason: null,
        timeRemaining: null
      };
    }

    try {
      const status = this.shutdownManager.getStatus();
      return {
        enabled: status.isMonitoring,
        scheduled: status.shutdownScheduled,
        shuttingDown: status.isShuttingDown,
        reason: status.shutdownReason,
        timeRemaining: null, // TODO: Calculate from shutdown timer
        lastActivity: status.lastActivityTime,
        uptime: status.uptime
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  /**
   * Collect active downloads
   * @returns {Array} Active downloads list
   */
  collectActiveDownloads() {
    if (!this.downloadMonitor) {
      return [];
    }

    try {
      const progress = this.downloadMonitor.getDownloadProgress();
      return progress.activeDownloads || [];
    } catch (error) {
      return [];
    }
  }

  // ============================================================================
  // DISPLAY RENDERING
  // ============================================================================

  /**
   * Build the display buffer with all dashboard sections
   */
  buildDisplayBuffer() {
    this.displayBuffer = [];

    // Dashboard header
    this.addDashboardHeader();

    // Server statistics section
    if (this.config.showServerStats) {
      this.addServerStatsSection();
    }

    // Download progress section
    if (this.config.showDownloadProgress) {
      this.addDownloadProgressSection();
    }

    // Active downloads section
    if (this.config.showActiveDownloads) {
      this.addActiveDownloadsSection();
    }

    // Shutdown status section
    if (this.config.showShutdownStatus) {
      this.addShutdownStatusSection();
    }

    // Dashboard footer
    this.addDashboardFooter();
  }

  /**
   * Add dashboard header
   */
  addDashboardHeader() {
    const title = 'S3 Object Storage Server';
    const width = this.terminalWidth - 4;

    this.displayBuffer.push(this.buildBoxLine('top', width));
    this.displayBuffer.push(this.buildTextLine(title, width, 'center'));
    this.displayBuffer.push(this.buildBoxLine('separator', width));
  }

  /**
   * Add server statistics section
   */
  addServerStatsSection() {
    const stats = this.serverStats;
    const width = this.terminalWidth - 4;

    // Status and uptime
    const statusColor = stats.status === 'RUNNING' ? this.colors.green : this.colors.red;
    const uptimeStr = this.formatDuration(stats.uptime);

    const leftText = `Status: ${statusColor}${stats.status}${this.colors.reset}`;
    const rightText = `Uptime: ${uptimeStr}`;
    this.displayBuffer.push(this.buildTextLine(leftText, width, 'left', rightText));

    // Port and URL
    const portText = `Port: ${stats.port || 'N/A'}`;
    const urlText = stats.publicUrl ? `Public URL: ${stats.publicUrl}` : '';
    this.displayBuffer.push(this.buildTextLine(portText, width, 'left', urlText));

    this.displayBuffer.push(this.buildBoxLine('separator', width));
  }

  /**
   * Add download progress section
   */
  addDownloadProgressSection() {
    const progress = this.downloadProgress;
    const width = this.terminalWidth - 4;

    this.displayBuffer.push(this.buildTextLine('Downloads Progress', width, 'left'));

    if (progress.error) {
      this.displayBuffer.push(this.buildTextLine(`Error: ${progress.error}`, width, 'left'));
    } else {
      // Overall progress bar
      const progressBar = this.buildProgressBar(progress.overallPercentage, this.config.progressBarWidth);
      const progressText = `${progressBar} ${progress.totalCompleted}/${progress.totalExpected} (${Math.round(progress.overallPercentage)}%)`;
      this.displayBuffer.push(this.buildTextLine(progressText, width, 'left'));

      // Statistics line
      const activeText = `Active Downloads: ${progress.activeCount}`;
      const completedText = `Completed: ${progress.totalCompleted}`;
      const failedText = progress.totalFailed > 0 ?
        `${this.colors.red}Failed: ${progress.totalFailed}${this.colors.reset}` :
        `Failed: ${progress.totalFailed}`;

      this.displayBuffer.push(this.buildTextLine(activeText, width, 'left', `${completedText}   ${failedText}`));

      // Speed and ETA
      const speedText = `Speed: ${this.formatSpeed(progress.overallSpeed)}`;
      const totalText = `Total: ${this.formatBytes(progress.bytesTransferred)}`;
      const etaText = progress.overallETA ? `ETA: ${this.formatDuration(progress.overallETA * 1000)}` : '';

      this.displayBuffer.push(this.buildTextLine(speedText, width, 'left', `${totalText}   ${etaText}`));
    }

    this.displayBuffer.push(this.buildBoxLine('separator', width));
  }

  /**
   * Add active downloads section
   */
  addActiveDownloadsSection() {
    const downloads = this.activeDownloads.slice(0, this.config.maxDisplayedDownloads);
    const width = this.terminalWidth - 4;

    this.displayBuffer.push(this.buildTextLine('Active Downloads', width, 'left'));

    if (downloads.length === 0) {
      this.displayBuffer.push(this.buildTextLine('No active downloads', width, 'center'));
    } else {
      for (const download of downloads) {
        const filename = this.truncateText(download.key || download.path || download.id, 20);
        const percentage = download.expectedSize > 0 ?
          (download.bytesTransferred / download.expectedSize) * 100 : 0;
        const progressBar = this.buildProgressBar(percentage, 16);
        const speedText = this.formatSpeed(download.speed || 0);

        const downloadText = `${filename} ${progressBar} ${Math.round(percentage)}% (${speedText})`;
        this.displayBuffer.push(this.buildTextLine(downloadText, width, 'left'));
      }
    }

    this.displayBuffer.push(this.buildBoxLine('separator', width));
  }

  /**
   * Add shutdown status section
   */
  addShutdownStatusSection() {
    const shutdown = this.shutdownStatus;
    const width = this.terminalWidth - 4;

    // Auto-shutdown status
    const statusText = shutdown.enabled ?
      `${this.colors.green}ON${this.colors.reset}` :
      `${this.colors.red}OFF${this.colors.reset}`;

    const triggerText = shutdown.reason ? `Trigger: ${shutdown.reason}` : 'Trigger: Completion + 30s';

    this.displayBuffer.push(this.buildTextLine(`Auto-Shutdown: ${statusText}`, width, 'left', triggerText));

    // Shutdown countdown or status
    if (shutdown.scheduled) {
      const statusColor = shutdown.shuttingDown ? this.colors.red : this.colors.yellow;
      const statusMessage = shutdown.shuttingDown ? 'SHUTTING DOWN' : 'SCHEDULED';
      this.displayBuffer.push(this.buildTextLine(`Next Check: 00:00:05`, width, 'left', `Status: ${statusColor}${statusMessage}${this.colors.reset}`));
    } else {
      this.displayBuffer.push(this.buildTextLine(`Next Check: 00:00:05`, width, 'left', `Status: Monitoring`));
    }
  }

  /**
   * Add dashboard footer
   */
  addDashboardFooter() {
    const width = this.terminalWidth - 4;
    this.displayBuffer.push(this.buildBoxLine('bottom', width));
  }

  // ============================================================================
  // DISPLAY UTILITIES
  // ============================================================================

  /**
   * Build a box line (top, bottom, separator)
   * @param {string} type - Line type
   * @param {number} width - Line width
   * @returns {string} Box line
   */
  buildBoxLine(type, width) {
    const chars = this.config.boxChars;

    switch (type) {
      case 'top':
        return chars.topLeft + chars.horizontal.repeat(width) + chars.topRight;
      case 'bottom':
        return chars.bottomLeft + chars.horizontal.repeat(width) + chars.bottomRight;
      case 'separator':
        return chars.teeRight + chars.horizontal.repeat(width) + chars.teeLeft;
      default:
        return chars.horizontal.repeat(width + 2);
    }
  }

  /**
   * Build a text line with optional left and right text
   * @param {string} leftText - Left-aligned text
   * @param {number} width - Line width
   * @param {string} align - Text alignment
   * @param {string} rightText - Right-aligned text
   * @returns {string} Text line
   */
  buildTextLine(leftText, width, align = 'left', rightText = '') {
    const chars = this.config.boxChars;

    // Strip color codes for length calculation
    const stripColors = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
    const leftLength = stripColors(leftText).length;
    const rightLength = stripColors(rightText).length;

    let content;
    const availableWidth = width - rightLength;

    if (align === 'center') {
      const padding = Math.max(0, Math.floor((availableWidth - leftLength) / 2));
      content = ' '.repeat(padding) + leftText + ' '.repeat(availableWidth - padding - leftLength);
    } else {
      const padding = Math.max(0, availableWidth - leftLength);
      content = leftText + ' '.repeat(padding);
    }

    return chars.vertical + content + rightText + chars.vertical;
  }

  /**
   * Build a progress bar
   * @param {number} percentage - Progress percentage (0-100)
   * @param {number} width - Progress bar width
   * @returns {string} Progress bar
   */
  buildProgressBar(percentage, width) {
    const chars = this.config.progressChars;
    const filledWidth = Math.floor((percentage / 100) * width);
    const emptyWidth = width - filledWidth;

    return chars.filled.repeat(filledWidth) + chars.empty.repeat(emptyWidth);
  }

  /**
   * Render the display buffer to console
   */
  renderToConsole() {
    // For the first render, print a separator and track position
    if (!this.hasRenderedOnce) {
      this.hasRenderedOnce = true;
      debug(''); // Add some space
      debug('\x1b[90m📊 Live Monitoring Dashboard:\x1b[0m');
      debug('\x1b[90m' + '─'.repeat(80) + '\x1b[0m');
      this.lastDisplayContent = '';
    }

    // Create the current display content as a string
    const currentContent = this.displayBuffer.join('\n');

    // Only update if content has actually changed significantly
    // This prevents minor updates from spamming the console
    if (this.lastDisplayContent && this.contentSimilarity(currentContent, this.lastDisplayContent) > 0.95) {
      return; // Skip very similar updates
    }

    // Try ANSI escape sequences for in-place update only if terminal supports it
    if (this.dashboardLineCount > 0 && process.stdout.isTTY && this.config.enableInPlaceUpdates !== false) {
      // Move cursor up and clear from that point
      process.stdout.write(`\x1b[${this.dashboardLineCount}A`); // Move cursor up
      process.stdout.write('\x1b[0J'); // Clear from cursor to end of screen
    } else if (this.dashboardLineCount > 0) {
      // If ANSI doesn't work well, just add a separator
      debug('\x1b[90m' + '─'.repeat(40) + ' Updated ' + '─'.repeat(40) + '\x1b[0m');
    }

    // Write each line of the dashboard
    for (const line of this.displayBuffer) {
      debug(line);
    }

    // Keep track of content and line count for next update
    this.lastDisplayContent = currentContent;
    this.dashboardLineCount = this.displayBuffer.length;
  }

  /**
   * Calculate content similarity to avoid unnecessary updates
   */
  contentSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0.0;

    // Simple similarity check - count different characters
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1.0;

    let same = 0;
    const minLen = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLen; i++) {
      if (str1[i] === str2[i]) same++;
    }

    return same / maxLen;
  }

  // ============================================================================
  // FORMATTING UTILITIES
  // ============================================================================

  /**
   * Format bytes as human-readable string
   * @param {number} bytes - Bytes to format
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Format speed as human-readable string
   * @param {number} bytesPerSecond - Speed in bytes per second
   * @returns {string} Formatted speed
   */
  formatSpeed(bytesPerSecond) {
    return this.formatBytes(bytesPerSecond) + '/s';
  }

  /**
   * Format duration as human-readable string
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(milliseconds) {
    if (milliseconds < 1000) return '< 1s';

    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    } else if (minutes > 0) {
      return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Truncate text to specified length
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  // ============================================================================
  // EVENT HANDLING
  // ============================================================================

  /**
   * Setup event handling
   */
  setupEventHandling() {
    // Handle errors gracefully
    this.on('error', (errorInfo) => {
      console.error('📊 MonitoringDashboard error:', errorInfo);
    });
  }

  /**
   * Setup terminal handling for responsive display
   */
  setupTerminalHandling() {
    // Update terminal dimensions on resize
    process.stdout.on('resize', () => {
      this.terminalWidth = process.stdout.columns || 80;
      this.terminalHeight = process.stdout.rows || 24;

      // Refresh display if active
      if (this.isDisplaying) {
        this.refreshDisplay();
      }
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get current dashboard status
   * @returns {Object} Dashboard status
   */
  getStatus() {
    return {
      isDisplaying: this.isDisplaying,
      lastUpdate: this.lastUpdate,
      terminalWidth: this.terminalWidth,
      terminalHeight: this.terminalHeight,
      config: this.config
    };
  }

  /**
   * Force a single dashboard render (for debugging)
   * @returns {string} Dashboard content
   */
  renderOnce() {
    this.collectDashboardData();
    this.buildDisplayBuffer();
    return this.displayBuffer.join('\n');
  }
}

export { MonitoringDashboard };
