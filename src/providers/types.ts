/**
 * LLM Provider System Types
 * LLM Provider System Types
 *
 * Defines interfaces and types for the pluggable LLM provider architecture.
 * Supports multiple providers (Anthropic Claude, OpenAI-compatible Model Manager Gateway)
 * with automatic failover and health monitoring.
 */

import type { Result } from '../common/result.js';

/**
 * Message format for LLM conversations
 * Supports OpenAI tool calling protocol
 */
export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * OpenAI-compatible tool definition
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

/**
 * Options for LLM chat requests
 */
export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

/**
 * Provider error types
 * Provider error types
 */
export enum ProviderErrorType {
  AUTH_FAILED = 'AUTH_FAILED',
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_REQUEST = 'INVALID_REQUEST',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Error object returned by providers
 * Error object returned by providers
 */
export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  provider: string;
  originalError?: unknown;
}

/**
 * Provider health status
 * Provider health status
 */
export interface ProviderStatus {
  isHealthy: boolean;
  consecutiveFailures: number;
  lastCheck: Date;
}

/**
 * Provider configuration
 * Provider configuration
 */
export interface ProviderConfig {
  primaryProvider: string; // 'anthropic' or 'model-manager'
  fallbackProvider?: string; // Optional fallback
  retryAttempts: number;
  retryDelayMs: number;
  healthCheckIntervalMs: number;
}

/**
 * Standard interface for all LLM provider adapters
 * Standard interface for all LLM provider adapters
 *
 * All LLM providers (Anthropic, Model Manager) must implement this interface
 * to enable pluggable provider architecture with automatic failover.
 */
export interface LLMProvider {
  /** Provider name (e.g., 'anthropic', 'model-manager') */
  name: string;

  /**
   * Generate chat completion
   *
   * @param messages - Conversation messages
   * @param options - Optional chat configuration
   * @returns Result with response text or error
   */
  chat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<Result<string, ProviderError>>;

  /**
   * Generate streaming chat completion
   *
   * @param messages - Conversation messages
   * @param options - Optional chat configuration
   * @returns Result with async iterator of text chunks or error
   */
  streamChat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<Result<AsyncIterator<string>, ProviderError>>;

  /**
   * Check if provider is healthy
   *
   * @returns True if provider is responding correctly
   */
  isHealthy(): Promise<boolean>;

  /**
   * Reset provider health status
   *
   * Clears failure counters and marks provider as healthy again.
   * Called by ProviderManager when health checks pass.
   */
  resetHealth(): void;

  /**
   * Get list of available models
   *
   * @returns Result with array of model IDs or error
   */
  getAvailableModels(): Promise<Result<string[], ProviderError>>;
}
