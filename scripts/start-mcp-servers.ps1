# start-mcp-servers.ps1 — Start all MCP servers in HTTP mode
#
# Usage:
#   .\scripts\start-mcp-servers.ps1          # start all servers
#   .\scripts\start-mcp-servers.ps1 -Stop    # stop all servers
#
# The broker picks up servers automatically via mcp-upstreams.json (volume-mounted).

param([switch]$Stop)

# ── Load secrets from .env ────────────────────────────────────────────────
$EnvFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
} else {
    Write-Host "[MCP] WARNING: scripts/.env not found — tokens will be empty" -ForegroundColor Red
}

$PidDir = "$env:USERPROFILE\.kadi\mcp-pids"
New-Item -ItemType Directory -Force -Path $PidDir | Out-Null

# ── Server definitions ───────────────────────────────────────────────────
$Servers = @(
    @{
        Id   = "mcp-server-quest"; Port = 3100
        Dir  = "C:\GitHub\mcp-server-quest"
        Cmd  = "node"; Args = @("dist\mcp-server.js")
        Env  = @{ QUEST_DATA_DIR = "C:\GitHub\mcp-server-quest\.quest-data" }
    },
    # mcp-server-discord and mcp-server-slack removed — replaced by agent-chatbot
    @{
        Id   = "mcp-server-github"; Port = 3400
        Dir  = "C:\GitHub\mcp-server-github"
        Cmd  = "bun"; Args = @("dist\index.js")
        Env  = @{
            GITHUB_PERSONAL_ACCESS_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN
            MCP_HTTP_HOST                = "0.0.0.0"
            MCP_HTTP_PORT                = "3400"
        }
    },
    @{
        Id   = "mcp-server-filesystem"; Port = 3500
        Dir  = "C:\GitHub-Reference\servers\src\filesystem"
        Cmd  = "node"; Args = @("dist\index.js", "C:\GitHub")
        Env  = @{}
    },
    @{
        Id   = "mcp-server-git"; Port = 3600
        Dir  = "C:\GitHub\mcp-server-git"
        Cmd  = "bun"; Args = @("dist\index.js")
        Env  = @{
            MCP_HTTP_PORT    = "3600"
            MCP_HTTP_HOST    = "0.0.0.0"
            GIT_MCP_ROOT_DIR = "C:\GitHub"
        }
    }
)

# ── Broker admin config ────────────────────────────────────────────────
$BrokerUrl = "http://localhost:8080"
$AdminKey = "dev-admin-key"

# ── Stop all servers ─────────────────────────────────────────────────────
function Stop-AllServers {
    Write-Host "[MCP] Stopping all MCP servers..." -ForegroundColor Green

    # Step 1: Kill host processes
    Get-ChildItem "$PidDir\*.pid" -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.BaseName
        $procId = Get-Content $_.FullName
        try {
            $proc = Get-Process -Id $procId -ErrorAction Stop
            # Graceful stop first (allows WebSocket close frame)
            Stop-Process -Id $procId
            $proc | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
            if (!$proc.HasExited) {
                Stop-Process -Id $procId -Force
                Write-Host "[MCP] Force-killed $name (PID $procId)" -ForegroundColor Yellow
            } else {
                Write-Host "[MCP] Stopped $name (PID $procId)" -ForegroundColor Green
            }
        } catch {
            Write-Host "[MCP] $name (PID $procId) already stopped" -ForegroundColor Yellow
        }
        Remove-Item $_.FullName -Force
    }

    # Step 2: Disable upstreams on the broker so it stops reconnecting
    Write-Host "[MCP] Disabling broker upstreams..." -ForegroundColor Green
    foreach ($server in $Servers) {
        $id = $server.Id
        try {
            $null = & curl.exe -s -X POST "$BrokerUrl/api/admin/mcp/upstreams/$id/disable" -H "X-Admin-Key: $AdminKey" 2>$null
            Write-Host "[MCP] Disabled upstream: $id" -ForegroundColor Green
        } catch {
            Write-Host "[MCP] Could not disable upstream: $id (broker may be down)" -ForegroundColor Yellow
        }
    }

    Write-Host "[MCP] All servers stopped." -ForegroundColor Green
}

if ($Stop) {
    Stop-AllServers
    exit 0
}

# ── Start a single server ───────────────────────────────────────────────
function Start-McpServer {
    param($Server)

    $id   = $Server.Id
    $port = $Server.Port
    $dir  = $Server.Dir
    $cmd  = $Server.Cmd
    $args_ = $Server.Args
    $envVars = $Server.Env

    $pidFile = "$PidDir\$id.pid"
    if (Test-Path $pidFile) {
        $existingPid = Get-Content $pidFile
        try {
            Get-Process -Id $existingPid -ErrorAction Stop | Out-Null
            Write-Host "[MCP] $id already running (PID $existingPid), skipping" -ForegroundColor Yellow
            return $true
        } catch {
            Remove-Item $pidFile -Force
        }
    }

    Write-Host "[MCP] Starting $id on port $port..." -ForegroundColor Green

    # Set environment variables
    $env:MCP_TRANSPORT_TYPE = "http"
    $env:MCP_PORT = "$port"
    foreach ($key in $envVars.Keys) {
        [Environment]::SetEnvironmentVariable($key, $envVars[$key], "Process")
    }

    # Start process
    $logFile = "$PidDir\$id.log"
    $proc = Start-Process -FilePath $cmd -ArgumentList $args_ `
        -WorkingDirectory $dir `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError "$PidDir\$id.err.log" `
        -PassThru -WindowStyle Hidden

    Set-Content -Path $pidFile -Value $proc.Id

    # Clean up env vars
    foreach ($key in $envVars.Keys) {
        [Environment]::SetEnvironmentVariable($key, $null, "Process")
    }
    $env:MCP_TRANSPORT_TYPE = $null
    $env:MCP_PORT = $null

    # Health check (up to 15s) — use curl.exe for reliability
    for ($i = 0; $i -lt 15; $i++) {
        $code = & curl.exe -s -o NUL -w "%{http_code}" "http://localhost:$port/healthz" 2>$null
        if ($code -eq "200") {
            Write-Host "[MCP] $id ready (PID $($proc.Id))" -ForegroundColor Green
            # Re-enable upstream on broker
            $null = & curl.exe -s -X POST "$BrokerUrl/api/admin/mcp/upstreams/$id/enable" -H "X-Admin-Key: $AdminKey" 2>$null
            return $true
        }
        # Try /mcp endpoint (some servers don't have /healthz)
        $code = & curl.exe -s -o NUL -w "%{http_code}" -X GET "http://localhost:$port/mcp" 2>$null
        if ($code -ne "000") {
            Write-Host "[MCP] $id ready (PID $($proc.Id))" -ForegroundColor Green
            # Re-enable upstream on broker
            $null = & curl.exe -s -X POST "$BrokerUrl/api/admin/mcp/upstreams/$id/enable" -H "X-Admin-Key: $AdminKey" 2>$null
            return $true
        }
        Start-Sleep -Seconds 1
    }

    Write-Host "[MCP] $id failed to start (check $logFile)" -ForegroundColor Red
    return $false
}

# ── Main ─────────────────────────────────────────────────────────────────
Write-Host "[MCP] Starting MCP servers in HTTP mode..." -ForegroundColor Green
Write-Host ""

Stop-AllServers
Write-Host ""

$failed = 0
foreach ($server in $Servers) {
    if (-not (Start-McpServer $server)) {
        $failed++
    }
}

Write-Host ""

if ($failed -gt 0) {
    Write-Host "[MCP] $failed server(s) failed to start" -ForegroundColor Red
    exit 1
}

Write-Host "[MCP] Done! All $($Servers.Count) MCP servers running." -ForegroundColor Green
Write-Host ""

# ── Podman iptables port forwarding ──────────────────────────────────
# Containers use host.containers.internal → 10.89.0.1 (bridge gateway on WSL2 VM).
# MCP servers run on Windows host, reachable from WSL2 via its default gateway.
# We need DNAT rules to forward bridge gateway traffic to the Windows host.

function Setup-PodmanPortForwarding {
    Write-Host "[MCP] Setting up Podman port forwarding..." -ForegroundColor Green

    # Check if Podman machine is running
    $machineStatus = & podman machine info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[MCP] Podman machine not running, skipping port forwarding" -ForegroundColor Yellow
        return
    }

    # Detect Windows host IP from WSL2 VM (default gateway)
    $winHostIp = & podman machine ssh -- "ip route | grep default | awk '{print `$3}'" 2>&1
    $winHostIp = $winHostIp.Trim()
    if (-not $winHostIp -or $winHostIp -notmatch '^\d+\.\d+\.\d+\.\d+$') {
        Write-Host "[MCP] Could not detect Windows host IP, skipping" -ForegroundColor Yellow
        return
    }

    # Detect Podman bridge gateway IP
    $bridgeGw = & podman machine ssh -- "ip -4 addr show podman0 2>/dev/null | grep inet | awk '{print `$2}' | cut -d/ -f1" 2>&1
    if ($bridgeGw) { $bridgeGw = $bridgeGw.Trim() }
    if (-not $bridgeGw -or $bridgeGw -notmatch '^\d+\.\d+\.\d+\.\d+$') {
        $bridgeGw = "10.89.0.1"  # fallback
    }

    Write-Host "[MCP] Bridge gateway: $bridgeGw -> Windows host: $winHostIp" -ForegroundColor Cyan

    # MCP server ports to forward
    $ports = @(3100, 3400, 3600)

    # Flush old rules for these ports (avoid duplicates)
    foreach ($p in $ports) {
        & podman machine ssh -- "iptables -t nat -D PREROUTING -p tcp -d $bridgeGw --dport $p -j DNAT --to-destination ${winHostIp}:$p 2>/dev/null; true" 2>&1 | Out-Null
        & podman machine ssh -- "iptables -t nat -D POSTROUTING -p tcp -d $winHostIp --dport $p -j MASQUERADE 2>/dev/null; true" 2>&1 | Out-Null
    }

    # Apply DNAT + MASQUERADE rules
    foreach ($p in $ports) {
        & podman machine ssh -- "iptables -t nat -A PREROUTING -p tcp -d $bridgeGw --dport $p -j DNAT --to-destination ${winHostIp}:$p" 2>&1 | Out-Null
        & podman machine ssh -- "iptables -t nat -A POSTROUTING -p tcp -d $winHostIp --dport $p -j MASQUERADE" 2>&1 | Out-Null
        Write-Host "[MCP] Forwarding $bridgeGw`:$p -> $winHostIp`:$p" -ForegroundColor Green
    }

    Write-Host "[MCP] Port forwarding ready." -ForegroundColor Green
}

Setup-PodmanPortForwarding
Write-Host ""
Write-Host "[MCP] Broker will auto-connect via mcp-upstreams.json." -ForegroundColor Green
Write-Host "[MCP] To stop: .\scripts\start-mcp-servers.ps1 -Stop" -ForegroundColor Green
