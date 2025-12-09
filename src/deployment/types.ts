/**
 * Deployment System Types
 *
 * Defines types for autonomous infrastructure deployment using deploy-ability
 * library to Digital Ocean. Supports Model Manager Gateway deployment with
 * automatic API key generation and OpenAI model registration.
 */

/**
 * Deployment configuration
 */
export interface DeployConfig {
  /** Digital Ocean region (e.g., 'nyc1', 'sfo3', 'lon1') */
  dropletRegion: string;

  /** Droplet size (e.g., 's-2vcpu-2gb', 's-4vcpu-8gb') */
  dropletSize: string;

  /** Container image to deploy (e.g., 'model-manager-agent:0.0.8') */
  containerImage: string;

  /** Admin key for gateway API */
  adminKey: string;

  /** Optional OpenAI API key for model registration */
  openaiKey?: string;

  /** Optional custom domain */
  domain?: string;

  /** Resource limits */
  resources?: {
    cpu?: string;
    memory?: string;
    storage?: string;
  };
}

/**
 * Deployment status
 */
export enum DeploymentStatus {
  PENDING = 'PENDING',
  DEPLOYING = 'DEPLOYING',
  RUNNING = 'RUNNING',
  FAILED = 'FAILED',
  STOPPED = 'STOPPED',
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  /** Deployment ID */
  id: string;

  /** Deployment status */
  status: DeploymentStatus;

  /** Gateway URL (HTTPS endpoint) */
  gatewayUrl: string;

  /** Generated API key for agent use */
  apiKey: string;

  /** List of registered models */
  registeredModels: string[];

  /** Deployment timestamp */
  deployedAt: Date;

  /** Resource usage information */
  resources?: {
    cpu: number;
    memory: number;
    storage: number;
  };

  /** Deployment metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Deployment error types
 */
export enum DeployErrorType {
  DEPLOYMENT_FAILED = 'DEPLOYMENT_FAILED',
  API_KEY_GENERATION_FAILED = 'API_KEY_GENERATION_FAILED',
  MODEL_REGISTRATION_FAILED = 'MODEL_REGISTRATION_FAILED',
  CONFIG_UPDATE_FAILED = 'CONFIG_UPDATE_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_FAILED = 'AUTH_FAILED',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Deployment operation error
 */
export interface DeployError {
  type: DeployErrorType;
  message: string;
  operation: string;
  originalError?: unknown;
}

/**
 * Model registration info
 */
export interface ModelRegistration {
  /** Model ID (e.g., 'gpt-4', 'gpt-3.5-turbo') */
  modelId: string;

  /** Backend provider ID */
  backendId: string;

  /** Provider base URL */
  baseUrl: string;

  /** Registration status */
  status: 'registered' | 'failed';

  /** Error message if registration failed */
  error?: string;
}
