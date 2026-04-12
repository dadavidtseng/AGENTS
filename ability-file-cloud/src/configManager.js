/**
 * ConfigManager — Convention Section 6 compliant.
 *
 * Load order (highest priority wins):
 *   1. process.env overrides
 *   2. secrets.toml via secret-ability (ENC[] decryption)
 *   3. config.toml [cloud] section (walk-up discovery)
 *   4. .env file (legacy fallback)
 *   5. Built-in defaults
 */

import fs from 'fs';
import path from 'path';

// ── Vault-to-config key mapping ──────────────────────────────────────
// Maps secrets.toml vault sections → config keys expected by providers.

const VAULT_KEY_MAP = {
  dropbox: [
    'DROPBOX_ACCESS_TOKEN',
    'DROPBOX_CLIENT_ID',
    'DROPBOX_CLIENT_SECRET',
    'DROPBOX_REFRESH_TOKEN',
  ],
  google: [
    'GOOGLE_ACCESS_TOKEN',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REFRESH_TOKEN',
    'GOOGLE_SERVICE_ACCOUNT_KEY',
    'GOOGLE_SERVICE_ACCOUNT_KEY_PATH',
  ],
  box: [
    'BOX_ACCESS_TOKEN',
    'BOX_CLIENT_ID',
    'BOX_CLIENT_SECRET',
    'BOX_REFRESH_TOKEN',
  ],
};

export class ConfigManager {
  constructor() {
    this.config = {};
    this.defaults = {
      // Dropbox
      DROPBOX_ACCESS_TOKEN: '',
      DROPBOX_CLIENT_ID: '',
      DROPBOX_CLIENT_SECRET: '',
      DROPBOX_REFRESH_TOKEN: '',
      // Google Drive
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_REFRESH_TOKEN: '',
      GOOGLE_SERVICE_ACCOUNT_KEY: '',
      GOOGLE_SERVICE_ACCOUNT_KEY_PATH: '',
      GOOGLE_SHARED_FOLDER_NAME: 'KADI',
      // Box
      BOX_CLIENT_ID: '',
      BOX_CLIENT_SECRET: '',
      BOX_ACCESS_TOKEN: '',
      BOX_REFRESH_TOKEN: '',
      // General
      DEFAULT_BACKUP_DIRECTORY: '/cloud-file-manager',
      DEFAULT_DOWNLOAD_DIRECTORY: './downloads',
      MAX_RETRY_ATTEMPTS: '3',
      CHUNK_SIZE: '8388608',
      TIMEOUT_MS: '300000',
      // Performance
      DROPBOX_CHUNK_THRESHOLD: '157286400',
      GOOGLE_CHUNK_THRESHOLD: '5242880',
      BOX_CHUNK_THRESHOLD: '20971520',
      // Rate Limiting
      MAX_CONCURRENT_UPLOADS: '3',
      MAX_CONCURRENT_DOWNLOADS: '5',
      RATE_LIMIT_DELAY: '1000',
      // Logging
      LOG_LEVEL: 'info',
      ENABLE_PROGRESS_TRACKING: 'true',
      ENABLE_CHECKSUM_VERIFICATION: 'true',
      // Features
      AUTO_CREATE_FOLDERS: 'true',
      PRESERVE_FILE_TIMESTAMPS: 'true',
      ENABLE_COMPRESSION: 'false',
      COMPRESSION_LEVEL: '6',
    };
  }

  // ====================================================================
  // LOAD — Convention Section 6 compliant
  // ====================================================================

  /**
   * Load configuration.  Accepts an optional KadiClient for vault access.
   * @param {object} [kadiClient] — KadiClient instance for loadNative('secret-ability')
   */
  async load(kadiClient) {
    // 1. config.toml [cloud] section (walk-up discovery)
    this._loadConfigToml();

    // 2. .env fallback (legacy)
    await this._loadDotEnv();

    // 3. secrets.toml via secret-ability (decrypts ENC[] values)
    if (kadiClient) {
      await this._loadSecretsFromVault(kadiClient);
    }

    // 4. process.env overrides (highest priority)
    this._loadFromEnvironment();

    // 5. Apply defaults for anything still missing
    this._applyDefaults();

    // Validate
    const validation = this.validate();
    if (!validation.isValid) {
      console.warn('[file-cloud] Config validation warnings:');
      validation.errors.forEach(e => console.warn(`  - ${e}`));
    }

    const services = this.getConfiguredServices();
    console.log(`[file-cloud] Configured providers: ${services.length ? services.join(', ') : 'none'}`);
  }

  // ── config.toml walk-up loader ─────────────────────────────────────

  _loadConfigToml() {
    const configPath = this._walkUp('config.toml');
    if (!configPath) return;

    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = this._parseToml(raw);

      // Load [cloud] section settings
      const cloud = parsed.cloud || {};
      for (const [key, value] of Object.entries(cloud)) {
        if (value !== undefined && value !== null) {
          this.config[key.toUpperCase()] = String(value);
        }
      }

      // Load [broker.*] sections for broker URL discovery
      if (parsed.broker) {
        for (const [name, section] of Object.entries(parsed.broker)) {
          if (section.URL) this.config[`BROKER_${name.toUpperCase()}_URL`] = section.URL;
          if (section.NETWORKS) this.config[`BROKER_${name.toUpperCase()}_NETWORKS`] = section.NETWORKS;
          if (section.MODE) this.config[`BROKER_${name.toUpperCase()}_MODE`] = section.MODE;
        }
      }

      console.log(`[file-cloud] config.toml loaded from ${configPath}`);
    } catch (err) {
      console.warn(`[file-cloud] Failed to parse config.toml: ${err.message}`);
    }
  }

  // ── secrets.toml via secret-ability ────────────────────────────────

  async _loadSecretsFromVault(kadiClient) {
    let secretAbility;
    try {
      secretAbility = await kadiClient.loadNative('secret-ability');
      console.log('[file-cloud] secret-ability loaded natively');
    } catch (err) {
      console.warn(`[file-cloud] Could not load secret-ability: ${err.message}`);
      console.warn('[file-cloud] Secrets from vault will not be available — using env/config only');
      return;
    }

    try {
      for (const [vault, keys] of Object.entries(VAULT_KEY_MAP)) {
        for (const key of keys) {
          // Skip if already set by env var (higher priority)
          if (process.env[key]) continue;
          // Skip if already set by config.toml
          if (this.config[key] && this.config[key] !== '' && this.config[key] !== this.defaults[key]) continue;

          try {
            const result = await secretAbility.invoke('get', { vault, key });
            if (result?.value) {
              this.config[key] = result.value;
            }
          } catch {
            // Key not in vault — that's fine
          }
        }
      }
      console.log('[file-cloud] Secrets loaded from vault');
    } catch (err) {
      console.warn(`[file-cloud] Error loading secrets from vault: ${err.message}`);
    } finally {
      try { await secretAbility.disconnect(); } catch { /* ignore */ }
    }
  }

  // ── .env fallback (legacy) ─────────────────────────────────────────

  async _loadDotEnv() {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const content = await fs.promises.readFile(envPath, 'utf8');
      this._parseEnvContent(content);
    } catch {
      // No .env file — that's fine under Convention 6
    }
  }

  _parseEnvContent(content) {
    for (const line of content.split('\n')) {
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

  // ── process.env overrides ──────────────────────────────────────────

  _loadFromEnvironment() {
    for (const key of Object.keys(this.defaults)) {
      if (process.env[key]) {
        this.config[key] = process.env[key];
      }
    }
  }

  _applyDefaults() {
    for (const [key, defaultValue] of Object.entries(this.defaults)) {
      if (!this.config[key]) {
        this.config[key] = defaultValue;
      }
    }
  }

  // ====================================================================
  // WALK-UP DISCOVERY
  // ====================================================================

  _walkUp(filename) {
    let dir = process.cwd();
    while (true) {
      const candidate = path.join(dir, filename);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  // ====================================================================
  // MINIMAL TOML PARSER (handles sections, key=value, quoted strings)
  // ====================================================================

  _parseToml(content) {
    const result = {};
    let currentSection = null;
    let currentSubSection = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // [section.subsection]
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        const parts = sectionMatch[1].split('.');
        currentSection = parts[0];
        currentSubSection = parts.length > 1 ? parts.slice(1).join('.') : null;
        if (!result[currentSection]) result[currentSection] = {};
        if (currentSubSection && !result[currentSection][currentSubSection]) {
          result[currentSection][currentSubSection] = {};
        }
        continue;
      }

      // key = value
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (kvMatch) {
        const [, key, rawValue] = kvMatch;
        let value = rawValue.trim();
        // Strip quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // Parse arrays
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            value = JSON.parse(value);
          } catch {
            value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
          }
        }

        if (currentSubSection && currentSection) {
          result[currentSection][currentSubSection][key] = value;
        } else if (currentSection) {
          result[currentSection][key] = value;
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  // ====================================================================
  // GETTERS / SETTERS
  // ====================================================================

  get(key) {
    return this.config[key];
  }

  getNumber(key) {
    const value = this.get(key);
    const n = value ? parseInt(value, 10) : 0;
    return isNaN(n) ? 0 : n;
  }

  getBoolean(key) {
    const value = this.get(key);
    return value && ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  getFloat(key) {
    const value = this.get(key);
    const n = value ? parseFloat(value) : 0.0;
    return isNaN(n) ? 0.0 : n;
  }

  set(key, value) {
    if (value === undefined || value === null || value === 'undefined' || value === 'null') {
      console.warn(`[file-cloud] Attempted to set ${key} to invalid value: ${value}. Skipping.`);
      return false;
    }
    const stringValue = String(value).trim();
    if (!stringValue) {
      console.warn(`[file-cloud] Attempted to set ${key} to empty value. Skipping.`);
      return false;
    }
    if (this.isCredentialKey(key) && stringValue.length < 10) {
      console.warn(`[file-cloud] Credential ${key} appears too short (${stringValue.length} chars). Skipping.`);
      return false;
    }
    this.config[key] = stringValue;
    return true;
  }

  has(key) {
    return key in this.config && this.config[key] !== '';
  }

  isCredentialKey(key) {
    return [
      'DROPBOX_ACCESS_TOKEN', 'DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET', 'DROPBOX_REFRESH_TOKEN',
      'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
      'BOX_CLIENT_ID', 'BOX_CLIENT_SECRET', 'BOX_ACCESS_TOKEN', 'BOX_REFRESH_TOKEN',
    ].includes(key);
  }

  // ====================================================================
  // VALIDATION
  // ====================================================================

  validate() {
    const errors = [];
    const warnings = [];
    const configuredServices = this.getConfiguredServices();

    if (configuredServices.length === 0) {
      errors.push('No cloud providers configured (need credentials for Dropbox, Google Drive, or Box)');
    }

    this._validateDropbox(errors, warnings);
    this._validateGoogle(errors, warnings);
    this._validateBox(errors, warnings);

    return { isValid: errors.length === 0, errors, warnings, configuredServices };
  }

  _validateDropbox(errors, warnings) {
    const has = k => this.has(k);
    if (has('DROPBOX_ACCESS_TOKEN') || has('DROPBOX_CLIENT_ID')) {
      if (!has('DROPBOX_ACCESS_TOKEN')) errors.push('DROPBOX_ACCESS_TOKEN required');
      if ((has('DROPBOX_CLIENT_ID') || has('DROPBOX_CLIENT_SECRET') || has('DROPBOX_REFRESH_TOKEN')) &&
          (!has('DROPBOX_CLIENT_ID') || !has('DROPBOX_CLIENT_SECRET'))) {
        warnings.push('Dropbox OAuth credentials incomplete — refresh may fail');
      }
    }
  }

  _validateGoogle(errors, warnings) {
    const has = k => this.has(k);
    if (has('GOOGLE_CLIENT_ID') || has('GOOGLE_CLIENT_SECRET') || has('GOOGLE_REFRESH_TOKEN')) {
      if (!has('GOOGLE_CLIENT_ID')) errors.push('GOOGLE_CLIENT_ID required');
      if (!has('GOOGLE_CLIENT_SECRET')) errors.push('GOOGLE_CLIENT_SECRET required');
      if (!has('GOOGLE_REFRESH_TOKEN')) errors.push('GOOGLE_REFRESH_TOKEN required');
    }
  }

  _validateBox(errors, warnings) {
    const has = k => this.has(k);
    if (has('BOX_CLIENT_ID') || has('BOX_CLIENT_SECRET') || has('BOX_ACCESS_TOKEN')) {
      if (!has('BOX_CLIENT_ID')) errors.push('BOX_CLIENT_ID required');
      if (!has('BOX_CLIENT_SECRET')) errors.push('BOX_CLIENT_SECRET required');
      if (!has('BOX_ACCESS_TOKEN') && !has('BOX_REFRESH_TOKEN')) {
        errors.push('BOX_ACCESS_TOKEN or BOX_REFRESH_TOKEN required');
      }
    }
  }

  // ====================================================================
  // SERVICE DISCOVERY
  // ====================================================================

  getConfiguredServices() {
    const services = [];
    if (this.has('DROPBOX_ACCESS_TOKEN')) services.push('dropbox');
    if (this.has('GOOGLE_CLIENT_ID') && this.has('GOOGLE_CLIENT_SECRET') && this.has('GOOGLE_REFRESH_TOKEN')) {
      services.push('googledrive');
    }
    if (this.has('BOX_CLIENT_ID') && this.has('BOX_CLIENT_SECRET') &&
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
          chunkSize: this.getNumber('CHUNK_SIZE'),
        };
      case 'googledrive':
        return {
          clientId: this.get('GOOGLE_CLIENT_ID'),
          clientSecret: this.get('GOOGLE_CLIENT_SECRET'),
          refreshToken: this.get('GOOGLE_REFRESH_TOKEN'),
          serviceAccountKey: this.get('GOOGLE_SERVICE_ACCOUNT_KEY'),
          serviceAccountKeyPath: this.get('GOOGLE_SERVICE_ACCOUNT_KEY_PATH'),
          sharedFolderName: this.get('GOOGLE_SHARED_FOLDER_NAME') || 'KADI',
          chunkThreshold: this.getNumber('GOOGLE_CHUNK_THRESHOLD'),
          chunkSize: this.getNumber('CHUNK_SIZE'),
        };
      case 'box':
        return {
          clientId: this.get('BOX_CLIENT_ID'),
          clientSecret: this.get('BOX_CLIENT_SECRET'),
          accessToken: this.get('BOX_ACCESS_TOKEN'),
          refreshToken: this.get('BOX_REFRESH_TOKEN'),
          chunkThreshold: this.getNumber('BOX_CHUNK_THRESHOLD'),
          chunkSize: this.getNumber('CHUNK_SIZE'),
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
      enableChecksumVerification: this.getBoolean('ENABLE_CHECKSUM_VERIFICATION'),
    };
  }

  getFeatureConfig() {
    return {
      autoCreateFolders: this.getBoolean('AUTO_CREATE_FOLDERS'),
      preserveFileTimestamps: this.getBoolean('PRESERVE_FILE_TIMESTAMPS'),
      enableCompression: this.getBoolean('ENABLE_COMPRESSION'),
      compressionLevel: this.getNumber('COMPRESSION_LEVEL'),
      logLevel: this.get('LOG_LEVEL'),
    };
  }
}
