# ability-secret
> Encrypted secrets for KADI — Age-style encryption backed by the OS keychain

Overview
--------
ability-secret (agent package name: secret-ability) provides encrypted secret management for KADI agents. It exposes a set of tools for vault management, secret CRUD, local encryption/decryption, OS keychain-backed key storage (via keytar), and remote synchronization / sharing operations. The ability is implemented as a Kadi ability and registers tools through the Kadi client.

Package metadata (from agent.json)
- name: secret-ability
- version: 0.9.3
- type: ability
- repo: https://gitlab.com/humin-game-lab/agent-abilities/secret-ability.git
- lib: https://gitlab.com/humin-game-lab/agent-abilities/secret-ability/-/archive/v0.9.3/secret-ability-v0.9.3.zip
- entrypoint: dist/index.js
- scripts:
  - setup: npm install && npm run build
  - start: node dist/index.js

Quick Start
-----------
1. Install package dependencies and build (per package scripts):
npm install
npm run setup

2. Install the ability into your KADI environment (kadi CLI required):
kadi install

3. Run the ability locally via KADI:
kadi run start

4. You can also run the built entrypoint directly (stdio by default):
node dist/index.js
or run in broker mode:
node dist/index.js broker

Tools
-----
The ability registers a set of tools on the KadiClient. Tools are implemented and registered from src/tools.ts and the client bootstrap is at src/index.ts.

| Tool | Description |
|------|-------------|
| config.read | Read the ability configuration for vaults and providers. |
| config.createVault | Initialize a new vault (creates metadata, keys, and storage container). |
| config.destroyVault | Remove a vault and its metadata (destructive). |
| vault.fromJson | Create/load an in-memory vault representation from a JSON blob. |
| vault.fromEnv | Create/load a vault using environment variables (for CI or transient usage). |
| get | Retrieve a secret from a vault (decrypted output). |
| set | Store a secret into a vault (encrypts before persisting). |
| list | List keys/entries in a vault. |
| delete | Remove a named secret from a vault. |
| exists | Check existence of a key in a vault (returns boolean). |
| encrypt | Encrypt arbitrary payloads with a specified key in a vault (returns ciphertext). |
| decrypt | Decrypt ciphertext using vault keys (returns plaintext). |
| key.init | Initialize an encryption key and store reference in OS keychain (via keytar). |
| key.delete | Remove a key from the OS keychain and vault metadata. |
| remote.get | Fetch a secret from a remote provider (remote-backed vault). |
| remote.set | Push a secret to a remote provider. |
| remote.list | List remote-stored secrets. |
| remote.delete | Delete a remote secret. |
| remote.share | Share a secret with a remote principal (encrypt for recipient). |
| remote.revoke | Revoke a previously shared secret or access. |
| remote.listShared | List secrets that are shared out or shared with you. |
| remote.getShared | Retrieve a secret that was shared with you. |
| remote.auditLogs | Retrieve audit logs for remote operations (syncs, shares, revokes). |

Configuration
-------------
ability-secret reads configuration that controls vault locations, provider settings, and keychain labels. The ability validates config with zod at runtime (zod is a dependency).

Recommended config fields (example)
- vaultsDir (string) — filesystem path where vault metadata and ciphertext are stored (default: ~/.kadi/vaults)
- defaultVault (string) — name of the default vault to operate against
- keychainLabel (string) — label used when storing keys in the OS keychain via keytar
- remote.provider (string) — identifier of the remote provider (e.g., "s3", "git", "http")
- remote.endpoint (string) — URL or endpoint for remote provider
- remote.auth (object) — authentication settings for the remote provider (token, clientId, secret, etc.)

Example config file (user-managed, illustrative)
{
  "vaultsDir": "/home/user/.kadi/vaults",
  "defaultVault": "personal",
  "keychainLabel": "kadi-secret-ability",
  "remote": {
    "provider": "s3",
    "endpoint": "https://s3.example.com/kadi-vaults",
    "auth": {
      "accessKeyId": "...",
      "secretAccessKey": "..."
    }
  }
}

Files and paths
- Source entry: src/index.ts
- Tools implementation: src/tools.ts
- Provider connectors: src/providers/index.js
- Built entrypoint (package): dist/index.js
- agent metadata: agent.json

Architecture
------------
Core components
- KadiClient (from @kadi.build/core)
  - The central runtime for registering and serving tools. The client is created in src/index.ts and is the public interface to KADI.
- Tools layer (src/tools.ts)
  - Implements the tool functions listed above (config, vault, key, remote, encrypt/decrypt, CRUD).
  - Each tool is registered on the KadiClient using registerTools(client).
- Providers (src/providers/*)
  - Provider adapters abstract remote persistence and synchronization (S3/Git/HTTP/etc.). Providers are connected on demand and cleaned up via disconnectAllProviders() on client disconnect.
- Key storage (keytar)
  - OS-native keychain storage (macOS Keychain, Windows Credential Vault, Linux Secret Service) is used to store private keys or key references securely.
- Crypto stack
  - The ability uses tweetnacl and tweetnacl-sealedbox-js for NaCl-based authenticated encryption, ed2curve for key type conversion, and sealed boxes for recipient-encrypted sharing operations.
- Vault storage
  - Vaults are logical containers for encrypted secrets. A vault contains metadata (keys, access lists) and ciphertext entries. Vaults can be created from JSON, environment variables, or local filesystem metadata.

Data flow (typical operations)
1. Initialization
   - KadiClient starts and registerTools(client) registers all tool handlers. Providers are idle until used.
2. key.init
   - A new keypair is generated locally; the private key is stored (or referenced) in the OS keychain via keytar and vault metadata is updated with the public key.
3. set (store secret)
   - The tool encrypts the value using a vault key (sealed box or symmetric encryption derived from the key) and writes ciphertext into the vault storage (local filesystem or remote provider).
4. get (retrieve secret)
   - The ability fetches ciphertext, uses the private key from keytar to decrypt, and returns plaintext to the caller (via KADI tool response).
5. remote.share
   - To share, the ability encrypts the secret for recipients' public keys (sealed boxes) and calls the remote provider to publish the shared ciphertext. Audit logs may be recorded.
6. Disconnect / cleanup
   - On client disconnect, disconnectAllProviders() is called to close provider connections and free resources.

Security notes
- Private keys are stored in the OS keychain using keytar — the ability never stores plain private keys on disk.
- Encryption primitives are based on tweetnacl and sealedbox constructions; key conversions use ed2curve where necessary.
- Always secure the vaultsDir and remote provider credentials; follow your organization's secret management policies.

Development
-----------
Repository layout (relevant)
- src/index.ts — ability bootstrap and KadiClient instantiation
- src/tools.ts — implementation and registration of tools
- src/providers/index.js — provider connection and disconnect helpers
- dist/index.js — built entrypoint (agent.json entrypoint)

Dependencies (selected)
- @kadi.build/core — Kadi runtime client
- keytar — OS keychain integration
- tweetnacl, tweetnacl-sealedbox-js, ed2curve — crypto primitives
- smol-toml — small TOML utility (used by config or metadata)
- zod — runtime schema validation

Common development commands
- Install dependencies:
npm install

- Build and setup (per agent.json):
npm run setup

- Start in development (run built entrypoint):
npm run start
or
node dist/index.js

- Run in stdio or broker mode:
node dist/index.js      # stdio mode
node dist/index.js broker  # broker mode

- KADI CLI workflows:
kadi install
kadi run start

Testing
- The project uses vitest and TypeScript for development (devDependencies include vitest, typescript). Run tests with your repository test script or configure vitest as needed.

Notes
- The source registers all tools via registerTools(client) in src/index.ts. On disconnect, disconnectAllProviders() is called to cleanly close remote connections.
- The code uses the built output dist/index.js as the published entrypoint; ensure you run the build step prior to running the start script.

If you need an example of invoking a specific tool or a recommended config file for a particular remote provider, tell me which provider (S3/Git/HTTP) and I’ll add a concrete example.