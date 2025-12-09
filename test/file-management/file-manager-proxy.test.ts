/**
 * FileManagerProxy Unit Tests
 *
 * Tests file management operations with mocked KadiClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FileManagerProxy,
  type FileServerInfo,
  type CloudFileInfo,
  type ContainerShareInfo,
  type SSHCommandResult,
} from '../../src/file-management/file-manager-proxy.js';
import { FileErrorType } from '../../src/common/types.js';
import type { KadiClient } from '@kadi.build/core';

describe('FileManagerProxy', () => {
  let proxy: FileManagerProxy;
  let mockInvokeTool: ReturnType<typeof vi.fn>;
  let mockKadiClient: KadiClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mocks for each test
    mockInvokeTool = vi.fn();
    const mockBrokerProtocol = {
      invokeTool: mockInvokeTool,
    };
    mockKadiClient = {
      getBrokerProtocol: vi.fn().mockReturnValue(mockBrokerProtocol),
    } as unknown as KadiClient;

    proxy = new FileManagerProxy(mockKadiClient);
  });

  describe('Local/Remote File Server', () => {
    describe('startFileServer', () => {
      it('should start file server with default port', async () => {
        const mockResult = {
          serverId: 'server-123',
          localUrl: 'http://localhost:8080',
          tunnelUrl: 'https://abc123.tunnel.com',
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.startFileServer('/path/to/files');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.serverId).toBe('server-123');
          expect(result.data.localUrl).toBe('http://localhost:8080');
          expect(result.data.tunnelUrl).toBe('https://abc123.tunnel.com');
        }

        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'local-remote-file-manager',
          toolName: 'start-file-server',
          toolInput: {
            directory: '/path/to/files',
            port: 8080,
          },
          timeout: 30000,
        });
      });

      it('should start file server with custom port', async () => {
        const mockResult = {
          serverId: 'server-456',
          localUrl: 'http://localhost:3000',
          tunnelUrl: 'https://xyz789.tunnel.com',
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.startFileServer('/path/to/files', 3000);

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith(
          expect.objectContaining({
            toolInput: expect.objectContaining({
              port: 3000,
            }),
          })
        );
      });

      it('should handle snake_case response format', async () => {
        const mockResult = {
          server_id: 'server-789',
          local_url: 'http://localhost:8080',
          tunnel_url: 'https://def456.tunnel.com',
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.startFileServer('/path/to/files');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.serverId).toBe('server-789');
          expect(result.data.localUrl).toBe('http://localhost:8080');
          expect(result.data.tunnelUrl).toBe('https://def456.tunnel.com');
        }
      });

      it('should return error when protocol not initialized', async () => {
        const clientWithoutProtocol = {
          getBrokerProtocol: vi.fn().mockReturnValue(null),
        } as unknown as KadiClient;
        const proxyWithoutProtocol = new FileManagerProxy(clientWithoutProtocol);

        const result = await proxyWithoutProtocol.startFileServer('/path/to/files');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.KADI_PROTOCOL_ERROR);
        }
      });

      it('should return error on invocation failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Connection failed'));

        const result = await proxy.startFileServer('/path/to/files');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.START_SERVER_FAILED);
          expect(result.error.message).toContain('Connection failed');
        }
      });
    });

    describe('stopFileServer', () => {
      it('should stop file server', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.stopFileServer('server-123');

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'local-remote-file-manager',
          toolName: 'stop-file-server',
          toolInput: {
            serverId: 'server-123',
          },
          timeout: 30000,
        });
      });

      it('should return error on failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Server not found'));

        const result = await proxy.stopFileServer('invalid-server');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.STOP_SERVER_FAILED);
        }
      });
    });
  });

  describe('Cloud File Management', () => {
    describe('uploadToCloud', () => {
      it('should upload file to cloud', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.uploadToCloud('s3', '/local/file.txt', '/remote/file.txt');

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'cloud-file-manager',
          toolName: 'upload',
          toolInput: {
            provider: 's3',
            localPath: '/local/file.txt',
            remotePath: '/remote/file.txt',
          },
          timeout: 60000,
        });
      });

      it('should return error on upload failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Network timeout'));

        const result = await proxy.uploadToCloud('s3', '/local/file.txt', '/remote/file.txt');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.UPLOAD_FAILED);
        }
      });
    });

    describe('downloadFromCloud', () => {
      it('should download file from cloud', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.downloadFromCloud('gcs', '/remote/file.txt', '/local/file.txt');

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'cloud-file-manager',
          toolName: 'download',
          toolInput: {
            provider: 'gcs',
            remotePath: '/remote/file.txt',
            localPath: '/local/file.txt',
          },
          timeout: 60000,
        });
      });

      it('should return error on download failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('File not found'));

        const result = await proxy.downloadFromCloud('gcs', '/remote/file.txt', '/local/file.txt');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.DOWNLOAD_FAILED);
        }
      });
    });

    describe('listCloudFiles', () => {
      it('should list cloud files', async () => {
        const mockFiles = [
          {
            path: '/remote/file1.txt',
            size: 1024,
            lastModified: '2024-01-01T00:00:00Z',
            isDirectory: false,
          },
          {
            path: '/remote/dir1/',
            size: 0,
            lastModified: '2024-01-02T00:00:00Z',
            isDirectory: true,
          },
        ];

        mockInvokeTool.mockResolvedValueOnce({ files: mockFiles });

        const result = await proxy.listCloudFiles('azure', '/remote');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toHaveLength(2);
          expect(result.data[0].path).toBe('/remote/file1.txt');
          expect(result.data[0].size).toBe(1024);
          expect(result.data[1].isDirectory).toBe(true);
        }
      });

      it('should handle snake_case response format', async () => {
        const mockFiles = [
          {
            name: 'file1.txt',
            size: 2048,
            last_modified: '2024-01-03T00:00:00Z',
            is_directory: false,
          },
        ];

        mockInvokeTool.mockResolvedValueOnce({ files: mockFiles });

        const result = await proxy.listCloudFiles('s3', '/remote');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data[0].path).toBe('file1.txt');
          expect(result.data[0].size).toBe(2048);
          expect(result.data[0].isDirectory).toBe(false);
        }
      });

      it('should return error on list failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Access denied'));

        const result = await proxy.listCloudFiles('s3', '/remote');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.LIST_FILES_FAILED);
        }
      });
    });
  });

  describe('Container Registry', () => {
    describe('shareContainer', () => {
      it('should share container', async () => {
        const mockResult = {
          registryId: 'registry-123',
          registryUrl: 'registry.example.com',
          imageName: 'myapp:latest',
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.shareContainer('myapp:latest');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.registryId).toBe('registry-123');
          expect(result.data.registryUrl).toBe('registry.example.com');
          expect(result.data.imageName).toBe('myapp:latest');
        }
      });

      it('should share container with custom registry URL', async () => {
        const mockResult = {
          registry_id: 'registry-456',
          registry_url: 'custom.registry.com',
          image_name: 'app:v2',
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.shareContainer('app:v2', 'custom.registry.com');

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith(
          expect.objectContaining({
            toolInput: expect.objectContaining({
              containerImage: 'app:v2',
              registryUrl: 'custom.registry.com',
            }),
          })
        );
      });

      it('should return error on share failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Push failed'));

        const result = await proxy.shareContainer('myapp:latest');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.SHARE_CONTAINER_FAILED);
        }
      });
    });

    describe('stopRegistry', () => {
      it('should stop registry', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.stopRegistry('registry-123');

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'container-registry',
          toolName: 'stop',
          toolInput: {
            registryId: 'registry-123',
          },
          timeout: 30000,
        });
      });

      it('should return error on stop failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Registry not found'));

        const result = await proxy.stopRegistry('invalid-registry');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.STOP_REGISTRY_FAILED);
        }
      });
    });
  });

  describe('SSH/SCP Operations', () => {
    describe('uploadViaSSH', () => {
      it('should upload file via SSH', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.uploadViaSSH(
          'host.example.com',
          'user',
          '/local/file.txt',
          '/remote/file.txt'
        );

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'ssh-scp',
          toolName: 'upload',
          toolInput: {
            host: 'host.example.com',
            username: 'user',
            localPath: '/local/file.txt',
            remotePath: '/remote/file.txt',
          },
          timeout: 60000,
        });
      });

      it('should upload with private key', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.uploadViaSSH(
          'host.example.com',
          'user',
          '/local/file.txt',
          '/remote/file.txt',
          '/keys/id_rsa'
        );

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith(
          expect.objectContaining({
            toolInput: expect.objectContaining({
              privateKeyPath: '/keys/id_rsa',
            }),
          })
        );
      });

      it('should return error on upload failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Connection refused'));

        const result = await proxy.uploadViaSSH(
          'host.example.com',
          'user',
          '/local/file.txt',
          '/remote/file.txt'
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.SSH_UPLOAD_FAILED);
        }
      });
    });

    describe('downloadViaSSH', () => {
      it('should download file via SSH', async () => {
        mockInvokeTool.mockResolvedValueOnce({});

        const result = await proxy.downloadViaSSH(
          'host.example.com',
          'user',
          '/remote/file.txt',
          '/local/file.txt'
        );

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'ssh-scp',
          toolName: 'download',
          toolInput: {
            host: 'host.example.com',
            username: 'user',
            remotePath: '/remote/file.txt',
            localPath: '/local/file.txt',
          },
          timeout: 60000,
        });
      });

      it('should return error on download failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('File not found'));

        const result = await proxy.downloadViaSSH(
          'host.example.com',
          'user',
          '/remote/file.txt',
          '/local/file.txt'
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.SSH_DOWNLOAD_FAILED);
        }
      });
    });

    describe('executeRemoteCommand', () => {
      it('should execute remote command', async () => {
        const mockResult = {
          stdout: 'Command output',
          stderr: '',
          exitCode: 0,
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.executeRemoteCommand(
          'host.example.com',
          'user',
          'ls -la /tmp'
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.stdout).toBe('Command output');
          expect(result.data.stderr).toBe('');
          expect(result.data.exitCode).toBe(0);
        }

        expect(mockInvokeTool).toHaveBeenCalledWith({
          targetAgent: 'ssh-scp',
          toolName: 'execute',
          toolInput: {
            host: 'host.example.com',
            username: 'user',
            command: 'ls -la /tmp',
          },
          timeout: 60000,
        });
      });

      it('should handle snake_case response format', async () => {
        const mockResult = {
          stdout: 'Output',
          stderr: 'Error',
          exit_code: 1,
        };

        mockInvokeTool.mockResolvedValueOnce(mockResult);

        const result = await proxy.executeRemoteCommand(
          'host.example.com',
          'user',
          'false'
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.exitCode).toBe(1);
          expect(result.data.stderr).toBe('Error');
        }
      });

      it('should execute with private key', async () => {
        mockInvokeTool.mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
        });

        const result = await proxy.executeRemoteCommand(
          'host.example.com',
          'user',
          'whoami',
          '/keys/id_rsa'
        );

        expect(result.success).toBe(true);
        expect(mockInvokeTool).toHaveBeenCalledWith(
          expect.objectContaining({
            toolInput: expect.objectContaining({
              privateKeyPath: '/keys/id_rsa',
            }),
          })
        );
      });

      it('should return error on execution failure', async () => {
        mockInvokeTool.mockRejectedValueOnce(new Error('Authentication failed'));

        const result = await proxy.executeRemoteCommand(
          'host.example.com',
          'user',
          'whoami'
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe(FileErrorType.SSH_COMMAND_FAILED);
        }
      });
    });
  });
});
