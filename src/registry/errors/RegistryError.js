class RegistryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.details = details;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RegistryError);
    }
  }
  
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack
    };
  }
}

export { RegistryError };