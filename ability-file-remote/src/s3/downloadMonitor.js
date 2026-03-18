/**
 * Download Monitor - Phase 4 Implementation
 * 
 * Monitors download completion and tracks progress for auto-shutdown functionality.
 * Integrates with S3HttpServer to provide comprehensive download tracking,
 * completion detection, and progress monitoring for container downloads.
 * 
 * Features:
 * - Expected download tracking (manifests, layers, configs)
 * - Real-time progress monitoring with speed calculations
 * - Download completion detection and verification
 * - Partial download and retry logic
 * - Download analytics and statistics
 * - Event-driven notifications for download lifecycle
 * - Memory-efficient tracking for large download sets
 */

import { EventEmitter } from 'events';
import path from 'path';
import crypto from 'crypto';
import createDebug from 'debug';

const debug = createDebug('kadi:registry:downloads');

class DownloadMonitor extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      // Download tracking settings
      trackPartialDownloads: config.trackPartialDownloads !== false,
      retryFailedDownloads: config.retryFailedDownloads !== false,
      maxRetryAttempts: config.maxRetryAttempts || 3,
      retryDelay: config.retryDelay || 5000, // 5 seconds

      // Progress monitoring settings
      progressUpdateInterval: config.progressUpdateInterval || 1000, // 1 second
      speedCalculationWindow: config.speedCalculationWindow || 10, // 10 samples
      minProgressThreshold: config.minProgressThreshold || 1024, // 1KB minimum for progress update

      // Completion detection settings
      completionCheckInterval: config.completionCheckInterval || 2000, // 2 seconds
      waitForSlowDownloads: config.waitForSlowDownloads !== false,
      slowDownloadThreshold: config.slowDownloadThreshold || 30000, // 30 seconds no progress

      // Memory management
      maxTrackedDownloads: config.maxTrackedDownloads || 1000,
      cleanupInterval: config.cleanupInterval || 30000, // 30 seconds
      historyRetentionTime: config.historyRetentionTime || 3600000, // 1 hour

      ...config
    };

    // Download tracking state
    this.expectedDownloads = new Map(); // downloadId -> expectedDownloadInfo
    this.activeDownloads = new Map(); // downloadId -> activeDownloadInfo  
    this.completedDownloads = new Map(); // downloadId -> completedDownloadInfo
    this.failedDownloads = new Map(); // downloadId -> failedDownloadInfo

    // Progress tracking
    this.downloadProgress = new Map(); // downloadId -> progressInfo
    this.speedHistory = new Map(); // downloadId -> speed samples array

    // Analytics and statistics
    this.statistics = {
      totalExpected: 0,
      totalStarted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalBytes: 0,
      totalBytesTransferred: 0,
      averageSpeed: 0,
      fastestDownload: null,
      slowestDownload: null,
      startTime: null,
      endTime: null
    };

    // Internal state
    this.isMonitoring = false;
    this.progressTimer = null;
    this.completionTimer = null;
    this.cleanupTimer = null;
    this.monitoringStartTime = null;

    this.setupEventHandling();
  }

  // ============================================================================
  // DOWNLOAD EXPECTATION MANAGEMENT
  // ============================================================================

  /**
   * Set expected downloads for monitoring
   * @param {Array} expectedDownloads - Array of expected download objects
   * @param {Object} options - Configuration options
   * @returns {Object} Setup result with tracking info
   */
  setExpectedDownloads(expectedDownloads, options = {}) {
    try {
      this.expectedDownloads.clear();
      this.statistics.totalExpected = 0;
      this.statistics.totalBytes = 0;
      this.statistics.startTime = new Date();

      for (const download of expectedDownloads) {
        const downloadId = this.generateDownloadId(download);
        const expectedInfo = {
          id: downloadId,
          path: download.path || download.key,
          bucket: download.bucket,
          key: download.key,
          expectedSize: download.size || 0,
          type: download.type || 'file', // 'manifest', 'layer', 'config', 'file'
          priority: download.priority || 'normal', // 'high', 'normal', 'low'
          metadata: download.metadata || {},
          addedAt: new Date(),
          ...download
        };

        this.expectedDownloads.set(downloadId, expectedInfo);
        this.statistics.totalExpected++;
        this.statistics.totalBytes += expectedInfo.expectedSize;
      }

      this.emit('expectedDownloadsSet', {
        count: this.statistics.totalExpected,
        totalBytes: this.statistics.totalBytes,
        downloads: Array.from(this.expectedDownloads.values())
      });

      return {
        success: true,
        expectedCount: this.statistics.totalExpected,
        totalBytes: this.statistics.totalBytes,
        downloadIds: Array.from(this.expectedDownloads.keys())
      };
    } catch (error) {
      this.emit('error', { type: 'setExpectedDownloads', error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Add a single expected download
   * @param {Object} download - Download object to add
   * @returns {string} Generated download ID
   */
  addExpectedDownload(download) {
    const downloadId = this.generateDownloadId(download);

    if (this.expectedDownloads.has(downloadId)) {
      this.emit('warning', { type: 'duplicateExpectedDownload', downloadId });
      return downloadId;
    }

    const expectedInfo = {
      id: downloadId,
      path: download.path || download.key,
      bucket: download.bucket,
      key: download.key,
      expectedSize: download.size || 0,
      type: download.type || 'file',
      priority: download.priority || 'normal',
      metadata: download.metadata || {},
      addedAt: new Date(),
      ...download
    };

    this.expectedDownloads.set(downloadId, expectedInfo);
    this.statistics.totalExpected++;
    this.statistics.totalBytes += expectedInfo.expectedSize;

    this.emit('expectedDownloadAdded', expectedInfo);
    return downloadId;
  }

  /**
   * Remove an expected download
   * @param {string} downloadId - Download ID to remove
   * @returns {boolean} Success status
   */
  removeExpectedDownload(downloadId) {
    const expectedInfo = this.expectedDownloads.get(downloadId);
    if (!expectedInfo) {
      return false;
    }

    this.expectedDownloads.delete(downloadId);
    this.statistics.totalExpected--;
    this.statistics.totalBytes -= expectedInfo.expectedSize;

    this.emit('expectedDownloadRemoved', { downloadId, expectedInfo });
    return true;
  }

  // ============================================================================
  // DOWNLOAD TRACKING
  // ============================================================================

  /**
   * Mark a download as started
   * @param {string} downloadId - Download ID
   * @param {Object} downloadInfo - Download start information
   * @returns {Object} Tracking result
   */
  startDownload(downloadId, downloadInfo = {}) {
    try {
      const expectedInfo = this.expectedDownloads.get(downloadId);

      const activeInfo = {
        id: downloadId,
        startTime: new Date(),
        expectedSize: expectedInfo?.expectedSize || downloadInfo.size || 0,
        totalSize: expectedInfo?.expectedSize || downloadInfo.size || 0, // Add totalSize for consistency
        bytesTransferred: 0,
        speed: 0,
        eta: null,
        retryCount: 0,
        lastProgressUpdate: new Date(),
        path: expectedInfo?.path || downloadInfo.path,
        bucket: expectedInfo?.bucket || downloadInfo.bucket,
        key: expectedInfo?.key || downloadInfo.key,
        type: expectedInfo?.type || downloadInfo.type || 'file',
        ...downloadInfo
      };

      this.activeDownloads.set(downloadId, activeInfo);
      this.downloadProgress.set(downloadId, {
        percentage: 0,
        speed: 0,
        eta: null,
        lastUpdate: new Date()
      });
      this.speedHistory.set(downloadId, []);

      this.statistics.totalStarted++;

      this.emit('downloadStarted', activeInfo);

      return {
        success: true,
        downloadId,
        activeInfo
      };
    } catch (error) {
      this.emit('error', { type: 'startDownload', downloadId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Update download progress
   * @param {string} downloadId - Download ID
   * @param {Object} progressUpdate - Progress information
   * @returns {Object} Update result
   */
  updateDownloadProgress(downloadId, progressUpdate) {
    try {
      const activeInfo = this.activeDownloads.get(downloadId);
      if (!activeInfo) {
        return { success: false, error: 'Download not found in active downloads' };
      }

      const now = new Date();
      const timeDelta = now - activeInfo.lastProgressUpdate;
      const bytesDelta = progressUpdate.bytesTransferred - activeInfo.bytesTransferred;

      // Update active download info
      activeInfo.bytesTransferred = progressUpdate.bytesTransferred || activeInfo.bytesTransferred;
      activeInfo.lastProgressUpdate = now;

      // Calculate speed if enough time has passed
      let currentSpeed = 0;
      if (timeDelta > 0 && bytesDelta > 0) {
        currentSpeed = (bytesDelta / timeDelta) * 1000; // bytes per second
        activeInfo.speed = currentSpeed;

        // Update speed history for smoothing
        const speedSamples = this.speedHistory.get(downloadId) || [];
        speedSamples.push({ timestamp: now, speed: currentSpeed });

        // Keep only recent samples
        const cutoff = now - (this.config.speedCalculationWindow * 1000);
        const recentSamples = speedSamples.filter(sample => sample.timestamp > cutoff);
        this.speedHistory.set(downloadId, recentSamples);

        // Calculate average speed
        if (recentSamples.length > 0) {
          const avgSpeed = recentSamples.reduce((sum, sample) => sum + sample.speed, 0) / recentSamples.length;
          activeInfo.speed = avgSpeed;
        }
      }

      // Calculate progress percentage and ETA
      const percentage = activeInfo.expectedSize > 0 ?
        (activeInfo.bytesTransferred / activeInfo.expectedSize) * 100 : 0;

      let eta = null;
      if (activeInfo.speed > 0 && activeInfo.expectedSize > 0) {
        const remainingBytes = activeInfo.expectedSize - activeInfo.bytesTransferred;
        eta = Math.ceil(remainingBytes / activeInfo.speed); // seconds
      }

      activeInfo.eta = eta;

      // Update progress tracking
      const progressInfo = {
        percentage: Math.min(percentage, 100),
        speed: activeInfo.speed,
        eta: eta,
        bytesTransferred: activeInfo.bytesTransferred,
        expectedSize: activeInfo.expectedSize,
        lastUpdate: now
      };
      this.downloadProgress.set(downloadId, progressInfo);

      // Emit progress event if significant change
      if (bytesDelta >= this.config.minProgressThreshold || progressUpdate.force) {
        this.emit('downloadProgress', {
          downloadId,
          ...progressInfo,
          activeInfo
        });
      }

      return {
        success: true,
        downloadId,
        progressInfo
      };
    } catch (error) {
      this.emit('error', { type: 'updateDownloadProgress', downloadId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark a download as completed
   * @param {string} downloadId - Download ID
   * @param {Object} completionInfo - Completion information
   * @returns {Object} Completion result
   */
  completeDownload(downloadId, completionInfo = {}) {
    try {
      const activeInfo = this.activeDownloads.get(downloadId);
      if (!activeInfo) {
        return { success: false, error: 'Download not found in active downloads' };
      }

      const completedInfo = {
        ...activeInfo,
        endTime: new Date(),
        duration: new Date() - activeInfo.startTime,
        finalSize: completionInfo.finalSize || activeInfo.bytesTransferred,
        success: true,
        ...completionInfo
      };

      // Move from active to completed
      this.activeDownloads.delete(downloadId);
      this.completedDownloads.set(downloadId, completedInfo);

      // Clean up tracking data
      this.downloadProgress.delete(downloadId);
      this.speedHistory.delete(downloadId);

      // Update statistics
      this.statistics.totalCompleted++;
      this.statistics.totalBytesTransferred += completedInfo.finalSize;

      // Update speed statistics
      if (completedInfo.duration > 0) {
        const downloadSpeed = completedInfo.finalSize / (completedInfo.duration / 1000);
        if (!this.statistics.fastestDownload || downloadSpeed > this.statistics.fastestDownload.speed) {
          this.statistics.fastestDownload = { downloadId, speed: downloadSpeed, duration: completedInfo.duration };
        }
        if (!this.statistics.slowestDownload || downloadSpeed < this.statistics.slowestDownload.speed) {
          this.statistics.slowestDownload = { downloadId, speed: downloadSpeed, duration: completedInfo.duration };
        }
      }

      this.emit('downloadCompleted', {
        downloadId,
        completedInfo
      });

      // Check if all downloads are complete
      this.checkAllDownloadsComplete();

      return {
        success: true,
        downloadId,
        completedInfo
      };
    } catch (error) {
      this.emit('error', { type: 'completeDownload', downloadId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark a download as failed
   * @param {string} downloadId - Download ID
   * @param {Object} failureInfo - Failure information
   * @returns {Object} Failure result
   */
  failDownload(downloadId, failureInfo = {}) {
    try {
      const activeInfo = this.activeDownloads.get(downloadId);
      if (!activeInfo) {
        return { success: false, error: 'Download not found in active downloads' };
      }

      const failedInfo = {
        ...activeInfo,
        endTime: new Date(),
        duration: new Date() - activeInfo.startTime,
        error: failureInfo.error || 'Unknown error',
        retryable: failureInfo.retryable !== false,
        ...failureInfo
      };

      // Check if retry is possible and configured
      const shouldRetry = this.config.retryFailedDownloads &&
        failedInfo.retryable &&
        activeInfo.retryCount < this.config.maxRetryAttempts;

      if (shouldRetry) {
        // Schedule retry
        setTimeout(() => {
          this.retryDownload(downloadId);
        }, this.config.retryDelay);

        failedInfo.retryScheduled = true;
        failedInfo.nextRetryAt = new Date(Date.now() + this.config.retryDelay);
      } else {
        // Move to failed downloads
        this.activeDownloads.delete(downloadId);
        this.failedDownloads.set(downloadId, failedInfo);

        // Clean up tracking data
        this.downloadProgress.delete(downloadId);
        this.speedHistory.delete(downloadId);

        this.statistics.totalFailed++;
      }

      this.emit('downloadFailed', {
        downloadId,
        failedInfo,
        willRetry: shouldRetry
      });

      return {
        success: true,
        downloadId,
        failedInfo,
        willRetry: shouldRetry
      };
    } catch (error) {
      this.emit('error', { type: 'failDownload', downloadId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Retry a failed download
   * @param {string} downloadId - Download ID to retry
   * @returns {Object} Retry result
   */
  retryDownload(downloadId) {
    try {
      const failedInfo = this.failedDownloads.get(downloadId) || this.activeDownloads.get(downloadId);
      if (!failedInfo) {
        return { success: false, error: 'Download not found' };
      }

      // Increment retry count
      failedInfo.retryCount = (failedInfo.retryCount || 0) + 1;

      // Reset download state
      const retryInfo = {
        ...failedInfo,
        bytesTransferred: 0,
        speed: 0,
        eta: null,
        startTime: new Date(),
        lastProgressUpdate: new Date(),
        retryAttempt: failedInfo.retryCount
      };

      // Move back to active downloads
      this.failedDownloads.delete(downloadId);
      this.activeDownloads.set(downloadId, retryInfo);

      // Reset tracking data
      this.downloadProgress.set(downloadId, {
        percentage: 0,
        speed: 0,
        eta: null,
        lastUpdate: new Date()
      });
      this.speedHistory.set(downloadId, []);

      this.emit('downloadRetry', {
        downloadId,
        retryAttempt: failedInfo.retryCount,
        retryInfo
      });

      return {
        success: true,
        downloadId,
        retryAttempt: failedInfo.retryCount,
        retryInfo
      };
    } catch (error) {
      this.emit('error', { type: 'retryDownload', downloadId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // COMPLETION DETECTION
  // ============================================================================

  /**
   * Check if all expected downloads are complete
   * @returns {Object} Completion status
   */
  isAllDownloadsComplete() {
    const totalExpected = this.statistics.totalExpected;
    const totalCompleted = this.statistics.totalCompleted;
    const totalFailed = this.statistics.totalFailed;
    const activeCount = this.activeDownloads.size;

    const allComplete = totalExpected > 0 &&
      activeCount === 0 &&
      (totalCompleted + totalFailed) >= totalExpected;

    return {
      allComplete,
      totalExpected,
      totalCompleted,
      totalFailed,
      activeCount,
      completionPercentage: totalExpected > 0 ? ((totalCompleted + totalFailed) / totalExpected) * 100 : 100
    };
  }

  /**
   * Get detailed download progress summary
   * @returns {Object} Progress summary
   */
  getDownloadProgress() {
    const status = this.isAllDownloadsComplete();

    // Calculate overall statistics
    const totalBytesExpected = this.statistics.totalBytes;
    const totalBytesTransferred = this.statistics.totalBytesTransferred +
      Array.from(this.activeDownloads.values()).reduce((sum, download) => sum + download.bytesTransferred, 0);

    // If no expected downloads set, calculate based on active downloads
    let overallPercentage;
    if (totalBytesExpected > 0) {
      overallPercentage = (totalBytesTransferred / totalBytesExpected) * 100;
    } else if (this.activeDownloads.size > 0) {
      // Calculate percentage based on active downloads only
      const activeDownloadsArray = Array.from(this.activeDownloads.values());
      const activeTotalExpected = activeDownloadsArray.reduce((sum, download) => sum + (download.totalSize || 0), 0);
      const activeTotalTransferred = activeDownloadsArray.reduce((sum, download) => sum + download.bytesTransferred, 0);
      overallPercentage = activeTotalExpected > 0 ? (activeTotalTransferred / activeTotalExpected) * 100 : 0;
    } else {
      overallPercentage = 100; // No downloads = 100% complete
    }

    // Calculate overall speed from active downloads
    const activeSpeeds = Array.from(this.activeDownloads.values()).map(d => d.speed || 0);
    const overallSpeed = activeSpeeds.reduce((sum, speed) => sum + speed, 0);

    // Calculate ETA for remaining downloads
    let overallETA = null;
    if (overallSpeed > 0 && totalBytesExpected > totalBytesTransferred) {
      overallETA = Math.ceil((totalBytesExpected - totalBytesTransferred) / overallSpeed);
    }

    return {
      ...status,
      overallPercentage: Math.min(overallPercentage, 100),
      totalBytesExpected,
      totalBytesTransferred,
      overallSpeed,
      overallETA,
      activeDownloads: Array.from(this.activeDownloads.values()),
      recentlyCompleted: Array.from(this.completedDownloads.values()).slice(-5),
      failedDownloads: Array.from(this.failedDownloads.values()),
      statistics: { ...this.statistics }
    };
  }

  /**
   * Internal method to check completion and emit events
   */
  checkAllDownloadsComplete() {
    const status = this.isAllDownloadsComplete();

    if (status.allComplete && !this.statistics.endTime) {
      this.statistics.endTime = new Date();
      this.statistics.averageSpeed = this.statistics.totalBytesTransferred > 0 ?
        this.statistics.totalBytesTransferred / ((this.statistics.endTime - this.statistics.startTime) / 1000) : 0;

      this.emit('allDownloadsComplete', {
        ...status,
        duration: this.statistics.endTime - this.statistics.startTime,
        statistics: { ...this.statistics }
      });
    }
  }

  // ============================================================================
  // MONITORING CONTROL
  // ============================================================================

  /**
   * Start download monitoring
   * @param {Object} options - Monitoring options
   * @returns {Object} Start result
   */
  startMonitoring(options = {}) {
    if (this.isMonitoring) {
      return { success: false, error: 'Monitoring already started' };
    }

    this.isMonitoring = true;
    this.monitoringStartTime = new Date();

    // Start progress update timer
    if (this.config.progressUpdateInterval > 0) {
      this.progressTimer = setInterval(() => {
        this.emitProgressUpdate();
      }, this.config.progressUpdateInterval);
    }

    // Start completion check timer
    if (this.config.completionCheckInterval > 0) {
      this.completionTimer = setInterval(() => {
        this.checkAllDownloadsComplete();
        this.checkStaleDownloads();
      }, this.config.completionCheckInterval);
    }

    // Start cleanup timer
    if (this.config.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanupOldData();
      }, this.config.cleanupInterval);
    }

    this.emit('monitoringStarted', {
      startTime: this.monitoringStartTime,
      config: this.config
    });

    return { success: true, startTime: this.monitoringStartTime };
  }

  /**
   * Stop download monitoring
   * @returns {Object} Stop result
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return { success: false, error: 'Monitoring not started' };
    }

    this.isMonitoring = false;

    // Clear timers
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.completionTimer) {
      clearInterval(this.completionTimer);
      this.completionTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

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
  // UTILITY METHODS
  // ============================================================================

  /**
   * Generate a unique download ID
   * @param {Object} download - Download object
   * @returns {string} Generated download ID
   */
  generateDownloadId(download) {
    const idSource = `${download.bucket || 'default'}/${download.key || download.path}`;
    return crypto.createHash('md5').update(idSource).digest('hex').substring(0, 16);
  }

  /**
   * Emit progress update for all active downloads
   */
  emitProgressUpdate() {
    if (this.activeDownloads.size === 0) return;

    const progress = this.getDownloadProgress();
    this.emit('progressUpdate', progress);
  }

  /**
   * Check for stale downloads and handle them
   */
  checkStaleDownloads() {
    const now = new Date();
    const staleThreshold = this.config.slowDownloadThreshold;

    for (const [downloadId, activeInfo] of this.activeDownloads) {
      const timeSinceProgress = now - activeInfo.lastProgressUpdate;

      if (timeSinceProgress > staleThreshold) {
        this.emit('downloadStale', {
          downloadId,
          activeInfo,
          staleDuration: timeSinceProgress
        });

        // Optionally fail stale downloads
        if (!this.config.waitForSlowDownloads) {
          this.failDownload(downloadId, {
            error: 'Download stalled - no progress for too long',
            retryable: true
          });
        }
      }
    }
  }

  /**
   * Clean up old completed and failed download data
   */
  cleanupOldData() {
    const now = new Date();
    const retentionTime = this.config.historyRetentionTime;
    let cleanedCount = 0;

    // Clean up old completed downloads
    for (const [downloadId, completedInfo] of this.completedDownloads) {
      if (now - completedInfo.endTime > retentionTime) {
        this.completedDownloads.delete(downloadId);
        cleanedCount++;
      }
    }

    // Clean up old failed downloads
    for (const [downloadId, failedInfo] of this.failedDownloads) {
      if (now - failedInfo.endTime > retentionTime) {
        this.failedDownloads.delete(downloadId);
        cleanedCount++;
      }
    }

    // Enforce maximum tracked downloads limit
    const totalTracked = this.expectedDownloads.size + this.activeDownloads.size +
      this.completedDownloads.size + this.failedDownloads.size;

    if (totalTracked > this.config.maxTrackedDownloads) {
      // Remove oldest completed downloads first
      const oldestCompleted = Array.from(this.completedDownloads.entries())
        .sort(([, a], [, b]) => a.endTime - b.endTime)
        .slice(0, Math.max(0, totalTracked - this.config.maxTrackedDownloads));

      for (const [downloadId] of oldestCompleted) {
        this.completedDownloads.delete(downloadId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.emit('dataCleanup', { cleanedCount, totalTracked });
    }
  }

  /**
   * Setup event handling and forwarding
   */
  setupEventHandling() {
    // Handle errors gracefully
    this.on('error', (errorInfo) => {
      console.error('📊 DownloadMonitor error:', errorInfo);
    });

    // Log major events in development
    if (process.env.NODE_ENV === 'development') {
      this.on('downloadStarted', (info) => {
        console.log(`📥 Download started: ${info.id} (${info.type})`);
      });

      this.on('downloadCompleted', (info) => {
        console.log(`✅ Download completed: ${info.downloadId} (${info.completedInfo.duration}ms)`);
      });

      this.on('downloadFailed', (info) => {
        console.log(`❌ Download failed: ${info.downloadId} - ${info.failedInfo.error}`);
      });

      this.on('allDownloadsComplete', (info) => {
        console.log(`🎉 All downloads complete! ${info.totalCompleted}/${info.totalExpected} succeeded`);
      });
    }
  }

  /**
   * Get current monitoring statistics
   * @returns {Object} Current statistics
   */
  getStatistics() {
    return {
      ...this.statistics,
      activeDownloads: this.activeDownloads.size,
      completedDownloads: this.completedDownloads.size,
      failedDownloads: this.failedDownloads.size,
      expectedDownloads: this.expectedDownloads.size,
      isMonitoring: this.isMonitoring,
      uptime: this.monitoringStartTime ? new Date() - this.monitoringStartTime : 0
    };
  }

  /**
   * Reset all download tracking state
   * @returns {Object} Reset result
   */
  reset() {
    // Stop monitoring if running
    if (this.isMonitoring) {
      this.stopMonitoring();
    }

    // Clear all tracking data
    this.expectedDownloads.clear();
    this.activeDownloads.clear();
    this.completedDownloads.clear();
    this.failedDownloads.clear();
    this.downloadProgress.clear();
    this.speedHistory.clear();

    // Reset statistics
    this.statistics = {
      totalExpected: 0,
      totalStarted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalBytes: 0,
      totalBytesTransferred: 0,
      averageSpeed: 0,
      fastestDownload: null,
      slowestDownload: null,
      startTime: null,
      endTime: null
    };

    this.emit('reset');

    return { success: true, resetTime: new Date() };
  }
}

export { DownloadMonitor };
