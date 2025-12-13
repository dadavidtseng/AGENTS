/**
 * SimpleMiner Autonomous Agents
 *
 * This module provides autonomous AI agent implementations for SimpleMiner game.
 * These agents connect to the KADI broker, spawn in-game agents, and execute
 * behaviors like mining ore, building structures, and exploring the world.
 *
 * Architecture:
 * - BaseAgent: Abstract base class with common agent functionality
 * - MinerAgent: Autonomous ore discovery and extraction
 * - BuilderAgent: Automated structure construction
 *
 * Usage:
 * ```typescript
 * import { MinerAgent, BuilderAgent } from './agents/simpleminer';
 *
 * const miner = new MinerAgent(kadiClient, { name: 'MinerBot' });
 * await miner.start();
 * ```
 *
 * @module agents/simpleminer
 */

export { BaseAgent, type AgentConfig } from './base-agent.js';
export { MinerAgent, type MinerConfig } from './miner-agent.js';
export { BuilderAgent, type BuilderConfig } from './builder-agent.js';
