#!/usr/bin/env node
/**
 * Standalone startup script for git-mcp-server
 * Imports reflect-metadata before loading the bundled code
 */

import 'reflect-metadata';
import './dist/index.js';
