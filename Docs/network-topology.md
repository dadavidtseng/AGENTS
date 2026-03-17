# M4 Network Topology — Quick Reference

> Canonical source: `Docs/ARCHITECTURE_V2.md` §2 (Network Topology & Tool Registration)
> This document adds ability→network mapping and agent→network membership summary.

## Network Zones

| Zone | Networks | Purpose |
|------|----------|---------|
| Interaction | global, text, quest, producer | HUMAN-facing interfaces |
| Distribution | artist, designer, programmer | Role-specific task assignment + execution |
| Validation | qa | QA validation and scoring |
| Infrastructure | git, deploy, file, infra | Shared services and operations |
| Perception | vision, voice | Sensory capabilities |
| Maintenance | maintainer | Agent health monitoring |

## Agent → Network Membership

| Agent | Networks |
|-------|----------|
| agent-producer | producer, quest, text |
| agent-chatbot | text |
| agent-quest | quest, producer, infra |
| agent-lead-artist | producer, artist, git, qa |
| agent-lead-designer | producer, designer, git, qa |
| agent-lead-programmer | producer, programmer, git, qa, deploy |
| agent-worker-artist | artist, git, qa, file |
| agent-worker-designer | designer, git, qa, file |
| agent-worker-programmer | programmer, git, qa, file |
| agent-builder | deploy, git, file |
| agent-deployer | deploy, infra |
| agent-qa | qa, vision, file |

## Ability → Network Mapping

| Ability | Network | Repo | Tools |
|---------|---------|------|-------|
| ability-file-local | file | ability-file-management | 21 |
| ability-file-remote | file | ability-local-remote-file-manager | 33 |
| ability-file-cloud | file | ability-cloud-file-manager | 15 |
| ability-memory | memory | ability-arcadedb | 14 |
| ability-tunnel-public | infra | ability-tunnel | 6 |
| ability-deploy | deploy | ability-deploy + ability-container-registry | 10 |
| ability-secret | infra | secret-ability (port from ref) | 23 |
| ability-vision | vision | New | TBD |
| ability-voice | voice | New | TBD |
| ability-eval | qa | New | TBD |
| ability-tunnel-private | infra | New | TBD |

## Event → Network Mapping

See `Docs/ARCHITECTURE_V2.md` §3 (KADI Event Flow) for the full event catalog and sequence diagram.

Key routing rules:
- Quest lifecycle events (`quest.*`) → network: **quest**
- Task assignment/failure events (`task.assigned`, `task.failed`) → network: **role-specific** (artist/designer/programmer)
- QA events (`task.review_requested`, `task.revision_needed`, `task.validated`) → network: **qa**
- Handoff events (`quest.tasks_ready`, `task.verified`, `quest.pr_created`) → network: **producer**
- PR events (`pr.changes_requested`, `quest.pr_rejected`, `quest.merged`) → network: **quest**
- Completion (`quest.completed`) → network: **global**
