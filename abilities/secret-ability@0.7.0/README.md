# secret-ability

An ability for KADI agents to manage encrypted secrets. Agents load this ability to store, retrieve, and share sensitive data like API keys and credentials.

The primary consumer is the `kadi-secret` CLI plugin, which provides interactive commands for managing secrets from your terminal.

## Installation

```bash
kadi install secret-ability
```

## Getting Started

Your agent needs an API key. You want to store it securely without hardcoding it. Here's how:

```typescript
import { KadiClient } from '@kadi.build/core';

const client = new KadiClient({ name: 'my-agent' });
const secrets = await client.loadNative('secret-ability');
```

You now have access to secret-ability's tools through the `secrets` object.

### Creating a Vault

Before storing secrets, you need a vault. A vault is a named container for related secrets.

```typescript
await secrets.invoke('config.createVault', {
  name: 'my-vault',
  type: 'age',
});
```

This creates a local vault called `my-vault`. The `type: 'age'` means secrets are encrypted on disk using your OS keychain for the master key.

### Storing and Retrieving Secrets

```typescript
await secrets.invoke('set', {
  vault: 'my-vault',
  key: 'API_KEY',
  value: 'sk-abc123',
});

const { value } = await secrets.invoke('get', {
  vault: 'my-vault',
  key: 'API_KEY',
});
```

The secret is now encrypted and stored. When you're done, disconnect:

```typescript
await secrets.disconnect();
```

## Understanding the Config File

Secrets are stored in `secrets.toml`. After the steps above, your file looks like:

```toml
[vaults.my-vault]
type = "age"

[secrets.my-vault]
API_KEY = "ENC[AES256_GCM,data:abc123...]"
```

The file has two sections:

- **`[vaults.<name>]`** — Vault definitions. Each vault has a `type` that determines where and how secrets are stored.

- **`[secrets.<vault-name>]`** — The encrypted secrets. Values wrapped in `ENC[...]` are ciphertext—safe to commit to version control.

## Local vs Remote Vaults

So far we've used local vaults (`type: 'age'`). These store secrets on your machine, encrypted with a key in your OS keychain.

But what if you need to share secrets with another agent? Or access them from a different machine? That's where remote vaults come in.

**Remote vaults** store secrets on a server instead of your local filesystem. The vault type determines which server:

- `type: 'kadi'` — Stored on a KADI broker with end-to-end encryption

## Remote Vaults

You're building two agents that need to share an API key. One agent stores the secret, the other retrieves it.

First, create a remote vault that connects to your broker:

```typescript
await secrets.invoke('config.createVault', {
  name: 'team-vault',
  type: 'kadi',
  options: {
    broker: 'ws://localhost:8080/kadi',
    network: 'secrets',
  },
});
```

This creates a vault that stores secrets on the broker at the given address, scoped to the `secrets` network.

### Storing a Remote Secret

```typescript
await secrets.invoke('remote.set', {
  vault: 'team-vault',
  key: 'SHARED_KEY',
  value: 'secret-value',
  identity: client.keyPair,
});
```

The secret is encrypted with your agent's key before leaving your machine. The broker never sees the plaintext.

### Sharing with Another Agent

Now share it with a teammate's agent using their public key:

```typescript
await secrets.invoke('remote.share', {
  vault: 'team-vault',
  key: 'SHARED_KEY',
  withAgent: 'MCowBQYDK2Vw...',  // recipient's public key
  identity: client.keyPair,
  maxReads: 5,        // optional: limit reads
  durationHours: 24,  // optional: auto-expire
});
```

The secret is re-encrypted for the recipient. You can limit how many times they can read it or set an expiration.

### Retrieving a Shared Secret

The recipient retrieves it like this:

```typescript
const { value } = await secrets.invoke('remote.get', {
  vault: 'team-vault',
  key: 'SHARED_KEY',
  fromAgent: 'MCowBQYDK2Vw...',  // sharer's public key
  identity: client.keyPair,
});
```

The `fromAgent` parameter identifies who shared the secret with them.

## Tools

### Config

| Tool | Description |
|------|-------------|
| `config.createVault` | Create a vault (`type: 'age'` or `'kadi'`) |
| `config.destroyVault` | Remove a vault and its secrets |
| `config.read` | Read the config file |

### Local Vault Operations

| Tool | Description |
|------|-------------|
| `get` | Get a secret |
| `set` | Store a secret |
| `list` | List secret keys |
| `delete` | Delete a secret |
| `exists` | Check if a secret exists |

### Remote Vault Operations

| Tool | Description |
|------|-------------|
| `remote.get` | Get a secret (use `fromAgent` for shared secrets) |
| `remote.set` | Store a secret |
| `remote.list` | List your secrets |
| `remote.delete` | Delete a secret |
| `remote.share` | Share a secret with another agent |
| `remote.revoke` | Revoke access to a shared secret |
| `remote.listShared` | List secrets shared with you |
| `remote.getShared` | Get a shared secret by name |
| `remote.auditLogs` | View access history |

## Security

- **Local vaults**: ChaCha20-Poly1305 encryption, master key in OS keychain
- **Remote vaults**: Ed25519 authentication, X25519 key exchange, end-to-end encryption
- **Sharing**: Secrets re-encrypted for recipient's public key—broker never sees plaintext

## License

MIT
