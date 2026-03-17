#!/usr/bin/env tsx
/**
 * Unit test: merge conflict detection & resolution in git-operations.ts
 *
 * Mocks KadiClient.invokeRemote to simulate mcp-server-git responses,
 * testing the actual merge logic without needing a live broker.
 *
 * Test scenarios:
 *   1. Clean merge (no conflicts)
 *   2. Auto-resolvable conflict (package-lock.json → "theirs")
 *   3. Non-resolvable conflict (source code → escalate to HUMAN)
 *   4. Mixed: one auto-resolvable + one non-resolvable
 *
 * Usage:
 *   npx tsx scripts/test-merge-conflict.ts
 */

import { mergeTaskBranch } from '../src/handlers/git-operations.js';

// ============================================================================
// Mock KadiClient
// ============================================================================

type InvokeHandler = (tool: string, args: Record<string, any>) => any;

function createMockClient(onInvoke: InvokeHandler) {
  const published: Array<{ event: string; payload: any }> = [];

  const client = {
    invokeRemote: async (tool: string, args: Record<string, any>) => {
      const result = onInvoke(tool, args);
      // Wrap in MCP response format if not already
      if (result?.content) return result;
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
    publish: async (event: string, payload: any) => {
      published.push({ event, payload });
    },
    published,
  };

  return client as any;
}

// ============================================================================
// Test helpers
// ============================================================================

let passed = 0;
let failed = 0;

function log(msg: string): void {
  console.log(`\n${'='.repeat(60)}\n${msg}\n${'='.repeat(60)}`);
}

function pass(name: string): void {
  console.log(`  ✅ PASS: ${name}`);
  passed++;
}

function fail(name: string, reason: string): void {
  console.log(`  ❌ FAIL: ${name} — ${reason}`);
  failed++;
}

function assert(condition: boolean, name: string, reason = 'assertion failed') {
  if (condition) pass(name);
  else fail(name, reason);
}

// ============================================================================
// Test 1: Clean merge (no conflicts)
// ============================================================================

async function testCleanMerge(): Promise<void> {
  log('Test 1: Clean merge (no conflicts)');

  const client = createMockClient((tool, args) => {
    if (tool === 'git_git_set_working_dir') {
      return { success: true, path: args.path, message: 'ok' };
    }
    if (tool === 'git_git_merge') {
      return {
        success: true,
        conflicts: false,
        conflictedFiles: [],
        mergedFiles: ['file-a.txt'],
        message: 'Merge completed',
      };
    }
    return { success: true };
  });

  const result = await mergeTaskBranch(
    client, '/fake/repo', 'branch-a', 'quest-1', 'agent-lead-test',
  );

  assert(result.merge.success, 'merge succeeded');
  assert(!result.merge.conflicts, 'no conflicts');
  assert(!result.resolution, 'no resolution needed');
}

// ============================================================================
// Test 2: Auto-resolvable conflict (package-lock.json)
// ============================================================================

async function testAutoResolvable(): Promise<void> {
  log('Test 2: Auto-resolvable conflict (package-lock.json)');

  const checkoutCalls: Array<{ file: string; strategy: string }> = [];
  const stagedFiles: string[] = [];

  const client = createMockClient((tool, args) => {
    if (tool === 'git_git_set_working_dir') {
      return { success: true, path: args.path, message: 'ok' };
    }
    if (tool === 'git_git_merge') {
      return {
        success: false,
        conflicts: true,
        conflictedFiles: ['package-lock.json'],
        mergedFiles: [],
        message: 'CONFLICT in package-lock.json',
      };
    }
    if (tool === 'git_git_status') {
      return {
        currentBranch: 'staging',
        isClean: false,
        conflictedFiles: ['package-lock.json'],
        stagedChanges: [],
        unstagedChanges: [],
      };
    }
    if (tool === 'git_git_checkout') {
      const strategy = args.theirs ? 'theirs' : 'ours';
      checkoutCalls.push({ file: args.files[0], strategy });
      return { success: true };
    }
    if (tool === 'git_git_add') {
      stagedFiles.push(...args.files);
      return { success: true };
    }
    if (tool === 'git_git_commit') {
      return { commitHash: 'abc1234' };
    }
    return { success: true };
  });

  const result = await mergeTaskBranch(
    client, '/fake/repo', 'lock-branch', 'quest-1', 'agent-lead-test',
  );

  assert(result.merge.conflicts, 'conflicts detected');
  assert(!!result.resolution, 'resolution attempted');
  assert(result.resolution!.resolved === true, 'all conflicts resolved');
  assert(
    result.resolution!.autoResolved.includes('package-lock.json'),
    'package-lock.json auto-resolved',
  );
  assert(result.resolution!.escalated.length === 0, 'nothing escalated');
  assert(
    checkoutCalls.some(c => c.file === 'package-lock.json' && c.strategy === 'theirs'),
    'used "theirs" strategy for lock file',
  );
  assert(stagedFiles.includes('package-lock.json'), 'lock file staged');
  assert(result.finalCommit === 'abc1234', 'merge committed');
}

// ============================================================================
// Test 3: Non-resolvable conflict (source code → escalate)
// ============================================================================

async function testNonResolvable(): Promise<void> {
  log('Test 3: Non-resolvable conflict (source code → escalate)');

  let mergeAborted = false;

  const client = createMockClient((tool, args) => {
    if (tool === 'git_git_set_working_dir') {
      return { success: true, path: args.path, message: 'ok' };
    }
    if (tool === 'git_git_merge') {
      if (args.abort) {
        mergeAborted = true;
        return { success: true };
      }
      return {
        success: false,
        conflicts: true,
        conflictedFiles: ['src/index.ts'],
        mergedFiles: [],
        message: 'CONFLICT in src/index.ts',
      };
    }
    return { success: true };
  });

  const result = await mergeTaskBranch(
    client, '/fake/repo', 'src-branch', 'quest-1', 'agent-lead-test',
  );

  assert(result.merge.conflicts, 'conflicts detected');
  assert(!!result.resolution, 'resolution attempted');
  assert(!result.resolution!.resolved, 'not fully resolved');
  assert(result.resolution!.autoResolved.length === 0, 'nothing auto-resolved');
  assert(
    result.resolution!.escalated.includes('src/index.ts'),
    'src/index.ts escalated',
  );
  assert(!result.finalCommit, 'no commit (unresolved)');
  assert(mergeAborted, 'merge aborted after escalation');

  // Check escalation event was published
  assert(
    client.published.some(
      (e: any) => e.event === 'conflict.escalation'
        && e.payload.questId === 'quest-1'
        && e.payload.conflictedFiles.includes('src/index.ts'),
    ),
    'conflict.escalation event published',
  );
}

// ============================================================================
// Test 4: Mixed conflicts (auto-resolvable + non-resolvable)
// ============================================================================

async function testMixedConflicts(): Promise<void> {
  log('Test 4: Mixed conflicts (auto-resolvable + non-resolvable)');

  let mergeAborted = false;
  const checkoutCalls: Array<{ file: string; strategy: string }> = [];

  const client = createMockClient((tool, args) => {
    if (tool === 'git_git_set_working_dir') {
      return { success: true, path: args.path, message: 'ok' };
    }
    if (tool === 'git_git_merge') {
      if (args.abort) {
        mergeAborted = true;
        return { success: true };
      }
      return {
        success: false,
        conflicts: true,
        conflictedFiles: ['package-lock.json', 'src/app.ts', '.env'],
        mergedFiles: [],
        message: 'CONFLICT in multiple files',
      };
    }
    if (tool === 'git_git_checkout') {
      const strategy = args.theirs ? 'theirs' : 'ours';
      checkoutCalls.push({ file: args.files[0], strategy });
      return { success: true };
    }
    if (tool === 'git_git_add') return { success: true };
    return { success: true };
  });

  const result = await mergeTaskBranch(
    client, '/fake/repo', 'mix-branch', 'quest-1', 'agent-lead-test',
  );

  assert(result.merge.conflicts, 'conflicts detected');
  assert(!!result.resolution, 'resolution attempted');
  assert(!result.resolution!.resolved, 'not fully resolved (has escalated)');

  // package-lock.json → theirs
  assert(
    result.resolution!.autoResolved.includes('package-lock.json'),
    'package-lock.json auto-resolved',
  );
  assert(
    checkoutCalls.some(c => c.file === 'package-lock.json' && c.strategy === 'theirs'),
    'package-lock.json used "theirs"',
  );

  // .env → ours
  assert(
    result.resolution!.autoResolved.includes('.env'),
    '.env auto-resolved',
  );
  assert(
    checkoutCalls.some(c => c.file === '.env' && c.strategy === 'ours'),
    '.env used "ours"',
  );

  // src/app.ts → escalated
  assert(
    result.resolution!.escalated.includes('src/app.ts'),
    'src/app.ts escalated',
  );

  assert(mergeAborted, 'merge aborted (has unresolved conflicts)');
  assert(!result.finalCommit, 'no commit (unresolved)');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('🧪 Merge Conflict Unit Test (mocked MCP calls)\n');

  try {
    await testCleanMerge();
    await testAutoResolvable();
    await testNonResolvable();
    await testMixedConflicts();
  } catch (err) {
    console.error('\nFatal error:', err);
    process.exitCode = 1;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('❌ Some tests failed');
    process.exitCode = 1;
  } else {
    console.log('✅ All tests passed');
  }
  console.log('='.repeat(60));
}

main();
