# Cloud File Service Manager

A comprehensive Node.js CLI tool and library for managing files across multiple cloud storage providers: **Dropbox**, **Google Drive**, and **Box**. This service provides a unified interface for cloud file operations, making it easy to integrate cloud storage into any application or workflow.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16.0.0-green.svg)](https://nodejs.org/)
[![npm version](https://badge.fury.io/js/cloud-file-service.svg)](https://www.npmjs.com/package/cloud-file-service)

## 🌟 Features

- **🌐 Multi-Cloud Support**: Unified interface for Dropbox, Google Drive, and Box
- **📁 Complete File Management**: Full CRUD operations for files and folders
- **🔍 Advanced Search**: Find files across all cloud providers with powerful search capabilities
- **📤 Smart Uploads**: Automatic chunked uploads for large files with progress tracking
- **🔐 OAuth 2.0 Support**: Secure authentication with refresh token management
- **🛠️ CLI & Library**: Use as command-line tool or integrate as Node.js library
- **🔄 Robust Error Handling**: Comprehensive error handling and retry logic
- **📊 Progress Tracking**: Real-time progress for long-running operations
- **🎯 Path Management**: Automatic folder creation and path normalization
- **⚡ Performance Optimized**: Efficient memory usage and streaming for large files
- **🧪 Comprehensive Testing**: Full test suite for reliability

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [OAuth Setup](#oauth-setup)
- [CLI Usage](#cli-usage)
- [Library Usage](#library-usage)
- [Testing](#testing)
- [API Reference](#api-reference)
- [Performance](#performance)
- [Contributing](#contributing)

## 🚀 Installation

### As a CLI Tool
```bash
git clone <repository-url>
cd cloud-file-service
npm install
npm run setup
```

### As a Node.js Library
```bash
npm install cloud-file-service
```

```javascript
const { CloudStorageManager, ConfigManager } = require('cloud-file-service');

// Initialize the service
const config = new ConfigManager();
await config.load();
const cloudManager = new CloudStorageManager(config);

// Use the service
await cloudManager.uploadFile('dropbox', './myfile.zip', '/backups/myfile.zip');
```

## ⚡ Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up configuration**
   ```bash
   cp .env_example .env
   # Edit .env with your cloud provider credentials
   ```

3. **Test your configuration**
   ```bash
   npm test
   # or test specific provider
   npm run test:dropbox
   ```

4. **Upload your first file**
   ```bash
   node index.js upload --file document.pdf --service dropbox
   ```

## ⚙️ Configuration

### Environment Variables Setup

Create a `.env` file in your project root:

```bash
cp .env.example .env
# Edit .env with your cloud provider credentials
```

### Required Credentials

| Provider | Required Variables |
|----------|-------------------|
| **Dropbox** | `DROPBOX_ACCESS_TOKEN` or OAuth setup |
| **Google Drive** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| **Box** | `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ACCESS_TOKEN` |

### Validation

Check your configuration:
```bash
npm run validate
npm run info  # Show configured services
```

## 🔐 OAuth Setup

### Automated OAuth Setup (Recommended)

#### Dropbox OAuth Setup
```bash
npm run setup:dropbox
```
This will:
- Open your browser for authorization
- Handle the OAuth flow automatically
- Save refresh tokens to `.env`
- Test the connection

#### Google Drive OAuth Setup
```bash
npm run setup:googledrive
```
This will:
- Guide you through Google Cloud Console setup
- Handle the OAuth flow automatically
- Save refresh tokens to `.env`
- Test the connection

### Manual OAuth Setup

If the automated setup fails:

```bash
# Dropbox manual token exchange
npm run setup:dropbox-manual

# Google Drive manual token exchange
npm run setup:googledrive-manual
```

### Cloud Provider Setup Guides

<details>
<summary><strong>📦 Dropbox Setup</strong></summary>

1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Create a new app with "Scoped access" and "Full Dropbox" access
3. Enable these permissions in the Permissions tab:
   - `files.metadata.read` - View file and folder metadata
   - `files.metadata.write` - Edit file and folder metadata
   - `files.content.read` - View file contents
   - `files.content.write` - Edit file contents
4. Add redirect URI: `http://localhost:8080/callback`
5. **Automated setup**: Run `npm run setup:dropbox`
6. **Manual setup**: Generate access token and add to `.env`

</details>

<details>
<summary><strong>🌐 Google Drive Setup</strong></summary>

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Drive API
4. Configure OAuth consent screen with external user type
5. Create OAuth 2.0 credentials (Desktop application type)
6. Add redirect URI: `http://localhost:8080/callback`
7. **Automated setup**: Run `npm run setup:googledrive`
8. **Manual setup**: Use OAuth playground to get refresh token

</details>

<details>
<summary><strong>📊 Box Setup</strong></summary>

1. Go to [Box Developer Console](https://developer.box.com/)
2. Create a new "Custom App" with "Standard OAuth 2.0"
3. Configure OAuth settings and get client credentials
4. Add redirect URI: `http://localhost:8080/callback`
5. Use OAuth flow to obtain access and refresh tokens
6. Add credentials to your `.env` file

</details>

## 💻 CLI Usage

### Basic Commands

**Test connections:**
```bash
node index.js test                    # Test all configured services
node index.js test --service dropbox  # Test specific service
```

**Upload files:**
```bash
node index.js upload --file document.pdf --service dropbox
node index.js upload --file archive.zip --service googledrive --directory /documents
```

**Download files:**
```bash
node index.js download --service dropbox --remote /uploads/document.pdf
node index.js download --service googledrive --remote /documents/archive.zip --local ./downloads
```

**List files:**
```bash
node index.js list --service dropbox                    # List files in default directory
node index.js list --service googledrive --directory /documents
```

### Advanced Operations

**File management:**
```bash
# Copy files
node index.js copy --service dropbox --remote /file.pdf --destination /backup/file.pdf

# Rename files
node index.js rename --service googledrive --remote /old-name.pdf --name new-name.pdf

# Delete files
node index.js delete --service box --remote /old-file.pdf --yes

# Get file information
node index.js info --service dropbox --remote /uploads/document.pdf
```

**Folder operations:**
```bash
# Create folders
node index.js mkdir --service dropbox --remote /new-project-folder

# List folders
node index.js ls-folders --service googledrive --directory /projects

# Delete folders
node index.js rmdir --service box --remote /old-project --force --yes
```

**Search files:**
```bash
node index.js search --service googledrive --query "quarterly report"
node index.js search --service dropbox --query "*.pdf" --limit 50
```

### Automated Scripts

```bash
# Run comprehensive tests
npm test
npm run test:all

# Clean up test files
npm run clean

# Setup all providers
npm run setup
```

## 📚 Library Usage

### Basic Integration

```javascript
const { CloudStorageManager, ConfigManager } = require('cloud-file-service');

class MyApp {
  constructor() {
    this.config = new ConfigManager();
    this.cloudManager = null;
  }

  async initialize() {
    await this.config.load();
    this.cloudManager = new CloudStorageManager(this.config);
    
    // Validate configuration
    const validation = this.config.validate();
    if (!validation.isValid) {
      throw new Error(`Configuration errors: ${validation.errors.join(', ')}`);
    }
  }

  async uploadFile(provider, localPath, remotePath) {
    return await this.cloudManager.uploadFile(provider, localPath, remotePath);
  }

  async listFiles(provider, directory = '/') {
    return await this.cloudManager.listFiles(provider, directory);
  }
}
```

### Advanced Integration

```javascript
const { CloudStorageManager, ConfigManager } = require('cloud-file-service');

class DocumentManager {
  constructor() {
    this.config = new ConfigManager();
    this.cloudManager = null;
  }

  async initialize() {
    await this.config.load();
    this.cloudManager = new CloudStorageManager(this.config);
  }

  async backupDocument(document, metadata = {}) {
    const timestamp = new Date().toISOString().split('T')[0];
    const remotePath = `/backups/${timestamp}/${document.name}`;
    
    try {
      // Upload to primary storage
      const result = await this.cloudManager.uploadFile(
        'dropbox', 
        document.path, 
        remotePath
      );
      
      // Create backup copy on secondary storage
      await this.cloudManager.uploadFile(
        'googledrive', 
        document.path, 
        remotePath
      );
      
      return {
        success: true,
        primary: { service: 'dropbox', fileId: result.id },
        backup: { service: 'googledrive', path: remotePath },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Document backup failed: ${error.message}`);
    }
  }

  async syncDocuments(sourceProvider, targetProvider, directory = '/') {
    const files = await this.cloudManager.listFiles(sourceProvider, directory);
    const results = [];

    for (const file of files) {
      try {
        // Download from source
        const localPath = `./temp/${file.name}`;
        await this.cloudManager.downloadFile(sourceProvider, file.path, localPath);
        
        // Upload to target
        await this.cloudManager.uploadFile(targetProvider, localPath, file.path);
        
        // Clean up temp file
        await fs.unlink(localPath);
        
        results.push({ file: file.name, status: 'synced' });
      } catch (error) {
        results.push({ file: file.name, status: 'failed', error: error.message });
      }
    }
    
    return results;
  }
}
```

### Batch Operations

```javascript
// Upload multiple files
const uploadResults = await cloudManager.uploadMultipleFiles(
  'dropbox',
  ['./file1.pdf', './file2.pdf', './file3.pdf'],
  '/batch-upload'
);

// Download multiple files
const downloadResults = await cloudManager.downloadMultipleFiles(
  'googledrive',
  ['/docs/file1.pdf', '/docs/file2.pdf'],
  './downloads'
);

// Sync directories
const syncResults = await cloudManager.syncDirectory(
  'dropbox',
  './local-folder',
  '/remote-folder',
  { dryRun: false, deleteRemote: false, overwrite: true }
);
```

## 🧪 Testing

### Automated Testing

Run comprehensive tests for all providers:
```bash
npm test                    # Interactive test selection
npm run test:all           # Test all providers sequentially
npm run test:dropbox       # Test Dropbox only
npm run test:googledrive   # Test Google Drive only
npm run test:box           # Test Box only
```

### Test Categories

The test suite includes:

- **Connection & Authentication** - Verify credentials and API access
- **Basic File Operations** - Upload, download, list, info
- **Folder Operations** - Create, delete, rename, list
- **File Management** - Copy, rename, delete operations
- **Search & Query** - File search functionality
- **Large File Handling** - Chunked upload/download for 2MB+ files
- **Edge Cases & Error Handling** - Invalid paths, missing files
- **Performance & Stress** - Batch operations, timing tests

### Test Results

Tests generate detailed reports in `./test-results/` with:
- Pass/fail statistics
- Performance metrics
- Error details
- Timing information

### Cleanup

Clean up test artifacts:
```bash
npm run clean  # Remove test files and directories
```

## 📖 API Reference

### CloudStorageManager

#### File Operations
- `uploadFile(serviceName, localPath, remotePath)` - Upload a file
- `downloadFile(serviceName, remotePath, localPath)` - Download a file
- `getFileInfo(serviceName, remotePath)` - Get file metadata
- `listFiles(serviceName, remotePath, options)` - List files in directory
- `deleteFile(serviceName, remotePath)` - Delete a file
- `renameFile(serviceName, remotePath, newName)` - Rename a file
- `copyFile(serviceName, sourcePath, destinationPath)` - Copy a file

#### Folder Operations
- `createFolder(serviceName, remotePath)` - Create a folder
- `listFolders(serviceName, remotePath)` - List folders in directory
- `deleteFolder(serviceName, remotePath, recursive)` - Delete a folder
- `renameFolder(serviceName, remotePath, newName)` - Rename a folder
- `getFolderInfo(serviceName, remotePath)` - Get folder metadata

#### Search & Utility
- `searchFiles(serviceName, query, options)` - Search for files
- `testConnection(serviceName)` - Test service connection
- `getAvailableServices()` - Get list of configured services

#### Batch Operations
- `uploadMultipleFiles(serviceName, fileList, directory)` - Upload multiple files
- `downloadMultipleFiles(serviceName, fileList, directory)` - Download multiple files
- `syncDirectory(serviceName, localDir, remoteDir, options)` - Sync directories

### ConfigManager

- `load()` - Load configuration from environment
- `get(key)` - Get configuration value
- `set(key, value)` - Set configuration value
- `validate()` - Validate current configuration
- `getConfiguredServices()` - Get list of configured services
- `getSummary()` - Get configuration summary

## ⚡ Performance

### Provider Features Matrix

| Feature | Dropbox | Google Drive | Box |
|---------|---------|--------------|-----|
| File Upload/Download | ✅ | ✅ | ✅ |
| Large File Chunking | ✅ (150MB+) | ✅ (5MB+) | ✅ (20MB+) |
| Progress Tracking | ✅ | ✅ | ✅ |
| Checksum Verification | ✅ (SHA256) | ✅ (MD5) | ✅ (SHA1) |
| Folder Operations | ✅ | ✅ | ✅ |
| File Search | ✅ | ✅ | ✅ |
| OAuth Refresh | ✅ | ✅ | ✅ |
| Batch Operations | ✅ | ✅ | ✅ |

### Performance Optimizations

- **Automatic Chunking**: Large files split into optimal chunks per provider
- **Memory Efficiency**: Streaming uploads minimize memory usage
- **Retry Logic**: Automatic retry with exponential backoff
- **Concurrent Operations**: Parallel uploads/downloads where supported
- **Token Management**: Automatic refresh prevents authentication failures

### Best Practices

```javascript
// Use batch operations for multiple files
const results = await cloudManager.uploadMultipleFiles(
  'dropbox', 
  fileList, 
  '/uploads'
);

// Handle large files efficiently
const result = await cloudManager.uploadFile(
  'googledrive',
  './large-file.zip',  // Automatically uses chunked upload
  '/backups/large-file.zip'
);

// Monitor progress for long operations
console.log('Upload completed:', result.name);
```

## 🔧 Error Handling

The service provides comprehensive error handling for:

- **Authentication Errors**: Invalid or expired tokens (automatic refresh)
- **Network Issues**: Connection timeouts and retries
- **File Operations**: Not found, permission denied, quota exceeded
- **Rate Limiting**: Automatic backoff and retry logic
- **Validation Errors**: Invalid parameters and configurations

### Error Types

```javascript
try {
  await cloudManager.uploadFile('dropbox', './file.pdf', '/upload/file.pdf');
} catch (error) {
  if (error.message.includes('quota_exceeded')) {
    console.log('Storage quota exceeded');
  } else if (error.message.includes('unauthorized')) {
    console.log('Authentication failed - check credentials');
  } else if (error.message.includes('not_found')) {
    console.log('File or folder not found');
  }
}
```

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
git clone <repository-url>
cd cloud-file-service
npm install
npm run setup
```

### Adding New Providers

1. Create provider file in `src/providers/`
2. Implement all methods from `spec.md`
3. Add configuration support in `configManager.js`
4. Update `cloudStorageManager.js`
5. Add comprehensive tests
6. Update documentation

### Testing Contributions

```bash
npm run lint          # Check code style
npm run validate      # Validate configuration
npm test             # Run test suite
```

### Guidelines

- Follow the Provider Integration Guide in `Cloud Provider Integration Spec.md`
- Maintain feature parity across providers
- Add comprehensive error handling
- Include performance optimizations
- Update documentation

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [Create an issue](https://github.com/cloud-file-service/cloud-file-service/issues)
- **Discussions**: [GitHub Discussions](https://github.com/cloud-file-service/cloud-file-service/discussions)
- **Documentation**: Check this README and `spec.md`

### Common Issues

**"Provider not configured" error:**
- Run `npm run validate` to check configuration
- Run `npm run info` to see configured services
- Check `.env` file has correct credentials

**OAuth setup fails:**
- Ensure redirect URI is `http://localhost:8080/callback`
- Check firewall/antivirus isn't blocking port 8080
- Try manual setup: `npm run setup:dropbox-manual`

**Large file upload issues:**
- Check stable internet connection
- Monitor progress output for specific errors
- Verify sufficient storage quota in cloud provider

---

**Cloud File Service Manager - Unified cloud storage for any application 🚀**