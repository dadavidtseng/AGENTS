# Deployment Memo — Container Networking for KADI Agents

## The Problem

`localhost` means different things depending on where code runs.

- **On your dev machine (no containers):** `localhost:8080` = your machine's port 8080. Everything shares the same network.
- **Inside a container:** `localhost` = the container itself, not your host. The broker at `localhost:8080` is unreachable.

```
┌─────────────────────────┐     ┌─────────────────────────┐
│  agent-producer container│     │  Your host machine      │
│                         │     │                         │
│  localhost:8080 = ❌    │     │  localhost:8080 = broker │
│  (nothing listening)    │     │                         │
└─────────────────────────┘     └─────────────────────────┘
       They can't see each other by default
```

## `kadi build` Behavior

- Excludes: `node_modules`, `.git`, `dist`
- `.env` IS copied into the image (not excluded)
- But `KADI_BROKER_URL=ws://localhost:8080/kadi` in `.env` won't work inside a container
- Override at runtime with `-e` flags or `--env-file`

---

## Networking Scenarios

### 1. Broker on Host, Agent in Container (Dev Default)

Podman provides `host.containers.internal` — a magic hostname that resolves to the host machine.

```
┌──────────────────────┐          ┌──────────────────┐
│  agent-producer      │          │  Host machine     │
│  (container)         │          │                  │
│                      │──────────│► kadi-broker     │
│  ws://host.containers│          │  :8080           │
│  .internal:8080      │          │                  │
└──────────────────────┘          └──────────────────┘
```

```powershell
podman run `
  -e KADI_BROKER_URL=ws://host.containers.internal:8080/kadi `
  -e KADI_BROKER_URL_2=ws://openkadi.com:8080/kadi `
  agent-producer:1.0.0
```

**Recommended for local development.** No changes to how you run the broker.

### 2. `--network=host` (Simple but Less Isolated)

Removes network isolation entirely. The container shares the host's network stack. `localhost` works again.

```
┌─────────────────────────────────────────┐
│  Host machine (shared network)          │
│                                         │
│  agent-producer    kadi-broker          │
│  (container)       :8080                │
│  localhost:8080 = ✅                    │
└─────────────────────────────────────────┘
```

```powershell
podman run --network=host agent-producer:1.0.0
```

Downside: no port isolation. If agent-producer also listens on a port, it directly occupies a host port.

### 3. Both in the Same Podman Pod

A pod is a group of containers sharing a network namespace (same concept as Kubernetes pods). They see each other via `localhost`.

```
┌─ Pod ──────────────────────────────────┐
│  ┌──────────────┐ ┌─────────────────┐  │
│  │agent-producer │ │ kadi-broker     │  │
│  │              │ │ :8080           │  │
│  │localhost:8080│►│                 │  │
│  │    = ✅      │ │                 │  │
│  └──────────────┘ └─────────────────┘  │
│         shared network namespace        │
└─────────────────────────────────────────┘
```

```powershell
podman pod create --name kadi-pod -p 8080:8080
podman run --pod kadi-pod kadi-broker:latest
podman run --pod kadi-pod agent-producer:1.0.0
```

Closest to how it works in production on Kubernetes/Akash.

### 4. Separate Containers on a Podman Network

Create a named network. Containers find each other by container name (DNS).

```
┌─ kadi-network ─────────────────────────┐
│  ┌──────────────┐ ┌─────────────────┐  │
│  │agent-producer │ │ kadi-broker     │  │
│  │              │ │ :8080           │  │
│  │ws://broker   │►│                 │  │
│  │  :8080       │ │ name="broker"   │  │
│  └──────────────┘ └─────────────────┘  │
│         Podman DNS resolves names       │
└─────────────────────────────────────────┘
```

```powershell
podman network create kadi-network
podman run --network kadi-network --name broker kadi-broker:latest
podman run --network kadi-network `
  -e KADI_BROKER_URL=ws://broker:8080/kadi `
  agent-producer:1.0.0
```

Best for multi-container setups where you want isolation between services.

### 5. Broker on a Remote Machine

Use the IP or domain name directly. This is production / multi-machine deployment.

```
┌─ Machine A ──────────┐     ┌─ Machine B ──────────┐
│  agent-producer       │     │  kadi-broker          │
│  (container)          │────►│  :8080                │
│  ws://192.168.1.50    │     │  IP: 192.168.1.50     │
│    :8080              │     │                       │
└───────────────────────┘     └───────────────────────┘
```

This is what `KADI_BROKER_URL_2=ws://openkadi.com:8080/kadi` already does.

---

## Quick Reference

| Scenario | Broker URL | Use Case |
|----------|-----------|----------|
| Broker on host, agent in Podman | `ws://host.containers.internal:8080/kadi` | Local dev |
| `--network=host` | `ws://localhost:8080/kadi` | Quick testing |
| Same Podman pod | `ws://localhost:8080/kadi` | K8s-like local |
| Podman named network | `ws://<container-name>:8080/kadi` | Multi-container |
| Remote machine | `ws://<ip-or-domain>:8080/kadi` | Production |

## Recommendation

### Local Dev (after `kadi build` + `podman run`)

`kadi broker up` already runs the broker on a Podman network called `kadi-net` (service name: `broker`). So **Scenario 4 is the natural fit** — just join the same network:

```powershell
podman run --network kadi-net `
  -e KADI_BROKER_URL=ws://broker:8080/kadi `
  -e KADI_BROKER_URL_2=ws://openkadi.com:8080/kadi `
  agent-producer:1.0.0
```

`host.containers.internal` (Scenario 1) also works since the broker maps port 8080 to the host, but joining `kadi-net` directly is cleaner — no port mapping hop, direct container-to-container DNS.

### Production (Akash/DigitalOcean)

**Scenario 3** (pod) if broker and agents are co-located, **Scenario 5** (remote) if distributed.

### General Rule

Always override broker URLs at runtime via `-e` flags. Don't rely on `.env` baked into the image.

---

## `kadi build` vs `kadi deploy` — Who Handles Networking?

### `kadi build`

Only builds the container image. Does NOT run it.

```powershell
kadi build --engine podman
```

- Copies project files (excludes `node_modules`, `.git`, `dist`)
- Generates Dockerfile, runs `npm ci` + `npx tsc`
- Outputs an image (e.g., `agent-producer:1.0.0`)
- `.env` is copied into the image but `localhost` won't work
- You run the image yourself with `podman run` — you're responsible for passing the correct broker URL via `-e` flags

### `kadi deploy --target local`

Builds AND runs. Handles networking for you.

```powershell
kadi deploy --profile local-dev
```

- Reads `agent.json` deploy profiles
- Generates `docker-compose.yml` with env vars from the profile
- Starts containers via Docker/Podman Compose
- If the profile has the correct broker URL in its service env config, networking just works
- Also handles secrets injection (KADI secret handshake via broker)

### `kadi deploy` (Akash)

Builds, deploys to Akash Network, handles secrets.

```powershell
kadi deploy --profile akash-testnet
```

- Generates SDL (Akash's deployment manifest) from `agent.json` profile
- Broker URL is baked into the SDL from the profile's env config
- Since Akash containers run on remote providers, use the public broker: `ws://openkadi.com:8080/kadi`
- Handles wallet connection, certificate management, bid selection, and secret sharing

### Summary

| Command | Builds Image | Runs Container | Handles Broker URL | Handles Secrets |
|---------|-------------|---------------|-------------------|----------------|
| `kadi build` | ✅ | ❌ | ❌ (you do it) | ❌ |
| `kadi deploy --target local` | ✅ | ✅ | ✅ (from profile) | ✅ |
| `kadi deploy` (Akash) | ✅ | ✅ | ✅ (from profile) | ✅ |

For quick testing after `kadi build`, use `podman run` with `-e` flags.
For proper deployments, use `kadi deploy` with a configured `agent.json` profile.

---

## Container Engine Consistency

`kadi broker up` is hardcoded to Podman. `kadi build` and `kadi deploy` default to Docker.

| Command | Default Engine | Configurable? |
|---------|---------------|---------------|
| `kadi broker up` | Podman | ❌ |
| `kadi build` | Docker | ✅ `--engine podman` |
| `kadi deploy` | Docker | ✅ `--engine podman` or profile |

Broker and agents must use the same engine — otherwise they can't share networks or see each other's images. Since `kadi broker up` is Podman-only, always use `--engine podman` for build/deploy, or set it in `agent.json`:

```json
{
  "build": {
    "default": {
      "engine": "podman"
    }
  }
}
```

---

## Container Startup Chain

When `cli: "latest"` is set in `agent.json`, `kadi build` generates a multi-stage Dockerfile:

1. **Stage 1 (kadi-cli-builder):** Clones KADI CLI from GitLab, builds it + `kadi-install`
2. **Final stage:** Copies built CLI into the image alongside your app code

The container's CMD is `["kadi", "run", "start"]`, which:

```
Container starts
  → CMD ["kadi", "run", "start"]
    → kadi CLI (inside container) reads agent.json
    → executes scripts.start
    → "node dist/index.js"
    → agent connects to KADI_BROKER_URL from env vars
```

No SSH, no manual intervention. Everything the container needs is baked into the image at build time.

---

## Full Deployment Lifecycle

```
LOCAL (your machine)                    REMOTE (Akash provider)
─────────────────────                   ──────────────────────
kadi build --engine podman
  → multi-stage Dockerfile
  → stage 1: clone + build kadi CLI
  → stage 2: your app code + deps
  → image: agent-producer:1.0.0

kadi deploy --profile akash
  → push image to registry ────────────► Provider pulls image
                                         → container starts
                                         → CMD ["kadi","run","start"]
                                         → kadi CLI reads agent.json
                                         → "node dist/index.js"
                                         → connects to broker
```

You only need Podman on your local machine. Remote platforms handle their own container runtime:

| Target | Who runs the container? | You install Podman? |
|--------|------------------------|-------------------|
| Your machine (local dev) | You, via `podman run` or `kadi deploy --target local` | ✅ Yes |
| Akash Network | Akash provider (Kubernetes + containerd) | ❌ No |
| DigitalOcean App Platform | DigitalOcean's managed runtime | ❌ No |
| Raw VPS (droplet, EC2) | You'd need a container runtime on the VPS | ⚠️ Yes |

---

## `agent.json` — The Single Source of Truth

`agent.json` is the KADI equivalent of `package.json`. Every deployable component needs one.

### Minimal Template

```json
{
  "name": "<component-name>",
  "version": "1.0.0",
  "scripts": {
    "start": "node dist/index.js"
  },
  "build": {
    "default": {
      "from": "node:20-alpine",
      "cli": "latest",
      "run": [
        "npm ci --include=dev",
        "npx tsc",
        "npm prune --omit=dev"
      ]
    }
  }
}
```

For abilities, add `"kind": "ability"`.

### CLI Lifecycle

```
kadi install <ability>     → downloads ability, writes to agent.json abilities section
kadi build --engine podman → reads build section, generates Dockerfile, builds image
kadi deploy --profile X    → reads deploy profiles, deploys container
kadi run start             → reads scripts.start, executes it (used inside container)
```

### Current Deployment Readiness

| Component | Has agent.json | Has build section | Can kadi build |
|-----------|:-:|:-:|:-:|
| agent-producer | ✅ | ✅ | ✅ |
| agent-worker | ❌ | — | ❌ |
| agent-chatbot | ❌ | — | ❌ |
| mcp-server-quest | ❌ | — | ❌ |
| mcp-server-git | ❌ | — | ❌ |
| mcp-server-github | ❌ | — | ❌ |
| ability-deploy | ✅ | ❌ | ❌ |
| ability-file-management | ✅ | ❌ | ❌ |

Most components need `agent.json` with a `build` section added before they can use the `kadi` CLI pipeline.

There is no `kadi init` command yet — `agent.json` must be created manually.
