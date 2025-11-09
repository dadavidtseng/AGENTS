/**
 * MCP Client - Handles communication with MCP servers via JSON-RPC
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import {
  MCPServerConfig,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResult,
  MCPMessage,
  MCPInitializeParams,
  MCPInitializeResult,
} from '../types/mcp.js';

export class MCPClient extends EventEmitter {
  private serverProcess: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }>();
  private tools: MCPTool[] = [];
  private buffer = '';
  private isReady = false;

  constructor(private config: MCPServerConfig) {
    super();
  }

  /**
   * Start the MCP server and initialize connection
   */
  async start(): Promise<void> {
    console.log(`🚀 Starting MCP server: ${this.config.name}`);
    console.log(`  - Command: ${this.config.command}`);
    console.log(`  - Args: ${JSON.stringify(this.config.args || [])}`);

    // Build environment for spawned process
    const env = {
      ...process.env,
      ...this.config.env,
    };

    // Only override PATH if NOT using cmd.exe with batch file
    // When using cmd.exe /c batch.bat, the batch file handles PATH setup
    if (this.config.command !== 'cmd.exe') {
      // Ensure PATH is properly inherited for Git executable
      // This is critical because npx may isolate the spawned process environment
      if (!env.PATH) {
        env.PATH = process.env.PATH || '';
        console.log(`⚠️  [${this.config.name}] PATH was missing, restored from process.env`);
      }

      // FORCE Git into PATH for direct node/npx spawns
      // Ensures git.exe is always findable by MCP server subprocess
      const gitPaths = 'C:\\Program Files\\Git\\cmd;C:\\Program Files\\Git\\mingw64\\bin';
      const nodejsPath = 'C:\\Program Files\\nodejs';
      const systemPaths = 'C:\\Windows\\system32;C:\\Windows';

      // Build complete PATH to ensure all required executables are findable
      const fullPath = [gitPaths, systemPaths, nodejsPath, env.PATH || '']
        .filter(p => p)
        .join(';');

      env.PATH = fullPath;

      console.log(`✓ [${this.config.name}] Git paths explicitly added to environment PATH`);
      console.log(`✓ [${this.config.name}] Environment PATH configured (${env.PATH.length} chars)`);
      console.log(`✓ [${this.config.name}] PATH starts with: ${env.PATH.substring(0, 100)}...`);
    } else {
      console.log(`✓ [${this.config.name}] Using cmd.exe - batch file will handle PATH setup`);
    }

    // Spawn MCP server process
    this.serverProcess = spawn(this.config.command, this.config.args || [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // NOTE: shell:false to match kadi-broker's behavior
      // cmd.exe doesn't need shell:true and it causes ENOENT errors
    });

    // Handle stdout (JSON-RPC messages)
    this.serverProcess.stdout?.on('data', (data) => {
      this.handleServerOutput(data);
    });

    // Handle stderr (logs) - Enhanced error detection
    this.serverProcess.stderr?.on('data', (data) => {
      const message = data.toString();
      if (message.trim()) {
        console.error(`❌ [${this.config.name}] stderr: ${message}`);

        // Check for specific Git errors and provide diagnostics
        if (message.includes('Git command not found') || message.includes('ENOENT')) {
          console.error(`🔧 DIAGNOSIS: Git executable not found in PATH`);
          console.error(`   Current PATH length: ${env.PATH?.length || 0} characters`);
          console.error(`   Git should be at: C:\\Program Files\\Git\\cmd\\git.exe`);
          console.error(`   Verify Git installed: where git`);
        }

        // Check for generic spawn errors
        if (message.includes('spawn') && message.includes('ENOENT')) {
          console.error(`🔧 DIAGNOSIS: Command not found in PATH`);
          console.error(`   Command: ${this.config.command}`);
          console.error(`   Args: ${JSON.stringify(this.config.args)}`);
        }
      }
    });

    // Handle process exit
    this.serverProcess.on('exit', (code, signal) => {
      console.log(`[${this.config.name}] Process exited with code ${code}, signal ${signal}`);
      this.isReady = false;
      this.emit('exit', code);

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('MCP server process exited'));
        this.pendingRequests.delete(id);
      }
    });

    // Handle process errors - Enhanced error reporting
    this.serverProcess.on('error', (error) => {
      console.error(`❌ [${this.config.name}] Process error:`, error);
      console.error(`🔧 Failed to start MCP server process`);
      console.error(`   Command: ${this.config.command}`);
      console.error(`   Args: ${JSON.stringify(this.config.args || [])}`);

      if (error.message.includes('ENOENT')) {
        console.error(`   Error type: Command not found`);
        console.error(`   Verify command exists: ${this.config.command}`);
      }

      this.emit('error', error);
    });

    // Wait for server to be ready
    await this.waitForReady();

    // Initialize connection
    await this.initialize();

    // Discover tools
    await this.discoverTools();

    this.isReady = true;
    console.log(`✅ MCP server ready: ${this.config.name} (${this.tools.length} tools)`);
  }

  /**
   * Wait for server process to be ready
   */
  private async waitForReady(timeout = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`MCP server ${this.config.name} did not start in time`));
      }, timeout);

      const checkReady = () => {
        if (this.serverProcess?.stdout?.readable && this.serverProcess?.stdin?.writable) {
          clearTimeout(timer);
          resolve();
        } else if (this.serverProcess?.killed) {
          clearTimeout(timer);
          reject(new Error(`MCP server ${this.config.name} process was killed`));
        } else {
          setTimeout(checkReady, 100);
        }
      };

      checkReady();
    });
  }

  /**
   * Initialize MCP connection
   */
  private async initialize(): Promise<MCPInitializeResult> {
    const params: MCPInitializeParams = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'Agent_TypeScript',
        version: '1.0.0',
      },
    };

    const response = await this.sendRequest('initialize', params);

    if (response.error) {
      throw new Error(`Failed to initialize: ${response.error.message}`);
    }

    // Send initialized notification
    await this.sendNotification('notifications/initialized');

    return response.result;
  }

  /**
   * Discover available tools from MCP server
   */
  private async discoverTools(): Promise<void> {
    const response = await this.sendRequest('tools/list', {});

    if (response.error) {
      throw new Error(`Failed to discover tools: ${response.error.message}`);
    }

    this.tools = response.result?.tools || [];
    console.log(`📋 Discovered ${this.tools.length} tools from ${this.config.name}`);

    // Log tool names for debugging
    if (this.tools.length > 0) {
      console.log(`   Tools: ${this.tools.map(t => t.name).join(', ')}`);
    }
  }

  /**
   * Call a tool on the MCP server
   */
  async callTool(request: MCPToolCallRequest): Promise<MCPToolCallResult> {
    if (!this.isReady) {
      throw new Error(`MCP server ${this.config.name} is not ready`);
    }

    const response = await this.sendRequest('tools/call', {
      name: request.name,
      arguments: request.arguments,
    });

    if (response.error) {
      return {
        content: [{
          type: 'text',
          text: `Error: ${response.error.message}`,
        }],
        isError: true,
      };
    }

    return response.result;
  }

  /**
   * Get list of available tools
   */
  getTools(): MCPTool[] {
    return this.tools;
  }

  /**
   * Check if server is ready
   */
  isServerReady(): boolean {
    return this.isReady;
  }

  /**
   * Send a JSON-RPC request
   */
  private async sendRequest(method: string, params: any): Promise<MCPMessage> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      const message: MCPMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      // Set up timeout
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out after 30s`));
        }
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const messageStr = JSON.stringify(message) + '\n';

      if (!this.serverProcess?.stdin?.writable) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error(`Cannot send request: stdin not writable`));
        return;
      }

      this.serverProcess.stdin.write(messageStr, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write to stdin: ${error.message}`));
        }
      });
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private async sendNotification(method: string, params?: any): Promise<void> {
    const message: MCPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const messageStr = JSON.stringify(message) + '\n';

    if (!this.serverProcess?.stdin?.writable) {
      throw new Error(`Cannot send notification: stdin not writable`);
    }

    return new Promise((resolve, reject) => {
      this.serverProcess!.stdin!.write(messageStr, (error) => {
        if (error) {
          reject(new Error(`Failed to write notification: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Handle output from MCP server (JSON-RPC messages)
   */
  private handleServerOutput(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete messages (one per line)
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message: MCPMessage = JSON.parse(line);

        // Handle response to request
        if (message.id !== undefined) {
          const pending = this.pendingRequests.get(Number(message.id));
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(Number(message.id));
            pending.resolve(message);
          }
        }

        // Handle notification from server
        if (message.method && message.id === undefined) {
          this.emit('notification', message);
        }
      } catch (error) {
        console.error(`Failed to parse MCP message from ${this.config.name}:`, line, error);
      }
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    console.log(`🛑 Stopping MCP server: ${this.config.name}`);

    if (this.serverProcess) {
      // Clear all pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('MCP client is shutting down'));
        this.pendingRequests.delete(id);
      }

      // Kill the process
      this.serverProcess.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Force kill if still alive
      if (!this.serverProcess.killed) {
        this.serverProcess.kill('SIGKILL');
      }

      this.serverProcess = null;
    }

    this.isReady = false;
    this.tools = [];
  }
}
