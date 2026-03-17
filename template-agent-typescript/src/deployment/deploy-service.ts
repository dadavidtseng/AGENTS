/**
 * Deploy Service
 *
 * Autonomous deployment service for Model Manager Gateway to Digital Ocean.
 * Handles full deployment lifecycle including API key generation, model registration,
 * and agent configuration updates with rollback support.
 */

import type { Result } from 'agents-library';
import { ok, err } from 'agents-library';
import type {
  DeployConfig,
  DeploymentResult,
  DeployError,
  ModelRegistration,
  DeploymentStatus,
} from './types.js';
import { DeployErrorType } from './types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Deploy Ability Interface (Mock for @kadi.build/deploy-ability)
 * This interface defines the expected API structure
 */
interface DeployAbilityOptions {
  region: string;
  size: string;
  image: string;
  environment: Record<string, string>;
}

interface DeployAbilityResult {
  deploymentId: string;
  ipAddress: string;
  status: string;
}

interface DeployAbility {
  deployToDigitalOcean(options: DeployAbilityOptions): Promise<DeployAbilityResult>;
  rollbackDeployment(deploymentId: string): Promise<void>;
}

/**
 * Kadi Secret Interface (Mock for @kadi.build/kadi-secret)
 * This interface defines the expected API structure
 */
interface KadiSecret {
  store(key: string, value: string): Promise<void>;
  retrieve(key: string): Promise<string | null>;
}

/**
 * Deploy Service
 *
 * Manages autonomous deployment of Model Manager Gateway to Digital Ocean
 */
export class DeployService {
  private deployAbility: DeployAbility | null = null;
  private kadiSecret: KadiSecret | null = null;

  /**
   * Create Deploy Service
   *
   * @param config - Deployment configuration
   */
  constructor(private readonly config: DeployConfig) {}

  /**
   * Set Deploy Ability instance (for dependency injection)
   *
   * @param deployAbility - Deploy Ability instance
   */
  setDeployAbility(deployAbility: DeployAbility): void {
    this.deployAbility = deployAbility;
  }

  /**
   * Set Kadi Secret instance (for dependency injection)
   *
   * @param kadiSecret - Kadi Secret instance
   */
  setKadiSecret(kadiSecret: KadiSecret): void {
    this.kadiSecret = kadiSecret;
  }

  /**
   * Deploy Model Manager Gateway to Digital Ocean
   *
   * Performs full deployment lifecycle:
   * 1. Deploy to Digital Ocean
   * 2. Wait for gateway ready
   * 3. Generate API key
   * 4. Register OpenAI models (if configured)
   * 5. Store API key securely
   * 6. Update agent .env configuration
   *
   * @returns Result with deployment info or error
   */
  async deployModelManager(): Promise<Result<DeploymentResult, DeployError>> {
    let deploymentId: string | null = null;

    try {
      // Step 1: Deploy to Digital Ocean
      if (!this.deployAbility) {
        return err({
          type: DeployErrorType.DEPLOYMENT_FAILED,
          message: 'Deploy Ability not initialized',
          operation: 'deployToDigitalOcean',
        });
      }

      const deployResult = await this.deployAbility.deployToDigitalOcean({
        region: this.config.dropletRegion,
        size: this.config.dropletSize,
        image: this.config.containerImage,
        environment: {
          ADMIN_KEY: this.config.adminKey,
        },
      });

      deploymentId = deployResult.deploymentId;
      const gatewayUrl = `https://${deployResult.ipAddress}`;

      // Step 2: Wait for gateway ready
      const readyResult = await this.waitForGatewayReady(gatewayUrl, 60000);
      if (!readyResult.success) {
        await this.rollback(deploymentId);
        return readyResult;
      }

      // Step 3: Generate API key
      const apiKeyResult = await this.generateAPIKey(gatewayUrl, this.config.adminKey);
      if (!apiKeyResult.success) {
        await this.rollback(deploymentId);
        return apiKeyResult;
      }
      const apiKey = apiKeyResult.data;

      // Step 4: Register OpenAI models (if configured)
      let registeredModels: string[] = [];
      if (this.config.openaiKey) {
        const modelsResult = await this.registerOpenAIModels(
          gatewayUrl,
          this.config.adminKey,
          this.config.openaiKey
        );
        if (!modelsResult.success) {
          await this.rollback(deploymentId);
          return modelsResult;
        }
        registeredModels = modelsResult.data;
      }

      // Step 5: Store API key securely
      if (this.kadiSecret) {
        try {
          await this.kadiSecret.store('MODEL_MANAGER_API_KEY', apiKey);
        } catch (error: any) {
          await this.rollback(deploymentId);
          return err({
            type: DeployErrorType.CONFIG_UPDATE_FAILED,
            message: `Failed to store API key: ${error.message}`,
            operation: 'storeAPIKey',
            originalError: error,
          });
        }
      }

      // Step 6: Update agent .env configuration
      const configResult = await this.updateAgentConfig(gatewayUrl, apiKey);
      if (!configResult.success) {
        await this.rollback(deploymentId);
        return configResult;
      }

      // Return successful deployment result
      return ok({
        id: deploymentId,
        status: 'RUNNING' as DeploymentStatus,
        gatewayUrl,
        apiKey,
        registeredModels,
        deployedAt: new Date(),
      });
    } catch (error: any) {
      if (deploymentId) {
        await this.rollback(deploymentId);
      }
      return err({
        type: DeployErrorType.DEPLOYMENT_FAILED,
        message: `Deployment failed: ${error.message}`,
        operation: 'deployModelManager',
        originalError: error,
      });
    }
  }

  /**
   * Generate API key from gateway admin endpoint
   *
   * @param gatewayUrl - Gateway base URL
   * @param adminKey - Admin key for authentication
   * @returns Result with API key or error
   */
  async generateAPIKey(
    gatewayUrl: string,
    adminKey: string
  ): Promise<Result<string, DeployError>> {
    try {
      const response = await fetch(`${gatewayUrl}/admin/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({
          name: 'agent-api-key',
          description: 'Auto-generated API key for template agent',
        }),
      });

      if (!response.ok) {
        return err({
          type: DeployErrorType.API_KEY_GENERATION_FAILED,
          message: `Failed to generate API key: ${response.status} ${response.statusText}`,
          operation: 'generateAPIKey',
        });
      }

      const data = await response.json();
      const apiKey = data.apiKey || data.api_key || data.key;

      if (!apiKey) {
        return err({
          type: DeployErrorType.API_KEY_GENERATION_FAILED,
          message: 'API key not found in response',
          operation: 'generateAPIKey',
        });
      }

      return ok(apiKey);
    } catch (error: any) {
      return err({
        type: DeployErrorType.API_KEY_GENERATION_FAILED,
        message: `API key generation failed: ${error.message}`,
        operation: 'generateAPIKey',
        originalError: error,
      });
    }
  }

  /**
   * Register OpenAI models in gateway
   *
   * @param gatewayUrl - Gateway base URL
   * @param adminKey - Admin key for authentication
   * @param openaiKey - OpenAI API key
   * @returns Result with list of registered models or error
   */
  async registerOpenAIModels(
    gatewayUrl: string,
    adminKey: string,
    openaiKey: string
  ): Promise<Result<string[], DeployError>> {
    try {
      const response = await fetch(`${gatewayUrl}/admin/models/openai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({
          apiKey: openaiKey,
          models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        }),
      });

      if (!response.ok) {
        return err({
          type: DeployErrorType.MODEL_REGISTRATION_FAILED,
          message: `Failed to register models: ${response.status} ${response.statusText}`,
          operation: 'registerOpenAIModels',
        });
      }

      const data = await response.json();
      const registeredModels = data.registeredModels || data.models || [];

      return ok(registeredModels);
    } catch (error: any) {
      return err({
        type: DeployErrorType.MODEL_REGISTRATION_FAILED,
        message: `Model registration failed: ${error.message}`,
        operation: 'registerOpenAIModels',
        originalError: error,
      });
    }
  }

  /**
   * Update agent .env configuration with gateway URL and API key
   *
   * @param gatewayUrl - Gateway base URL
   * @param apiKey - Generated API key
   * @returns Result indicating success or error
   */
  async updateAgentConfig(
    gatewayUrl: string,
    apiKey: string
  ): Promise<Result<void, DeployError>> {
    try {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';

      // Read existing .env file if it exists
      try {
        envContent = await fs.readFile(envPath, 'utf-8');
      } catch (error) {
        // File doesn't exist, create new content
        envContent = '';
      }

      // Parse existing content
      const envLines = envContent.split('\n');
      const updatedLines: string[] = [];
      let foundUrl = false;
      let foundKey = false;

      for (const line of envLines) {
        if (line.startsWith('MODEL_MANAGER_BASE_URL=')) {
          updatedLines.push(`MODEL_MANAGER_BASE_URL=${gatewayUrl}`);
          foundUrl = true;
        } else if (line.startsWith('MODEL_MANAGER_API_KEY=')) {
          updatedLines.push(`MODEL_MANAGER_API_KEY=${apiKey}`);
          foundKey = true;
        } else {
          updatedLines.push(line);
        }
      }

      // Append if not found
      if (!foundUrl) {
        updatedLines.push(`MODEL_MANAGER_BASE_URL=${gatewayUrl}`);
      }
      if (!foundKey) {
        updatedLines.push(`MODEL_MANAGER_API_KEY=${apiKey}`);
      }

      // Write updated content
      await fs.writeFile(envPath, updatedLines.join('\n'), 'utf-8');

      return ok(undefined);
    } catch (error: any) {
      return err({
        type: DeployErrorType.CONFIG_UPDATE_FAILED,
        message: `Failed to update .env file: ${error.message}`,
        operation: 'updateAgentConfig',
        originalError: error,
      });
    }
  }

  /**
   * Wait for gateway to become ready
   *
   * Polls /health endpoint until gateway responds successfully
   *
   * @param gatewayUrl - Gateway base URL
   * @param timeoutMs - Timeout in milliseconds (default: 60000)
   * @returns Result indicating success or timeout error
   */
  async waitForGatewayReady(
    gatewayUrl: string,
    timeoutMs: number = 60000
  ): Promise<Result<void, DeployError>> {
    const startTime = Date.now();
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${gatewayUrl}/health`, {
          signal: AbortSignal.timeout(5000), // 5 second timeout per request
        });

        if (response.ok) {
          return ok(undefined);
        }
      } catch (error) {
        // Continue polling on error
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    return err({
      type: DeployErrorType.TIMEOUT,
      message: `Gateway did not become ready within ${timeoutMs}ms`,
      operation: 'waitForGatewayReady',
    });
  }

  /**
   * Rollback deployment on failure
   *
   * @param deploymentId - Deployment ID to rollback
   */
  private async rollback(deploymentId: string): Promise<void> {
    if (!this.deployAbility) {
      return;
    }

    try {
      await this.deployAbility.rollbackDeployment(deploymentId);
    } catch (error) {
      // Log rollback failure but don't throw
      console.error(`Failed to rollback deployment ${deploymentId}:`, error);
    }
  }
}
