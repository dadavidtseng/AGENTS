import { DropboxProvider } from './providers/dropboxProvider.js';
import { GoogleDriveProvider } from './providers/googleDriveProvider.js';
import { BoxProvider } from './providers/boxProvider.js';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

export class CloudStorageManager {
  constructor(config) {
    this.config = config;
    this.providers = {};
    this.initializeProviders();
  }

  initializeProviders() {
    // Initialize Dropbox
    if (this.config.get('DROPBOX_ACCESS_TOKEN')) {
      this.providers.dropbox = new DropboxProvider({
        accessToken: this.config.get('DROPBOX_ACCESS_TOKEN'),
        refreshToken: this.config.get('DROPBOX_REFRESH_TOKEN'),
        clientId: this.config.get('DROPBOX_CLIENT_ID'),
        clientSecret: this.config.get('DROPBOX_CLIENT_SECRET')
      });
    }

    // Initialize Google Drive
    // Check for service account first, then OAuth
    if (this.config.get('GOOGLE_SERVICE_ACCOUNT_KEY') || 
        this.config.get('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')) {
      // Service Account authentication
      this.providers.googledrive = new GoogleDriveProvider({
        serviceAccountKey: this.config.get('GOOGLE_SERVICE_ACCOUNT_KEY'),
        serviceAccountKeyPath: this.config.get('GOOGLE_SERVICE_ACCOUNT_KEY_PATH'),
        sharedFolderName: this.config.get('GOOGLE_SHARED_FOLDER_NAME') || 'KADI'
      });
    } else if (this.config.get('GOOGLE_CLIENT_ID') && 
               this.config.get('GOOGLE_CLIENT_SECRET') && 
               this.config.get('GOOGLE_REFRESH_TOKEN')) {
      // OAuth authentication
      this.providers.googledrive = new GoogleDriveProvider({
        clientId: this.config.get('GOOGLE_CLIENT_ID'),
        clientSecret: this.config.get('GOOGLE_CLIENT_SECRET'),
        refreshToken: this.config.get('GOOGLE_REFRESH_TOKEN')
      });
    }

    // Initialize Box
    if (this.config.get('BOX_CLIENT_ID') && 
        this.config.get('BOX_CLIENT_SECRET')) {
      this.providers.box = new BoxProvider({
        clientId: this.config.get('BOX_CLIENT_ID'),
        clientSecret: this.config.get('BOX_CLIENT_SECRET'),
        accessToken: this.config.get('BOX_ACCESS_TOKEN'),
        refreshToken: this.config.get('BOX_REFRESH_TOKEN')
      });
    }
  }

  getProvider(serviceName) {
    const provider = this.providers[serviceName.toLowerCase()];
    if (!provider) {
      throw new Error(`Provider '${serviceName}' not configured or not supported. Available: ${Object.keys(this.providers).join(', ')}`);
    }
    return provider;
  }

  // ============================================================================
  // FILE OPERATIONS
  // ============================================================================

  async uploadFile(serviceName, localPath, remotePath) {
    const provider = this.getProvider(serviceName);
    return await provider.uploadFile(localPath, remotePath);
  }

  async downloadFile(serviceName, remotePath, localPath) {
    const provider = this.getProvider(serviceName);
    return await provider.downloadFile(remotePath, localPath);
  }

  async getFileInfo(serviceName, remotePath) {
    const provider = this.getProvider(serviceName);
    return await provider.getFile(remotePath);
  }

  async listFiles(serviceName, remotePath = '/', options = {}) {
    const provider = this.getProvider(serviceName);
    return await provider.listFiles(remotePath, options);
  }

  async deleteFile(serviceName, remotePath) {
    const provider = this.getProvider(serviceName);
    return await provider.deleteFile(remotePath);
  }

  async renameFile(serviceName, remotePath, newName) {
    const provider = this.getProvider(serviceName);
    return await provider.renameFile(remotePath, newName);
  }

  async copyFile(serviceName, sourcePath, destinationPath) {
    const provider = this.getProvider(serviceName);
    return await provider.copyFile(sourcePath, destinationPath);
  }

  // ============================================================================
  // FOLDER OPERATIONS
  // ============================================================================

  async createFolder(serviceName, remotePath) {
    const provider = this.getProvider(serviceName);
    return await provider.createFolder(remotePath);
  }

  async listFolders(serviceName, remotePath = '/') {
    const provider = this.getProvider(serviceName);
    return await provider.listFolders(remotePath);
  }

  async deleteFolder(serviceName, remotePath, recursive = false) {
    const provider = this.getProvider(serviceName);
    return await provider.deleteFolder(remotePath, recursive);
  }

  async renameFolder(serviceName, remotePath, newName) {
    const provider = this.getProvider(serviceName);
    return await provider.renameFolder(remotePath, newName);
  }

  async getFolderInfo(serviceName, remotePath) {
    const provider = this.getProvider(serviceName);
    return await provider.getFolder(remotePath);
  }

  // ============================================================================
  // SEARCH OPERATIONS
  // ============================================================================

  async searchFiles(serviceName, query, options = {}) {
    const provider = this.getProvider(serviceName);
    return await provider.searchFiles(query, options);
  }

  // ============================================================================
  // UTILITY OPERATIONS
  // ============================================================================

  async testConnection(serviceName) {
    const provider = this.getProvider(serviceName);
    return await provider.testConnection();
  }

  async validateProvider(serviceName) {
    const provider = this.getProvider(serviceName);
    if (provider.validateConfig) {
      return await provider.validateConfig();
    }
    return { isValid: true, errors: [] };
  }

  getAvailableServices() {
    return Object.keys(this.providers);
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  async uploadMultipleFiles(serviceName, fileList, remoteDirectory = '/') {
    const results = [];
    const errors = [];

    for (const localPath of fileList) {
      try {
        const fileName = path.basename(localPath);
        const remotePath = `${remoteDirectory}/${fileName}`.replace(/\/+/g, '/');
        const result = await this.uploadFile(serviceName, localPath, remotePath);
        results.push({ localPath, remotePath, result });
      } catch (error) {
        errors.push({ localPath, error: error.message });
      }
    }

    return { results, errors };
  }

  async downloadMultipleFiles(serviceName, fileList, localDirectory = './downloads') {
    const results = [];
    const errors = [];

    for (const remotePath of fileList) {
      try {
        const fileName = path.basename(remotePath);
        const localPath = path.join(localDirectory, fileName);
        const result = await this.downloadFile(serviceName, remotePath, localPath);
        results.push({ remotePath, localPath, result });
      } catch (error) {
        errors.push({ remotePath, error: error.message });
      }
    }

    return { results, errors };
  }

  async syncDirectory(serviceName, localDirectory, remoteDirectory, options = {}) {
    const {
      dryRun = false,
      deleteRemote = false,
      overwrite = true
    } = options;

    const results = {
      uploaded: [],
      downloaded: [],
      deleted: [],
      errors: []
    };

    try {
      // Get local files
      const localFiles = await this.getLocalFiles(localDirectory);

      // Get remote files
      const remoteFiles = await this.listFiles(serviceName, remoteDirectory);

      // Upload new/modified local files
      for (const localFile of localFiles) {
        try {
          const relativePath = path.relative(localDirectory, localFile.path);
          const remotePath = `${remoteDirectory}/${relativePath}`.replace(/\/+/g, '/');

          const remoteFile = remoteFiles.find(f => f.path === remotePath);

          if (!remoteFile || (overwrite && localFile.modified > new Date(remoteFile.modifiedTime))) {
            if (!dryRun) {
              const result = await this.uploadFile(serviceName, localFile.path, remotePath);
              results.uploaded.push({ local: localFile.path, remote: remotePath, result });
            } else {
              results.uploaded.push({ local: localFile.path, remote: remotePath, dryRun: true });
            }
          }
        } catch (error) {
          results.errors.push({ operation: 'upload', file: localFile.path, error: error.message });
        }
      }

      // Delete remote files not present locally
      if (deleteRemote) {
        const localPaths = localFiles.map(f =>
          `${remoteDirectory}/${path.relative(localDirectory, f.path)}`.replace(/\/+/g, '/')
        );

        for (const remoteFile of remoteFiles) {
          if (!localPaths.includes(remoteFile.path)) {
            try {
              if (!dryRun) {
                await this.deleteFile(serviceName, remoteFile.path);
                results.deleted.push({ remote: remoteFile.path });
              } else {
                results.deleted.push({ remote: remoteFile.path, dryRun: true });
              }
            } catch (error) {
              results.errors.push({ operation: 'delete', file: remoteFile.path, error: error.message });
            }
          }
        }
      }
    } catch (error) {
      results.errors.push({ operation: 'sync', error: error.message });
    }

    return results;
  }

  async getLocalFiles(directory) {
    const files = [];

    async function walk(dir) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const stats = await fs.promises.stat(fullPath);
          files.push({
            path: fullPath,
            size: stats.size,
            modified: stats.mtime
          });
        }
      }
    }

    await walk(directory);
    return files;
  }

  // ============================================================================
  // URL TRANSFER METHODS
  // ============================================================================

  /**
   * Get a temporary download URL for a file in cloud storage.
   */
  async getDownloadUrl(serviceName, remotePath) {
    const provider = this.getProvider(serviceName);
    return await provider.getDownloadUrl(remotePath);
  }

  /**
   * Download a file from a URL and upload it to cloud storage.
   * Streams the content through a temp file to avoid memory issues with large files.
   */
  async uploadFromUrl(serviceName, sourceUrl, remotePath, authHeader, createFolders) {
    const provider = this.getProvider(serviceName);
    const os = await import('os');
    const tmpFile = path.join(os.default.tmpdir(), `cloud-upload-${Date.now()}-${path.basename(remotePath)}`);

    try {
      // Download from source URL to temp file
      const headers = {};
      if (authHeader) headers['Authorization'] = authHeader;

      const response = await fetch(sourceUrl, { headers });
      if (!response.ok) {
        throw new Error(`Failed to download from source URL: ${response.status} ${response.statusText}`);
      }

      const fileStream = fs.createWriteStream(tmpFile);
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on('error', reject);
        fileStream.on('finish', resolve);
      });

      // Create parent folders if requested
      if (createFolders !== false) {
        const dir = path.dirname(remotePath);
        if (dir && dir !== '/' && dir !== '.') {
          try { await provider.createFolder(dir); } catch (_e) { /* ignore if exists */ }
        }
      }

      // Upload temp file to cloud
      const result = await provider.uploadFile(tmpFile, remotePath);
      return result;
    } finally {
      // Clean up temp file
      try { await fs.promises.unlink(tmpFile); } catch (_e) { /* ignore */ }
    }
  }

  /**
   * Download a file from cloud storage and PUT it to a target URL.
   */
  async downloadToUrl(serviceName, remotePath, targetUrl, authHeader) {
    const provider = this.getProvider(serviceName);
    const os = await import('os');
    const tmpFile = path.join(os.default.tmpdir(), `cloud-download-${Date.now()}-${path.basename(remotePath)}`);

    try {
      // Download from cloud to temp file
      await provider.downloadFile(remotePath, tmpFile);

      // Read and PUT to target URL
      const fileContent = await fs.promises.readFile(tmpFile);
      const headers = { 'Content-Type': 'application/octet-stream' };
      if (authHeader) headers['Authorization'] = authHeader;

      const response = await fetch(targetUrl, {
        method: 'PUT',
        headers,
        body: fileContent,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload to target URL: ${response.status} ${response.statusText}`);
      }

      return { uploaded: true, targetUrl, size: fileContent.length };
    } finally {
      try { await fs.promises.unlink(tmpFile); } catch (_e) { /* ignore */ }
    }
  }

  // ============================================================================
  // OAUTH TOKEN MANAGEMENT METHODS
  // ============================================================================

  /** Provider class map for static method access */
  static providerClasses = {
    dropbox: DropboxProvider,
    googledrive: GoogleDriveProvider,
    box: BoxProvider,
  };

  /**
   * Check token health for one or all providers.
   */
  async getTokenStatus(serviceName, testConnection) {
    const providers = serviceName
      ? { [serviceName]: this.getProvider(serviceName) }
      : this.providers;

    const statuses = {};
    for (const [name, provider] of Object.entries(providers)) {
      const status = {
        configured: true,
        hasAccessToken: !!provider.accessToken,
        hasRefreshToken: !!provider.refreshToken,
        tokenExpiry: provider.tokenExpiry ? new Date(provider.tokenExpiry).toISOString() : null,
        isExpired: provider.tokenExpiry ? Date.now() > provider.tokenExpiry : null,
      };

      if (testConnection) {
        try {
          await provider.testConnection();
          status.connectionOk = true;
        } catch (err) {
          status.connectionOk = false;
          status.connectionError = err.message;
        }
      }

      statuses[name] = status;
    }

    return { providers: statuses };
  }

  /**
   * Force refresh the OAuth access token for a provider.
   */
  async refreshProviderToken(serviceName, testAfterRefresh) {
    const provider = this.getProvider(serviceName);

    if (!provider.refreshToken || !provider.clientId || !provider.clientSecret) {
      throw new Error(`${serviceName} does not have refresh token credentials configured`);
    }

    await provider.refreshAccessToken();

    const result = {
      refreshed: true,
      newExpiry: provider.tokenExpiry ? new Date(provider.tokenExpiry).toISOString() : null,
    };

    if (testAfterRefresh) {
      try {
        await provider.testConnection();
        result.connectionOk = true;
      } catch (err) {
        result.connectionOk = false;
        result.connectionError = err.message;
      }
    }

    return result;
  }

  /**
   * Generate an OAuth authorization URL for a provider.
   */
  generateAuthUrl(serviceName, callbackUrl) {
    const ProviderClass = CloudStorageManager.providerClasses[serviceName?.toLowerCase()];
    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${serviceName}`);
    }
    if (!ProviderClass.generateAuthUrl) {
      throw new Error(`${serviceName} does not support OAuth authorization URL generation`);
    }

    const clientId = this.config.get(`${serviceName.toUpperCase()}_CLIENT_ID`)
      || this.config.get(`${serviceName === 'googledrive' ? 'GOOGLE' : serviceName.toUpperCase()}_CLIENT_ID`);

    if (!clientId) {
      throw new Error(`No client ID configured for ${serviceName}`);
    }

    const url = ProviderClass.generateAuthUrl(clientId, callbackUrl);
    return { url, provider: serviceName };
  }

  /**
   * Exchange an OAuth authorization code for tokens.
   */
  async exchangeCode(serviceName, code, callbackUrl) {
    const ProviderClass = CloudStorageManager.providerClasses[serviceName?.toLowerCase()];
    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${serviceName}`);
    }
    if (!ProviderClass.exchangeCodeForTokens) {
      throw new Error(`${serviceName} does not support OAuth code exchange`);
    }

    const prefix = serviceName === 'googledrive' ? 'GOOGLE' : serviceName.toUpperCase();
    const clientId = this.config.get(`${prefix}_CLIENT_ID`);
    const clientSecret = this.config.get(`${prefix}_CLIENT_SECRET`);

    if (!clientId || !clientSecret) {
      throw new Error(`No client credentials configured for ${serviceName}`);
    }

    const tokens = await ProviderClass.exchangeCodeForTokens(clientId, clientSecret, code, callbackUrl);
    return { provider: serviceName, ...tokens };
  }
}