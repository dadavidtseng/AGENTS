import { DropboxProvider } from './providers/dropboxProvider.js';
import { GoogleDriveProvider } from './providers/googleDriveProvider.js';
import { BoxProvider } from './providers/boxProvider.js';
import path from 'path';
import fs from 'fs';

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
}