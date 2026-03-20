#!/usr/bin/env node

// test-runner.js - Complete Feature Testing Suite for ArcadeDB Admin Tool
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class TestRunner {
    constructor() {
        this.testResults = [];
        this.passed = 0;
        this.failed = 0;
        this.skipped = 0;
        this.testData = {
            testDatabase: 'TestRunner_' + Date.now(),
            sampleData: this.generateSampleData(),
            backupFile: null
        };
        this.cleanup = [];
    }

    // Test execution framework
    async runTest(name, testFunction, options = {}) {
        const { skip = false, timeout = 30000 } = options;
        
        if (skip) {
            console.log(`⏭️  SKIP: ${name}`);
            this.testResults.push({ name, status: 'skipped', reason: 'Manually skipped' });
            this.skipped++;
            return;
        }

        console.log(`🧪 TEST: ${name}`);
        
        const startTime = Date.now();
        
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout)
            );
            
            await Promise.race([testFunction(), timeoutPromise]);
            
            const duration = Date.now() - startTime;
            console.log(`✅ PASS: ${name} (${duration}ms)`);
            this.testResults.push({ name, status: 'passed', duration });
            this.passed++;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            console.log(`❌ FAIL: ${name} - ${error.message} (${duration}ms)`);
            this.testResults.push({ name, status: 'failed', error: error.message, duration });
            this.failed++;
        }
    }

    async runAllTests() {
        console.log('🚀 Starting ArcadeDB Admin Tool Test Suite');
        console.log('═'.repeat(60));

        try {
            // Setup phase
            await this.runTest('Setup - Check Prerequisites', () => this.testPrerequisites());
            
            // Container management tests
            console.log('\n🐳 Container Management Tests');
            console.log('-'.repeat(40));
            await this.runTest('Container - Start Clean', () => this.testContainerStart(), { timeout: 120000 });
            await this.runTest('Container - Status Check', () => this.testContainerStatus());
            await this.runTest('Container - Health Check', () => this.testHealthCheck());
            await this.runTest('Container - Logs', () => this.testLogs());
            await this.runTest('Container - Metrics', () => this.testMetrics());
            
            // Database management tests
            console.log('\n💾 Database Management Tests');
            console.log('-'.repeat(40));
            await this.runTest('Database - List Empty', () => this.testDatabaseListEmpty());
            await this.runTest('Database - Create', () => this.testDatabaseCreate());
            await this.runTest('Database - List With Data', () => this.testDatabaseList());
            await this.runTest('Database - Info', () => this.testDatabaseInfo());
            await this.runTest('Database - Users', () => this.testDatabaseUsers());
            await this.runTest('Database - Stats', () => this.testDatabaseStats());
            
            // Import/Export tests
            console.log('\n📊 Import/Export Tests');
            console.log('-'.repeat(40));
            await this.runTest('Import - Create Test Data', () => this.createTestDataFiles());
            await this.runTest('Import - JSON Data', () => this.testImportJSON());
            await this.runTest('Import - CSV Data', () => this.testImportCSV());
            await this.runTest('Export - JSON Format', () => this.testExportJSON());
            await this.runTest('Export - CSV Format', () => this.testExportCSV());
            
            // Backup/Restore tests
            console.log('\n🔄 Backup & Restore Tests');
            console.log('-'.repeat(40));
            await this.runTest('Backup - Create Backup', () => this.testBackupCreate());
            await this.runTest('Backup - List Backups', () => this.testBackupList());
            await this.runTest('Backup - Verify Backup', () => this.testBackupVerify());
            await this.runTest('Backup - Clear Databases', () => this.testClearDatabases());
            await this.runTest('Backup - Restore Database', () => this.testBackupRestore());
            
            // Monitoring tests
            console.log('\n🏥 Monitoring Tests');
            console.log('-'.repeat(40));
            await this.runTest('Monitor - Diagnostics', () => this.testDiagnostics());
            await this.runTest('Monitor - System Monitoring', () => this.testSystemMonitoring(), { skip: false, timeout: 10000 });
            
            // Maintenance tests
            console.log('\n🛠️ Maintenance Tests');
            console.log('-'.repeat(40));
            await this.runTest('Maintenance - Cleanup Dry Run', () => this.testCleanupDryRun());
            await this.runTest('Maintenance - Config Show', () => this.testConfigShow());
            
            // Cleanup phase
            console.log('\n🧹 Cleanup Tests');
            console.log('-'.repeat(40));
            await this.runTest('Cleanup - Remove Test Database', () => this.testDatabaseDrop());
            await this.runTest('Cleanup - Stop Container', () => this.testContainerStop());
            await this.runTest('Cleanup - Remove Test Files', () => this.cleanupTestFiles());

        } catch (error) {
            console.error('❌ Test suite failed with critical error:', error.message);
        }

        this.showTestResults();
    }

    // Individual test methods

    async testPrerequisites() {
        // Check Node.js version
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
        if (majorVersion < 18) {
            throw new Error(`Node.js 18+ required, found ${nodeVersion}`);
        }

        // Check Docker availability
        try {
            execSync('docker --version', { stdio: 'ignore' });
        } catch (error) {
            throw new Error('Docker is not available');
        }

        // Check arcade-admin.js exists
        if (!fs.existsSync('./arcade-admin.js')) {
            throw new Error('arcade-admin.js not found in current directory');
        }

        // Check lib directory exists
        if (!fs.existsSync('./lib')) {
            throw new Error('lib directory not found');
        }

        console.log(`   ✓ Node.js ${nodeVersion}`);
        console.log(`   ✓ Docker available`);
        console.log(`   ✓ arcade-admin.js found`);
        console.log(`   ✓ lib directory found`);
    }

    async testContainerStart() {
        const result = this.executeCommand('start');
        if (!result.includes('Server is ready!') && !result.includes('Container started successfully')) {
            throw new Error('Container did not start properly');
        }
        console.log('   ✓ Container started successfully');
    }

    async testContainerStatus() {
        const result = this.executeCommand('status');
        if (!result.includes('Running') || !result.includes('Ready')) {
            throw new Error('Container or server not in expected state');
        }
        console.log('   ✓ Container and server are running');
    }

    async testHealthCheck() {
        const result = this.executeCommand('health');
        if (!result.includes('Health Check Report')) {
            throw new Error('Health check did not run properly');
        }
        console.log('   ✓ Health check completed');
    }

    async testLogs() {
        const result = this.executeCommand('logs --lines=10');
        if (!result.includes('Container Logs')) {
            throw new Error('Could not retrieve container logs');
        }
        console.log('   ✓ Container logs retrieved');
    }

    async testMetrics() {
        const result = this.executeCommand('metrics');
        if (!result.includes('Performance Metrics')) {
            throw new Error('Could not retrieve performance metrics');
        }
        console.log('   ✓ Performance metrics retrieved');
    }

    async testDatabaseListEmpty() {
        const result = this.executeCommand('database list');
        if (!result.includes('Available databases')) {
            throw new Error('Could not list databases');
        }
        console.log('   ✓ Database list command working');
    }

    async testDatabaseCreate() {
        const result = this.executeCommand(`database create ${this.testData.testDatabase}`);
        if (!result.includes('created successfully')) {
            throw new Error('Database creation failed');
        }
        // Note: Don't add cleanup function here since we have a dedicated cleanup test
        console.log(`   ✓ Database ${this.testData.testDatabase} created`);
    }

    async testDatabaseList() {
        const result = this.executeCommand('database list');
        if (!result.includes(this.testData.testDatabase)) {
            throw new Error('Created database not found in list');
        }
        console.log('   ✓ Database appears in list');
    }

    async testDatabaseInfo() {
        const result = this.executeCommand(`database info ${this.testData.testDatabase}`);
        if (!result.includes('Database:') || !result.includes(this.testData.testDatabase)) {
            throw new Error('Database info command failed');
        }
        console.log('   ✓ Database info retrieved');
    }

    async testDatabaseUsers() {
        const result = this.executeCommand(`database users ${this.testData.testDatabase}`);
        if (!result.includes('User information') && !result.includes('Users with access')) {
            throw new Error('Database users command failed');
        }
        console.log('   ✓ Database users command working (limited functionality noted)');
    }

    async testDatabaseStats() {
        const result = this.executeCommand('database stats');
        if (!result.includes('Database Statistics')) {
            throw new Error('Database stats command failed');
        }
        console.log('   ✓ Database statistics retrieved');
    }

    createTestDataFiles() {
        const testDir = './test-data';
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir);
        }

        // Create JSON test data
        const jsonData = this.testData.sampleData.users;
        fs.writeFileSync(path.join(testDir, 'users.json'), JSON.stringify(jsonData, null, 2));

        // Create CSV test data
        const csvData = [
            'id,name,email,age',
            '1,John Doe,john@example.com,30',
            '2,Jane Smith,jane@example.com,25',
            '3,Bob Johnson,bob@example.com,35'
        ].join('\n');
        fs.writeFileSync(path.join(testDir, 'users.csv'), csvData);

        this.cleanup.push(() => {
            if (fs.existsSync(testDir)) {
                fs.rmSync(testDir, { recursive: true, force: true });
            }
        });

        console.log('   ✓ Test data files created');
    }

    async testImportJSON() {
        const result = this.executeCommand(`import ${this.testData.testDatabase} ./test-data/users.json`);
        if (!result.includes('Import completed successfully')) {
            throw new Error('JSON import failed');
        }
        console.log('   ✓ JSON data imported successfully');
    }

    async testImportCSV() {
        const result = this.executeCommand(`import ${this.testData.testDatabase} ./test-data/users.csv --type=CsvUser`);
        if (!result.includes('Import completed successfully')) {
            throw new Error('CSV import failed');
        }
        console.log('   ✓ CSV data imported successfully');
    }

    async testExportJSON() {
        const result = this.executeCommand(`export ${this.testData.testDatabase} ./test-data/export.json`);
        if (!result.includes('Export completed successfully') && !result.includes('No data found') && !result.includes('Export Statistics')) {
            throw new Error(`JSON export failed - Output: ${result.substring(0, 200)}...`);
        }
        
        if (fs.existsSync('./test-data/export.json')) {
            console.log('   ✓ Data exported to JSON successfully');
        } else {
            console.log('   ✓ Export completed (no data to export)');
        }
    }

    async testExportCSV() {
        const result = this.executeCommand(`export ${this.testData.testDatabase} ./test-data/export.csv --format=csv`);
        if (!result.includes('Export completed successfully') && !result.includes('No data found') && !result.includes('Export Statistics')) {
            throw new Error(`CSV export failed - Output: ${result.substring(0, 200)}...`);
        }
        
        if (fs.existsSync('./test-data/export.csv')) {
            console.log('   ✓ Data exported to CSV successfully');
        } else {
            console.log('   ✓ Export completed (no data to export)');
        }
    }

    async testBackupCreate() {
        const result = this.executeCommand(`backup ${this.testData.testDatabase}`);
        if (!result.includes('Backup created')) {
            throw new Error('Backup creation failed');
        }
        
        // Extract backup file path from output - look for the "Location:" line
        const locationMatch = result.match(/Location: (.+)/);
        if (locationMatch) {
            let backupPath = locationMatch[1].trim();
            // Ensure we have the full path with ./ prefix
            if (!backupPath.startsWith('./')) {
                backupPath = `./${backupPath}`;
            }
            this.testData.backupFile = backupPath;
            console.log(`   ✓ Database backup created: ${this.testData.backupFile}`);
        } else {
            // Fallback: look for the "Backup created:" line and construct path
            const createdMatch = result.match(/Backup created: (.+)/);
            if (createdMatch) {
                const filename = createdMatch[1].trim();
                this.testData.backupFile = `./arcadedb-data/backups/${this.testData.testDatabase}/${filename}`;
                console.log(`   ✓ Database backup created (constructed path): ${this.testData.backupFile}`);
            } else {
                console.log('   ✓ Database backup created (could not extract path)');
            }
        }
    }

    async testBackupList() {
        const result = this.executeCommand('list-backups');
        if (!result.includes('Available backups')) {
            throw new Error('Backup list command failed');
        }
        
        if (!result.includes(this.testData.testDatabase)) {
            throw new Error('Created backup not found in list');
        }
        
        console.log('   ✓ Backup appears in backup list');
    }

    async testBackupVerify() {
        if (!this.testData.backupFile) {
            // Try to find the backup file from the backup list
            const listResult = this.executeCommand('list-backups');
            const filenameMatch = listResult.match(/([a-zA-Z0-9_-]+-backup-[0-9-]+\.zip)/);
            if (filenameMatch) {
                this.testData.backupFile = `./arcadedb-data/backups/${this.testData.testDatabase}/${filenameMatch[1]}`;
            } else {
                throw new Error('No backup file to verify');
            }
        }
        
        const result = this.executeCommand(`verify-backup "${this.testData.backupFile}"`);
        if (!result.includes('Backup verification passed')) {
            throw new Error(`Backup verification failed: ${result}`);
        }
        
        console.log('   ✓ Backup verification passed');
    }

    async testClearDatabases() {
        const result = this.executeCommand('clear-databases --confirm');
        if (!result.includes('databases') || result.includes('failed')) {
            throw new Error('Clear databases command failed');
        }
        console.log('   ✓ Databases cleared successfully');
    }

    async testBackupRestore() {
        if (!this.testData.backupFile) {
            // Try to find the backup file from the backup list
            const listResult = this.executeCommand('list-backups');
            const filenameMatch = listResult.match(/([a-zA-Z0-9_-]+-backup-[0-9-]+\.zip)/);
            if (filenameMatch) {
                this.testData.backupFile = `./arcadedb-data/backups/${this.testData.testDatabase}/${filenameMatch[1]}`;
            } else {
                throw new Error('No backup file to restore');
            }
        }
        
        console.log(`   Restoring from: ${this.testData.backupFile}`);
        // Use --overwrite flag in case database still exists
        const result = this.executeCommand(`restore ${this.testData.testDatabase} "${this.testData.backupFile}" --overwrite`);
        if (!result.includes('successfully restored')) {
            throw new Error(`Backup restore failed: ${result.substring(0, 300)}`);
        }
        
        console.log('   ✓ Database restored from backup');
    }

    async testDiagnostics() {
        const result = this.executeCommand('diagnostics');
        if (!result.includes('Diagnostic Report')) {
            throw new Error('Diagnostics command failed');
        }
        console.log('   ✓ System diagnostics completed');
    }

    async testSystemMonitoring() {
        // Use very short duration for testing
        const result = this.executeCommand('monitor --duration=2 --interval=1');
        if (!result.includes('Monitoring Report') && !result.includes('Monitoring')) {
            throw new Error(`System monitoring failed: ${result.substring(0, 200)}`);
        }
        console.log('   ✓ System monitoring completed');
    }

    async testCleanupDryRun() {
        const result = this.executeCommand('cleanup --dry-run');
        if (!result.includes('Dry run mode')) {
            throw new Error('Cleanup dry run failed');
        }
        console.log('   ✓ Cleanup dry run completed');
    }

    async testConfigShow() {
        const result = this.executeCommand('config show');
        if (!result.includes('Configuration') || !result.includes('server:')) {
            throw new Error('Config show command failed');
        }
        console.log('   ✓ Configuration displayed');
    }

    async testDatabaseDrop() {
        const result = this.executeCommand(`database drop ${this.testData.testDatabase} --confirm`);
        if (!result.includes('dropped successfully')) {
            throw new Error('Database drop failed');
        }
        console.log('   ✓ Test database removed');
    }

    async testContainerStop() {
        const result = this.executeCommand('stop');
        if (!result.includes('stopped') && !result.includes('not running')) {
            throw new Error('Container stop failed');
        }
        console.log('   ✓ Container stopped');
    }

    async cleanupTestFiles() {
        try {
            // Clean up test data files
            if (fs.existsSync('./test-data')) {
                fs.rmSync('./test-data', { recursive: true, force: true });
                console.log('   ✓ Test data directory removed');
            }
            
            // Run other cleanup functions
            this.cleanup.forEach(cleanupFn => {
                try {
                    cleanupFn();
                } catch (error) {
                    console.warn(`   ⚠️ Cleanup warning: ${error.message}`);
                }
            });
            
            console.log('   ✓ Test files cleaned up');
        } catch (error) {
            throw new Error(`Cleanup failed: ${error.message}`);
        }
    }

    // Helper methods

    executeCommand(command) {
        try {
            const fullCommand = `node arcade-admin.js ${command}`;
            console.log(`   → ${fullCommand}`);
            
            const result = execSync(fullCommand, { 
                encoding: 'utf8',
                timeout: 30000,
                maxBuffer: 1024 * 1024 // 1MB buffer
            });
            
            return result;
        } catch (error) {
            throw new Error(`Command failed: ${error.message}`);
        }
    }

    generateSampleData() {
        return {
            users: [
                { id: 1, name: 'Alice Johnson', email: 'alice@example.com', age: 28, role: 'admin' },
                { id: 2, name: 'Bob Smith', email: 'bob@example.com', age: 32, role: 'user' },
                { id: 3, name: 'Carol Davis', email: 'carol@example.com', age: 25, role: 'user' },
                { id: 4, name: 'David Wilson', email: 'david@example.com', age: 30, role: 'moderator' }
            ]
        };
    }

    showTestResults() {
        console.log('\n📊 Test Results Summary');
        console.log('═'.repeat(60));
        
        const total = this.passed + this.failed + this.skipped;
        const passRate = total > 0 ? Math.round((this.passed / total) * 100) : 0;
        
        console.log(`Total Tests: ${total}`);
        console.log(`✅ Passed: ${this.passed}`);
        console.log(`❌ Failed: ${this.failed}`);
        console.log(`⏭️  Skipped: ${this.skipped}`);
        console.log(`📈 Pass Rate: ${passRate}%`);
        
        if (this.failed > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults
                .filter(result => result.status === 'failed')
                .forEach(result => {
                    console.log(`   • ${result.name}: ${result.error}`);
                });
        }
        
        if (this.skipped > 0) {
            console.log('\n⏭️  Skipped Tests:');
            this.testResults
                .filter(result => result.status === 'skipped')
                .forEach(result => {
                    console.log(`   • ${result.name}: ${result.reason}`);
                });
        }
        
        console.log('\n' + '═'.repeat(60));
        
        if (this.failed === 0) {
            console.log('🎉 All tests passed! ArcadeDB Admin Tool is working correctly.');
            process.exit(0);
        } else {
            console.log('💥 Some tests failed. Please check the errors above.');
            process.exit(1);
        }
    }
}

// Command line interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🧪 ArcadeDB Admin Tool Test Runner

USAGE:
    node test-runner.js [options]

OPTIONS:
    --help, -h          Show this help message
    --version, -v       Show version information

DESCRIPTION:
    Runs a comprehensive test suite to verify all features of the
    ArcadeDB Admin Tool are working correctly according to the spec.

TESTS INCLUDE:
    • Container management (start, stop, status, health)
    • Database operations (create, list, info, drop)
    • Import/export functionality (JSON, CSV formats)
    • Backup and restore operations
    • Monitoring and diagnostics
    • Maintenance operations

REQUIREMENTS:
    • Node.js 18+
    • Docker
    • arcade-admin.js in current directory
    • Write permissions for test files

EXAMPLE:
    node test-runner.js

The test runner will automatically clean up after itself.
        `);
        return;
    }
    
    if (args.includes('--version') || args.includes('-v')) {
        console.log('ArcadeDB Admin Tool Test Runner v1.0.0');
        return;
    }
    
    const testRunner = new TestRunner();
    await testRunner.runAllTests();
}

// Handle errors gracefully
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection in test runner:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception in test runner:', error.message);
    process.exit(1);
});

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Test runner failed:', error.message);
        process.exit(1);
    });
}

module.exports = TestRunner;