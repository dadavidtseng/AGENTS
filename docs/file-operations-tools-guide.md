# File Operations Tools - User Guide

## Overview

template-agent-typescript now exposes file-management-ability operations as KADI tools that can be called from Discord, Slack, or any KADI client.

## Architecture

```
Discord/Slack User
      ↓
template-agent-typescript (KADI Agent)
      ↓
KADI Tools (upload_file_ssh, download_file_ssh, execute_remote_command)
      ↓
FileOperationsProxy (Result<T, E> error handling)
      ↓
file-management-ability (Native ES Import)
      ↓
SSH/SCP Commands
```

## Available Tools

### 1. upload_file_ssh

Upload a file to a remote server via SSH/SCP.

**Parameters:**
- `host` (string, required) - SSH host address (e.g., "server.example.com")
- `username` (string, required) - SSH username
- `localPath` (string, required) - Local file path to upload
- `remotePath` (string, required) - Remote destination path
- `privateKey` (string, optional) - Path to SSH private key (defaults to ~/.ssh/id_rsa)

**Returns:**
```typescript
{
  success: boolean,
  message: string,
  host?: string,
  localPath?: string,
  remotePath?: string
}
```

**Example Discord Command:**
```
@template-agent upload file /home/user/data.txt to myserver.com:/opt/data/data.txt using key ~/.ssh/id_rsa
```

### 2. download_file_ssh

Download a file from a remote server via SSH/SCP.

**Parameters:**
- `host` (string, required) - SSH host address
- `username` (string, required) - SSH username
- `remotePath` (string, required) - Remote file path to download
- `localPath` (string, required) - Local destination path
- `privateKey` (string, optional) - Path to SSH private key

**Returns:**
```typescript
{
  success: boolean,
  message: string,
  host?: string,
  remotePath?: string,
  localPath?: string
}
```

**Example Discord Command:**
```
@template-agent download myserver.com:/opt/logs/app.log to ./logs/app.log
```

### 3. execute_remote_command

Execute a command on a remote server via SSH.

⚠️ **NOTE:** This feature is **NOT SUPPORTED** in native transport mode. The tool will gracefully return an error explaining that broker transport is required.

**Parameters:**
- `host` (string, required) - SSH host address
- `username` (string, required) - SSH username
- `command` (string, required) - Command to execute
- `privateKey` (string, optional) - Path to SSH private key

**Returns:**
```typescript
{
  success: boolean,
  message: string,
  stdout?: string,
  stderr?: string,
  exitCode?: number
}
```

## Error Handling

All tools use structured error handling with:
- **Error codes** (e.g., `SSH_AUTH_FAILED`, `FILE_NOT_FOUND`, `NETWORK_ERROR`)
- **Error messages** with context
- **Host and file path tracking** for debugging

Example error response:
```typescript
{
  success: false,
  message: "Upload failed: Permission denied (Error code: SSH_AUTH_FAILED)",
  host: "server.example.com",
  localPath: "/home/user/data.txt",
  remotePath: "/opt/data/data.txt"
}
```

## Testing

### Unit Tests
```bash
npm test -- test/integration/file-operations-native.test.ts
```

### Manual Verification
```bash
npx tsx test/manual/verify-native-transport.ts
```

## Security Considerations

1. **Private Keys**: Tools accept private key paths, not key content. Keys remain on disk.
2. **Error Messages**: Error messages may contain file paths and hostnames for debugging.
3. **Authentication**: Use SSH key-based authentication instead of passwords.
4. **Permissions**: Ensure the agent process has appropriate file system permissions.

## Implementation Details

### Native Transport
- **Zero network overhead** - Direct ES module imports
- **No broker required** - file-management-ability loaded via `import()`
- **Type-safe** - Full TypeScript type checking with Result<T, E> pattern

### File Structure
```
src/
├── tools/
│   ├── file-upload-ssh.ts       # Upload tool registration
│   ├── file-download-ssh.ts     # Download tool registration
│   ├── file-execute-remote.ts   # Remote command tool (not supported)
│   └── index.ts                 # Tool registry
├── abilities/
│   ├── file-operations-proxy.ts # Result<T, E> wrapper
│   ├── errors.ts                # Error types and factories
│   └── file-management-ability.d.ts # Type declarations
└── index.ts                     # Main agent entry point
```

## Logs

Tools log all operations for debugging:

```
[template-agent] Info: Executing SSH upload: /local/file.txt -> user@host:/remote/file.txt
[template-agent] Info: SSH upload completed successfully
```

## Future Enhancements

- [ ] Add support for remote command execution (requires broker transport)
- [ ] Add file compression before transfer
- [ ] Add progress tracking for large files
- [ ] Add batch operations (upload/download multiple files)
- [ ] Add SFTP support as alternative to SCP

## Troubleshooting

### "Connection refused" errors
- Verify SSH server is running on the target host
- Check firewall settings
- Verify host is reachable: `ping <host>`

### "Permission denied" errors
- Verify SSH key has correct permissions (chmod 600)
- Verify user has access to the remote path
- Check SSH key is registered on remote server (~/.ssh/authorized_keys)

### "File not found" errors
- Verify local file exists before uploading
- Verify remote file exists before downloading
- Use absolute paths when possible

## Support

For issues or questions:
1. Check logs in console output
2. Verify SSH access manually: `ssh user@host`
3. Test SCP manually: `scp local.txt user@host:/remote/`
4. File issue in template-agent-typescript repository
