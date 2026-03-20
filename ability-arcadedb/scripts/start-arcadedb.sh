#!/bin/sh
# =============================================================================
# Start ArcadeDB as a native Java process inside the container.
#
# This script handles ONLY ArcadeDB startup — no secret delivery.
# Secrets are handled by the deploy profile's `command` field which calls
# `kadi secret receive` BEFORE this script runs.
#
# Usage (from deploy command):
#   kadi secret receive --vault arcadedb && sh scripts/start-arcadedb.sh && kadi run start
# =============================================================================
set -e

# ---- 1. Configure ArcadeDB -------------------------------------------------
# kadi secret receive writes to an encrypted vault file, NOT env vars.
# Read credentials from vault via `kadi secret get`, fall back to env, then default.
if command -v kadi >/dev/null 2>&1; then
  ARCADE_PW="$(kadi secret get ARCADE_PASSWORD -v arcadedb 2>/dev/null || echo "")"
  ARCADE_USER="$(kadi secret get ARCADE_USERNAME -v arcadedb 2>/dev/null || echo "")"
fi
ARCADE_PW="${ARCADE_PW:-${ARCADE_PASSWORD:-playwithdata}}"
ARCADE_USER="${ARCADE_USER:-${ARCADE_USERNAME:-root}}"
export ARCADE_PASSWORD="$ARCADE_PW"
export ARCADE_USERNAME="$ARCADE_USER"
ARCADE_DB_DIR="${ARCADEDB_HOME:-/home/arcadedb}/databases"
ARCADE_BK_DIR="${ARCADEDB_HOME:-/home/arcadedb}/backups"

export JAVA_OPTS="${JAVA_OPTS:-} \
  -Darcadedb.server.rootPassword=${ARCADE_PW} \
  -Darcadedb.server.databaseDirectory=${ARCADE_DB_DIR} \
  -Darcadedb.server.backupDirectory=${ARCADE_BK_DIR}"

# Ensure data directories exist
mkdir -p "${ARCADE_DB_DIR}" "${ARCADE_BK_DIR}"

# ---- 2. Start ArcadeDB in background ---------------------------------------
echo "🚀 Starting ArcadeDB server..."
_KADI_ORIG_DIR="$PWD"
cd "${ARCADEDB_HOME:-/home/arcadedb}"
bin/server.sh &
ARCADE_PID=$!
cd "$_KADI_ORIG_DIR"

# ---- 3. Wait for ArcadeDB to be ready (up to 60 s) -------------------------
echo "⏳ Waiting for ArcadeDB to be ready..."
READY=0
for i in $(seq 1 60); do
  if command -v curl >/dev/null 2>&1; then
    if curl -sf -o /dev/null http://localhost:2480/api/v1/ready 2>/dev/null; then
      READY=1; break
    fi
  else
    if node -e "fetch('http://localhost:2480/api/v1/ready').then(r=>{process.exit(r.status===204?0:1)}).catch(()=>process.exit(1))" 2>/dev/null; then
      READY=1; break
    fi
  fi
  sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo "✅ ArcadeDB is ready (PID ${ARCADE_PID})"
else
  echo "❌ ArcadeDB failed to start within 60 s"
  exit 1
fi
