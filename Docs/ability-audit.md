# M4 Ability Audit — Existing vs Canonical Mapping

## Summary

| Canonical Name (M4) | Current Repo | Current Name | Tools | Action | Network |
|---------------------|-------------|-------------|-------|--------|---------|
| ability-file-local | ability-file-management | ability-file-management v1.0.0 | 21 | Rename + strip remote tools | file |
| ability-file-remote | ability-local-remote-file-manager | @kadi.build/local-remote-file-manager-ability v0.0.2 | 33 | Rename + strip local-only tools | file |
| ability-file-cloud | ability-cloud-file-manager | cloud-file-service v1.0.0 | 15 | Rename only | file |
| ability-memory | ability-arcadedb | arcade-admin v1.0.0 | 14 | Rename + add graph/context APIs | memory |
| ability-tunnel-public | ability-tunnel | kadi-tunnel v1.0.0 | 6 | Rename only | infra |
| ability-deploy | ability-deploy + ability-container-registry | deploy-ability v1.0.0 + @kadi.build/container-registry-ability v0.0.3 | 2 + 8 = 10 | Consolidate into one | deploy |
| ability-secret | (new, based on humin-game-lab secret-ability) | secret-ability v0.7.0 (ref) | 23 | Port to KĀDI ability format | infra |
| ability-vision | (new) | — | 0 | Create from scratch | vision |
| ability-voice | (new) | — | 0 | Create from scratch | voice |
| ability-eval | (new) | — | 0 | Create from scratch | qa |
| ability-tunnel-private | (new) | — | 0 | Create from scratch | infra |

**Existing repos: 7** (99 tools total)
**New projects: 4** (ability-vision, ability-voice, ability-eval, ability-tunnel-private)
**Reference repos: 5** (humin-game-lab — libraries, not KĀDI-wrapped)
