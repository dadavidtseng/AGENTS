/**
 * File Streaming Utilities
 * 
 * Reusable utilities for efficient file streaming with range request support,
 * progress tracking, and proper caching headers. Extracted from TunnelProvider
 * and enhanced for container registry compatibility.
 * 
 * Features:
 * - MIME type detection with extended container formats
 * - Range request parsing and validation  
 * - ETag generation and caching headers
 * - Progress tracking with event emission
 * - Memory-efficient streaming for large files
 * - Error handling and recovery
 */

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

class FileStreamingUtils extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // Default streaming options
      bufferSize: options.bufferSize || 64 * 1024, // 64KB chunks
      progressInterval: options.progressInterval || 1024 * 1024, // 1MB progress updates
      enableETag: options.enableETag !== false, // Default true
      enableLastModified: options.enableLastModified !== false, // Default true
      enableCaching: options.enableCaching !== false, // Default true
      maxCacheAge: options.maxCacheAge || 3600, // 1 hour default cache
      ...options
    };
  }

  // ============================================================================
  // MIME TYPE DETECTION (Enhanced for Container Formats)
  // ============================================================================

  /**
   * Get MIME type for file with enhanced container format support
   * @param {string} filePath - Path to the file
   * @returns {string} MIME type
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Enhanced MIME types including container registry formats
    const mimeTypes = {
      // Text files
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.xml': 'application/xml',
      '.yaml': 'application/x-yaml',
      '.yml': 'application/x-yaml',

      // JavaScript/JSON
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.json': 'application/json',
      '.jsonl': 'application/jsonlines',

      // Images
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',

      // Archives and container formats
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      '.tgz': 'application/gzip',
      '.bz2': 'application/x-bzip2',
      '.xz': 'application/x-xz',
      '.7z': 'application/x-7z-compressed',
      '.rar': 'application/vnd.rar',

      // Container registry specific
      '.layer': 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      '.manifest': 'application/vnd.docker.distribution.manifest.v2+json',
      '.config': 'application/vnd.docker.container.image.v1+json',

      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

      // Audio/Video
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',

      // Programming languages
      '.py': 'text/x-python',
      '.java': 'text/x-java-source',
      '.cpp': 'text/x-c++src',
      '.c': 'text/x-csrc',
      '.h': 'text/x-chdr',
      '.sh': 'application/x-sh',
      '.bat': 'application/x-bat',
      '.ps1': 'application/x-powershell',

      // Configuration files
      '.ini': 'text/plain',
      '.conf': 'text/plain',
      '.cfg': 'text/plain',
      '.env': 'text/plain',
      '.properties': 'text/plain',
      '.dockerfile': 'text/plain'
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  // ============================================================================
  // FILE INFORMATION AND METADATA
  // ============================================================================

  /**
   * Get comprehensive file information
   * @param {string} filePath - Path to the file
   * @returns {Promise<Object>} File information object
   */
  async getFileInfo(filePath) {
    try {
      const stats = await fsPromises.stat(filePath);
      const fileName = path.basename(filePath);
      const fileExt = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(filePath);

      return {
        filePath,
        fileName,
        fileExt,
        mimeType,
        size: stats.size,
        mtime: stats.mtime,
        ctime: stats.ctime,
        atime: stats.atime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        mode: stats.mode,
        uid: stats.uid,
        gid: stats.gid,
        dev: stats.dev,
        ino: stats.ino,
        nlink: stats.nlink,

        // Calculated fields
        etag: this.calculateETag(stats),
        lastModified: stats.mtime.toUTCString(),
        formattedSize: this.formatBytes(stats.size),

        // Additional metadata
        isLargeFile: stats.size > 100 * 1024 * 1024, // > 100MB
        isContainerLayer: this.isContainerLayer(filePath),
        supportedRanges: true // Always true for file streaming
      };
    } catch (error) {
      throw new Error(`Failed to get file info for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Check if file is a container layer based on path/extension
   * @param {string} filePath - Path to check
   * @returns {boolean} True if likely a container layer
   */
  isContainerLayer(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    const isDigestPath = /^[a-f0-9]{64}$/.test(fileName); // SHA256 digest
    const isLayerExt = ['.layer', '.tar', '.gz', '.tgz'].includes(path.extname(filePath).toLowerCase());
    const hasLayerInPath = filePath.toLowerCase().includes('layer');
    const hasDigestInPath = filePath.toLowerCase().includes('sha256');

    return isDigestPath || isLayerExt || hasLayerInPath || hasDigestInPath;
  }

  // ============================================================================
  // ETAG AND CACHING UTILITIES
  // ============================================================================

  /**
   * Calculate ETag for file based on size and modification time
   * @param {fs.Stats} stats - File stats object
   * @returns {string} ETag value
   */
  calculateETag(stats) {
    if (!this.options.enableETag) return null;

    // Use file size and mtime for ETag (similar to Apache/nginx)
    const etag = `"${stats.size.toString(16)}-${stats.mtime.getTime().toString(16)}"`;
    return etag;
  }

  /**
   * Generate comprehensive response headers for file serving
   * @param {Object} fileInfo - File information object
   * @param {Object} options - Additional options
   * @returns {Object} Headers object
   */
  generateResponseHeaders(fileInfo, options = {}) {
    const headers = {
      'Content-Type': fileInfo.mimeType,
      'Content-Length': fileInfo.size.toString(),
      'Accept-Ranges': 'bytes'
    };

    // Add ETag if enabled
    if (this.options.enableETag && fileInfo.etag) {
      headers['ETag'] = fileInfo.etag;
    }

    // Add Last-Modified if enabled
    if (this.options.enableLastModified && fileInfo.lastModified) {
      headers['Last-Modified'] = fileInfo.lastModified;
    }

    // Add caching headers if enabled
    if (this.options.enableCaching) {
      headers['Cache-Control'] = `public, max-age=${this.options.maxCacheAge}`;

      // Add Expires header (HTTP/1.0 compatibility)
      const expires = new Date(Date.now() + this.options.maxCacheAge * 1000);
      headers['Expires'] = expires.toUTCString();
    } else {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    // Add additional headers from options
    if (options.additionalHeaders) {
      Object.assign(headers, options.additionalHeaders);
    }

    // Content-Disposition for downloads
    if (options.forceDownload) {
      headers['Content-Disposition'] = `attachment; filename="${fileInfo.fileName}"`;
    } else if (options.inlineDisposition !== false) {
      headers['Content-Disposition'] = `inline; filename="${fileInfo.fileName}"`;
    }

    return headers;
  }

  // ============================================================================
  // RANGE REQUEST PROCESSING
  // ============================================================================

  /**
   * Parse HTTP Range header with comprehensive validation
   * @param {string} rangeHeader - Range header value
   * @param {number} fileSize - Total file size
   * @returns {Array<Object>|null} Array of range objects or null if invalid
   */
  parseRangeHeader(rangeHeader, fileSize) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
      return null;
    }

    const ranges = [];
    const rangeSpec = rangeHeader.replace(/bytes=/, '').split(',');

    for (const spec of rangeSpec) {
      const range = this.parseRangeSpec(spec.trim(), fileSize);
      if (range) {
        ranges.push(range);
      }
    }

    return ranges.length > 0 ? ranges : null;
  }

  /**
   * Parse individual range specification
   * @param {string} spec - Range specification (e.g., "0-1023", "-500", "1000-")
   * @param {number} fileSize - Total file size
   * @returns {Object|null} Range object or null if invalid
   */
  parseRangeSpec(spec, fileSize) {
    const parts = spec.split('-');
    if (parts.length !== 2) return null;

    let start = parts[0] ? parseInt(parts[0], 10) : null;
    let end = parts[1] ? parseInt(parts[1], 10) : null;

    // Check for NaN values (invalid input)
    if ((parts[0] && isNaN(start)) || (parts[1] && isNaN(end))) {
      return null;
    }

    // Suffix range: -500 (last 500 bytes)
    if (start === null && end !== null) {
      start = Math.max(0, fileSize - end);
      end = fileSize - 1;
    }
    // Prefix range: 1000- (from byte 1000 to end)
    else if (start !== null && end === null) {
      end = fileSize - 1;
    }
    // Full range: 1000-2000
    else if (start !== null && end !== null) {
      // Validate range
      if (start > end || start >= fileSize || end >= fileSize) {
        return null;
      }
    } else {
      return null; // Invalid format
    }

    // Final validation
    if (start < 0 || end < 0 || start >= fileSize || end >= fileSize || start > end) {
      return null;
    }

    return {
      start,
      end,
      length: end - start + 1
    };
  }

  /**
   * Format Content-Range header value
   * @param {number} start - Range start byte
   * @param {number} end - Range end byte  
   * @param {number} total - Total file size
   * @returns {string} Content-Range header value
   */
  formatContentRange(start, end, total) {
    return `bytes ${start}-${end}/${total}`;
  }

  /**
   * Validate range request against file size
   * @param {Array<Object>} ranges - Array of range objects
   * @param {number} fileSize - Total file size
   * @returns {boolean} True if all ranges are valid
   */
  validateRanges(ranges, fileSize) {
    if (!ranges || ranges.length === 0) return false;

    return ranges.every(range => {
      return range.start >= 0 &&
        range.end < fileSize &&
        range.start <= range.end &&
        range.length > 0;
    });
  }

  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================

  /**
   * Format bytes to human readable format
   * @param {number} bytes - Number of bytes
   * @param {number} decimals - Number of decimal places
   * @returns {string} Formatted size string
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Format duration in milliseconds to human readable format
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration string
   */
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  /**
   * Calculate transfer speed
   * @param {number} bytes - Number of bytes transferred
   * @param {number} timeMs - Time taken in milliseconds
   * @returns {number} Speed in bytes per second
   */
  calculateSpeed(bytes, timeMs) {
    if (timeMs === 0) return 0;
    return bytes / (timeMs / 1000);
  }

  /**
   * Generate unique operation ID
   * @returns {string} Unique ID
   */
  generateOperationId() {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// ENHANCED FILE STREAMING WITH PROGRESS TRACKING
// ============================================================================

/**
 * Enhanced file streaming class with progress tracking and error recovery
 */
class FileStreamer extends EventEmitter {
  constructor(fileStreamingUtils, options = {}) {
    super();

    this.utils = fileStreamingUtils;
    this.options = {
      bufferSize: options.bufferSize || 64 * 1024, // 64KB chunks
      progressInterval: options.progressInterval || 1024 * 1024, // 1MB
      timeout: options.timeout || 30000, // 30 seconds
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };

    this.activeStreams = new Map(); // Track active streaming operations
  }

  /**
   * Create enhanced read stream with range support and progress tracking
   * @param {string} filePath - Path to file
   * @param {Object} options - Streaming options
   * @returns {Promise<Object>} Stream information and control object
   */
  async createReadStream(filePath, options = {}) {
    const operationId = this.utils.generateOperationId();
    const fileInfo = await this.utils.getFileInfo(filePath);

    // Parse range if provided
    let range = null;
    if (options.range) {
      const ranges = this.utils.parseRangeHeader(options.range, fileInfo.size);
      if (ranges && ranges.length > 0) {
        range = ranges[0]; // Use first range for now
      }
    }

    // Calculate stream parameters
    const start = range ? range.start : 0;
    const end = range ? range.end : fileInfo.size - 1;
    const streamLength = end - start + 1;

    // Create read stream with options
    const streamOptions = {
      start,
      end,
      highWaterMark: this.options.bufferSize
    };

    const readStream = fs.createReadStream(filePath, streamOptions);

    // Create stream tracking object
    const streamInfo = {
      operationId,
      filePath,
      fileInfo,
      range,
      streamLength,
      bytesTransferred: 0,
      startTime: Date.now(),
      lastProgressUpdate: 0,
      speed: 0,
      estimatedTimeRemaining: 0,
      completed: false,
      error: null,
      stream: readStream
    };

    // Store in active streams
    this.activeStreams.set(operationId, streamInfo);

    // Set up progress tracking
    this.setupProgressTracking(streamInfo, options);

    // Set up error handling
    this.setupErrorHandling(streamInfo, options);

    return {
      operationId,
      stream: readStream,
      fileInfo,
      range,
      streamLength,
      cancel: () => this.cancelStream(operationId),
      getProgress: () => this.getStreamProgress(operationId)
    };
  }

  /**
   * Set up progress tracking for stream
   * @private
   */
  setupProgressTracking(streamInfo, options) {
    const { operationId, stream, streamLength, fileInfo } = streamInfo;

    stream.on('data', (chunk) => {
      streamInfo.bytesTransferred += chunk.length;

      const now = Date.now();
      const elapsed = now - streamInfo.startTime;

      // Calculate current speed
      if (elapsed > 0) {
        streamInfo.speed = streamInfo.bytesTransferred / (elapsed / 1000);
      }

      // Calculate estimated time remaining
      if (streamInfo.speed > 0) {
        const remaining = streamLength - streamInfo.bytesTransferred;
        streamInfo.estimatedTimeRemaining = (remaining / streamInfo.speed) * 1000;
      }

      // Emit progress events
      const shouldEmitProgress = (
        streamInfo.bytesTransferred - streamInfo.lastProgressUpdate >= this.options.progressInterval ||
        streamInfo.bytesTransferred === chunk.length || // First chunk
        streamInfo.bytesTransferred >= streamLength // Last chunk
      );

      if (shouldEmitProgress) {
        const progress = {
          operationId,
          filePath: streamInfo.filePath,
          fileName: fileInfo.fileName,
          bytesTransferred: streamInfo.bytesTransferred,
          totalBytes: streamLength,
          percentage: Math.round((streamInfo.bytesTransferred / streamLength) * 100),
          speed: streamInfo.speed,
          speedFormatted: this.utils.formatBytes(streamInfo.speed) + '/s',
          estimatedTimeRemaining: streamInfo.estimatedTimeRemaining,
          elapsed: elapsed,
          isRangeRequest: !!streamInfo.range,
          timestamp: new Date()
        };

        this.emit('progress', progress);
        streamInfo.lastProgressUpdate = streamInfo.bytesTransferred;
      }
    });

    stream.on('end', () => {
      if (streamInfo.completed) return;
      streamInfo.completed = true;

      const elapsed = Date.now() - streamInfo.startTime;
      const finalSpeed = streamInfo.bytesTransferred / (elapsed / 1000);

      const completion = {
        operationId,
        filePath: streamInfo.filePath,
        fileName: fileInfo.fileName,
        bytesTransferred: streamInfo.bytesTransferred,
        totalBytes: streamLength,
        duration: elapsed,
        speed: finalSpeed,
        speedFormatted: this.utils.formatBytes(finalSpeed) + '/s',
        durationFormatted: this.utils.formatDuration(elapsed),
        isRangeRequest: !!streamInfo.range,
        success: true,
        timestamp: new Date()
      };

      this.emit('complete', completion);
      this.activeStreams.delete(operationId);
    });
  }

  /**
   * Set up error handling for stream
   * @private
   */
  setupErrorHandling(streamInfo, options) {
    const { operationId, stream } = streamInfo;

    stream.on('error', (error) => {
      streamInfo.error = error;
      streamInfo.completed = true;

      const errorInfo = {
        operationId,
        filePath: streamInfo.filePath,
        error: error.message,
        errorCode: error.code,
        bytesTransferred: streamInfo.bytesTransferred,
        totalBytes: streamInfo.streamLength,
        elapsed: Date.now() - streamInfo.startTime,
        timestamp: new Date()
      };

      this.emit('error', errorInfo);
      this.activeStreams.delete(operationId);
    });

    // Set up timeout if specified
    if (this.options.timeout > 0) {
      const timeout = setTimeout(() => {
        if (!streamInfo.completed) {
          const timeoutError = new Error(`Stream timeout after ${this.options.timeout}ms`);
          stream.destroy(timeoutError);
        }
      }, this.options.timeout);

      stream.on('end', () => clearTimeout(timeout));
      stream.on('error', () => clearTimeout(timeout));
    }
  }

  /**
   * Cancel active stream
   * @param {string} operationId - Operation ID to cancel
   */
  cancelStream(operationId) {
    const streamInfo = this.activeStreams.get(operationId);
    if (streamInfo && !streamInfo.completed) {
      streamInfo.stream.destroy();
      streamInfo.completed = true;

      this.emit('cancelled', {
        operationId,
        filePath: streamInfo.filePath,
        bytesTransferred: streamInfo.bytesTransferred,
        totalBytes: streamInfo.streamLength,
        timestamp: new Date()
      });

      this.activeStreams.delete(operationId);
    }
  }

  /**
   * Get progress of active stream
   * @param {string} operationId - Operation ID
   * @returns {Object|null} Progress information
   */
  getStreamProgress(operationId) {
    const streamInfo = this.activeStreams.get(operationId);
    if (!streamInfo) return null;

    const elapsed = Date.now() - streamInfo.startTime;

    return {
      operationId,
      filePath: streamInfo.filePath,
      fileName: streamInfo.fileInfo.fileName,
      bytesTransferred: streamInfo.bytesTransferred,
      totalBytes: streamInfo.streamLength,
      percentage: Math.round((streamInfo.bytesTransferred / streamInfo.streamLength) * 100),
      speed: streamInfo.speed,
      speedFormatted: this.utils.formatBytes(streamInfo.speed) + '/s',
      estimatedTimeRemaining: streamInfo.estimatedTimeRemaining,
      elapsed: elapsed,
      elapsedFormatted: this.utils.formatDuration(elapsed),
      isRangeRequest: !!streamInfo.range,
      completed: streamInfo.completed,
      timestamp: new Date()
    };
  }

  /**
   * List all active streams
   * @returns {Array<Object>} Array of active stream progress information
   */
  listActiveStreams() {
    return Array.from(this.activeStreams.keys()).map(id => this.getStreamProgress(id));
  }

  /**
   * Cancel all active streams
   */
  cancelAllStreams() {
    const activeIds = Array.from(this.activeStreams.keys());
    activeIds.forEach(id => this.cancelStream(id));
  }
}

// ============================================================================
// DOWNLOAD PROGRESS TRACKER
// ============================================================================

/**
 * Download progress tracking and monitoring class
 */
class DownloadTracker extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      trackingInterval: options.trackingInterval || 1000, // 1 second
      historySize: options.historySize || 100, // Keep last 100 download records
      enableRealTimeStats: options.enableRealTimeStats !== false,
      ...options
    };

    this.downloads = new Map(); // Active downloads
    this.history = []; // Completed download history
    this.stats = {
      totalDownloads: 0,
      totalBytes: 0,
      totalDuration: 0,
      averageSpeed: 0,
      activeDownloads: 0,
      completedDownloads: 0,
      failedDownloads: 0
    };

    // Start real-time tracking if enabled
    if (this.options.enableRealTimeStats) {
      this.startRealTimeTracking();
    }
  }

  /**
   * Start tracking a download
   * @param {Object} downloadInfo - Download information
   * @returns {string} Download tracking ID
   */
  startTracking(downloadInfo) {
    const trackingId = `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const download = {
      trackingId,
      startTime: Date.now(),
      ...downloadInfo,
      bytesTransferred: 0,
      speed: 0,
      percentage: 0,
      status: 'active',
      lastUpdate: Date.now()
    };

    this.downloads.set(trackingId, download);
    this.stats.activeDownloads++;

    this.emit('downloadStarted', { trackingId, download });

    return trackingId;
  }

  /**
   * Update download progress
   * @param {string} trackingId - Download tracking ID
   * @param {Object} progress - Progress information
   */
  updateProgress(trackingId, progress) {
    const download = this.downloads.get(trackingId);
    if (!download || download.status !== 'active') return;

    const now = Date.now();
    const elapsed = now - download.startTime;

    // Update download information
    Object.assign(download, {
      bytesTransferred: progress.bytesTransferred || download.bytesTransferred,
      totalBytes: progress.totalBytes || download.totalBytes,
      speed: progress.speed || (elapsed > 0 ? download.bytesTransferred / (elapsed / 1000) : 0),
      percentage: progress.percentage || (download.totalBytes > 0 ?
        Math.round((download.bytesTransferred / download.totalBytes) * 100) : 0),
      estimatedTimeRemaining: progress.estimatedTimeRemaining,
      lastUpdate: now
    });

    this.emit('downloadProgress', { trackingId, download, progress });
  }

  /**
   * Complete a download
   * @param {string} trackingId - Download tracking ID
   * @param {Object} completionInfo - Completion information
   */
  completeDownload(trackingId, completionInfo = {}) {
    const download = this.downloads.get(trackingId);
    if (!download) return;

    const now = Date.now();
    const duration = now - download.startTime;
    const finalSpeed = download.bytesTransferred / (duration / 1000);

    // Update download status
    Object.assign(download, {
      status: 'completed',
      endTime: now,
      duration: duration,
      speed: finalSpeed,
      percentage: 100,
      ...completionInfo
    });

    // Move to history
    this.history.unshift(download);
    if (this.history.length > this.options.historySize) {
      this.history.pop();
    }

    // Update stats
    this.stats.activeDownloads--;
    this.stats.completedDownloads++;
    this.stats.totalDownloads++;
    this.stats.totalBytes += download.bytesTransferred;
    this.stats.totalDuration += duration;
    this.stats.averageSpeed = this.stats.totalBytes / (this.stats.totalDuration / 1000);

    this.downloads.delete(trackingId);

    this.emit('downloadCompleted', { trackingId, download });
  }

  /**
   * Fail a download
   * @param {string} trackingId - Download tracking ID
   * @param {Object} errorInfo - Error information
   */
  failDownload(trackingId, errorInfo = {}) {
    const download = this.downloads.get(trackingId);
    if (!download) return;

    const now = Date.now();
    const duration = now - download.startTime;

    // Update download status
    Object.assign(download, {
      status: 'failed',
      endTime: now,
      duration: duration,
      error: errorInfo.error || 'Unknown error',
      errorCode: errorInfo.errorCode,
      ...errorInfo
    });

    // Move to history
    this.history.unshift(download);
    if (this.history.length > this.options.historySize) {
      this.history.pop();
    }

    // Update stats
    this.stats.activeDownloads--;
    this.stats.failedDownloads++;

    this.downloads.delete(trackingId);

    this.emit('downloadFailed', { trackingId, download, error: errorInfo });
  }

  /**
   * Get download information
   * @param {string} trackingId - Download tracking ID
   * @returns {Object|null} Download information
   */
  getDownload(trackingId) {
    return this.downloads.get(trackingId) || null;
  }

  /**
   * List active downloads
   * @returns {Array<Object>} Array of active downloads
   */
  listActiveDownloads() {
    return Array.from(this.downloads.values());
  }

  /**
   * Get download history
   * @param {number} limit - Maximum number of records to return
   * @returns {Array<Object>} Array of historical downloads
   */
  getHistory(limit = 50) {
    return this.history.slice(0, limit);
  }

  /**
   * Get overall statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Start real-time tracking updates
   * @private
   */
  startRealTimeTracking() {
    this.trackingInterval = setInterval(() => {
      const now = Date.now();

      // Check for stalled downloads (no updates for 30 seconds)
      for (const [trackingId, download] of this.downloads.entries()) {
        if (now - download.lastUpdate > 30000) {
          this.failDownload(trackingId, {
            error: 'Download stalled - no progress updates received',
            errorCode: 'STALLED'
          });
        }
      }

      // Emit real-time stats
      this.emit('statsUpdate', this.getStats());

    }, this.options.trackingInterval);
  }

  /**
   * Stop real-time tracking
   */
  stopRealTimeTracking() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
  }

  /**
   * Cleanup and shutdown
   */
  shutdown() {
    this.stopRealTimeTracking();
    this.downloads.clear();
    this.emit('shutdown');
  }
}

export {
  FileStreamingUtils,
  FileStreamer,
  DownloadTracker
};
