import fs from 'fs';
import path from 'path';

export class ConfigManager {
  constructor() {
    this.config = {};
    this.defaults = {
      // Dropbox Configuration
      DROPBOX_ACCESS_TOKEN: '',
      DROPBOX_CLIENT_ID: '',
      DROPBOX_CLIENT_SECRET: '',
      DROPBOX_REFRESH_TOKEN: '',
      
      // Google Drive Configuration
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REFRESH_TOKEN: '',
      
      // Service Account Configuration
      GOOGLE_SERVICE_ACCOUNT_KEY: '',
      GOOGLE_SERVICE_ACCOUNT_KEY_PATH: '',
      GOOGLE_SHARED_FOLDER_NAME: 'KADI', // Default shared folder for service accounts
      
      // Box Configuration
      BOX_CLIENT_ID: '',
      BOX_CLIENT_SECRET: '',
      BOX_ACCESS_TOKEN: '',
      BOX_REFRESH_TOKEN: '',
      
      // General Service Configuration
      DEFAULT_BACKUP_DIRECTORY: '/cloud-file-manager', // Remote directory for backups/uploads
      DEFAULT_DOWNLOAD_DIRECTORY: './downloads', // Local directory for downloads
      MAX_RETRY_ATTEMPTS: '3',
      CHUNK_SIZE: '8388608', // 8MB chunks for uploads
      TIMEOUT_MS: '300000',   // 5 minutes timeout
      
      // Performance Configuration
      DROPBOX_CHUNK_THRESHOLD: '157286400',  // 150MB for Dropbox chunked uploads
      GOOGLE_CHUNK_THRESHOLD: '5242880',     // 5MB for Google Drive resumable uploads
      BOX_CHUNK_THRESHOLD: '20971520',       // 20MB for Box upload sessions
      
      // Rate Limiting Configuration
      MAX_CONCURRENT_UPLOADS: '3',
      MAX_CONCURRENT_DOWNLOADS: '5',
      RATE_LIMIT_DELAY: '1000',  // 1 second delay between requests
      
      // Logging and Debug Configuration
      LOG_LEVEL: 'info',         // error, warn, info, debug
      ENABLE_PROGRESS_TRACKING: 'true',
      ENABLE_CHECKSUM_VERIFICATION: 'true',
      
      // Advanced Features
      AUTO_CREATE_FOLDERS: 'true',
      PRESERVE_FILE_TIMESTAMPS: 'true',
      ENABLE_COMPRESSION: 'false',
      COMPRESSION_LEVEL: '6'
    };
  }

  async load() {
    // Load from .env file if it exists
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = await fs.promises.readFile(envPath, 'utf8');
      this.parseEnvContent(envContent);
    } catch (error) {
      console.warn('⚠️  .env file not found, using environment variables and defaults');
    }

    // Override with actual environment variables
    this.loadFromEnvironment();

    // Apply defaults for missing values
    this.applyDefaults();

    // Validate configuration
    const validation = this.validate();
    if (!validation.isValid) {
      console.warn('⚠️  Configuration validation warnings:');
      validation.errors.forEach(error => console.warn(`   - ${error}`));
    }
  }

  parseEnvContent(content) {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          this.config[key.trim()] = value;
        }
      }
    }
  }

  loadFromEnvironment() {
    for (const key of Object.keys(this.defaults)) {
      if (process.env[key]) {
        this.config[key] = process.env[key];
      }
    }
  }

  applyDefaults() {
    for (const [key, defaultValue] of Object.entries(this.defaults)) {
      if (!this.config[key]) {
        this.config[key] = defaultValue;
      }
    }
  }

  get(key) {
    return this.config[key];
  }

  getNumber(key) {
    const value = this.get(key);
    const number = value ? parseInt(value, 10) : 0;
    return isNaN(number) ? 0 : number;
  }

  getBoolean(key) {
    const value = this.get(key);
    return value && ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  getFloat(key) {
    const value = this.get(key);
    const number = value ? parseFloat(value) : 0.0;
    return isNaN(number) ? 0.0 : number;
  }

  set(key, value) {
    // CRITICAL FIX: Validate value before setting
    if (value === undefined || value === null || value === 'undefined' || value === 'null') {
      console.warn(`⚠️  Attempted to set ${key} to invalid value: ${value}. Skipping.`);
      return false;
    }
    
    // Convert to string and validate it's not empty for credential keys
    const stringValue = String(value).trim();
    if (!stringValue) {
      console.warn(`⚠️  Attempted to set ${key} to empty value. Skipping.`);
      return false;
    }
    
    // Additional validation for credential keys
    if (this.isCredentialKey(key)) {
      if (stringValue.length < 10) { // Reasonable minimum length for tokens/secrets
        console.warn(`⚠️  Credential ${key} appears too short (${stringValue.length} chars). Skipping.`);
        return false;
      }
    }
    
    this.config[key] = stringValue;
    return true;
  }

  isCredentialKey(key) {
    const credentialKeys = [
      'DROPBOX_ACCESS_TOKEN', 'DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET', 'DROPBOX_REFRESH_TOKEN',
      'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
      'BOX_CLIENT_ID', 'BOX_CLIENT_SECRET', 'BOX_ACCESS_TOKEN', 'BOX_REFRESH_TOKEN'
    ];
    return credentialKeys.includes(key);
  }

  has(key) {
    return key in this.config && this.config[key] !== '';
  }

  validate() {
    const errors = [];
    const warnings = [];

    // Check if at least one cloud service is configured
    const configuredServices = this.getConfiguredServices();
    if (configuredServices.length === 0) {
      errors.push('At least one cloud service must be configured (Dropbox, Google Drive, or Box)');
    }

    // Validate specific service configurations
    this.validateDropboxConfig(errors, warnings);
    this.validateGoogleDriveConfig(errors, warnings);
    this.validateBoxConfig(errors, warnings);

    // Validate general configuration
    this.validateGeneralConfig(errors, warnings);

    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      configuredServices: configuredServices
    };
  }

  validateDropboxConfig(errors, warnings) {
    const hasAccessToken = this.has('DROPBOX_ACCESS_TOKEN');
    const hasClientId = this.has('DROPBOX_CLIENT_ID');
    const hasClientSecret = this.has('DROPBOX_CLIENT_SECRET');
    const hasRefreshToken = this.has('DROPBOX_REFRESH_TOKEN');

    if (hasAccessToken || hasClientId || hasClientSecret || hasRefreshToken) {
      if (!hasAccessToken) {
        errors.push('DROPBOX_ACCESS_TOKEN is required for Dropbox integration');
      }
      
      if ((hasClientId || hasClientSecret || hasRefreshToken) && 
          (!hasClientId || !hasClientSecret)) {
        warnings.push('Dropbox OAuth credentials incomplete - refresh token functionality may be limited');
      }
    }
  }

  validateGoogleDriveConfig(errors, warnings) {
    const hasClientId = this.has('GOOGLE_CLIENT_ID');
    const hasClientSecret = this.has('GOOGLE_CLIENT_SECRET');
    const hasRefreshToken = this.has('GOOGLE_REFRESH_TOKEN');

    if (hasClientId || hasClientSecret || hasRefreshToken) {
      if (!hasClientId) {
        errors.push('GOOGLE_CLIENT_ID is required for Google Drive integration');
      }
      if (!hasClientSecret) {
        errors.push('GOOGLE_CLIENT_SECRET is required for Google Drive integration');
      }
      if (!hasRefreshToken) {
        errors.push('GOOGLE_REFRESH_TOKEN is required for Google Drive integration');
      }
    }
  }

  validateBoxConfig(errors, warnings) {
    const hasClientId = this.has('BOX_CLIENT_ID');
    const hasClientSecret = this.has('BOX_CLIENT_SECRET');
    const hasAccessToken = this.has('BOX_ACCESS_TOKEN');
    const hasRefreshToken = this.has('BOX_REFRESH_TOKEN');

    if (hasClientId || hasClientSecret || hasAccessToken || hasRefreshToken) {
      if (!hasClientId) {
        errors.push('BOX_CLIENT_ID is required for Box integration');
      }
      if (!hasClientSecret) {
        errors.push('BOX_CLIENT_SECRET is required for Box integration');
      }
      
      if (!hasAccessToken && !hasRefreshToken) {
        errors.push('Either BOX_ACCESS_TOKEN or BOX_REFRESH_TOKEN must be provided for Box integration');
      }
      
      if (hasRefreshToken && (!hasClientId || !hasClientSecret)) {
        errors.push('BOX_CLIENT_ID and BOX_CLIENT_SECRET are required when using BOX_REFRESH_TOKEN');
      }
    }
  }

  validateGeneralConfig(errors, warnings) {
    // Validate numeric configurations
    const numericConfigs = [
      'MAX_RETRY_ATTEMPTS',
      'CHUNK_SIZE',
      'TIMEOUT_MS',
      'DROPBOX_CHUNK_THRESHOLD',
      'GOOGLE_CHUNK_THRESHOLD',
      'BOX_CHUNK_THRESHOLD',
      'MAX_CONCURRENT_UPLOADS',
      'MAX_CONCURRENT_DOWNLOADS',
      'RATE_LIMIT_DELAY'
    ];

    for (const config of numericConfigs) {
      const value = this.getNumber(config);
      if (value <= 0) {
        warnings.push(`${config} should be a positive number, got: ${this.get(config)}`);
      }
    }

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info', 'debug'];
    const logLevel = this.get('LOG_LEVEL');
    if (!validLogLevels.includes(logLevel)) {
      warnings.push(`LOG_LEVEL should be one of: ${validLogLevels.join(', ')}, got: ${logLevel}`);
    }

    // Validate chunk sizes
    const chunkSize = this.getNumber('CHUNK_SIZE');
    if (chunkSize < 1024 * 1024) { // Less than 1MB
      warnings.push('CHUNK_SIZE should be at least 1MB for optimal performance');
    }
    if (chunkSize > 100 * 1024 * 1024) { // More than 100MB
      warnings.push('CHUNK_SIZE should not exceed 100MB to avoid memory issues');
    }

    // Validate timeout
    const timeout = this.getNumber('TIMEOUT_MS');
    if (timeout < 30000) { // Less than 30 seconds
      warnings.push('TIMEOUT_MS should be at least 30 seconds for large file operations');
    }

    // Validate directories
    const backupDir = this.get('DEFAULT_BACKUP_DIRECTORY');
    const downloadDir = this.get('DEFAULT_DOWNLOAD_DIRECTORY');
    
    if (!backupDir.startsWith('/') && !backupDir.startsWith('./') && !backupDir.startsWith('../')) {
      warnings.push('DEFAULT_BACKUP_DIRECTORY should start with / for absolute paths or ./ for relative paths');
    }
    
    if (!downloadDir.startsWith('./') && !downloadDir.startsWith('../') && !path.isAbsolute(downloadDir)) {
      warnings.push('DEFAULT_DOWNLOAD_DIRECTORY should be a valid local path');
    }
  }

  getConfiguredServices() {
    const services = [];
    
    if (this.has('DROPBOX_ACCESS_TOKEN')) {
      services.push('dropbox');
    }
    
    if (this.has('GOOGLE_CLIENT_ID') && 
        this.has('GOOGLE_CLIENT_SECRET') && 
        this.has('GOOGLE_REFRESH_TOKEN')) {
      services.push('googledrive');
    }
    
    if (this.has('BOX_CLIENT_ID') && 
        this.has('BOX_CLIENT_SECRET') && 
        (this.has('BOX_ACCESS_TOKEN') || this.has('BOX_REFRESH_TOKEN'))) {
      services.push('box');
    }
    
    return services;
  }

  getProviderConfig(serviceName) {
    switch (serviceName.toLowerCase()) {
      case 'dropbox':
        return {
          accessToken: this.get('DROPBOX_ACCESS_TOKEN'),
          clientId: this.get('DROPBOX_CLIENT_ID'),
          clientSecret: this.get('DROPBOX_CLIENT_SECRET'),
          refreshToken: this.get('DROPBOX_REFRESH_TOKEN'),
          chunkThreshold: this.getNumber('DROPBOX_CHUNK_THRESHOLD'),
          chunkSize: this.getNumber('CHUNK_SIZE')
        };
      
      case 'googledrive':
        return {
          clientId: this.get('GOOGLE_CLIENT_ID'),
          clientSecret: this.get('GOOGLE_CLIENT_SECRET'),
          refreshToken: this.get('GOOGLE_REFRESH_TOKEN'),
          chunkThreshold: this.getNumber('GOOGLE_CHUNK_THRESHOLD'),
          chunkSize: this.getNumber('CHUNK_SIZE')
        };
      
      case 'box':
        return {
          clientId: this.get('BOX_CLIENT_ID'),
          clientSecret: this.get('BOX_CLIENT_SECRET'),
          accessToken: this.get('BOX_ACCESS_TOKEN'),
          refreshToken: this.get('BOX_REFRESH_TOKEN'),
          chunkThreshold: this.getNumber('BOX_CHUNK_THRESHOLD'),
          chunkSize: this.getNumber('CHUNK_SIZE')
        };
      
      default:
        throw new Error(`Unknown service: ${serviceName}`);
    }
  }

  getPerformanceConfig() {
    return {
      maxRetryAttempts: this.getNumber('MAX_RETRY_ATTEMPTS'),
      timeoutMs: this.getNumber('TIMEOUT_MS'),
      maxConcurrentUploads: this.getNumber('MAX_CONCURRENT_UPLOADS'),
      maxConcurrentDownloads: this.getNumber('MAX_CONCURRENT_DOWNLOADS'),
      rateLimitDelay: this.getNumber('RATE_LIMIT_DELAY'),
      chunkSize: this.getNumber('CHUNK_SIZE'),
      enableProgressTracking: this.getBoolean('ENABLE_PROGRESS_TRACKING'),
      enableChecksumVerification: this.getBoolean('ENABLE_CHECKSUM_VERIFICATION')
    };
  }

  getFeatureConfig() {
    return {
      autoCreateFolders: this.getBoolean('AUTO_CREATE_FOLDERS'),
      preserveFileTimestamps: this.getBoolean('PRESERVE_FILE_TIMESTAMPS'),
      enableCompression: this.getBoolean('ENABLE_COMPRESSION'),
      compressionLevel: this.getNumber('COMPRESSION_LEVEL'),
      logLevel: this.get('LOG_LEVEL')
    };
  }

  // CRITICAL FIX: Enhanced save method with validation
  async save(filePath = '.env') {
    const envPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    
    // SAFETY CHECK: Validate all credential values before saving
    const credentialKeys = [
      'DROPBOX_ACCESS_TOKEN', 'DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET', 'DROPBOX_REFRESH_TOKEN',
      'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
      'BOX_CLIENT_ID', 'BOX_CLIENT_SECRET', 'BOX_ACCESS_TOKEN', 'BOX_REFRESH_TOKEN'
    ];
    
    const invalidCredentials = [];
    for (const key of credentialKeys) {
      const value = this.config[key];
      if (value && (value === 'undefined' || value === 'null' || value.length < 5)) {
        invalidCredentials.push(key);
      }
    }
    
    if (invalidCredentials.length > 0) {
      const error = `Refusing to save .env file with invalid credentials: ${invalidCredentials.join(', ')}`;
      console.error(`❌ ${error}`);
      throw new Error(error);
    }
    
    // Create backup of existing .env file
    let backupCreated = false;
    try {
      const backupPath = `${envPath}.backup-${Date.now()}`;
      await fs.promises.copyFile(envPath, backupPath);
      console.log(`📦 Created backup: ${backupPath}`);
      backupCreated = true;
    } catch (error) {
      // Original file might not exist, that's okay
      console.log('🔧 No existing .env file to backup');
    }

    try {
      const lines = [];

      lines.push('# Cloud File Service Configuration');
      lines.push('# Generated on ' + new Date().toISOString());
      lines.push('');

      lines.push('# =============================================================================');
      lines.push('# CLOUD PROVIDER CREDENTIALS');
      lines.push('# =============================================================================');
      lines.push('');

      lines.push('# Dropbox Configuration');
      lines.push(`DROPBOX_ACCESS_TOKEN=${this.get('DROPBOX_ACCESS_TOKEN')}`);
      lines.push(`DROPBOX_CLIENT_ID=${this.get('DROPBOX_CLIENT_ID')}`);
      lines.push(`DROPBOX_CLIENT_SECRET=${this.get('DROPBOX_CLIENT_SECRET')}`);
      lines.push(`DROPBOX_REFRESH_TOKEN=${this.get('DROPBOX_REFRESH_TOKEN')}`);
      lines.push('');

      lines.push('# Google Drive Configuration');
      lines.push(`GOOGLE_CLIENT_ID=${this.get('GOOGLE_CLIENT_ID')}`);
      lines.push(`GOOGLE_CLIENT_SECRET=${this.get('GOOGLE_CLIENT_SECRET')}`);
      lines.push(`GOOGLE_REFRESH_TOKEN=${this.get('GOOGLE_REFRESH_TOKEN')}`);
      lines.push('');

      lines.push('# Box Configuration');
      lines.push(`BOX_CLIENT_ID=${this.get('BOX_CLIENT_ID')}`);
      lines.push(`BOX_CLIENT_SECRET=${this.get('BOX_CLIENT_SECRET')}`);
      lines.push(`BOX_ACCESS_TOKEN=${this.get('BOX_ACCESS_TOKEN')}`);
      lines.push(`BOX_REFRESH_TOKEN=${this.get('BOX_REFRESH_TOKEN')}`);
      lines.push('');

      lines.push('# =============================================================================');
      lines.push('# SERVICE CONFIGURATION');
      lines.push('# =============================================================================');
      lines.push('');

      lines.push('# Default Directories');
      lines.push(`DEFAULT_BACKUP_DIRECTORY=${this.get('DEFAULT_BACKUP_DIRECTORY')}`);
      lines.push(`DEFAULT_DOWNLOAD_DIRECTORY=${this.get('DEFAULT_DOWNLOAD_DIRECTORY')}`);
      lines.push('');

      lines.push('# Performance Settings');
      lines.push(`MAX_RETRY_ATTEMPTS=${this.get('MAX_RETRY_ATTEMPTS')}`);
      lines.push(`CHUNK_SIZE=${this.get('CHUNK_SIZE')}`);
      lines.push(`TIMEOUT_MS=${this.get('TIMEOUT_MS')}`);
      lines.push('');

      lines.push('# Provider-Specific Thresholds');
      lines.push(`DROPBOX_CHUNK_THRESHOLD=${this.get('DROPBOX_CHUNK_THRESHOLD')}`);
      lines.push(`GOOGLE_CHUNK_THRESHOLD=${this.get('GOOGLE_CHUNK_THRESHOLD')}`);
      lines.push(`BOX_CHUNK_THRESHOLD=${this.get('BOX_CHUNK_THRESHOLD')}`);
      lines.push('');

      lines.push('# Concurrency and Rate Limiting');
      lines.push(`MAX_CONCURRENT_UPLOADS=${this.get('MAX_CONCURRENT_UPLOADS')}`);
      lines.push(`MAX_CONCURRENT_DOWNLOADS=${this.get('MAX_CONCURRENT_DOWNLOADS')}`);
      lines.push(`RATE_LIMIT_DELAY=${this.get('RATE_LIMIT_DELAY')}`);
      lines.push('');

      lines.push('# Feature Flags');
      lines.push(`LOG_LEVEL=${this.get('LOG_LEVEL')}`);
      lines.push(`ENABLE_PROGRESS_TRACKING=${this.get('ENABLE_PROGRESS_TRACKING')}`);
      lines.push(`ENABLE_CHECKSUM_VERIFICATION=${this.get('ENABLE_CHECKSUM_VERIFICATION')}`);
      lines.push(`AUTO_CREATE_FOLDERS=${this.get('AUTO_CREATE_FOLDERS')}`);
      lines.push(`PRESERVE_FILE_TIMESTAMPS=${this.get('PRESERVE_FILE_TIMESTAMPS')}`);
      lines.push(`ENABLE_COMPRESSION=${this.get('ENABLE_COMPRESSION')}`);
      lines.push(`COMPRESSION_LEVEL=${this.get('COMPRESSION_LEVEL')}`);

      await fs.promises.writeFile(envPath, lines.join('\n'));
      console.log('✅ .env file saved successfully');

    } catch (saveError) {
      console.error(`❌ Failed to save .env file: ${saveError.message}`);

      // If we created a backup and save failed, we could restore it
      if (backupCreated) {
        console.log('💡 Your original .env file was backed up and is safe');
      }

      throw saveError;
    }
  }

  // SAFE UPDATE METHOD: Only update specific keys without overwriting entire file
  async safeUpdate(updates) {
    const envPath = path.join(process.cwd(), '.env');

    // Validate all updates first
    for (const [key, value] of Object.entries(updates)) {
      if (!this.set(key, value)) {
        throw new Error(`Invalid value for ${key}: ${value}`);
      }
    }

    // Read existing .env file
    let existingContent = '';
    try {
      existingContent = await fs.promises.readFile(envPath, 'utf8');
    } catch (error) {
      // File doesn't exist, use empty content
    }

    // Update only the specified keys
    let updatedContent = existingContent;
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(updatedContent)) {
        updatedContent = updatedContent.replace(regex, newLine);
      } else {
        updatedContent += `\n${newLine}`;
      }
    }

    // Create backup before writing
    const backupPath = `${envPath}.backup-${Date.now()}`;
    try {
      await fs.promises.copyFile(envPath, backupPath);
      console.log(`📦 Created backup: ${backupPath}`);
    } catch (error) {
      // Original might not exist
    }

    await fs.promises.writeFile(envPath, updatedContent);
    console.log(`✅ Updated ${Object.keys(updates).length} configuration value(s)`);
  }

  async loadFromFile(filePath) {
    const envPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);

    try {
      const envContent = await fs.promises.readFile(envPath, 'utf8');
      this.parseEnvContent(envContent);
      this.applyDefaults();
      return true;
    } catch (error) {
      throw new Error(`Failed to load configuration from ${filePath}: ${error.message}`);
    }
  }

  clone() {
    const cloned = new ConfigManager();
    cloned.config = { ...this.config };
    cloned.defaults = { ...this.defaults };
    return cloned;
  }

  merge(otherConfig) {
    if (otherConfig instanceof ConfigManager) {
      Object.assign(this.config, otherConfig.config);
    } else if (typeof otherConfig === 'object') {
      Object.assign(this.config, otherConfig);
    } else {
      throw new Error('Cannot merge: invalid configuration object');
    }
  }

  reset() {
    this.config = {};
    this.applyDefaults();
  }

  getAll() {
    return { ...this.config };
  }

  getSummary() {
    const configuredServices = this.getConfiguredServices();
    const performanceConfig = this.getPerformanceConfig();
    const featureConfig = this.getFeatureConfig();
    
    return {
      configuredServices: configuredServices,
      serviceCount: configuredServices.length,
      performance: performanceConfig,
      features: featureConfig,
      directories: {
        backup: this.get('DEFAULT_BACKUP_DIRECTORY'),
        download: this.get('DEFAULT_DOWNLOAD_DIRECTORY')
      }
    };
  }
}