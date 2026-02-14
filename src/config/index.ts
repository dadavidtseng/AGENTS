/**
 * @fileoverview Zod-based configuration for the GitHub MCP Server.
 */
import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  // GitHub API
  githubToken: z.string().min(1, 'GITHUB_PERSONAL_ACCESS_TOKEN is required'),
  githubApiUrl: z.string().url().default('https://api.github.com'),
  githubHost: z.string().optional(),

  // MCP Transport
  mcpTransportType: z.enum(['stdio', 'http']).default('stdio'),
  mcpHttpPort: z.coerce.number().default(3016),
  mcpHttpHost: z.string().default('127.0.0.1'),
  mcpLogLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Server metadata
  mcpServerName: z.string().default('github-mcp-server'),
  mcpServerVersion: z.string().default('1.0.0'),
});

const rawConfig = {
  githubToken: process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '',
  githubApiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
  githubHost: process.env.GITHUB_HOST,
  mcpTransportType: process.env.MCP_TRANSPORT_TYPE || 'stdio',
  mcpHttpPort: process.env.MCP_HTTP_PORT || '3016',
  mcpHttpHost: process.env.MCP_HTTP_HOST || '127.0.0.1',
  mcpLogLevel: process.env.MCP_LOG_LEVEL || 'info',
  mcpServerName: process.env.MCP_SERVER_NAME || 'github-mcp-server',
  mcpServerVersion: process.env.MCP_SERVER_VERSION || '1.0.0',
};

export const config = ConfigSchema.parse(rawConfig);
export type AppConfig = z.infer<typeof ConfigSchema>;
