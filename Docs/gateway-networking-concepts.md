# Gateway, Domain, Port, URL, DDNS & Route Concepts

## IP + Port — the raw address

Every service on the internet is a process listening on an IP + port. A machine can run many services, each on a different port (0-65535):

```
64.23.168.129:8080   → kadi-broker
64.23.168.129:5672   → RabbitMQ
64.23.168.129:15672  → RabbitMQ dashboard
64.23.168.129:80     → Caddy (HTTP)
64.23.168.129:443    → Caddy (HTTPS)
```

## Domain — human-readable name for an IP

DNS (Domain Name System) is a global phonebook:

```
broker.dadavidtseng.com → 64.23.168.129
```

A domain is just a name that resolves to an IP. Your registrar (Gandi) holds these records.

**Wildcard record** (`*.dadavidtseng.com → 64.23.168.129`) means any undefined subdomain points to the same IP. Explicit records (like `mcp`, `www`) take priority over the wildcard.

## DDNS — for when your IP changes

A VPS has a **static IP** — it never changes. Home internet gets a new IP on router reboot. DDNS (Dynamic DNS) auto-updates the DNS record when your IP changes:

```
myagent.ddns.net → 192.168.x.x (updates automatically)
```

Not needed with a VPS since the IP is fixed. Only relevant if kadi-gateway runs on a home machine.

## Port — why 80 and 443 are special

Browsers have defaults:
- `http://` → port 80
- `https://` → port 443

When you type `https://broker.dadavidtseng.com`, the browser connects to `64.23.168.129:443`. No port needed in the URL because 443 is implied.

If you exposed kadi-broker directly, users would need `https://broker.dadavidtseng.com:8080` — ugly, and you'd need separate TLS certs for each service.

## Gateway / Reverse Proxy — the traffic cop

Caddy (kadi-gateway) sits on ports 80/443 and routes traffic based on the **hostname** in the request:

```
Browser request: GET https://broker.dadavidtseng.com/health
                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                      Host header

Caddy receives on :443, reads the Host header, looks up its config:

  broker.dadavidtseng.com  → forward to kadi-broker:8080
  rabbit.dadavidtseng.com  → forward to kadi-rabbit:15672
  chatbot.dadavidtseng.com → forward to agent-chatbot:3000
```

One IP, one port (443), many services. That's the whole point of a reverse proxy.

## TLS / HTTPS — encryption

Without TLS, traffic is plain text. Caddy auto-provisions Let's Encrypt certificates for each subdomain:

```
Browser ←──TLS encrypted──→ Caddy ←──plain HTTP──→ kadi-broker
          (port 443)                  (port 8080, internal network)
```

Public internet sees HTTPS. Inside the Docker network, it's plain HTTP — fine because it's container-to-container on the same machine.

## Route — mapping a URL to a backend

A route is a rule: "when a request matches this pattern, send it here."

In kadi-gateway's `config.json`:
```json
{ "subdomain": "broker", "upstream": "kadi-broker:8080" }
```

Any request to `broker.dadavidtseng.com` → proxy to `kadi-broker:8080`.

Tunnel wildcard example:
```json
{ "subdomain": "*.tunnel", "upstream": "frps:8880", "tls": "on-demand" }
```

## URL — putting it all together

```
https://broker.dadavidtseng.com:443/api/admin/observer
│       │                        │   │
│       │                        │   └─ Path (route within the service)
│       │                        └─ Port (443 = default for https, usually omitted)
│       └─ Domain (DNS → 64.23.168.129)
└─ Protocol (TLS encrypted)
```

## Current Setup

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────┐
│  64.23.168.129 (DigitalOcean VPS)               │
│                                                  │
│  *.dadavidtseng.com → this IP (DNS wildcard)   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Caddy (kadi-gateway) :80 / :443         │   │
│  │                                           │   │
│  │  broker.* → kadi-broker:8080             │   │
│  │  rabbit.* → kadi-rabbit:15672            │   │
│  │  chatbot.* → agent-chatbot:3000 (future) │   │
│  │  *.tunnel.* → frps:8880 (future)         │   │
│  └──────────┬───────────────────────────────┘   │
│             │ kadi-net (Docker bridge)           │
│  ┌──────────┴───────────────────────────────┐   │
│  │  kadi-broker :8080                        │   │
│  │  kadi-rabbit :5672 :15672                 │   │
│  │  (future containers...)                   │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

Without the gateway, you'd need to expose each service on a different port, manage TLS certs manually, and users would need to remember port numbers. The gateway collapses all of that into clean subdomain URLs with automatic TLS.
