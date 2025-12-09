/**
 * File Manager Proxy
 *
 * Provides unified interface for invoking file management abilities via KADI broker MCP protocol.
 * Supports:
 * - Local/Remote file server management
 * - Cloud file operations (upload/download/list)
 * - Container registry operations
 * - SSH/SCP remote file operations
 */

import type { Result } from '../common/result.js';
import { ok, err } from '../common/result.js';
import type { FileError } from '../common/types.js';
import { FileErrorType } from '../common/types.js';
import type { KadiClient } from '@kadi.build/core';

/**
 * File server information
 */
export interface FileServerInfo {
  serverId: string;
  localUrl: string;
  tunnelUrl: string;
}

/**
 * Cloud file information
 */
export interface CloudFileInfo {
  path: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
}

/**
 * Container share information
 */
export interface ContainerShareInfo {
  registryId: string;
  registryUrl: string;
  imageName: string;
}

/**
 * SSH command result
 */
export interface SSHCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * File Manager Proxy
 *
 * Orchestrates file management operations via KADI protocol
 */
export class FileManagerProxy {
  /**
   * Create File Manager Proxy
   *
   * @param client - KADI client instance
   */
  constructor(private readonly client: KadiClient) {}

  /**
   * Start local file server with optional tunnel
   *
   * @param directory - Directory to serve
   * @param port - Server port (default: 8080)
   * @returns Result with file server info or error
   */
  async startFileServer(
    directory: string,
    port?: number
  ): Promise<Result<FileServerInfo, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: directory,
        });
      }

      const result = await protocol.invokeTool({
        targetAgent: 'local-remote-file-manager',
        toolName: 'start-file-server',
        toolInput: {
          directory,
          port: port || 8080,
        },
        timeout: 30000,
      });

      // Parse result based on KADI response structure
      const serverInfo: FileServerInfo = {
        serverId: result.serverId || result.server_id || '',
        localUrl: result.localUrl || result.local_url || '',
        tunnelUrl: result.tunnelUrl || result.tunnel_url || '',
      };

      return ok(serverInfo);
    } catch (error: any) {
      return err({
        type: FileErrorType.START_SERVER_FAILED,
        message: `Failed to start file server: ${error.message}`,
        filePath: directory,
        originalError: error,
      });
    }
  }

  /**
   * Stop file server
   *
   * @param serverId - Server ID from startFileServer
   * @returns Result indicating success or error
   */
  async stopFileServer(serverId: string): Promise<Result<void, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: '',
        });
      }

      await protocol.invokeTool({
        targetAgent: 'local-remote-file-manager',
        toolName: 'stop-file-server',
        toolInput: {
          serverId,
        },
        timeout: 30000,
      });

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.STOP_SERVER_FAILED,
        message: `Failed to stop file server: ${error.message}`,
        filePath: '',
        originalError: error,
      });
    }
  }

  /**
   * Upload file to cloud storage
   *
   * @param provider - Cloud provider (e.g., 's3', 'gcs', 'azure')
   * @param localPath - Local file path
   * @param remotePath - Remote destination path
   * @returns Result indicating success or error
   */
  async uploadToCloud(
    provider: string,
    localPath: string,
    remotePath: string
  ): Promise<Result<void, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: localPath,
        });
      }

      await protocol.invokeTool({
        targetAgent: 'cloud-file-manager',
        toolName: 'upload',
        toolInput: {
          provider,
          localPath,
          remotePath,
        },
        timeout: 60000,
      });

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.UPLOAD_FAILED,
        message: `Failed to upload to cloud: ${error.message}`,
        filePath: localPath,
        originalError: error,
      });
    }
  }

  /**
   * Download file from cloud storage
   *
   * @param provider - Cloud provider (e.g., 's3', 'gcs', 'azure')
   * @param remotePath - Remote file path
   * @param localPath - Local destination path
   * @returns Result indicating success or error
   */
  async downloadFromCloud(
    provider: string,
    remotePath: string,
    localPath: string
  ): Promise<Result<void, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: remotePath,
        });
      }

      await protocol.invokeTool({
        targetAgent: 'cloud-file-manager',
        toolName: 'download',
        toolInput: {
          provider,
          remotePath,
          localPath,
        },
        timeout: 60000,
      });

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.DOWNLOAD_FAILED,
        message: `Failed to download from cloud: ${error.message}`,
        filePath: remotePath,
        originalError: error,
      });
    }
  }

  /**
   * List files in cloud storage
   *
   * @param provider - Cloud provider (e.g., 's3', 'gcs', 'azure')
   * @param remotePath - Remote directory path
   * @returns Result with file list or error
   */
  async listCloudFiles(
    provider: string,
    remotePath: string
  ): Promise<Result<CloudFileInfo[], FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: remotePath,
        });
      }

      const result = await protocol.invokeTool({
        targetAgent: 'cloud-file-manager',
        toolName: 'list',
        toolInput: {
          provider,
          remotePath,
        },
        timeout: 30000,
      });

      // Parse file list from result
      const files: CloudFileInfo[] = (result.files || []).map((file: any) => ({
        path: file.path || file.name || '',
        size: file.size || 0,
        lastModified: new Date(file.lastModified || file.last_modified || Date.now()),
        isDirectory: file.isDirectory || file.is_directory || false,
      }));

      return ok(files);
    } catch (error: any) {
      return err({
        type: FileErrorType.LIST_FILES_FAILED,
        message: `Failed to list cloud files: ${error.message}`,
        filePath: remotePath,
        originalError: error,
      });
    }
  }

  /**
   * Share container via registry
   *
   * @param containerImage - Container image name
   * @param registryUrl - Optional registry URL
   * @returns Result with container share info or error
   */
  async shareContainer(
    containerImage: string,
    registryUrl?: string
  ): Promise<Result<ContainerShareInfo, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: containerImage,
        });
      }

      const result = await protocol.invokeTool({
        targetAgent: 'container-registry',
        toolName: 'share',
        toolInput: {
          containerImage,
          ...(registryUrl && { registryUrl }),
        },
        timeout: 60000,
      });

      const shareInfo: ContainerShareInfo = {
        registryId: result.registryId || result.registry_id || '',
        registryUrl: result.registryUrl || result.registry_url || registryUrl || '',
        imageName: result.imageName || result.image_name || containerImage,
      };

      return ok(shareInfo);
    } catch (error: any) {
      return err({
        type: FileErrorType.SHARE_CONTAINER_FAILED,
        message: `Failed to share container: ${error.message}`,
        filePath: containerImage,
        originalError: error,
      });
    }
  }

  /**
   * Stop container registry
   *
   * @param registryId - Registry ID from shareContainer
   * @returns Result indicating success or error
   */
  async stopRegistry(registryId: string): Promise<Result<void, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: '',
        });
      }

      await protocol.invokeTool({
        targetAgent: 'container-registry',
        toolName: 'stop',
        toolInput: {
          registryId,
        },
        timeout: 30000,
      });

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.STOP_REGISTRY_FAILED,
        message: `Failed to stop registry: ${error.message}`,
        filePath: '',
        originalError: error,
      });
    }
  }

  /**
   * Upload file via SSH/SCP
   *
   * @param host - Remote host
   * @param username - SSH username
   * @param localPath - Local file path
   * @param remotePath - Remote destination path
   * @param privateKeyPath - Optional SSH private key path
   * @returns Result indicating success or error
   */
  async uploadViaSSH(
    host: string,
    username: string,
    localPath: string,
    remotePath: string,
    privateKeyPath?: string
  ): Promise<Result<void, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: localPath,
        });
      }

      await protocol.invokeTool({
        targetAgent: 'ssh-scp',
        toolName: 'upload',
        toolInput: {
          host,
          username,
          localPath,
          remotePath,
          ...(privateKeyPath && { privateKeyPath }),
        },
        timeout: 60000,
      });

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.SSH_UPLOAD_FAILED,
        message: `Failed to upload via SSH: ${error.message}`,
        filePath: localPath,
        originalError: error,
      });
    }
  }

  /**
   * Download file via SSH/SCP
   *
   * @param host - Remote host
   * @param username - SSH username
   * @param remotePath - Remote file path
   * @param localPath - Local destination path
   * @param privateKeyPath - Optional SSH private key path
   * @returns Result indicating success or error
   */
  async downloadViaSSH(
    host: string,
    username: string,
    remotePath: string,
    localPath: string,
    privateKeyPath?: string
  ): Promise<Result<void, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: remotePath,
        });
      }

      await protocol.invokeTool({
        targetAgent: 'ssh-scp',
        toolName: 'download',
        toolInput: {
          host,
          username,
          remotePath,
          localPath,
          ...(privateKeyPath && { privateKeyPath }),
        },
        timeout: 60000,
      });

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: FileErrorType.SSH_DOWNLOAD_FAILED,
        message: `Failed to download via SSH: ${error.message}`,
        filePath: remotePath,
        originalError: error,
      });
    }
  }

  /**
   * Execute remote command via SSH
   *
   * @param host - Remote host
   * @param username - SSH username
   * @param command - Command to execute
   * @param privateKeyPath - Optional SSH private key path
   * @returns Result with command result or error
   */
  async executeRemoteCommand(
    host: string,
    username: string,
    command: string,
    privateKeyPath?: string
  ): Promise<Result<SSHCommandResult, FileError>> {
    try {
      const protocol = this.client.getBrokerProtocol();
      if (!protocol) {
        return err({
          type: FileErrorType.KADI_PROTOCOL_ERROR,
          message: 'KADI protocol not initialized',
          filePath: '',
        });
      }

      const result = await protocol.invokeTool({
        targetAgent: 'ssh-scp',
        toolName: 'execute',
        toolInput: {
          host,
          username,
          command,
          ...(privateKeyPath && { privateKeyPath }),
        },
        timeout: 60000,
      });

      const commandResult: SSHCommandResult = {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode !== undefined ? result.exitCode : result.exit_code || 0,
      };

      return ok(commandResult);
    } catch (error: any) {
      return err({
        type: FileErrorType.SSH_COMMAND_FAILED,
        message: `Failed to execute remote command: ${error.message}`,
        filePath: '',
        originalError: error,
      });
    }
  }
}
