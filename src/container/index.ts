/**
 * @fileoverview DI container composition root.
 */
import 'reflect-metadata';
import { registerCoreServices } from '@/container/registrations/core.js';
import { registerMcpServices } from '@/container/registrations/mcp.js';

export function composeContainer(): void {
  registerCoreServices();
  registerMcpServices();
}
