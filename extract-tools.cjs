#!/usr/bin/env node

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let buffer = '';

rl.on('line', (line) => {
  buffer += line;
});

rl.on('close', () => {
  try {
    const response = JSON.parse(buffer);
    const tools = response.result.tools;

    console.log('// Generated tool definitions for template-agent-typescript');
    console.log('// Total tools:', tools.length);
    console.log('[');

    tools.forEach((tool, index) => {
      const isLast = index === tools.length - 1;
      console.log('  {');
      console.log(`    name: 'git_${tool.name}',`);
      console.log(`    description: ${JSON.stringify(tool.description)},`);
      console.log(`    input_schema: ${JSON.stringify(tool.inputSchema, null, 6).replace(/\n/g, '\n    ')}`);
      console.log(`  }${isLast ? '' : ','}`);
    });

    console.log(']');
  } catch (error) {
    console.error('Error parsing JSON:', error.message);
    process.exit(1);
  }
});
