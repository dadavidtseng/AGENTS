# ArcadeDB Admin Tool - Simple MVP Guide

## Overview
A straightforward Node.js administration tool for managing ArcadeDB instances in Docker containers. This tool handles the essential operations needed to run and maintain ArcadeDB locally.

## Core Features

### 1. Container Operations
Start, stop, and monitor your ArcadeDB container with simple commands.

**Commands:**
- `start` - Launch ArcadeDB container
- `start --with-test-data` - Launch with sample data
- `stop` - Stop the running container
- `status` - Check container and server status

### 2. Database Management
Basic database operations for creating, listing, and removing databases.

**Commands:**
- `database list` - Show all databases
- `database create <name>` - Create a new database
- `database drop <name>` - Delete a database
- `database info <name>` - Show database details

### 3. Backup & Restore
Create and restore database backups with verification.

**Commands:**
- `backup <database>` - Create backup of specified database
- `restore <database> <backup-file>` - Restore database from backup
- `list-backups` - Show all available backups
- `verify-backup <backup-file>` - Check backup file integrity

### 4. Data Management
Import and export data in common formats.

**Commands:**
- `import <database> <file>` - Import JSON/CSV data
- `export <database> <file>` - Export database to file
- `clear-databases` - Remove all databases (keep backups)

### 5. Basic Monitoring
Essential health checks and system information.

**Commands:**
- `health` - Comprehensive system health check
- `logs [--lines=50]` - View container logs
- `metrics` - Show basic performance metrics

### 6. Maintenance
Simple cleanup and optimization operations.

**Commands:**
- `optimize <database>` - Optimize database performance
- `cleanup` - Remove old logs and temporary files
- `clean-all` - Complete system reset

## CLI Interface

```bash
# Basic Operations
node arcade-admin.js start
node arcade-admin.js stop
node arcade-admin.js status

# Database Operations
node arcade-admin.js database create MyApp
node arcade-admin.js database list
node arcade-admin.js database drop MyApp

# Backup Operations
node arcade-admin.js backup MyApp
node arcade-admin.js restore MyApp ./backups/MyApp/backup-20250101.zip
node arcade-admin.js list-backups

# Data Operations
node arcade-admin.js import MyApp ./data/users.json
node arcade-admin.js export MyApp ./exports/myapp-export.json

# Monitoring & Maintenance
node arcade-admin.js health
node arcade-admin.js logs --lines=100
node arcade-admin.js cleanup
```

## Configuration

Simple configuration file (`config.yml`):

Storage paths are split by deployment mode — `local:` for development,
`container:` for deployed images (`KADI_DEPLOY_MODE=container`).
Credentials are managed by secret-ability via the `arcadedb` vault — never put them here.

```yaml
arcadedb:
  host: localhost
  port: 2480
  container_name: kadi-arcadedb
  backup_retention_days: 30
  log_lines: 50

  local:
    data_dir: ./arcadedb-data
    backup_dir: ./arcadedb-data/backups
  container:
    data_dir: /home/arcadedb/databases
    backup_dir: /home/arcadedb/backups

tunnel:
  server_addr: broker.kadi.build
  tunnel_domain: tunnel.kadi.build
  server_port: 7000
  ssh_port: 2200
  mode: frpc
  transport: wss
  wss_control_host: tunnel-control.kadi.build
  agent_id: arcadedb-ability

defaults:
  backup_retention_days: 30
  log_lines: 50
```

## File Structure

```
arcade-admin/
├── arcade-admin.js         # Main CLI tool (CommonJS)
├── arcade-admin.mjs        # ES Module wrapper
├── lib/
│   ├── container.js        # Container management (CommonJS)
│   ├── container.mjs       # ES Module wrapper
│   ├── database.js         # Database operations (CommonJS)
│   ├── database.mjs        # ES Module wrapper
│   ├── backup.js           # Backup/restore (CommonJS)
│   ├── backup.mjs          # ES Module wrapper
│   ├── import-export.js    # Data import/export (CommonJS)
│   ├── import-export.mjs   # ES Module wrapper
│   ├── monitoring.js       # Health checks (CommonJS)
│   └── monitoring.mjs      # ES Module wrapper
├── config.yml              # Configuration
├── package.json
└── README.md
```

## Basic Workflow

### Setup New Environment
```bash
node arcade-admin.js start --with-test-data
node arcade-admin.js status
```

### Daily Operations
```bash
# Check system health
node arcade-admin.js health

# Create backup
node arcade-admin.js backup MyApp

# View recent activity
node arcade-admin.js logs
```

### Data Management
```bash
# Create new database
node arcade-admin.js database create ProductionApp

# Import initial data
node arcade-admin.js import ProductionApp ./initial-data.json

# Create backup before changes
node arcade-admin.js backup ProductionApp
```

### Maintenance
```bash
# Weekly cleanup
node arcade-admin.js cleanup

# Optimize databases
node arcade-admin.js optimize MyApp

# Check system health
node arcade-admin.js health
```

## Module Support

This package supports both **CommonJS** and **ES Modules** for programmatic usage:

### CommonJS Usage
```javascript
const ArcadeAdmin = require('arcade-admin');
const { ContainerManager } = require('arcade-admin/lib/container');

// Create and use admin instance
const admin = new ArcadeAdmin();
await admin.containerManager.start();
```

### ES Module Usage
```javascript
import ArcadeAdmin from 'arcade-admin';
import { ContainerManager } from 'arcade-admin/lib/container';

// Create and use admin instance
const admin = new ArcadeAdmin();
await admin.containerManager.start();
```

## Key Benefits

- **Simple Commands** - Easy-to-remember CLI interface
- **Safe Operations** - Built-in confirmations for destructive actions
- **Reliable Backups** - Automated backup verification
- **Clear Status** - Always know what's running and healthy
- **Quick Setup** - Get ArcadeDB running in seconds
- **Data Safety** - Multiple safeguards against data loss
- **Dual Module Support** - Works with both CommonJS and ES Modules
- **Node.js 18+ Compatible** - Supports modern Node.js versions

This tool provides everything needed to run ArcadeDB locally with confidence, while keeping the interface simple and focused on essential operations.