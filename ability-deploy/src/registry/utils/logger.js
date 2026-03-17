import createDebug from 'debug';
import chalk from 'chalk';

/**
 * Logger utility for the registry using debug package
 *
 * Creates namespaced debug instances for different log levels.
 * Enable with: DEBUG=kadi:registry:* or DEBUG=kadi:registry:info,kadi:registry:debug
 */
class Logger {
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.prefix = options.prefix || 'Registry';

    // Create debug instances for each log level
    this.debugError = createDebug(`kadi:${this.prefix.toLowerCase()}:error`);
    this.debugWarn = createDebug(`kadi:${this.prefix.toLowerCase()}:warn`);
    this.debugInfo = createDebug(`kadi:${this.prefix.toLowerCase()}:info`);
    this.debugLog = createDebug(`kadi:${this.prefix.toLowerCase()}:debug`);

    // Enable colors for debug output
    this.debugError.color = '1'; // Red
    this.debugWarn.color = '3';  // Yellow
    this.debugInfo.color = '4';  // Blue
    this.debugLog.color = '8';   // Gray
  }

  log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${this.prefix}] ${level.toUpperCase()}: ${message}`;

    switch (level) {
      case 'error':
        // Always show errors
        console.error(chalk.red(formattedMessage), ...args);
        break;
      case 'warn':
        this.debugWarn(formattedMessage, ...args);
        break;
      case 'info':
        this.debugInfo(formattedMessage, ...args);
        break;
      case 'debug':
        this.debugLog(formattedMessage, ...args);
        break;
      default:
        this.debugLog(formattedMessage, ...args);
    }
  }

  error(message, ...args) {
    this.log('error', message, ...args);
  }

  warn(message, ...args) {
    this.log('warn', message, ...args);
  }

  info(message, ...args) {
    this.log('info', message, ...args);
  }

  debug(message, ...args) {
    this.log('debug', message, ...args);
  }
}

export { Logger };
