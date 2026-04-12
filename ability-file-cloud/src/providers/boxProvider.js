import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import FormData from 'form-data';
import crypto from 'crypto';

class BoxProvider {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.tokenExpiry = null;
    this.baseUrl = 'https://api.box.com/2.0';
    this.uploadUrl = 'https://upload.box.com/api/2.0';
    
    // Set initial token expiry if we have an access token
    if (this.accessToken && !this.tokenExpiry) {
      // Box tokens typically last 1 hour, set conservative expiry
      this.tokenExpiry = Date.now() + (50 * 60 * 1000); // 50 minutes from now
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
      console.log('🔄 Refreshing Box access token...');
      return await this.refreshAccessToken();
    }

    // If we only have an access token, try to use it but warn about expiration
    if (this.accessToken) {
      const timeLeft = this.tokenExpiry ? Math.max(0, this.tokenExpiry - Date.now()) : 0;
      const minutesLeft = Math.round(timeLeft / (60 * 1000));
      
      if (timeLeft > 0) {
        console.warn(`⚠️  Using Box access token that expires in ~${minutesLeft} minute(s). Consider setting up OAuth refresh tokens for long-running processes.`);
      } else {
        console.warn('⚠️  Box access token may be expired. Consider setting up OAuth refresh tokens.');
      }
      
      return this.accessToken;
    }

    throw new Error('No valid Box credentials available. Please configure BOX_ACCESS_TOKEN or set up OAuth with refresh tokens.');
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Missing OAuth credentials for token refresh. Need BOX_CLIENT_ID, BOX_CLIENT_SECRET, and BOX_REFRESH_TOKEN.');
    }

    try {
      const response = await fetch('https://api.box.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret
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
        
        throw new Error(`Box token refresh failed: ${response.status} - ${errorDetails}`);
      }

      const tokenData = await response.json();
      
      // Update our tokens
      const oldAccessToken = this.accessToken;
      this.accessToken = tokenData.access_token;
      
      // Update refresh token if a new one was provided
      if (tokenData.refresh_token) {
        this.refreshToken = tokenData.refresh_token;
      }
      
      // Set expiry time (Box tokens typically last 1 hour)
      const expiresIn = tokenData.expires_in || (60 * 60); // Default to 1 hour
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      
      const minutesUntilExpiry = Math.round(expiresIn / 60);
      console.log(`✅ Box access token refreshed. Expires in ${minutesUntilExpiry} minute(s).`);
      
      // Save updated tokens back to config if possible
      await this.saveUpdatedTokens();
      
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to refresh Box token:', error.message);
      
      // If refresh fails but we have an old token, try to use it one more time
      if (this.accessToken) {
        console.warn('⚠️  Attempting to continue with existing token...');
        return this.accessToken;
      }
      
      throw new Error(`Failed to refresh Box token: ${error.message}`);
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
        envContent = '# Box Configuration\n';
      }
      
      // Update or add the access token
      const accessTokenRegex = /^BOX_ACCESS_TOKEN=.*$/m;
      const newAccessTokenLine = `BOX_ACCESS_TOKEN=${this.accessToken}`;
      
      if (accessTokenRegex.test(envContent)) {
        envContent = envContent.replace(accessTokenRegex, newAccessTokenLine);
      } else {
        envContent += `\n${newAccessTokenLine}`;
      }
      
      // Update refresh token if we have a new one
      if (this.refreshToken) {
        const refreshTokenRegex = /^BOX_REFRESH_TOKEN=.*$/m;
        const newRefreshTokenLine = `BOX_REFRESH_TOKEN=${this.refreshToken}`;
        
        if (refreshTokenRegex.test(envContent)) {
          envContent = envContent.replace(refreshTokenRegex, newRefreshTokenLine);
        } else {
          envContent += `\n${newRefreshTokenLine}`;
        }
      }

      await fs.promises.writeFile(envPath, envContent);
      console.log('💾 Updated .env file with new Box tokens');
    } catch (error) {
      console.warn('⚠️  Could not save updated tokens to .env file:', error.message);
      console.log('📝 New access token (save manually if needed):', this.accessToken);
    }
  }

  async testConnection() {
    const response = await this.makeRequest('/users/me');
    
    return {
      user: response.name,
      email: response.login,
      quota: {
        used: parseInt(response.space_used) || 0,
        total: parseInt(response.space_amount) || 0
      }
    };
  }

  validateConfig() {
    const errors = [];
    const warnings = [];
    
    if (!this.accessToken && !this.refreshToken) {
      errors.push('Either BOX_ACCESS_TOKEN or BOX_REFRESH_TOKEN is required');
    }
    
    if (!this.clientId) {
      errors.push('BOX_CLIENT_ID is required');
    }
    
    if (!this.clientSecret) {
      errors.push('BOX_CLIENT_SECRET is required');
    }
    
    if (this.refreshToken && (!this.clientId || !this.clientSecret)) {
      errors.push('BOX_CLIENT_ID and BOX_CLIENT_SECRET are required when using BOX_REFRESH_TOKEN');
    }
    
    if (this.accessToken && !this.refreshToken) {
      warnings.push('Using access token without refresh token. Token will expire after 1 hour. Consider setting up OAuth with refresh tokens for long-running processes.');
    }
    
    if (this.refreshToken && this.clientId && this.clientSecret) {
      console.log('✅ Box configured with OAuth refresh tokens - suitable for long-running processes');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
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
            throw new Error(`Box API error after token refresh: ${retryResponse.status} - ${error}`);
          }
          
          // Handle empty responses for DELETE operations
          if (options.method === 'DELETE') {
            if (retryResponse.status === 204 || retryResponse.status === 200) {
              return {}; // Return empty object for successful deletes
            }
          }

          // Check if response has content before parsing JSON
          const contentLength = retryResponse.headers.get('content-length');
          const contentType = retryResponse.headers.get('content-type');
          
          if (contentLength === '0' || !contentType?.includes('application/json')) {
            return {}; // Return empty object for empty responses
          }

          try {
            return await retryResponse.json();
          } catch (parseError) {
            console.warn(`Warning: Could not parse response as JSON: ${parseError.message}`);
            return {};
          }
        } catch (refreshError) {
          throw new Error(`Token refresh failed during request: ${refreshError.message}`);
        }
      } else {
        throw new Error('Box access token expired and no refresh token available. Please re-authenticate.');
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Box API error: ${response.status} - ${error}`);
    }

    // Handle empty responses for DELETE operations
    if (options.method === 'DELETE') {
      if (response.status === 204 || response.status === 200) {
        return {}; // Return empty object for successful deletes
      }
    }

    // Check if response has content before parsing JSON
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    if (contentLength === '0' || !contentType?.includes('application/json')) {
      return {}; // Return empty object for empty responses
    }

    try {
      return await response.json();
    } catch (parseError) {
      console.warn(`Warning: Could not parse response as JSON: ${parseError.message}`);
      return {};
    }
  }

  async makeUploadRequest(endpoint, options = {}) {
    await this.ensureAccessToken();
    
    const url = `${this.uploadUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      ...options.headers
    };

    const response = await fetch(url, {
      ...options,
      headers
    });

    // Handle token expiration for upload requests too
    if (response.status === 401 && this.refreshToken && this.clientId && this.clientSecret) {
      console.log('🔄 Access token expired during upload, attempting to refresh...');
      
      try {
        await this.refreshAccessToken();
        
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        
        if (!retryResponse.ok) {
          const error = await retryResponse.text();
          throw new Error(`Box API error after token refresh: ${retryResponse.status} - ${error}`);
        }
        
        return retryResponse.json();
      } catch (refreshError) {
        throw new Error(`Token refresh failed during upload request: ${refreshError.message}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Box API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // ============================================================================
  // PATH MANAGEMENT METHODS
  // ============================================================================

  normalizePath(path) {
    if (!path || path === '/') return '';
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    return path.replace(/\/+/g, '/').replace(/\/$/, '');
  }

  async ensureFolderExists(remotePath) {
    if (!remotePath || remotePath === '/' || remotePath === '') {
      return '0'; // Root folder ID
    }
    
    remotePath = this.normalizePath(remotePath);
    
    try {
      const folderId = await this.getFolderId(remotePath);
      return folderId;
    } catch (error) {
      if (this.isFolderNotFoundError(error)) {
        // Create folder hierarchy
        return await this.findOrCreateFolder(remotePath);
      } else {
        throw error;
      }
    }
  }

  async findOrCreateFolder(folderPath) {
    const parts = folderPath.split('/').filter(p => p);
    let parentId = '0'; // Root folder ID
    
    for (const folderName of parts) {
      // Search for existing folder
      const searchResponse = await this.makeRequest(
        `/search?query=${encodeURIComponent(folderName)}&type=folder&ancestor_folder_ids=${parentId}&limit=100`
      );
      
      const existingFolder = searchResponse.entries.find(
        entry => entry.name === folderName && entry.parent.id === parentId
      );
      
      if (existingFolder) {
        parentId = existingFolder.id;
      } else {
        // Create new folder
        const createResponse = await this.makeRequest('/folders', {
          method: 'POST',
          body: JSON.stringify({
            name: folderName,
            parent: {
              id: parentId
            }
          })
        });
        parentId = createResponse.id;
      }
    }
    
    return parentId;
  }

  // ============================================================================
  // FOLDER OPERATIONS (CRUD)
  // ============================================================================

  async createFolder(remotePath) {
    remotePath = this.normalizePath(remotePath);
    const folderName = path.basename(remotePath);
    const parentPath = path.dirname(remotePath);
    
    let parentId = '0'; // Root folder
    if (parentPath && parentPath !== '.' && parentPath !== '/') {
      parentId = await this.ensureFolderExists(parentPath);
    }

    try {
      const response = await this.makeRequest('/folders', {
        method: 'POST',
        body: JSON.stringify({
          name: folderName,
          parent: {
            id: parentId
          }
        })
      });

      return {
        id: response.id,
        name: response.name,
        path: remotePath
      };
    } catch (error) {
      if (this.isFolderExistsError(error)) {
        // Folder already exists, get its info
        const folderId = await this.getFolderId(remotePath);
        return { 
          id: folderId,
          name: folderName,
          path: remotePath 
        };
      }
      throw error;
    }
  }

  async getFolder(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    let folderId = '0';
    if (remotePath) {
      folderId = await this.getFolderId(remotePath);
    }

    const response = await this.makeRequest(`/folders/${folderId}?fields=id,name,modified_at,item_collection`);

    return {
      id: response.id,
      name: response.name || 'Root',
      path: remotePath || '/',
      modifiedTime: response.modified_at,
      itemCount: response.item_collection ? response.item_collection.total_count : 0
    };
  }

  async listFolders(remotePath = '/') {
    remotePath = this.normalizePath(remotePath);
    
    let folderId = '0';
    if (remotePath) {
      folderId = await this.getFolderId(remotePath);
    }

    const response = await this.makeRequest(`/folders/${folderId}/items?fields=id,name,modified_at,type&limit=1000`);

    return response.entries
      .filter(entry => entry.type === 'folder')
      .map(folder => ({
        id: folder.id,
        name: folder.name,
        path: remotePath ? `${remotePath}/${folder.name}` : folder.name,
        modifiedTime: folder.modified_at,
        itemCount: 0 // Box doesn't provide item count in folder listing
      }));
  }

  async deleteFolder(remotePath, recursive = true) {
    remotePath = this.normalizePath(remotePath);
    
    const folderId = await this.getFolderId(remotePath);
    
    const queryParams = recursive ? '?recursive=true' : '';
    
    await this.makeRequest(`/folders/${folderId}${queryParams}`, {
      method: 'DELETE'
    });

    return { 
      deleted: true, 
      path: remotePath 
    };
  }

  async renameFolder(remotePath, newName) {
    remotePath = this.normalizePath(remotePath);
    const folderId = await this.getFolderId(remotePath);
    
    const response = await this.makeRequest(`/folders/${folderId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: newName
      })
    });

    const newPath = `${path.dirname(remotePath)}/${newName}`.replace(/\/+/g, '/');

    return {
      id: response.id,
      name: response.name,
      oldPath: remotePath,
      newPath: newPath
    };
  }

  // ============================================================================
  // FILE OPERATIONS (CRUD)
  // ============================================================================

  async uploadFile(localPath, remotePath) {
    remotePath = this.normalizePath(remotePath);
    const fileName = path.basename(remotePath);
    const folderPath = path.dirname(remotePath);
    
    let parentId = '0'; // Root folder
    if (folderPath && folderPath !== '.' && folderPath !== '/') {
      parentId = await this.ensureFolderExists(folderPath);
    }

    const fileContent = await fs.promises.readFile(localPath);
    const stats = await fs.promises.stat(localPath);
    
    console.log(`📤 Uploading ${fileName} (${this.formatBytes(stats.size)}) to Box`);
    
    // For large files, use chunked upload
    if (stats.size > this.getChunkThreshold()) {
      return this.uploadLargeFile(localPath, fileName, parentId, stats.size);
    }

    // Simple upload for smaller files
    const form = new FormData();
    form.append('attributes', JSON.stringify({
      name: fileName,
      parent: {
        id: parentId
      }
    }));
    form.append('file', fileContent, fileName);

    const response = await this.makeUploadRequest('/files/content', {
      method: 'POST',
      body: form
    });

    console.log(`✅ Upload completed: ${response.entries[0].name}`);

    return {
      id: response.entries[0].id,
      name: response.entries[0].name,
      path: remotePath,
      size: response.entries[0].size,
      hash: response.entries[0].sha1 || null
    };
  }

  async uploadLargeFile(localPath, fileName, parentId, fileSize) {
    console.log(`📤 Starting chunked upload for large file (${this.formatBytes(fileSize)})`);
    
    // Create upload session
    const sessionResponse = await this.makeRequest('/files/upload_sessions', {
      method: 'POST',
      body: JSON.stringify({
        folder_id: parentId,
        file_size: fileSize,
        file_name: fileName
      })
    });

    const sessionId = sessionResponse.id;
    const partSize = sessionResponse.part_size;
    const sessionEndpoints = sessionResponse.session_endpoints;
    
    const fileHandle = await fs.promises.open(localPath, 'r');
    const parts = [];
    
    try {
      let offset = 0;
      
      while (offset < fileSize) {
        const chunkSize = Math.min(partSize, fileSize - offset);
        const buffer = Buffer.alloc(chunkSize);
        
        await fileHandle.read(buffer, 0, chunkSize, offset);
        
        console.log(`📤 Uploading chunk ${Math.floor(offset / partSize) + 1}/${Math.ceil(fileSize / partSize)}`);
        
        // Upload part
        const partResponse = await fetch(sessionEndpoints.upload_part, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Digest': `sha1=${crypto.createHash('sha1').update(buffer).digest('base64')}`,
            'Content-Range': `bytes ${offset}-${offset + chunkSize - 1}/${fileSize}`
          },
          body: buffer
        });

        if (!partResponse.ok) {
          throw new Error(`Failed to upload part: ${partResponse.status}`);
        }

        const partData = await partResponse.json();
        parts.push(partData.part);
        
        offset += chunkSize;
      }
      
      // Commit the upload
      const commitResponse = await fetch(sessionEndpoints.commit, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parts: parts
        })
      });

      if (!commitResponse.ok) {
        throw new Error(`Failed to commit upload: ${commitResponse.status}`);
      }

      const result = await commitResponse.json();
      console.log(`✅ Chunked upload completed: ${result.entries[0].name}`);

      return {
        id: result.entries[0].id,
        name: result.entries[0].name,
        path: remotePath,
        size: result.entries[0].size,
        hash: result.entries[0].sha1 || null
      };
      
    } finally {
      await fileHandle.close();
    }
  }

  async downloadFile(remotePath, localPath) {
    remotePath = this.normalizePath(remotePath);
    const fileName = path.basename(remotePath);
    
    console.log(`📥 Downloading ${fileName} from Box...`);
    
    try {
      // Get file ID
      const fileId = await this.getFileId(remotePath);
      
      await this.ensureAccessToken();
      const response = await fetch(`${this.baseUrl}/files/${fileId}/content`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

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
      const fileId = await this.getFileId(remotePath);
      const response = await this.makeRequest(`/files/${fileId}?fields=id,name,size,modified_at,created_at,sha1,description,shared_link`);

      return {
        id: response.id,
        name: response.name,
        path: remotePath,
        size: parseInt(response.size) || 0,
        modifiedTime: response.modified_at,
        createdTime: response.created_at,
        hash: response.sha1 || null,
        mimeType: null, // Box doesn't provide MIME type in basic file info
        webViewLink: response.shared_link ? response.shared_link.url : null
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
    
    let folderId = '0'; // Root folder
    if (remotePath) {
      folderId = await this.getFolderId(remotePath);
    }

    const response = await this.makeRequest(`/folders/${folderId}/items?fields=id,name,size,modified_at,created_at,sha1,shared_link&limit=${limit}`);

    let entries = response.entries;
    
    if (fileTypesOnly) {
      entries = entries.filter(entry => entry.type === 'file');
    }
    
    return entries.map(file => ({
      id: file.id,
      name: file.name,
      path: remotePath ? `${remotePath}/${file.name}` : file.name,
      size: parseInt(file.size) || 0,
      modifiedTime: file.modified_at,
      createdTime: file.created_at,
      hash: file.sha1 || null,
      mimeType: null,
      webViewLink: file.shared_link ? file.shared_link.url : null
    }));
  }

  async deleteFile(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    try {
      // Verify file exists first to provide better error handling
      await this.getFile(remotePath);
      
      const fileId = await this.getFileId(remotePath);
      
      await this.makeRequest(`/files/${fileId}`, {
        method: 'DELETE'
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
    const fileId = await this.getFileId(remotePath);
    
    const response = await this.makeRequest(`/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: newName
      })
    });

    const newPath = `${path.dirname(remotePath)}/${newName}`.replace(/\/+/g, '/');

    return {
      id: response.id,
      name: response.name,
      oldPath: remotePath,
      newPath: newPath
    };
  }

  async copyFile(sourcePath, destinationPath) {
    sourcePath = this.normalizePath(sourcePath);
    destinationPath = this.normalizePath(destinationPath);
    
    const sourceFileId = await this.getFileId(sourcePath);
    const destinationFileName = path.basename(destinationPath);
    const destinationFolderPath = path.dirname(destinationPath);
    
    let destinationFolderId = '0';
    if (destinationFolderPath && destinationFolderPath !== '.' && destinationFolderPath !== '/') {
      destinationFolderId = await this.ensureFolderExists(destinationFolderPath);
    }
    
    const response = await this.makeRequest(`/files/${sourceFileId}/copy`, {
      method: 'POST',
      body: JSON.stringify({
        parent: {
          id: destinationFolderId
        },
        name: destinationFileName
      })
    });
    
    return {
      id: response.id,
      name: response.name,
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
      type = 'file',
      ancestorFolderId = null,
      fileCategory = null
    } = options;
    
    let searchQuery = `${query}`;
    let searchParams = `query=${encodeURIComponent(searchQuery)}&limit=${limit}`;
    
    if (type) {
      searchParams += `&type=${type}`;
    }
    
    if (ancestorFolderId) {
      const folderId = await this.getFolderId(ancestorFolderId);
      searchParams += `&ancestor_folder_ids=${folderId}`;
    }
    
    if (fileCategory) {
      searchParams += `&file_extensions=${fileCategory}`;
    }
    
    const response = await this.makeRequest(`/search?${searchParams}`);
    
    // FIXED: Properly enforce the limit by slicing results
    const results = response.entries.slice(0, limit).map(item => ({
      id: item.id,
      name: item.name,
      path: item.name, // Box search doesn't provide full paths
      type: item.type,
      size: parseInt(item.size) || 0,
      modifiedTime: item.modified_at,
      webViewLink: item.shared_link ? item.shared_link.url : null
    }));
    
    return results;
  }

  async getFileId(remotePath) {
    remotePath = this.normalizePath(remotePath);
    const fileName = path.basename(remotePath);
    const folderPath = path.dirname(remotePath);
    
    let folderId = '0';
    if (folderPath && folderPath !== '.' && folderPath !== '/') {
      folderId = await this.getFolderId(folderPath);
    }
    
    const response = await this.makeRequest(`/folders/${folderId}/items?fields=id,name,type&limit=1000`);
    
    const file = response.entries.find(entry => 
      entry.name === fileName && entry.type === 'file'
    );
    
    if (!file) {
      throw new Error(`File not found: ${remotePath}`);
    }
    
    return file.id;
  }

  async getFolderId(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    if (!remotePath) {
      return '0';
    }
    
    const parts = remotePath.split('/').filter(p => p);
    let currentId = '0';
    
    for (const part of parts) {
      const response = await this.makeRequest(`/folders/${currentId}/items?fields=id,name,type&limit=1000`);
      
      const folder = response.entries.find(entry => 
        entry.name === part && entry.type === 'folder'
      );
      
      if (!folder) {
        throw new Error(`Folder not found: ${remotePath}`);
      }
      
      currentId = folder.id;
    }
    
    return currentId;
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
    return 8 * 1024 * 1024; // 8MB chunks (Box default part size)
  }

  getChunkThreshold() {
    return 20 * 1024 * 1024; // 20MB threshold for chunked uploads
  }

  // ============================================================================
  // URL TRANSFER HELPERS
  // ============================================================================

  /**
   * Get a download URL for a file.
   * Box provides a direct download URL via the /files/:id/content endpoint.
   */
  async getDownloadUrl(remotePath) {
    const fileId = await this.getFileId(remotePath);
    // Box /files/:id?fields=download_url returns the direct download URL
    const response = await this.makeRequest(`/files/${fileId}?fields=id,name,size,download_url`);

    if (response.download_url) {
      return {
        url: response.download_url,
        metadata: { id: response.id, name: response.name, size: response.size },
      };
    }

    // Fallback: use the content endpoint (requires auth header)
    return {
      url: `${this.baseUrl}/files/${fileId}/content`,
      metadata: { id: response.id, name: response.name, size: response.size },
      note: 'URL requires Authorization header',
    };
  }

  // ============================================================================
  // OAUTH SETUP HELPERS
  // ============================================================================

  static generateAuthUrl(clientId, redirectUri = 'http://localhost:8080/callback') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
    });
    return `https://account.box.com/api/oauth2/authorize?${params.toString()}`;
  }

  static async exchangeCodeForTokens(clientId, clientSecret, code, redirectUri = 'http://localhost:8080/callback') {
    const response = await fetch('https://api.box.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Box token exchange failed: ${response.status} - ${errorText}`);
    }

    const tokenData = await response.json();
    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    };
  }

  // ============================================================================
  // ERROR HANDLING HELPERS
  // ============================================================================

  isFolderNotFoundError(error) {
    return error.message.includes('not_found') || 
           error.message.includes('item_name_invalid') ||
           error.message.includes('404') ||
           error.message.includes('Folder not found');
  }

  isFileNotFoundError(error) {
    return error.message.includes('not_found') || 
           error.message.includes('item_name_invalid') ||
           error.message.includes('404') ||
           error.message.includes('File not found');
  }

  isFolderExistsError(error) {
    return error.message.includes('item_name_in_use') || 
           error.message.includes('conflict');
  }

  isQuotaExceededError(error) {
    return error.message.includes('insufficient_storage') || 
           error.message.includes('storage_limit_exceeded');
  }

  isRateLimitError(error) {
    return error.message.includes('rate_limit_exceeded') || 
           error.message.includes('too_many_requests') ||
           error.message.includes('429');
  }

  isAuthenticationError(error) {
    return error.message.includes('unauthorized') || 
           error.message.includes('invalid_grant') ||
           error.message.includes('401');
  }
}

export { BoxProvider };