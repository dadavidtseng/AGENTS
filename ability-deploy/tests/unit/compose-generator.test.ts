/**
 * Unit Tests for Compose Generator
 *
 * Tests Docker Compose file generation, service validation,
 * and YAML serialization.
 *
 * @module tests/unit/compose-generator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  convertEnvArrayToObject,
  convertPortsToComposeFormat,
  generateComposeFile,
  composeFileToYAML,
  generateComposeYAML,
  type ServiceInput,
} from '../../src/targets/local/compose-generator.js';
import {
  expectSuccess,
  expectFailure,
  expectErrorCode,
  expectSuggestion,
} from '../helpers/assertions.js';
import {
  sampleServiceInput,
  minimalServiceInput,
  invalidServiceInput,
  envTestCases,
  portTestCases,
  sampleComposeFile,
} from '../helpers/fixtures.js';

describe('Compose Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('convertEnvArrayToObject', () => {
    it('should convert simple environment variables', () => {
      const result = convertEnvArrayToObject(envTestCases.simple);

      expect(result).toEqual({
        PORT: '8080',
        HOST: 'localhost',
      });
    });

    it('should handle values with equals signs', () => {
      const result = convertEnvArrayToObject(envTestCases.withEquals);

      expect(result).toEqual({
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        API_KEY: 'abc=def=ghi',
      });
    });

    it('should skip invalid entries (no equals sign)', () => {
      const result = convertEnvArrayToObject(['NOEQUALS', 'VALID=value']);

      expect(result).toEqual({
        VALID: 'value',
      });
      expect(result).not.toHaveProperty('NOEQUALS');
    });

    it('should skip entries with empty keys', () => {
      const result = convertEnvArrayToObject(['=NOKEY', 'VALID=value']);

      expect(result).toEqual({
        VALID: 'value',
      });
      // Verify empty key was not added
      expect(Object.keys(result)).not.toContain('');
      expect('' in result).toBe(false);
    });

    it('should handle empty arrays', () => {
      const result = convertEnvArrayToObject([]);

      expect(result).toEqual({});
    });

    it('should handle values with multiple equals signs correctly', () => {
      const result = convertEnvArrayToObject([
        'CONNECTION_STRING=Server=host;Database=db;User=admin;Password=p@ss=w0rd',
      ]);

      expect(result.CONNECTION_STRING).toBe(
        'Server=host;Database=db;User=admin;Password=p@ss=w0rd'
      );
    });

    it('should handle empty values', () => {
      const result = convertEnvArrayToObject(['EMPTY=', 'HAS_VALUE=test']);

      expect(result).toEqual({
        EMPTY: '',
        HAS_VALUE: 'test',
      });
    });
  });

  describe('convertPortsToComposeFormat', () => {
    it('should convert simple port configurations', () => {
      const result = convertPortsToComposeFormat(portTestCases.simple);

      expect(result).toEqual(['8080:8080']);
    });

    it('should use "as" field when different from port', () => {
      const result = convertPortsToComposeFormat(portTestCases.different);

      expect(result).toEqual(['8080:3000']);
    });

    it('should default "as" to port value when not specified', () => {
      const result = convertPortsToComposeFormat(portTestCases.noAs);

      expect(result).toEqual(['5432:5432']);
    });

    it('should handle multiple port mappings', () => {
      const result = convertPortsToComposeFormat(portTestCases.multiple);

      expect(result).toEqual(['8080:80', '8443:443']);
    });

    it('should return empty array for undefined', () => {
      const result = convertPortsToComposeFormat(undefined);

      expect(result).toEqual([]);
    });

    it('should return empty array for empty array', () => {
      const result = convertPortsToComposeFormat([]);

      expect(result).toEqual([]);
    });

    it('should format ports as strings with colon separator', () => {
      const result = convertPortsToComposeFormat([
        { port: 3000, as: 8080, to: ['local'] },
      ]);

      expect(result[0]).toBe('8080:3000');
      expect(typeof result[0]).toBe('string');
      expect(result[0]).toMatch(/^\d+:\d+$/);
    });
  });

  describe('generateComposeFile', () => {
    it('should generate valid compose structure', () => {
      const services = {
        app: sampleServiceInput,
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(result.data.version).toBe('3.9');
      expect(result.data.services).toHaveProperty('app');
      expect(result.data.networks).toBeDefined();
    });

    it('should validate required service fields', () => {
      const services = {
        invalid: invalidServiceInput,
      };

      const result = generateComposeFile(services);

      expectFailure(result);
      expectErrorCode(result, 'SERVICE_INVALID');
    });

    it('should validate image format', () => {
      const services = {
        'bad-image': {
          image: '   ',
        } as ServiceInput,
      };

      const result = generateComposeFile(services);

      expectFailure(result);
      expectErrorCode(result, 'SERVICE_INVALID');
      expectSuggestion(result.error, 'valid Docker image');
    });

    it('should validate environment variable format', () => {
      const services = {
        'bad-env': {
          image: 'test:latest',
          env: ['NOEQUALS'],
        },
      };

      const result = generateComposeFile(services);

      expectFailure(result);
      expectErrorCode(result, 'SERVICE_INVALID');
      expectSuggestion(result.error, 'KEY=VALUE');
    });

    it('should validate port numbers are in valid range', () => {
      const services = {
        'invalid-port': {
          image: 'test:latest',
          expose: [{ port: 99999, to: ['local'] }],
        },
      };

      const result = generateComposeFile(services);

      expectFailure(result);
      expectErrorCode(result, 'SERVICE_INVALID');
      expectSuggestion(result.error, 'between 1 and 65535');
    });

    it('should validate external port numbers', () => {
      const services = {
        'invalid-external': {
          image: 'test:latest',
          expose: [{ port: 3000, as: 0, to: ['local'] }],
        },
      };

      const result = generateComposeFile(services);

      expectFailure(result);
      expectErrorCode(result, 'SERVICE_INVALID');
    });

    it('should convert services correctly', () => {
      const services = {
        web: {
          image: 'nginx:alpine',
          env: ['NGINX_HOST=localhost', 'PORT=80'],
          expose: [{ port: 80, as: 8080, to: ['local'] }],
          command: ['nginx', '-g', 'daemon off;'],
        },
      };

      const result = generateComposeFile(services, { containerPrefix: 'test' });

      expectSuccess(result);

      const webService = result.data.services.web;
      expect(webService.container_name).toBe('test-web');
      expect(webService.environment).toEqual({
        NGINX_HOST: 'localhost',
        PORT: '80',
      });
      expect(webService.ports).toEqual(['8080:80']);
      expect(webService.command).toEqual(['nginx', '-g', 'daemon off;']);
    });

    it('should create network configuration', () => {
      const services = {
        app: minimalServiceInput,
      };

      const result = generateComposeFile(services, { networkName: 'custom-net' });

      expectSuccess(result);
      expect(result.data.networks).toHaveProperty('custom-net');
      expect(result.data.networks!['custom-net'].driver).toBe('bridge');
    });

    it('should handle multiple services', () => {
      const services = {
        web: { image: 'nginx:latest' },
        api: { image: 'api:latest' },
        db: { image: 'postgres:15' },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(Object.keys(result.data.services)).toHaveLength(3);
      expect(result.data.services).toHaveProperty('web');
      expect(result.data.services).toHaveProperty('api');
      expect(result.data.services).toHaveProperty('db');
    });

    it('should apply generation options', () => {
      const services = {
        app: sampleServiceInput,
      };

      const result = generateComposeFile(services, {
        version: '3.8',
        networkName: 'test-network',
        containerPrefix: 'myapp',
        tty: false,
        stdinOpen: false,
        defaultRestart: 'unless-stopped',
      });

      expectSuccess(result);
      expect(result.data.version).toBe('3.8');
      expect(result.data.networks).toHaveProperty('test-network');

      const appService = result.data.services.app;
      expect(appService.container_name).toBe('myapp-app');
      expect(appService.tty).toBe(false);
      expect(appService.stdin_open).toBe(false);
    });

    it('should include service restart policy when provided', () => {
      const services = {
        app: {
          image: 'app:latest',
          restart: 'always' as const,
        },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(result.data.services.app).toHaveProperty('restart', 'always');
    });

    it('should include volumes when provided', () => {
      const services = {
        app: {
          image: 'app:latest',
          volumes: ['/host/data:/container/data', 'named-volume:/app/data'],
        },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(result.data.services.app).toHaveProperty('volumes');
      expect(result.data.services.app.volumes).toEqual([
        '/host/data:/container/data',
        'named-volume:/app/data',
      ]);
    });

    it('should include working directory when provided', () => {
      const services = {
        app: {
          image: 'app:latest',
          workingDir: '/app',
        },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(result.data.services.app).toHaveProperty('working_dir', '/app');
    });

    it('should include service dependencies when provided', () => {
      const services = {
        web: {
          image: 'web:latest',
          dependsOn: ['api', 'db'],
        },
        api: {
          image: 'api:latest',
        },
        db: {
          image: 'postgres:15',
        },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(result.data.services.web).toHaveProperty('depends_on');
      expect(result.data.services.web.depends_on).toEqual(['api', 'db']);
    });
  });

  describe('composeFileToYAML', () => {
    it('should serialize ComposeFile to YAML', () => {
      const yaml = composeFileToYAML(sampleComposeFile);

      expect(yaml).toContain('version:');
      expect(yaml).toContain('services:');
      expect(yaml).toContain('networks:');
      expect(typeof yaml).toBe('string');
    });

    it('should use correct YAML formatting', () => {
      const yaml = composeFileToYAML(sampleComposeFile);

      // Should not have references
      expect(yaml).not.toContain('&');
      expect(yaml).not.toContain('*');

      // Should have proper indentation
      expect(yaml).toMatch(/^\w+:/m); // Top-level keys
      expect(yaml).toMatch(/^  \w+:/m); // Second-level keys
    });

    it('should handle empty networks', () => {
      const composeFile = {
        version: '3.9',
        services: {
          app: {
            image: 'app:latest' as any,
            container_name: 'test-app',
            networks: ['default'],
            tty: true,
            stdin_open: true,
          },
        },
      };

      const yaml = composeFileToYAML(composeFile);

      expect(yaml).toContain('app:');
      expect(yaml).toContain('image: app:latest');
    });
  });

  describe('generateComposeYAML', () => {
    it('should combine generation and serialization', () => {
      const services = {
        app: {
          image: 'test:latest',
          env: ['PORT=3000'],
        },
      };

      const result = generateComposeYAML(services);

      expectSuccess(result);
      expect(typeof result.data).toBe('string');
      expect(result.data).toContain('version:');
      expect(result.data).toContain('app:');
      expect(result.data).toContain('PORT: "3000"');
    });

    it('should return failure on validation error', () => {
      const services = {
        invalid: {
          image: '',
        } as ServiceInput,
      };

      const result = generateComposeYAML(services);

      expectFailure(result);
      expectErrorCode(result, 'SERVICE_INVALID');
    });

    it('should apply all options correctly', () => {
      const services = {
        app: {
          image: 'app:latest',
        },
      };

      const result = generateComposeYAML(services, {
        version: '3.7',
        networkName: 'custom',
        containerPrefix: 'prefix',
      });

      expectSuccess(result);
      expect(result.data).toContain('version: "3.7"');
      expect(result.data).toContain('custom:');
      expect(result.data).toContain('container_name: prefix-app');
    });

    it('should produce valid YAML that can be parsed', () => {
      const services = {
        web: {
          image: 'nginx:alpine',
          env: ['PORT=80'],
          expose: [{ port: 80, as: 8080, to: ['local'] }],
        },
      };

      const result = generateComposeYAML(services);

      expectSuccess(result);

      // YAML should be valid (no syntax errors)
      expect(() => {
        // This would throw if YAML is invalid
        const yaml = require('js-yaml');
        yaml.load(result.data);
      }).not.toThrow();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle service with no optional fields', () => {
      const services = {
        minimal: minimalServiceInput,
      };

      const result = generateComposeFile(services);

      expectSuccess(result);

      const service = result.data.services.minimal;
      expect(service.image).toBeDefined();
      expect(service.container_name).toBeDefined();
      expect(service.networks).toBeDefined();
      // Optional fields should not be present
      expect(service.environment).toBeUndefined();
      expect(service.ports).toBeUndefined();
      expect(service.command).toBeUndefined();
    });

    it('should handle port number at boundaries', () => {
      const services = {
        'min-port': {
          image: 'test:latest',
          expose: [{ port: 1, to: ['local'] }],
        },
        'max-port': {
          image: 'test:latest',
          expose: [{ port: 65535, to: ['local'] }],
        },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
    });

    it('should reject port 0', () => {
      const services = {
        'zero-port': {
          image: 'test:latest',
          expose: [{ port: 0, to: ['local'] }],
        },
      };

      const result = generateComposeFile(services);

      expectFailure(result);
    });

    it('should reject port above 65535', () => {
      const services = {
        'huge-port': {
          image: 'test:latest',
          expose: [{ port: 65536, to: ['local'] }],
        },
      };

      const result = generateComposeFile(services);

      expectFailure(result);
    });

    it('should handle service names with special characters', () => {
      const services = {
        'my-api-v2': {
          image: 'api:v2',
        },
      };

      const result = generateComposeFile(services);

      expectSuccess(result);
      expect(result.data.services).toHaveProperty('my-api-v2');
    });
  });
});
