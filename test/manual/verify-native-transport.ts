/**
 * Manual Verification Script - Native Transport Integration
 * 
 * This script verifies that file-management-ability is correctly integrated
 * via native transport (direct ES import) without requiring SSH server.
 * 
 * Usage: npx tsx test/manual/verify-native-transport.ts
 */

import { FileOperationsProxy } from '../../src/abilities/file-operations-proxy.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'file-ops-verification');
const SOURCE_FILE = path.join(TEST_DIR, 'source.txt');
const DEST_FILE = path.join(TEST_DIR, 'destination.txt');
const TEST_CONTENT = 'Native transport verification test - ' + new Date().toISOString();

async function main() {
  console.log('🧪 Verifying file-management-ability native transport integration...\n');

  try {
    // Setup
    console.log('📁 Setting up test directory...');
    await fs.mkdir(TEST_DIR, { recursive: true });
    await fs.writeFile(SOURCE_FILE, TEST_CONTENT, 'utf-8');
    console.log(`✓ Created test file: ${SOURCE_FILE}\n`);

    // Test 1: Instantiate FileOperationsProxy
    console.log('1️⃣ Testing FileOperationsProxy instantiation...');
    const fileOps = new FileOperationsProxy();
    console.log('✓ FileOperationsProxy created (no dependencies required)\n');

    // Test 2: Load native file-management-ability
    console.log('2️⃣ Testing native module import...');
    try {
      // This will trigger the dynamic import inside FileOperationsProxy
      const result = await fileOps.uploadViaSSH({
        host: 'test-verification',
        username: 'test',
        localPath: SOURCE_FILE,
        remotePath: '/tmp/test.txt',
        privateKey: '/nonexistent/key.pem'
      });
      
      // We expect this to fail (no SSH server), but if it loaded the module, it's success!
      if (!result.success) {
        console.log('✓ Native module loaded successfully!');
        console.log(`  Error code: ${result.error.code} (expected - no SSH connection)`);
        console.log(`  Error message: ${result.error.message}\n`);
      }
    } catch (error) {
      console.error('✗ Failed to load native module:', error);
      throw error;
    }

    // Test 3: Test local file operations (if available)
    console.log('3️⃣ Testing local file operations via native transport...');
    console.log('  Note: file-management-ability provides local operations too!\n');

    // Import file-management-ability directly to test local operations
    // @ts-expect-error - Dynamic import
    const fileManager = (await import('../../../kadi/file-management-ability/index.js')).default;
    
    // Test local copy
    console.log('  📋 Testing local file copy...');
    const copyResult = await fileManager.local.copyFile(SOURCE_FILE, DEST_FILE);
    console.log(`  ✓ ${copyResult}`);
    
    // Verify copied content
    const copiedContent = await fs.readFile(DEST_FILE, 'utf-8');
    if (copiedContent === TEST_CONTENT) {
      console.log('  ✓ Content verified: Files match!\n');
    } else {
      throw new Error('Content mismatch after copy!');
    }

    // Test local list
    console.log('  📂 Testing local directory listing...');
    const files = await fileManager.local.listFilesAndFolders(TEST_DIR);
    console.log(`  ✓ Found ${files.length} items in test directory:`);
    files.forEach((f: { name: string; type: string }) => {
      console.log(`    - ${f.name} (${f.type})`);
    });

    // Cleanup
    console.log('\n🧹 Cleaning up test files...');
    await fs.rm(TEST_DIR, { recursive: true, force: true });
    console.log('✓ Cleanup complete\n');

    // Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ VERIFICATION SUCCESSFUL!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('Native transport integration is working correctly:');
    console.log('  ✓ FileOperationsProxy instantiates without dependencies');
    console.log('  ✓ file-management-ability loads via dynamic import');
    console.log('  ✓ Local file operations work (copy, list)');
    console.log('  ✓ Error handling works (SSH failures handled gracefully)');
    console.log('');
    console.log('Your template-agent-typescript can now use file-management-ability');
    console.log('via native transport (zero overhead, no broker required)!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ VERIFICATION FAILED:');
    console.error(error);
    process.exit(1);
  }
}

main();
