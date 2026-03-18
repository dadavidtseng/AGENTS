import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import FormData from 'form-data';
import crypto from 'crypto';

class GoogleDriveProvider {
  constructor(config) {
    // Service Account authentication
    this.serviceAccountKey = config.serviceAccountKey || config.serviceAccountKeyPath;
    this.isServiceAccount = !!this.serviceAccountKey;
    
    if (this.isServiceAccount) {
      // Store config for later initialization
      this.serviceAccountConfig = config;
      this.serviceAccountInitialized = false;
      // Service accounts need to use a shared folder
      this.sharedFolderName = config.sharedFolderName;
      this.rootFolderId = null; // Will be set when we find the shared folder
    } else {
      // OAuth authentication
      this.clientId = config.clientId;
      this.clientSecret = config.clientSecret;
      this.refreshToken = config.refreshToken;
      // OAuth uses the actual root
      this.rootFolderId = 'root';
    }
    
    this.accessToken = null;
    this.tokenExpiry = null;
    this.baseUrl = 'https://www.googleapis.com/drive/v3';
    this.uploadUrl = 'https://www.googleapis.com/upload/drive/v3';
  }

  async initServiceAccount() {
    if (this.serviceAccountInitialized) return;
    
    const config = this.serviceAccountConfig;
    try {
      // Load service account key
      let keyData;
      if (typeof this.serviceAccountKey === 'string') {
        // Check if it's a path or JSON string
        if (this.serviceAccountKey.startsWith('{')) {
          keyData = JSON.parse(this.serviceAccountKey);
        } else {
          // It's a file path
          const keyContent = await fs.promises.readFile(this.serviceAccountKey, 'utf8');
          keyData = JSON.parse(keyContent);
        }
      } else {
        keyData = this.serviceAccountKey;
      }
      
      this.serviceAccountEmail = keyData.client_email;
      this.privateKey = keyData.private_key;
      this.privateKeyId = keyData.private_key_id;
      this.serviceAccountInitialized = true;
      
      console.log(`🔐 Using Google Service Account: ${this.serviceAccountEmail}`);
    } catch (error) {
      throw new Error(`Failed to load service account key: ${error.message}`);
    }
  }

  // ============================================================================
  // SHARED FOLDER MANAGEMENT FOR SERVICE ACCOUNTS
  // ============================================================================
  
  async ensureRootFolder() {
    // For OAuth, root is always 'root'
    if (!this.isServiceAccount) {
      return 'root';
    }
    
    // For service accounts, find the shared folder
    if (this.rootFolderId) {
      return this.rootFolderId;
    }
    
    // Use default if not specified
    const folderName = this.sharedFolderName || 'KADI';
    
    try {
      // Search for the shared folder by name
      const response = await this.makeRequest(
        `/files?q=name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      
      if (response.files && response.files.length > 0) {
        this.rootFolderId = response.files[0].id;
        console.log(`📁 Using shared folder '${folderName}' (${this.rootFolderId}) as root for service account`);
        return this.rootFolderId;
      } else {
        // Try to create the folder if it doesn't exist
        console.log(`📁 Shared folder '${folderName}' not found, attempting to create...`);
        const createResponse = await this.makeRequest('/files', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        
        this.rootFolderId = createResponse.id;
        console.log(`✅ Created folder '${folderName}' (${this.rootFolderId})`);
        console.log(`⚠️  Remember to share this folder with your personal Google account to access the files!`);
        return this.rootFolderId;
      }
    } catch (error) {
      console.error(`❌ Failed to find or create shared folder '${folderName}':`, error.message);
      console.log('ℹ️  Using service account root as fallback (may have quota issues)');
      this.rootFolderId = 'root';
      return 'root';
    }
  }
  
  // ============================================================================
  // AUTHENTICATION METHODS
  // ============================================================================

  async ensureAccessToken() {
    // Proactive refresh: refresh 5 minutes before expiration
    const refreshBuffer = 5 * 60 * 1000; // 5 minutes in milliseconds
    
    if (this.accessToken && this.tokenExpiry && Date.now() < (this.tokenExpiry - refreshBuffer)) {
      return this.accessToken;
    }

    if (this.isServiceAccount) {
      return await this.getServiceAccountToken();
    } else {
      return await this.refreshAccessToken();
    }
  }

  async getServiceAccountToken() {
    // Ensure service account is initialized
    if (!this.serviceAccountInitialized) {
      await this.initServiceAccount();
    }
    
    try {
      const now = Math.floor(Date.now() / 1000);
      const expiry = now + 3600; // 1 hour
      
      // Create JWT claims
      const claims = {
        iss: this.serviceAccountEmail,
        scope: 'https://www.googleapis.com/auth/drive',
        aud: 'https://oauth2.googleapis.com/token',
        exp: expiry,
        iat: now
      };
      
      // Create JWT
      const jwt = this.createJWT(claims);
      
      // Exchange JWT for access token
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Service account auth failed: ${response.status} - ${error}`);
      }
      
      const tokenData = await response.json();
      this.accessToken = tokenData.access_token;
      this.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
      
      console.log('✅ Google service account token obtained');
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to get service account token:', error.message);
      throw error;
    }
  }

  createJWT(claims) {
    // Create JWT header
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      kid: this.privateKeyId
    };
    
    // Encode header and claims
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url');
    
    // Create signature
    const signatureInput = `${encodedHeader}.${encodedClaims}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signatureInput);
    const signature = sign.sign(this.privateKey, 'base64url');
    
    return `${signatureInput}.${signature}`;
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new Error('Missing OAuth credentials for token refresh. Need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
    }

    try {
      console.log('🔄 Refreshing Google access token...');
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: 'refresh_token'
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
        
        // Check for specific error conditions
        if (errorText.includes('invalid_grant') || errorText.includes('Token has been expired or revoked')) {
          console.error('❌ Refresh token is invalid or expired');
          console.log('📝 This usually happens when:');
          console.log('   1. OAuth app is in "Testing" mode (tokens expire after 7 days)');
          console.log('   2. User revoked access');
          console.log('   3. Token hasn\'t been used for 6 months');
          console.log('   Run "npm run setup:googledrive" to get a new refresh token');
        }
        
        throw new Error(`Google token refresh failed: ${response.status} - ${errorDetails}`);
      }

      const tokenData = await response.json();
      
      // Update our tokens
      this.accessToken = tokenData.access_token;
      
      // Google rarely provides new refresh tokens, but save if provided
      if (tokenData.refresh_token) {
        this.refreshToken = tokenData.refresh_token;
      }
      
      // Set expiry time (Google tokens typically last 1 hour)
      const expiresIn = tokenData.expires_in || 3600; // Default to 1 hour
      this.tokenExpiry = Date.now() + (expiresIn * 1000);
      
      const minutesUntilExpiry = Math.round(expiresIn / 60);
      console.log(`✅ Google access token refreshed. Expires in ${minutesUntilExpiry} minute(s).`);
      
      // Save updated tokens back to config if possible
      await this.saveUpdatedTokens();
      
      return this.accessToken;
    } catch (error) {
      console.error('❌ Failed to refresh Google token:', error.message);
      
      // If refresh fails but we have an old token, try to use it one more time
      if (this.accessToken) {
        console.warn('⚠️  Attempting to continue with existing token...');
        return this.accessToken;
      }
      
      throw new Error(`Failed to refresh Google token: ${error.message}`);
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
        envContent = '# Google Drive Configuration\n';
      }
      
      // Update or add the access token (though Google doesn't typically need this saved)
      // We mainly save the refresh token if it changes
      
      // Update refresh token if we have a new one (rare for Google)
      if (this.refreshToken) {
        const refreshTokenRegex = /^GOOGLE_REFRESH_TOKEN=.*$/m;
        const newRefreshTokenLine = `GOOGLE_REFRESH_TOKEN=${this.refreshToken}`;
        
        if (refreshTokenRegex.test(envContent)) {
          const oldToken = envContent.match(refreshTokenRegex)[0].split('=')[1];
          if (oldToken !== this.refreshToken) {
            envContent = envContent.replace(refreshTokenRegex, newRefreshTokenLine);
            console.log('💾 Updated .env file with new Google refresh token');
          }
        }
      }

      await fs.promises.writeFile(envPath, envContent);
    } catch (error) {
      console.warn('⚠️  Could not save updated tokens to .env file:', error.message);
    }
  }

  async testConnection() {
    const aboutResponse = await this.makeRequest('/about?fields=user,storageQuota');
    
    return {
      user: aboutResponse.user.displayName,
      email: aboutResponse.user.emailAddress,
      quota: {
        used: parseInt(aboutResponse.storageQuota.usage) || 0,
        total: parseInt(aboutResponse.storageQuota.limit) || 0
      }
    };
  }

  validateConfig() {
    const errors = [];
    const warnings = [];
    
    if (this.isServiceAccount) {
      // Validate service account configuration
      if (!this.serviceAccountKey) {
        errors.push('GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_PATH is required for service account authentication');
      }
      if (!this.sharedFolderName) {
        warnings.push('GOOGLE_SHARED_FOLDER_NAME not specified - will use default "KADI" (ensure this folder exists and is shared with the service account)');
      }
    } else {
      // Validate OAuth configuration
      if (!this.clientId) {
        errors.push('GOOGLE_CLIENT_ID is required for OAuth authentication');
      }
      
      if (!this.clientSecret) {
        errors.push('GOOGLE_CLIENT_SECRET is required for OAuth authentication');
      }
      
      if (!this.refreshToken) {
        errors.push('GOOGLE_REFRESH_TOKEN is required for OAuth authentication');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      authType: this.isServiceAccount ? 'Service Account' : 'OAuth 2.0'
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

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Drive API error: ${response.status} - ${error}`);
    }

    // CRITICAL FIX: Handle empty responses for DELETE operations
    if (options.method === 'DELETE') {
      // Google Drive DELETE operations return empty response body on success
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
      // If JSON parsing fails but request was successful, return empty object
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

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google Drive API error: ${response.status} - ${error}`);
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
      return await this.ensureRootFolder(); // Use appropriate root based on auth type
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
    let parentId = await this.ensureRootFolder();
    
    for (const folderName of parts) {
      // Search for existing folder
      const searchResponse = await this.makeRequest(
        `/files?q=name='${folderName}' and parents in '${parentId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      
      if (searchResponse.files.length > 0) {
        parentId = searchResponse.files[0].id;
      } else {
        // Create new folder
        const createResponse = await this.makeRequest('/files', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId]
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
    
    let parentId = await this.ensureRootFolder();
    if (parentPath && parentPath !== '.' && parentPath !== '/') {
      parentId = await this.ensureFolderExists(parentPath);
    }

    const response = await this.makeRequest('/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });

    return {
      id: response.id,
      name: response.name,
      path: remotePath
    };
  }

  async getFolder(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    if (!remotePath) {
      // Root folder
      const response = await this.makeRequest('/files/root?fields=id,name,modifiedTime,parents');
      return {
        id: response.id,
        name: 'Root',
        path: '/',
        modifiedTime: response.modifiedTime,
        itemCount: 0
      };
    }

    const folderId = await this.getFolderId(remotePath);
    const response = await this.makeRequest(`/files/${folderId}?fields=id,name,modifiedTime,parents`);

    return {
      id: response.id,
      name: response.name,
      path: remotePath,
      modifiedTime: response.modifiedTime,
      itemCount: 0 // Google Drive doesn't provide item count directly
    };
  }

  async listFolders(remotePath = '/') {
    remotePath = this.normalizePath(remotePath);
    
    let parentId = await this.ensureRootFolder();
    if (remotePath) {
      parentId = await this.getFolderId(remotePath);
    }

    const response = await this.makeRequest(
      `/files?q=parents in '${parentId}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name,modifiedTime)`
    );

    return response.files.map(folder => ({
      id: folder.id,
      name: folder.name,
      path: remotePath ? `${remotePath}/${folder.name}` : folder.name,
      modifiedTime: folder.modifiedTime,
      itemCount: 0
    }));
  }

  async deleteFolder(remotePath, recursive = true) {
    remotePath = this.normalizePath(remotePath);
    
    const folderId = await this.getFolderId(remotePath);
    
    await this.makeRequest(`/files/${folderId}`, {
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
    
    const response = await this.makeRequest(`/files/${folderId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
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
    
    let parentId = await this.ensureRootFolder();
    if (folderPath && folderPath !== '.' && folderPath !== '/') {
      parentId = await this.ensureFolderExists(folderPath);
    }

    const fileContent = await fs.promises.readFile(localPath);
    const stats = await fs.promises.stat(localPath);
    
    console.log(`📤 Uploading ${fileName} (${this.formatBytes(stats.size)}) to Google Drive`);
    
    // For files larger than 5MB, use resumable upload
    if (stats.size > this.getChunkThreshold()) {
      return this.uploadLargeFile(fileContent, fileName, parentId, stats.size);
    }

    // Simple upload for smaller files
    const form = new FormData();
    form.append('metadata', JSON.stringify({
      name: fileName,
      parents: [parentId]
    }), { contentType: 'application/json' });
    form.append('file', fileContent, fileName);

    const response = await this.makeUploadRequest('/files?uploadType=multipart', {
      method: 'POST',
      body: form
    });

    console.log(`✅ Upload completed: ${response.name}`);
    
    return {
      id: response.id,
      name: response.name,
      path: remotePath,
      size: response.size,
      hash: response.md5Checksum || null
    };
  }

  async uploadLargeFile(fileContent, fileName, parentId, fileSize) {
    console.log(`📤 Starting chunked upload for large file (${this.formatBytes(fileSize)})`);
    
    // Initiate resumable upload
    const initResponse = await fetch(`${this.uploadUrl}/files?uploadType=resumable`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: fileName,
        parents: [parentId]
      })
    });

    if (!initResponse.ok) {
      throw new Error(`Failed to initiate upload: ${initResponse.status}`);
    }

    const uploadUrl = initResponse.headers.get('location');
    const chunkSize = this.getChunkSize();
    let start = 0;

    while (start < fileContent.length) {
      const end = Math.min(start + chunkSize, fileContent.length);
      const chunk = fileContent.slice(start, end);
      const isLast = end === fileContent.length;

      console.log(`📤 Uploading chunk ${Math.floor(start / chunkSize) + 1}/${Math.ceil(fileContent.length / chunkSize)}`);

      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${start}-${end - 1}/${fileContent.length}`
        },
        body: chunk
      });

      if (isLast && uploadResponse.ok) {
        const result = await uploadResponse.json();
        console.log(`✅ Chunked upload completed: ${result.name}`);
        
        return {
          id: result.id,
          name: result.name,
          path: `${fileName}`,
          size: result.size,
          hash: result.md5Checksum || null
        };
      } else if (!uploadResponse.ok && uploadResponse.status !== 308) {
        throw new Error(`Upload failed: ${uploadResponse.status}`);
      }

      start = end;
    }
  }

  async downloadFile(remotePath, localPath) {
    remotePath = this.normalizePath(remotePath);
    const fileName = path.basename(remotePath);
    
    console.log(`📥 Downloading ${fileName} from Google Drive...`);
    
    // Search for the file
    const fileId = await this.getFileId(remotePath);
    
    await this.ensureAccessToken();
    const response = await fetch(`${this.baseUrl}/files/${fileId}?alt=media`, {
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
  }

  async getFile(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    const fileId = await this.getFileId(remotePath);
    const response = await this.makeRequest(`/files/${fileId}?fields=id,name,size,modifiedTime,createdTime,md5Checksum,mimeType,webViewLink,parents`);

    return {
      id: response.id,
      name: response.name,
      path: remotePath,
      size: parseInt(response.size) || 0,
      modifiedTime: response.modifiedTime,
      createdTime: response.createdTime,
      hash: response.md5Checksum || null,
      mimeType: response.mimeType,
      webViewLink: response.webViewLink || null
    };
  }

  async listFiles(remotePath = '/', options = {}) {
    remotePath = this.normalizePath(remotePath);
    
    const {
      recursive = false,
      includeDeleted = false,
      limit = 1000,
      fileTypesOnly = true
    } = options;
    
    let parentId = await this.ensureRootFolder();
    if (remotePath) {
      parentId = await this.getFolderId(remotePath);
    }

    let query = `parents in '${parentId}' and trashed=${includeDeleted}`;
    if (fileTypesOnly) {
      query += " and mimeType!='application/vnd.google-apps.folder'";
    }

    const response = await this.makeRequest(
      `/files?q=${encodeURIComponent(query)}&pageSize=${limit}&fields=files(id,name,size,modifiedTime,createdTime,md5Checksum,mimeType,webViewLink)`
    );

    return response.files.map(file => ({
      id: file.id,
      name: file.name,
      path: remotePath ? `${remotePath}/${file.name}` : file.name,
      size: parseInt(file.size) || 0,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      hash: file.md5Checksum || null,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || null
    }));
  }

  async deleteFile(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    const fileId = await this.getFileId(remotePath);
    
    await this.makeRequest(`/files/${fileId}`, {
      method: 'DELETE'
    });

    return { 
      deleted: true, 
      path: remotePath 
    };
  }

  async renameFile(remotePath, newName) {
    remotePath = this.normalizePath(remotePath);
    const fileId = await this.getFileId(remotePath);
    
    const response = await this.makeRequest(`/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
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
    
    let destinationFolderId = await this.ensureRootFolder();
    if (destinationFolderPath && destinationFolderPath !== '.' && destinationFolderPath !== '/') {
      destinationFolderId = await this.ensureFolderExists(destinationFolderPath);
    }
    
    const response = await this.makeRequest(`/files/${sourceFileId}/copy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parents: [destinationFolderId],
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
      type = 'name',
      ancestorFolderId = null,
      fileCategory = null
    } = options;
    
    let searchQuery = `name contains '${query}' and trashed=false`;
    
    if (ancestorFolderId) {
      const folderId = await this.getFolderId(ancestorFolderId);
      searchQuery += ` and parents in '${folderId}'`;
    }
    
    if (fileCategory) {
      searchQuery += ` and mimeType contains '${fileCategory}'`;
    }
    
    const response = await this.makeRequest(
      `/files?q=${encodeURIComponent(searchQuery)}&pageSize=${limit}&fields=files(id,name,size,modifiedTime,mimeType,webViewLink,parents)`
    );
    
    return response.files.map(file => ({
      id: file.id,
      name: file.name,
      path: file.name, // Google Drive doesn't provide full path in search
      type: file.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
      size: parseInt(file.size) || 0,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink || null
    }));
  }

  async getFileId(remotePath) {
    remotePath = this.normalizePath(remotePath);
    const fileName = path.basename(remotePath);
    const folderPath = path.dirname(remotePath);
    
    let parentId = await this.ensureRootFolder();
    if (folderPath && folderPath !== '.' && folderPath !== '/') {
      parentId = await this.getFolderId(folderPath);
    }
    
    const response = await this.makeRequest(
      `/files?q=name='${fileName}' and parents in '${parentId}' and trashed=false`
    );
    
    if (response.files.length === 0) {
      throw new Error(`File not found: ${remotePath}`);
    }
    
    return response.files[0].id;
  }

  async getFolderId(remotePath) {
    remotePath = this.normalizePath(remotePath);
    
    if (!remotePath) {
      return 'root';
    }
    
    const parts = remotePath.split('/').filter(p => p);
    let currentId = await this.ensureRootFolder();
    
    for (const part of parts) {
      const response = await this.makeRequest(
        `/files?q=name='${part}' and parents in '${currentId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      );
      
      if (response.files.length === 0) {
        throw new Error(`Folder not found: ${remotePath}`);
      }
      
      currentId = response.files[0].id;
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
    return 8 * 1024 * 1024; // 8MB chunks
  }

  getChunkThreshold() {
    return 5 * 1024 * 1024; // 5MB threshold for resumable uploads
  }

  // ============================================================================
  // ERROR HANDLING HELPERS
  // ============================================================================

  isFolderNotFoundError(error) {
    return error.message.includes('not found') || 
           error.message.includes('404');
  }

  isFolderExistsError(error) {
    return error.message.includes('already exists') || 
           error.message.includes('conflict');
  }

  isQuotaExceededError(error) {
    return error.message.includes('quotaExceeded') || 
           error.message.includes('storageQuotaExceeded');
  }

  isRateLimitError(error) {
    return error.message.includes('rateLimitExceeded') || 
           error.message.includes('userRateLimitExceeded');
  }

  isAuthenticationError(error) {
    return error.message.includes('invalid_grant') || 
           error.message.includes('unauthorized') ||
           error.message.includes('401');
  }
}

export { GoogleDriveProvider };