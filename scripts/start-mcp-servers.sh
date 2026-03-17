#!/usr/bin/env bash
# start-mcp-servers.sh — Start all MCP servers in HTTP mode
#
# Usage:
#   bash scripts/start-mcp-servers.sh          # start all servers
#   bash scripts/start-mcp-servers.sh --stop   # stop all servers
#
# The broker picks up servers automatically via mcp-upstreams.json (volume-mounted).
# This script only needs to start the server processes on the host.

set -euo pipefail

# ── WSL detection & path conversion ─────────────────────────────────────
IS_WSL=false
if [[ -d "/mnt/c" ]] && grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi

# Convert a single Windows path to WSL path
fix_path() {
  local p="$1"
  if $IS_WSL; then
    p=$(echo "$p" | sed -E 's|^([A-Za-z]):[/\\]|/mnt/\L\1/|' | sed 's|\\|/|g')
  fi
  echo "$p"
}

# Convert all Windows paths embedded in a string (env vars, commands)
fix_all_paths() {
  local s="$1"
  if $IS_WSL; then
    # Handle C:\ style paths
    s=$(echo "$s" | sed -E 's|([A-Za-z]):\\|/mnt/\L\1/|g' | sed 's|\\|/|g')
    # Handle C:/ style paths
    s=$(echo "$s" | sed -E 's|([A-Za-z]):/|/mnt/\L\1/|g')
  fi
  echo "$s"
}

PID_DIR="${HOME}/.kadi/mcp-pids"
mkdir -p "$PID_DIR"

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[MCP]${NC} $*"; }
warn() { echo -e "${YELLOW}[MCP]${NC} $*"; }
err()  { echo -e "${RED}[MCP]${NC} $*" >&2; }

# ── Server definitions ───────────────────────────────────────────────────
# Format: id|port|dir|command|env_vars (paths in Windows format, auto-converted)
SERVERS=(
  "mcp-server-quest|3100|C:/GitHub/mcp-server-quest|node dist/mcp-server.js|QUEST_DATA_DIR=C:\GitHub\mcp-server-quest\.quest-data"
  "mcp-server-discord|3200|C:/GitHub/mcp-server-discord|node dist/index.js|DISCORD_TOKEN=YOUR_DISCORD_TOKEN,DISCORD_GUILD_ID=1345598548535808042"
  "mcp-server-slack|3300|C:/GitHub/mcp-server-slack|node dist/index.js|SLACK_BOT_TOKEN=YOUR_SLACK_BOT_TOKEN"
  "mcp-server-github|3400|C:/GitHub/mcp-server-github|bun dist/index.js|GITHUB_PERSONAL_ACCESS_TOKEN=YOUR_GITHUB_TOKEN,MCP_HTTP_HOST=0.0.0.0"
  "mcp-server-filesystem|3500|C:/GitHub-Reference/servers/src/filesystem|node dist/index.js C:/GitHub|"
  "mcp-server-git|3600|C:/GitHub/mcp-server-git|bun dist/index.js|MCP_HTTP_PORT=3600,MCP_HTTP_HOST=0.0.0.0,GIT_MCP_ROOT_DIR=C:/GitHub"
)

# ── Stop all servers ─────────────────────────────────────────────────────
stop_servers() {
  log "Stopping all MCP servers..."
  for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    name=$(basename "$pidfile" .pid)
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && log "Stopped $name (PID $pid)" || warn "Failed to stop $name"
    else
      warn "$name (PID $pid) already stopped"
    fi
    rm -f "$pidfile"
  done
  log "All servers stopped."
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_servers
  exit 0
fi

# ── Start a single server ───────────────────────────────────────────────
start_server() {
  local id port dir cmd env_str
  IFS='|' read -r id port dir cmd env_str <<< "$1"

  local pidfile="$PID_DIR/$id.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    warn "$id already running (PID $(cat "$pidfile")), skipping"
    return 0
  fi

  log "Starting $id on port $port..."

  # Build env string
  local env_cmd="MCP_TRANSPORT_TYPE=http MCP_PORT=$port"
  if [ -n "$env_str" ]; then
    IFS=',' read -ra envs <<< "$env_str"
    for e in "${envs[@]}"; do
      env_cmd="$env_cmd $e"
    done
  fi

  # Convert Windows paths for WSL
  dir=$(fix_path "$dir")
  cmd=$(fix_all_paths "$cmd")
  env_cmd=$(fix_all_paths "$env_cmd")

  cd "$dir"
  eval "$env_cmd $cmd" > "$PID_DIR/$id.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"

  # Health check (up to 15s)
  local retries=0
  while [ $retries -lt 15 ]; do
    if curl -sf "http://localhost:$port/healthz" > /dev/null 2>&1; then
      log "$id ready (PID $pid)"
      return 0
    fi
    sleep 1
    retries=$((retries + 1))
  done

  err "$id failed to start (check $PID_DIR/$id.log)"
  return 1
}

# ── Main ─────────────────────────────────────────────────────────────────
$IS_WSL && log "WSL detected — converting Windows paths"
log "Starting MCP servers in HTTP mode..."
echo ""

stop_servers 2>/dev/null || true
echo ""

failed=0
for server in "${SERVERS[@]}"; do
  start_server "$server" || ((failed++))
done

echo ""

if [ $failed -gt 0 ]; then
  err "$failed server(s) failed to start"
  exit 1
fi

log "Done! All ${#SERVERS[@]} MCP servers running."
log "Broker will auto-connect via mcp-upstreams.json."
log "To stop: bash scripts/start-mcp-servers.sh --stop"
