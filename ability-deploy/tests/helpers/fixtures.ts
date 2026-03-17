/**
 * Test Data Fixtures
 *
 * Provides reusable test data for consistent testing across all test files.
 * These fixtures represent valid configurations, services, profiles, etc.
 *
 * @module tests/helpers/fixtures
 */

import type {
  AgentConfig,
  LocalDeploymentProfile,
  ContainerEngine,
} from '../../src/types/index.js';
import type {
  ComposeFile,
  ComposeService,
  ServiceInput,
} from '../../src/targets/local/index.js';

/**
 * Sample agent.json configuration with local deployment profile
 */
export const sampleAgentConfig: AgentConfig = {
  name: 'test-agent',
  version: '1.0.0',
  description: 'Test agent for unit testing',
  kind: 'agent',
  deploy: {
    'local-dev': {
      target: 'local',
      engine: 'docker',
      network: 'kadi-net',
      services: {
        gateway: {
          image: 'test-gateway:latest',
          env: ['PORT=8080', 'NODE_ENV=development'],
          expose: [
            {
              port: 8080,
              as: 8080,
              to: ['local'],
            },
          ],
          command: ['npm', 'start'],
        },
        database: {
          image: 'postgres:15',
          env: ['POSTGRES_PASSWORD=secret', 'POSTGRES_DB=testdb'],
          expose: [
            {
              port: 5432,
              as: 5432,
              to: ['local'],
            },
          ],
        },
      },
    },
    production: {
      target: 'akash',
      network: 'mainnet',
      services: {
        api: {
          image: 'api:prod',
          env: ['NODE_ENV=production'],
          expose: [
            {
              port: 3000,
              as: 80,
              to: [{ global: true }],
            },
          ],
        },
      },
    },
  },
};

/**
 * Minimal valid agent.json
 */
export const minimalAgentConfig: AgentConfig = {
  name: 'minimal-agent',
  version: '1.0.0',
  kind: 'agent',
  deploy: {
    local: {
      target: 'local',
      engine: 'docker',
      services: {
        app: {
          image: 'app:latest',
        },
      },
    },
  },
};

/**
 * Agent.json with no deploy section (invalid)
 */
export const agentConfigNoDeploy = {
  name: 'no-deploy-agent',
  version: '1.0.0',
  kind: 'agent',
};

/**
 * Agent.json with no local profiles
 */
export const agentConfigNoLocal: AgentConfig = {
  name: 'akash-only-agent',
  version: '1.0.0',
  kind: 'agent',
  deploy: {
    production: {
      target: 'akash',
      network: 'mainnet',
      services: {
        api: {
          image: 'api:prod',
        },
      },
    },
  },
};

/**
 * Local deployment profile with single service
 */
export const singleServiceProfile: LocalDeploymentProfile = {
  target: 'local',
  engine: 'docker',
  network: 'kadi-net',
  services: {
    app: {
      image: 'app:latest',
      env: ['PORT=3000'],
      expose: [{ port: 3000, as: 3000, to: ['local'] }],
    },
  },
};

/**
 * Local deployment profile with multiple services
 */
export const multiServiceProfile: LocalDeploymentProfile = {
  target: 'local',
  engine: 'podman',
  network: 'test-net',
  services: {
    web: {
      image: 'nginx:alpine',
      env: ['NGINX_HOST=localhost'],
      expose: [{ port: 80, as: 8080, to: ['local'] }],
    },
    api: {
      image: 'api:v1',
      env: ['API_KEY=test123', 'DB_URL=postgres://db:5432/app'],
      expose: [{ port: 3000, as: 3000, to: ['local'] }],
      command: ['node', 'server.js'],
    },
    db: {
      image: 'postgres:15',
      env: ['POSTGRES_PASSWORD=secret'],
      expose: [{ port: 5432, to: ['local'] }],
    },
  },
};

/**
 * Service input for testing compose generation
 */
export const sampleServiceInput: ServiceInput = {
  image: 'test-service:latest',
  env: ['KEY1=value1', 'KEY2=value2'],
  expose: [
    { port: 8080, as: 8080, to: ['local'] },
    { port: 8081, as: 8081, to: ['local'] },
  ],
  command: ['npm', 'start'],
  restart: 'always',
  volumes: ['/host/path:/container/path'],
  workingDir: '/app',
};

/**
 * Service input with minimal configuration
 */
export const minimalServiceInput: ServiceInput = {
  image: 'minimal:latest',
};

/**
 * Service input with invalid image (for validation testing)
 */
export const invalidServiceInput = {
  image: '',
  env: ['INVALID'],
} as any;

/**
 * Sample Docker Compose service definition
 */
export const sampleComposeService: ComposeService = {
  image: 'test:latest' as any,
  container_name: 'kadi-test',
  networks: ['kadi-net'],
  tty: true,
  stdin_open: true,
  environment: {
    PORT: '8080',
    NODE_ENV: 'development',
  },
  ports: ['8080:8080'],
  command: ['npm', 'start'],
};

/**
 * Sample complete Docker Compose file
 */
export const sampleComposeFile: ComposeFile = {
  version: '3.9',
  services: {
    app: {
      image: 'app:latest' as any,
      container_name: 'kadi-app',
      networks: ['kadi-net'],
      tty: true,
      stdin_open: true,
      environment: {
        PORT: '3000',
      },
      ports: ['3000:3000'],
    },
  },
  networks: {
    'kadi-net': {
      driver: 'bridge',
    },
  },
};

/**
 * Expected YAML output for sample compose file
 */
export const sampleComposeYAML = `version: '3.9'
services:
  app:
    image: app:latest
    container_name: kadi-app
    networks:
      - kadi-net
    tty: true
    stdin_open: true
    environment:
      PORT: '3000'
    ports:
      - 3000:3000
networks:
  kadi-net:
    driver: bridge
`;

/**
 * Environment variables test cases
 */
export const envTestCases = {
  simple: ['PORT=8080', 'HOST=localhost'],
  withEquals: ['DATABASE_URL=postgres://user:pass@host:5432/db', 'API_KEY=abc=def=ghi'],
  invalid: ['NOEQUALS', '=NOKEY', 'VALID=value'],
  empty: [] as string[],
};

/**
 * Port configuration test cases
 */
export const portTestCases = {
  simple: [{ port: 8080, as: 8080, to: ['local'] }],
  different: [{ port: 3000, as: 8080, to: ['local'] }],
  noAs: [{ port: 5432, to: ['local'] }],
  multiple: [
    { port: 80, as: 8080, to: ['local'] },
    { port: 443, as: 8443, to: ['local'] },
  ],
  empty: [],
};

/**
 * Container engine options
 */
export const engines: readonly ContainerEngine[] = ['docker', 'podman'];

/**
 * Project root paths for testing
 */
export const testPaths = {
  validProject: '/test/project',
  invalidProject: '/nonexistent/project',
  agentJsonPath: (root: string) => `${root}/agent.json`,
  composeFilePath: (root: string) => `${root}/docker-compose.yml`,
};

/**
 * Network names for testing
 */
export const networkNames = {
  default: 'kadi-net',
  custom: 'custom-network',
  nonexistent: 'nonexistent-network',
};

/**
 * Error messages for testing
 */
export const errorMessages = {
  agentJsonNotFound: 'No agent.json file found in project root',
  agentJsonInvalid: 'Failed to parse agent.json',
  profileNotFound: 'Profile "nonexistent" not found in agent.json',
  noLocalProfiles: 'No local profiles found in agent.json',
  dockerNotRunning: 'Docker daemon is not running',
  podmanNotRunning: 'Podman is not running',
  networkInUse: 'network has active endpoints',
  imageNotFound: 'pull access denied',
};

/**
 * Duration values for testing (milliseconds)
 */
export const durations = {
  fast: 50,
  normal: 100,
  slow: 500,
  timeout: 1000,
};

/**
 * Creates a deep copy of an object (for mutation testing)
 */
export function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Creates an agent config with specified number of services
 */
export function createAgentConfigWithServices(count: number): AgentConfig {
  const services: Record<string, any> = {};

  for (let i = 0; i < count; i++) {
    services[`service-${i}`] = {
      image: `service-${i}:latest`,
      env: [`SERVICE_ID=${i}`],
      expose: [{ port: 3000 + i, as: 3000 + i, to: ['local'] }],
    };
  }

  return {
    name: `multi-service-agent`,
    version: '1.0.0',
    kind: 'agent',
    deploy: {
      local: {
        target: 'local',
        engine: 'docker',
        services,
      },
    },
  };
}
