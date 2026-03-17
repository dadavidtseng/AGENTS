/**
 * Unreal Engine-Style Logger Utility
 * ==================================
 *
 * Provides structured logging with Unreal Engine format:
 * [MODULE_NAME] [HH:MM:SS.mmm] LogLevel: Message
 *
 * This logger is shared across all KĀDI agents (template-agent-typescript,
 * agent-producer, agent-artist, etc.) for consistent log formatting.
 *
 * Usage:
 * ```typescript
 * import { logger, MODULE_AGENT } from 'agents-library';
 *
 * logger.info(MODULE_AGENT, 'Application started');
 * logger.warn(MODULE_SLACK_BOT, 'Circuit breaker open', { timeout: 5000 });
 * logger.error(MODULE_AGENT, 'Connection failed', error);
 * logger.debug(MODULE_TOOLS, 'Tool invocation', { toolName: 'echo' });
 * ```
 *
 * @module logger
 */

/**
 * Module name constants for structured logging
 * All use kebab-case for consistency with KĀDI naming conventions
 */
export const MODULE_AGENT = 'template-agent' as const;
export const MODULE_SLACK_BOT = 'slack-bot' as const;
export const MODULE_DISCORD_BOT = 'discord-bot' as const;
export const MODULE_TASK_HANDLER = 'task-handler' as const;
export const MODULE_TOOLS = 'tools' as const;

/**
 * ANSI Color Codes for Terminal Output
 *
 * These color codes are applied only in TTY (interactive terminal) environments.
 * Non-TTY environments (pipes, redirects, log files) automatically receive plain text.
 *
 * Respects the NO_COLOR environment variable (https://no-color.org/)
 * Set NO_COLOR=1 to disable colors globally.
 */
const COLORS = {
    RESET: '\x1b[0m',
    CYAN: '\x1b[36m',     // Info level
    YELLOW: '\x1b[33m',   // Warning level
    RED: '\x1b[31m',      // Error level
    GRAY: '\x1b[90m',     // Debug level
    WHITE: '\x1b[37m'     // Message text color
};

/**
 * UnrealLogger class for Unreal Engine-style structured logging
 *
 * Formats all log output as: [MODULE_NAME] [HH:MM:SS.mmm] LogLevel: Message
 *
 * @example
 * ```typescript
 * const logger = new UnrealLogger();
 * logger.info('my-module', 'Initialization complete');
 * // Output: [my-module] [14:32:45.123] Info: Initialization complete
 * ```
 */
class Logger {
    /**
     * Get current timestamp in HH:MM:SS.mmm format
     *
     * @returns Formatted timestamp string with millisecond precision
     */
    private getTimestamp(): string {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    /**
     * Determine if colors should be used in log output
     *
     * Colors are enabled only when:
     * 1. stdout is a TTY (interactive terminal)
     * 2. NO_COLOR environment variable is not set
     *
     * This respects the NO_COLOR standard (https://no-color.org/)
     * which provides a universal way to disable colorized output.
     *
     * @returns true if colors should be applied, false for plain text
     */
    private shouldUseColors(): boolean {
        return process.stdout.isTTY && process.env.NO_COLOR === undefined;
    }

    /**
     * Format log message with module name and timestamp
     *
     * @param module - Module name (e.g., 'template-agent', 'slack-bot')
     * @param level - Log level (Info, Warning, Error, Debug)
     * @param message - Log message
     * @param elapsedTime - Elapsed time suffix (e.g., '+5s', '+3m') - always included
     * @param color - Optional ANSI color code to apply to module bracket, level indicator, and elapsed time
     * @returns Formatted log string with selective coloring: <color>[module]<reset> [timestamp] <color>level<reset>: <white>message<reset> <color>elapsedTime<reset>
     */
    private formatMessage(module: string, level: string, message: string, elapsedTime: string, color?: string): string {
        const timestamp = this.getTimestamp();

        if (this.shouldUseColors() && color) {
            // Apply selective coloring with module name and elapsed time both colored to match level:
            // <color>[module]<reset> [timestamp] <color>level<reset>: <white>message<reset> <color>elapsedTime<reset>
            // Module bracket colored to match level (cyan/yellow/red/gray)
            // Timestamp in terminal default color (no color codes)
            // Level indicator colored to match level
            // Message text in WHITE
            // Elapsed time suffix always colored to match level
            return `${color}[${module}]${COLORS.RESET} [${timestamp}] ${color}${level}${COLORS.RESET}: ${COLORS.WHITE}${message}${COLORS.RESET} ${color}${elapsedTime}${COLORS.RESET}`;
        }

        // Plain text for non-TTY environments
        return `[${module}] [${timestamp}] ${level}: ${message} ${elapsedTime}`;
    }

    /**
     * Log informational message
     *
     * Used for normal operational events (startup, connections, completions)
     *
     * @param module - Module name
     * @param message - Log message
     * @param elapsedTime - Elapsed time suffix (e.g., '+5s', '+3m')
     * @param data - Optional data to log (will be logged on separate line)
     */
    info(module: string, message: string, elapsedTime: string, data?: any): void {
        console.log(this.formatMessage(module, 'Info', message, elapsedTime, COLORS.CYAN));
        if (data) {
            console.log(data);
        }
    }

    /**
     * Log warning message
     *
     * Used for potentially problematic situations (circuit breaker open, retries, timeouts)
     *
     * @param module - Module name
     * @param message - Log message
     * @param elapsedTime - Elapsed time suffix (e.g., '+5s', '+3m')
     * @param data - Optional data to log
     */
    warn(module: string, message: string, elapsedTime: string, data?: any): void {
        console.warn(this.formatMessage(module, 'Warning', message, elapsedTime, COLORS.YELLOW));
        if (data) {
            console.warn(data);
        }
    }

    /**
     * Log error message
     *
     * Used for error conditions and exceptions
     *
     * @param module - Module name
     * @param message - Log message
     * @param elapsedTime - Elapsed time suffix (e.g., '+5s', '+3m')
     * @param error - Optional error object or error message string
     * @param data - Optional additional data to log
     */
    error(module: string, message: string, elapsedTime: string, error?: Error | string, data?: any): void {
        console.error(this.formatMessage(module, 'Error', message, elapsedTime, COLORS.RED));

        if (error instanceof Error) {
            if (error.stack) {
                console.error(error.stack);
            } else {
                console.error(error.message);
            }
        } else if (error) {
            console.error(error);
        }

        if (data) {
            console.error(data);
        }
    }

    /**
     * Log debug message
     *
     * Used for detailed diagnostic information during development
     *
     * @param module - Module name
     * @param message - Log message
     * @param elapsedTime - Elapsed time suffix (e.g., '+5s', '+3m')
     * @param data - Optional data to log
     */
    debug(module: string, message: string, elapsedTime: string, data?: any): void {
        console.log(this.formatMessage(module, 'Debug', message, elapsedTime, COLORS.GRAY));
        if (data) {
            console.log(data);
        }
    }
}

/**
 * Singleton logger instance
 *
 * Export as singleton to ensure consistent timestamp generation and
 * single source of truth for logging configuration across all agents.
 *
 * @example
 * ```typescript
 * import { logger, MODULE_AGENT } from 'agents-library';
 * logger.info(MODULE_AGENT, 'Application started');
 * ```
 */
export const logger = new Logger();
