/**
 * Environment configuration loader for mcp-server-quest
 * Centralizes configuration management for data directory, ports, and API keys
 */

import { resolve } from 'path';

/**
 * Application configuration interface
 */
export interface Config {
  /** Path to quest data directory (absolute path) */
  questDataDir: string;
  /** Dashboard HTTP server port (1-65535) */
  dashboardPort: number;
  /** Dashboard HTTP server host */
  dashboardHost: string;
  /** Anthropic API key for Claude (optional - warns if missing) */
  anthropicApiKey: string | undefined;
  /** KĀDI broker WebSocket URL */
  kadibrokerUrl: string;
}

/**
 * Load configuration from environment variables with defaults
 * 
 * Environment variables:
 * - QUEST_DATA_DIR: Path to quest data directory (default: "./.quest-data")
 * - QUEST_DASHBOARD_PORT: Dashboard port (default: 8888)
 * - QUEST_DASHBOARD_HOST: Dashboard host (default: "localhost")
 * - ANTHROPIC_API_KEY: Anthropic API key (optional, warns if missing)
 * - KADI_BROKER_URL: KĀDI broker URL (default: "ws://localhost:8080")
 * 
 * @returns Configuration object with all settings
 */
export function loadConfig(): Config {
  // Load quest data directory (resolve to absolute path)
  const questDataDir = resolve(
    process.env.QUEST_DATA_DIR || './.quest-data'
  );

  // Load dashboard port with validation
  const portEnv = process.env.QUEST_DASHBOARD_PORT;
  let dashboardPort = 8888; // Default port

  if (portEnv) {
    const parsed = parseInt(portEnv, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.warn(
        `[Config] Invalid QUEST_DASHBOARD_PORT: ${portEnv}. Using default: 8888`
      );
    } else {
      dashboardPort = parsed;
    }
  }

  // Load dashboard host
  const dashboardHost = process.env.QUEST_DASHBOARD_HOST || 'localhost';

  // Load Anthropic API key (warn if missing)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.warn(
      '[Config] ANTHROPIC_API_KEY not set. Document generation features will be unavailable.'
    );
  }

  // Load KĀDI broker URL
  const kadibrokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';

  return {
    questDataDir,
    dashboardPort,
    dashboardHost,
    anthropicApiKey,
    kadibrokerUrl,
  };
}

/**
 * Singleton configuration instance
 * Single source of truth for application configuration
 */
export const config = loadConfig();
