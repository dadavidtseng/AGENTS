import { RegistryError } from '../errors/RegistryError.js';
import { ERROR_CODES } from '../errors/ErrorCodes.js';

/**
 * Validate port number
 * @param {number} port - Port number to validate
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validatePort(port) {
  if (typeof port !== 'number') {
    throw new RegistryError(
      `Port must be a number, got ${typeof port}`,
      ERROR_CODES.INVALID_PORT,
      { value: port, expected: 'number' }
    );
  }
  
  if (!Number.isInteger(port)) {
    throw new RegistryError(
      'Port must be an integer',
      ERROR_CODES.INVALID_PORT,
      { value: port, expected: 'integer' }
    );
  }
  
  if (port < 0 || port > 65535) {
    throw new RegistryError(
      'Port must be between 0 and 65535',
      ERROR_CODES.INVALID_PORT,
      { value: port, range: '0-65535' }
    );
  }
  
  return true;
}

/**
 * Validate tunnel service
 * @param {string} service - Tunnel service name
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validateTunnelService(service) {
  const validServices = ['serveo', 'ngrok', 'localtunnel'];
  
  if (typeof service !== 'string') {
    throw new RegistryError(
      `Tunnel service must be a string, got ${typeof service}`,
      ERROR_CODES.INVALID_TUNNEL_SERVICE,
      { value: service, expected: 'string' }
    );
  }
  
  if (!validServices.includes(service)) {
    throw new RegistryError(
      `Invalid tunnel service: ${service}`,
      ERROR_CODES.INVALID_TUNNEL_SERVICE,
      { value: service, validOptions: validServices }
    );
  }
  
  return true;
}

/**
 * Validate timeout value
 * @param {number} timeout - Timeout in seconds
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validateTimeout(timeout) {
  if (typeof timeout !== 'number') {
    throw new RegistryError(
      `Timeout must be a number, got ${typeof timeout}`,
      ERROR_CODES.INVALID_TIMEOUT,
      { value: timeout, expected: 'number' }
    );
  }
  
  if (!Number.isInteger(timeout)) {
    throw new RegistryError(
      'Timeout must be an integer',
      ERROR_CODES.INVALID_TIMEOUT,
      { value: timeout, expected: 'integer' }
    );
  }
  
  if (timeout <= 0) {
    throw new RegistryError(
      'Timeout must be positive',
      ERROR_CODES.INVALID_TIMEOUT,
      { value: timeout, expected: 'positive integer' }
    );
  }
  
  return true;
}

/**
 * Validate container name according to Docker naming rules
 * @param {string} name - Container name
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validateContainerName(name) {
  if (typeof name !== 'string') {
    throw new RegistryError(
      `Container name must be a string, got ${typeof name}`,
      ERROR_CODES.INVALID_CONTAINER_SPEC,
      { value: name, expected: 'string' }
    );
  }
  
  if (name.length === 0) {
    throw new RegistryError(
      'Container name cannot be empty',
      ERROR_CODES.INVALID_CONTAINER_SPEC,
      { value: name }
    );
  }
  
  // More permissive Docker naming validation that allows registry URLs and tags
  // Basic check for invalid starting/ending characters
  if (name.startsWith('.') || name.startsWith('-') || name.endsWith('.') || name.endsWith('-')) {
    throw new RegistryError(
      'Invalid container name format',
      ERROR_CODES.INVALID_CONTAINER_SPEC,
      { value: name, pattern: 'Docker naming convention' }
    );
  }
  
  // Check for obviously invalid characters (allow / for registry URLs and : for tags)
  const invalidChars = /[ @#$%^&*()+={}[\]|\\";'<>?,~`]/;
  if (invalidChars.test(name)) {
    throw new RegistryError(
      'Invalid container name format',
      ERROR_CODES.INVALID_CONTAINER_SPEC,
      { value: name, pattern: 'Docker naming convention' }
    );
  }
  
  // Check for double slashes which are invalid
  if (name.includes('//')) {
    throw new RegistryError(
      'Invalid container name format',
      ERROR_CODES.INVALID_CONTAINER_SPEC,
      { value: name, pattern: 'Docker naming convention' }
    );
  }
  
  return true;
}

/**
 * Validate options object structure
 * @param {object} options - Options to validate
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validateOptions(options) {
  if (options === null) {
    return true; // null is allowed
  }
  
  if (typeof options !== 'object') {
    throw new RegistryError(
      `Options must be an object, got ${typeof options}`,
      ERROR_CODES.INVALID_CONFIG,
      { value: typeof options, expected: 'object' }
    );
  }
  
  if (Array.isArray(options)) {
    throw new RegistryError(
      'Options cannot be an array',
      ERROR_CODES.INVALID_CONFIG,
      { value: 'array', expected: 'object' }
    );
  }
  
  // Reject special objects like Date, Error, etc.
  if (options.constructor !== Object) {
    throw new RegistryError(
      `Options must be a plain object, got ${options.constructor.name}`,
      ERROR_CODES.INVALID_CONFIG,
      { value: options.constructor.name, expected: 'Object' }
    );
  }
  
  return true;
}

/**
 * Validate container specification object
 * @param {object} spec - Container specification
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validateContainerSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new RegistryError(
      'Container specification must be an object',
      ERROR_CODES.INVALID_CONTAINER_SPEC,
      { value: typeof spec, expected: 'object' }
    );
  }
  
  // Validate required fields
  if (!spec.type) {
    throw new RegistryError(
      'Container specification must include type field',
      ERROR_CODES.CONTAINER_SPEC_MISSING_FIELD,
      { field: 'type' }
    );
  }
  
  const validTypes = ['docker', 'podman', 'tar', 'mock'];
  if (!validTypes.includes(spec.type)) {
    throw new RegistryError(
      `Invalid container type: ${spec.type}`,
      ERROR_CODES.INVALID_CONTAINER_TYPE,
      { value: spec.type, validOptions: validTypes }
    );
  }
  
  if (!spec.name) {
    throw new RegistryError(
      'Container specification must include name field',
      ERROR_CODES.CONTAINER_SPEC_MISSING_FIELD,
      { field: 'name' }
    );
  }
  
  // Validate container name
  validateContainerName(spec.name);
  
  // Type-specific validation
  if (spec.type === 'docker' || spec.type === 'podman') {
    if (!spec.image) {
      throw new RegistryError(
        `${spec.type} container specification must include image field`,
        ERROR_CODES.CONTAINER_SPEC_MISSING_FIELD,
        { field: 'image', type: spec.type }
      );
    }
  }
  
  if (spec.type === 'tar') {
    if (!spec.path) {
      throw new RegistryError(
        'Tar container specification must include path field',
        ERROR_CODES.CONTAINER_SPEC_MISSING_FIELD,
        { field: 'path', type: 'tar' }
      );
    }
  }
  
  return true;
}

/**
 * Validate engine name
 * @param {string} engine - Engine name
 * @returns {boolean} - True if valid
 * @throws {RegistryError} - If invalid
 */
function validateEngine(engine) {
  const validEngines = ['docker', 'podman', 'auto'];
  
  if (typeof engine !== 'string') {
    throw new RegistryError(
      `Engine must be a string, got ${typeof engine}`,
      ERROR_CODES.INVALID_CONFIG,
      { value: engine, expected: 'string' }
    );
  }
  
  if (!validEngines.includes(engine)) {
    throw new RegistryError(
      `Invalid engine: ${engine}`,
      ERROR_CODES.INVALID_CONFIG,
      { value: engine, validOptions: validEngines }
    );
  }
  
  return true;
}

export {
  validatePort,
  validateTunnelService,
  validateTimeout,
  validateContainerName,
  validateOptions,
  validateContainerSpec,
  validateEngine
};
