import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';

class DropboxProvider {
  constructor(config) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = 'https://api.dropboxapi.com/2';
    this.contentUrl = 'https://content.dropboxapi.com/2';
    this.tokenExpiry = null;
    
    // If we have an access token but no expiry, assume it might expire soon
    if (this.accessToken && !this.tokenExpiry) {
      // Set a conservative expiry time (3 hours from now) for existing tokens
      this.tokenExpiry = Date.now() + (3 * 60 * 60 * 1000);
    }
  }

  // ============================================================================
  // AUTHENTICATION METHODS
  // ============================================================================

  async ensureAccessToken() {
    // Proactive refresh: refresh 5 minutes before expiration
    const refreshBuffer = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    // If we have a valid token that's not expiring soon, use it
    if (this.accessToken && this.tokenExpiry && Date.now() < (this.tokenExpiry - refreshBuffer)) {
      return this.accessToken;
    }

    // If we have refresh token credentials, use them to get a new access token
    if (this.refreshToken && this.clientId && this.clientSecret) {
      console.log('🔄 Refreshing Dropbox access token...');
      return await this.refreshAccessToken();
    }

    // If we only have an access token, try to use it but warn about expiration
    if (this.accessToken) {
      const timeLeft = this.tokenExpiry ? Math.max(0, this.tokenExpiry - Date.now()) : 0;
      const hoursLeft = Math.round(timeLeft / (60 * 60 * 1000));
      
      if (timeLeft > 0) {
        console.warn(`⚠️  Using Dropbox access token that expires in ~${hoursLeft} hour(s). Consider setting up OAuth refresh tokens for long-running processes.`);
      } else {
        console.warn('⚠️  Dropbox access token may be expired. Consider setting up OAuth refresh tokens.');
      }
      
      return this.accessToken;
    }

    throw new Error('No valid Dropbox credentials available. Please configure DROPBOX_ACCESS_TOKEN or set up OAuth with refresh tokens.');
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Missing OAuth credentials for token refresh. Need DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET, and DROPBOX_REFRESH_TOKEN.');
    }

    try {
      const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        
        // Try to parse error response
        let errorDetails = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetails = errorJson.error_description || errorJson.error || errorText;
        } catch (e) {
          // Use raw text if not JSON
        }
        
        throw new Error(`Dropbox token refresh failed: ${response.status} - ${errorDetails}`);
      }

      const tokenData = await response.json();
      
      // Update our tokens
      const oldAccessToken = this.accessToken;
      this.accessToken = tokenData.access_token;
      
      // Update refresh token if a new one was provided (Dropbox typically doesn't rotate refresh tokens)
      if (tokenData.refresh_token) {
        this.refreshToken = tokenData.refresh_token;
      }
      
      // Set expiry time (Dropbox tokens typically last 4 hours)
      const expiresIn = tokenData.expires_in || (4 * 60 * 60); // Default to 4 hours
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      
      const hoursUntilExpiry = Math.round(expiresIn / 3600);
      console.log(`✅ Dropbox access token refreshed. Expires in ${hoursUntilExpiry} hour(s).`);
      
      // Save updated tokens back to config if possible
      await this.saveUpdatedTokens();
      
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to refresh Dropbox token:', error.message);
      
      // If refresh fails but we have an old token, try to use it one more time
      if (this.accessToken) {
        console.warn('⚠️  Attempting to continue with existing token...');
        return this.accessToken;
      }
      
      throw new Error(`Failed to refresh Dropbox token: ${error.message}`);
    }
  }

  async saveUpdatedTokens() {
    // Try to update the .env file with new tokens
    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      
      try {
        envContent = await fs.promises.readFile(envPath, 'utf8');
      } catch (error) {
        // .env file doesn't exist, create new content
        envContent = '# Dropbox Configuration\n';
      }
      
      // Update or add the access token
      const accessTokenRegex = /^DROPBOX_ACCESS_TOKEN=.*$/m;
      const newAccessTokenLine = `DROPBOX_ACCESS_TOKEN=${this.accessToken}`;
      
      if (accessTokenRegex.test(envContent)) {
        envContent = envContent.replace(accessTokenRegex, newAccessTokenLine);
      } else {
        envContent += `\n${newAccessTokenLine}`;
      }
      
      // Update refresh token if we have a new one
      if (this.refreshToken) {
        const refreshTokenRegex = /^DROPBOX_REFRESH_TOKEN=.*$/m;
        const newRefreshTokenLine = `DROPBOX_REFRESH_TOKEN=${this.refreshToken}`;
        
        if (refreshTokenRegex.test(envContent)) {
          envContent = envContent.replace(refreshTokenRegex, newRefreshTokenLine);
        } else {
          envContent += `\n${newRefreshTokenLine}`;
        }
      }

      await fs.promises.writeFile(envPath, envContent);
      console.log('💾 Updated .env file with new Dropbox tokens');
    } catch (error) {
      console.warn('⚠️  Could not save updated tokens to .env file:', error.message);
      console.log('📝 New access token (save manually if needed):', this.accessToken);
    }
  }

  async testConnection() {
    const response = await this.makeRequest('/users/get_current_account', {
      method: 'POST',
      body: JSON.stringify(null)
    });

    const spaceUsage = await this.makeRequest('/users/get_space_usage', {
      method: 'POST',
      body: JSON.stringify(null)
    });

    return {
      user: response.name.display_name,
      email: response.email,
      quota: {
        used: spaceUsage.used,
        total: spaceUsage.allocation.allocated
      }
    };
  }

  validateConfig() {
    const errors = [];
    const warnings = [];
    
    if (!this.accessToken && !this.refreshToken) {
      errors.push('Either DROPBOX_ACCESS_TOKEN or DROPBOX_REFRESH_TOKEN is required');
    }
    
    if (this.refreshToken && (!this.clientId || !this.clientSecret)) {
      errors.push('DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET are required when using DROPBOX_REFRESH_TOKEN');
    }
    
    if (this.accessToken && !this.refreshToken) {
      warnings.push('Using access token without refresh token. Token will expire after 4 hours. Consider setting up OAuth with refresh tokens for long-running processes.');
    }
    
    if (this.refreshToken && this.clientId && this.clientSecret) {
      console.log('✅ Dropbox configured with OAuth refresh tokens - suitable for long-running processes');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ============================================================================
  // OAUTH SETUP HELPERS
  // ============================================================================

  static generateAuthUrl(clientId, redirectUri = 'http://localhost:8080/callback') {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      token_access_type: 'offline' // This requests a refresh token
    });
    
    return `https://www.dropbox.com/oauth2/authorize?${params.toString()}`;
  }

  static async exchangeCodeForTokens(clientId, clientSecret, code, redirectUri = 'http://localhost:8080/callback') {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();
    
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in
    };
  }

  // ============================================================================
  // HTTP REQUEST METHODS
  // ============================================================================

  async makeRequest(endpoint, options = {}) {
    await this.ensureAccessToken();
    
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    const requestOptions = { ...options, headers };

    // Ensure we always have a body for POST requests
    if (options.method === 'POST' && !options.body) {
      requestOptions.body = JSON.stringify(null);
    }

    const response = await fetch(url, requestOptions);

    // Handle token expiration - automatic retry with refresh
    if (response.status === 401) {
      console.log('🔄 Access token expired during request, attempting to refresh...');
      
      if (this.refreshToken && this.clientId && this.clientSecret) {
        try {
          await this.refreshAccessToken();
          
          // Retry the request with new token
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(url, { ...requestOptions, headers });
          
          if (!retryResponse.ok) {
            const error = await retryResponse.text();
            throw new Error(`Dropbox API error after token refresh: ${retryResponse.status} - ${error}`);
          }
          
          return retryResponse.json();
        } catch (refreshError) {
          throw new Error(`Token refresh failed during request: ${refreshError.message}`);
        }
      } else {
        throw new Error('Dropbox access token expired and no refresh token available. Please re-authenticate.');
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dropbox API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async makeContentRequest(endpoint, options = {}) {
    await this.ensureAccessToken();
    
    const url = `${this.contentUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/octet-stream',
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });

    // Handle token expiration for content requests too
    if (response.status === 401 && this.refreshToken && this.clientId && this.clientSecret) {
      console.log('🔄 Access token expired during upload, attempting to refresh...');
      
      try {
        await this.refreshAccessToken();
        
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        
        if (!retryResponse.ok) {
          const error = await retryResponse.text();
          throw new Error(`Dropbox API error after token refresh: ${retryResponse.status} - ${error}`);
        }
        
        return retryResponse;
      } catch (refreshError) {
        throw new Error(`Token refresh failed during content request: ${refreshError.message}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dropbox API error: ${response.status} - ${error}`);
    }

    return response;
  }

  // ============================================================================
  // PATH MANAGEMENT METHODS
  // ============================================================================

  normalizePath(path) {
    if (!path || path === '/') return '';
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return path.replace(/\/+/g, '/').replace(/\/$/, '');
  }

  async ensureFolderExists(remotePath) {
    if (!remotePath || remotePath === '/' || remotePath === '') {
      return; // Root folder always exists
    }
    
    remotePath = this.normalizePath(remotePath);
    
    try {
      await this.getFolder(remotePath);
      return; // Folder exists
    } catch (error) {
      if (this.isFolderNotFoundError(error)) {
        // Create folder hierarchy
        const parts = remotePath.split('/').filter(p => p);
        let currentPath = '';
        
        for (const part of parts) {
          currentPath += '/' + part;
          try {
            await this.createFolder(currentPath);
          } catch (createError) {
            if (!this.isFolderExistsError(createError)) {
              throw createError;
            }
          }
        }
      } else {
        throw error;
      }
    }
  }

  // ============================================================================
  // FOLDER OPERATIONS (CRUD)
  // ============================================================================

  async createFolder(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    try {
      const response = await this.makeRequest('/files/create_folder_v2', {
        method: 'POST',
        body: JSON.stringify({
          path: remotePath,
          autorename: false
        })
      });
      
      return {
        id: response.metadata.id,
        name: response.metadata.name,
        path: remotePath
      };
    } catch (error) {
      if (this.isFolderExistsError(error)) {
        return { path: remotePath };
      }
      throw error;
    }
  }

  async getFolder(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    const response = await this.makeRequest('/files/get_metadata', {
      method: 'POST',
      body: JSON.stringify({
        path: remotePath,
        include_media_info: false,
        include_deleted: false
      })
    });

    if (response['.tag'] !== 'folder') {
      throw new Error(`Path is not a folder: ${remotePath}`);
    }

    return {
      id: response.id,
      name: response.name,
      path: remotePath,
      modifiedTime: response.server_modified || null,
      itemCount: 0 // Dropbox doesn't provide item count in metadata
    };
  }

  async listFolders(remotePath = '/') {
    remotePath = this.normalizePath(remotePath);
    
    const response = await this.makeRequest('/files/list_folder', {
      method: 'POST',
      body: JSON.stringify({
        path: remotePath,
        recursive: false,
        include_media_info: false,
        include_deleted: false
      })
    });

    return response.entries
      .filter(entry => entry['.tag'] === 'folder')
      .map(folder => ({
        id: folder.id,
        name: folder.name,
        path: `${remotePath}/${folder.name}`.replace(/\/+/g, '/'),
        modifiedTime: folder.server_modified || null,
        itemCount: 0
      }));
  }

  async deleteFolder(remotePath, recursive = true) {
    remotePath = this.normalizePath(remotePath);
    
    const response = await this.makeRequest('/files/delete_v2', {
      method: 'POST',
      body: JSON.stringify({
        path: remotePath
      })
    });

    return { 
      deleted: true, 
      path: remotePath 
    };
  }

  async renameFolder(remotePath, newName) {
    remotePath = this.normalizePath(remotePath);
    const newPath = `${path.dirname(remotePath)}/${newName}`.replace(/\/+/g, '/');
    
    const response = await this.makeRequest('/files/move_v2', {
      method: 'POST',
      body: JSON.stringify({
        from_path: remotePath,
        to_path: newPath,
        allow_shared_folder: false,
        autorename: false
      })
    });

    return {
      id: response.metadata.id,
      name: response.metadata.name,
      oldPath: remotePath,
      newPath: newPath
    };
  }

  // ============================================================================
  // FILE OPERATIONS (CRUD)
  // ============================================================================

  async uploadFile(localPath, remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    // Ensure the target directory exists
    const remoteDir = path.dirname(remotePath);
    if (remoteDir && remoteDir !== '/' && remoteDir !== '.') {
      await this.ensureFolderExists(remoteDir);
    }
    
    const fileContent = await fs.promises.readFile(localPath);
    const stats = await fs.promises.stat(localPath);
    
    console.log(`📤 Uploading ${path.basename(localPath)} (${this.formatBytes(stats.size)}) to ${remotePath}`);
    
    // For files larger than 150MB, we should use upload sessions
    if (stats.size > this.getChunkThreshold()) {
      return this.uploadLargeFile(fileContent, remotePath, stats.size);
    }

    const response = await this.makeContentRequest('/files/upload', {
      method: 'POST',
      headers: {
        'Dropbox-API-Arg': JSON.stringify({
          path: remotePath,
          mode: 'overwrite',
          autorename: false
        }),
        'Content-Type': 'application/octet-stream'
      },
      body: fileContent
    });

    const result = await response.json();
    console.log(`✅ Upload completed: ${result.name}`);
    
    return {
      id: result.id,
      name: result.name,
      path: remotePath,
      size: result.size,
      hash: result.content_hash || null
    };
  }

  async uploadLargeFile(fileContent, remotePath, fileSize) {
    const chunkSize = this.getChunkSize();
    
    console.log(`📤 Starting chunked upload for large file (${this.formatBytes(fileSize)})`);
    
    // Start upload session
    const sessionStart = await this.makeContentRequest('/files/upload_session/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: fileContent.slice(0, chunkSize)
    });
    
    const session = await sessionStart.json();
    let offset = chunkSize;
    
    // Upload remaining chunks
    while (offset < fileContent.length) {
      const chunk = fileContent.slice(offset, offset + chunkSize);
      const isLast = offset + chunk.length >= fileContent.length;
      
      console.log(`📤 Uploading chunk ${Math.floor(offset / chunkSize) + 1}/${Math.ceil(fileContent.length / chunkSize)}`);
      
      if (isLast) {
        // Finish upload session
        const response = await this.makeContentRequest('/files/upload_session/finish', {
          method: 'POST',
          headers: {
            'Dropbox-API-Arg': JSON.stringify({
              cursor: {
                session_id: session.session_id,
                offset: offset
              },
              commit: {
                path: remotePath,
                mode: 'overwrite',
                autorename: false
              }
            }),
            'Content-Type': 'application/octet-stream'
          },
          body: chunk
        });
        
        const result = await response.json();
        console.log(`✅ Chunked upload completed: ${result.name}`);
        
        return {
          id: result.id,
          name: result.name,
          path: remotePath,
          size: result.size,
          hash: result.content_hash || null
        };
      } else {
        // Append to session
        await this.makeContentRequest('/files/upload_session/append_v2', {
          method: 'POST',
          headers: {
            'Dropbox-API-Arg': JSON.stringify({
              cursor: {
                session_id: session.session_id,
                offset: offset
              }
            }),
            'Content-Type': 'application/octet-stream'
          },
          body: chunk
        });
        
        offset += chunk.length;
      }
    }
  }

  async downloadFile(remotePath, localPath) {
    remotePath = this.normalizePath(remotePath);
    
    console.log(`📥 Downloading ${path.basename(remotePath)}...`);
    
    try {
      const response = await this.makeContentRequest('/files/download', {
        method: 'POST',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({
            path: remotePath
          })
        }
      });

      const buffer = await response.buffer();

      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await fs.promises.writeFile(localPath, buffer);

      console.log(`✅ Download completed: ${localPath}`);
      
      return { 
        path: localPath, 
        size: buffer.length,
        remotePath: remotePath
      };
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        throw new Error(`File not found: ${remotePath}`);
      }
      throw error;
    }
  }

  async getFile(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    try {
      const response = await this.makeRequest('/files/get_metadata', {
        method: 'POST',
        body: JSON.stringify({
          path: remotePath,
          include_media_info: true,
          include_deleted: false
        })
      });

      if (response['.tag'] !== 'file') {
        throw new Error(`Path is not a file: ${remotePath}`);
      }

      return {
        id: response.id,
        name: response.name,
        path: remotePath,
        size: response.size,
        modifiedTime: response.server_modified,
        createdTime: response.client_modified,
        hash: response.content_hash || null,
        mimeType: null, // Dropbox doesn't provide MIME type in metadata
        webViewLink: null // Would need to create shared link
      };
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        throw new Error(`File not found: ${remotePath}`);
      }
      throw error;
    }
  }

  async listFiles(remotePath = '/', options = {}) {
    remotePath = this.normalizePath(remotePath);
    
    const {
      recursive = false,
      includeDeleted = false,
      limit = 1000,
      fileTypesOnly = true
    } = options;
    
    const response = await this.makeRequest('/files/list_folder', {
      method: 'POST',
      body: JSON.stringify({
        path: remotePath,
        recursive: recursive,
        include_media_info: false,
        include_deleted: includeDeleted,
        limit: limit
      })
    });

    let entries = response.entries;
    
    if (fileTypesOnly) {
      entries = entries.filter(entry => entry['.tag'] === 'file');
    }
    
    return entries.map(file => ({
      id: file.id,
      name: file.name,
      path: file.path_lower,
      size: file.size || 0,
      modifiedTime: file.server_modified,
      createdTime: file.client_modified,
      hash: file.content_hash || null,
      mimeType: null,
      webViewLink: null
    }));
  }

  async deleteFile(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    try {
      // Verify file exists first to provide better error handling
      await this.getFile(remotePath);
      
      const response = await this.makeRequest('/files/delete_v2', {
        method: 'POST',
        body: JSON.stringify({
          path: remotePath
        })
      });

      return { 
        deleted: true, 
        path: remotePath 
      };
    } catch (error) {
      if (this.isFileNotFoundError(error)) {
        // File already doesn't exist, consider it successfully deleted
        return { 
          deleted: true, 
          path: remotePath 
        };
      }
      throw error;
    }
  }

  async renameFile(remotePath, newName) {
    remotePath = this.normalizePath(remotePath);
    const newPath = `${path.dirname(remotePath)}/${newName}`.replace(/\/+/g, '/');
    
    const response = await this.makeRequest('/files/move_v2', {
      method: 'POST',
      body: JSON.stringify({
        from_path: remotePath,
        to_path: newPath,
        allow_shared_folder: false,
        autorename: false
      })
    });

    return {
      id: response.metadata.id,
      name: response.metadata.name,
      oldPath: remotePath,
      newPath: newPath
    };
  }

  async copyFile(sourcePath, destinationPath) {
    sourcePath = this.normalizePath(sourcePath);
    destinationPath = this.normalizePath(destinationPath);
    
    const response = await this.makeRequest('/files/copy_v2', {
      method: 'POST',
      body: JSON.stringify({
        from_path: sourcePath,
        to_path: destinationPath,
        allow_shared_folder: false,
        autorename: false
      })
    });

    return {
      id: response.metadata.id,
      name: response.metadata.name,
      sourcePath: sourcePath,
      destinationPath: destinationPath
    };
  }

  // ============================================================================
  // SEARCH AND QUERY OPERATIONS
  // ============================================================================

  async searchFiles(query, options = {}) {
    const {
      limit = 100,
      type = 'filename',
      ancestorFolderId = null,
      fileCategory = null
    } = options;
    
    const searchOptions = {
      query: query,
      max_results: Math.min(limit, 1000), // Dropbox max is 1000
      mode: {
        '.tag': type // 'filename', 'filename_and_content', 'deleted_filename'
      }
    };

    if (ancestorFolderId) {
      searchOptions.options = {
        path: ancestorFolderId,
        max_results: Math.min(limit, 1000)
      };
    }

    if (fileCategory) {
      searchOptions.options = {
        ...searchOptions.options,
        file_categories: [fileCategory]
      };
    }
    
    const response = await this.makeRequest('/files/search_v2', {
      method: 'POST',
      body: JSON.stringify(searchOptions)
    });
    
    // FIXED: Properly enforce the limit by slicing results
    const results = response.matches.slice(0, limit).map(match => {
      const metadata = match.metadata.metadata;
      return {
        id: metadata.id,
        name: metadata.name,
        path: metadata.path_lower,
        type: metadata['.tag'],
        size: metadata.size || 0,
        modifiedTime: metadata.server_modified,
        webViewLink: null
      };
    });
    
    return results;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getChunkSize() {
    return 8 * 1024 * 1024; // 8MB chunks
  }

  getChunkThreshold() {
    return 150 * 1024 * 1024; // 150MB threshold for chunked uploads
  }

  // ============================================================================
  // ERROR HANDLING HELPERS
  // ============================================================================

  isFolderNotFoundError(error) {
    return error.message.includes('path/not_found') || 
           error.message.includes('not_found') ||
           error.message.includes('path_lookup_not_found');
  }

  isFileNotFoundError(error) {
    return error.message.includes('path/not_found') || 
           error.message.includes('not_found') ||
           error.message.includes('path_lookup_not_found');
  }

  isFolderExistsError(error) {
    return error.message.includes('path/conflict/folder') || 
           error.message.includes('conflict/folder');
  }

  isQuotaExceededError(error) {
    return error.message.includes('insufficient_space') || 
           error.message.includes('quota_exceeded');
  }

  isRateLimitError(error) {
    return error.message.includes('rate_limit') || 
           error.message.includes('too_many_requests');
  }

  isAuthenticationError(error) {
    return error.message.includes('invalid_access_token') || 
           error.message.includes('expired_access_token') ||
           error.message.includes('401');
  }
}

export { DropboxProvider };