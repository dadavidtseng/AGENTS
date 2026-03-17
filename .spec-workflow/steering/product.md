# Product Overview

## Product Purpose

AGENTS (Autonomous Game Engineering Network with Task-based Synchronization / for Task Synthesis) is a multi-agent orchestration system that enables AI agents to collaborate on complex software development tasks.

**Core Problem Solved:**
Current AI coding assistants work in isolation and cannot collaborate on complex, multi-step projects. AGENTS addresses this by introducing a quest-based workflow where humans provide high-level direction (CEO-style orchestration) and autonomous agents handle the detailed implementation, coordination, and execution.

**Key Innovation:**
Human-in-the-loop workflow where users act as CEOs providing high-level direction, while agent-producer orchestrates multiple specialized agents to execute tasks in parallel without conflicts.

## Target Users

### Primary Users

1. **Game Developers**
   - **Needs**: Coordinate asset creation, code implementation, and testing across multiple tools
   - **Pain Points**: Manual coordination overhead, inability to parallelize game development tasks
   - **Use Case**: Rapid prototyping of game mechanics using DaemonAgent

2. **Software Developers**
   - **Needs**: Parallel work on complex features with multiple components
   - **Pain Points**: Single-agent limitations, lack of task orchestration
   - **Use Case**: Refactoring modules across multiple files without merge conflicts

3. **Researchers**
   - **Needs**: Experimenting with multi-agent systems and autonomous software development
   - **Pain Points**: No existing platform for studying human-AI collaboration patterns
   - **Use Case**: Research platform for multi-agent orchestration studies

### User Role: CEO-Style Orchestration

Users provide high-level direction without needing deep technical expertise:
- Describe goals in natural language (e.g., "Create a simple starship shooting game")
- Review and approve agent-generated plans via dashboard
- Monitor progress in real-time
- Provide feedback and corrections as needed

**Key Principle**: System should be simple enough for non-technical users because a CEO doesn't necessarily need to be a tech expert.

## Key Features

1. **Quest-Based Task Management**
   - Break down high-level goals into executable tasks
   - 4-step workflow: Create → Assign → Execute → Verify
   - Human approval at critical checkpoints
   - Interactive dashboard (mcp-client-quest) for visual management

2. **Local/Remote Multi-Agent Orchestration**
   - Coordinate multiple agents working in parallel
   - Support for both local and remote agent deployment
   - Dynamic agent assignment based on workload and role
   - Git worktree isolation prevents merge conflicts

3. **Human-in-the-Loop Development Workflow**
   - CEO-style orchestration: humans provide direction, agents execute
   - Real-time progress monitoring via dashboard
   - Approval gates before critical operations (git merge, push)
   - Iterative refinement before execution

4. **Shadow Agent Worker for Monitoring and Rollback**
   - Backup agents monitor primary agent execution
   - Automatic rollback capability if tasks fail
   - Continuous health monitoring
   - Redundancy for critical operations

5. **Cross-Language Agent Support**
   - C++ Game Engine (DaemonAgent) with JavaScript scripting
   - TypeScript agents for general development
   - Python agents for data processing and ML integration
   - Rust/Go agents for performance-critical operations (planned)

## Business Objectives

### Academic Objectives
- Successfully defend thesis in May 2026
- Demonstrate system at public exhibition (May 8, 2026)
- Advance understanding of multi-agent orchestration and human-AI collaboration
- Potential publication of research findings

### Technical Objectives
- Enable real-world usage where users successfully achieve their requested goals
- Demonstrate effective CEO-style orchestration with minimal technical expertise
- Prove at least 10 workflow scenarios working reliably
- Show TypeScript, Python, and C++ agents collaborating seamlessly

### Long-Term Vision
- Become **the multi-agent template for all kinds of software development**
- Production-ready system for real-world use
- Open-source project with active community
- Reference implementation for multi-agent orchestration

## Success Metrics

### User Input → Agent Output Quality
- **Metric**: Accuracy of task breakdown from high-level goals
- **Target**: >80% of quests correctly broken down into executable tasks
- **Measurement**: Human review of agent-producer's task decomposition

### Task Completion Rate
- **Metric**: Percentage of tasks completed successfully
- **Target**: >75% success rate without human intervention
- **Measurement**: Automated tracking via mcp-server-quest

### Agent Collaboration Efficiency
- **Metric**: Number of agents working in parallel, conflict resolution success rate
- **Target**: 3+ agents working simultaneously, >90% conflict-free merges
- **Measurement**: Git worktree isolation effectiveness, merge success rate

### User Satisfaction
- **Metric**: Ease of use (CEO-style orchestration), dashboard usability
- **Target**: Non-technical users can successfully create and manage quests
- **Measurement**: User testing during thesis defense preparation

## Product Principles

1. **CEO-Style Orchestration**
   - Users provide high-level direction, agents handle implementation details
   - Minimal technical expertise required
   - Natural language interaction via Discord/Slack
   - Clear approval checkpoints for human oversight

2. **Human-in-the-Loop by Default**
   - All critical operations require human approval
   - Real-time visibility into agent progress
   - Ability to intervene and correct at any stage
   - Trust but verify: shadow agents monitor primary agents

3. **Isolation and Safety**
   - Git worktree isolation prevents conflicts
   - Each agent works in separate branch
   - Automatic rollback if tasks fail
   - No destructive operations without approval

4. **Cross-Language Collaboration**
   - Agents written in different languages work together seamlessly
   - KĀDI infrastructure enables cross-language communication
   - Language choice based on task requirements, not limitations
   - Game engine (C++) integrates with TypeScript/Python agents

5. **Quest-Based Workflow**
   - Structured approach to breaking down complex goals
   - Visual dashboard for management and monitoring
   - Iterative refinement before execution
   - Clear task dependencies and sequencing

## Monitoring & Visibility

### Dashboard Type
- **Web-based dashboard** (mcp-client-quest)
- React frontend with Express backend
- Accessible via browser for easy sharing and collaboration

### Real-time Updates
- **WebSocket-based real-time updates**
- Live progress tracking as agents execute tasks
- Instant notifications for approval requests
- Real-time git status and branch visualization

### Key Metrics Displayed
- **Quest Status**: Active, pending approval, completed
- **Task Progress**: Assigned agent, execution status, verification results
- **Agent Health**: Online/offline status, current workload
- **Git Status**: Branch status, merge conflicts, commit history
- **Approval Queue**: Tasks awaiting human review

### Sharing Capabilities
- **Read-only links** for stakeholders (planned)
- **Export to reports** for thesis documentation
- **Screenshot/video capture** for demonstrations
- **Git integration** for code review workflows

**Critical Concern**: mcp-client-quest is the only connection between human and agent-producer. It must be polished for thesis defense (May 2026).

## Future Vision

### 1-2 Year Vision
AGENTS will become **the multi-agent template for all kinds of software development**:
- Production-ready system for real-world use
- Open-source project with active community
- Reference implementation for multi-agent orchestration
- Research platform for human-AI collaboration studies

### Potential Enhancements

#### Remote Access
- **Tunnel features** for sharing dashboards with remote stakeholders
- **Cloud deployment** for multi-user access
- **Mobile app** for monitoring on the go

#### Analytics
- **Historical trends**: Task completion rates over time
- **Performance metrics**: Agent efficiency, bottleneck identification
- **Cost tracking**: LLM API usage and optimization

#### Collaboration
- **Multi-user support**: Multiple humans collaborating on same quest
- **Commenting**: Discussion threads on tasks and approvals
- **Role-based access control**: Different permission levels for team members

#### Additional Agent Types (Out of Scope for Thesis)
- **QA/Testing agents**: Automated testing and validation
- **DevOps agents**: CI/CD integration and deployment
- **Documentation agents**: Automatic documentation generation
- **Code review agents**: Automated code quality checks

#### Additional MCP Servers (Out of Scope for Thesis)
- **mcp-server-database**: Database operations and migrations
- **mcp-server-api**: REST API testing and integration
- **mcp-server-testing**: Test execution and coverage tracking

#### Language-Specific Agents (May Be Out of Scope)
- **Rust agents**: Performance-critical operations
- **Go agents**: Concurrent processing and microservices
- **Java agents**: Enterprise integration
- **Note**: May not have time for all languages, prioritizing Python + TypeScript

---

## Appendix

### Related Documents
- **tech.md**: Technical architecture and technology stack
- **structure.md**: Project structure and naming conventions
- **DEVELOPMENT-PLAN.md**: Detailed milestone plan (M2-M7)
- **DEVELOPMENT-PLAN-OUTLINE.md**: Quick reference guide

### Key User Stories

**Story 1: Game Scene Prototyping**
- User: "Create a game scene with 3 colored cubes (red, green, blue)"
- agent-producer breaks into tasks → DaemonAgent executes → User approves → Merge to main

**Story 2: Multi-File Refactoring**
- User: "Refactor the authentication module to use dependency injection"
- agent-producer assigns to multiple agents → Parallel execution in isolated worktrees → User reviews → Merge all branches

**Story 3: Automated QA Testing**
- User: "Test the shooting mechanics and verify bullets hit targets"
- DaemonAgent simulates gameplay → Captures screenshots → Analyzes with vision model → User reviews report

### Glossary
- **Quest**: High-level goal broken down into tasks
- **Task**: Atomic unit of work assigned to an agent
- **agent-producer**: Orchestration agent that manages quest/task workflow
- **agent-worker**: Generic worker agent with role-based configuration (artist, programmer, designer)
- **shadow-agent-worker**: Backup agent for monitoring and rollback
- **DaemonAgent**: C++ game engine agent with JavaScript scripting
- **KĀDI**: Knowledge & Ability Deployment Infrastructure (message routing and cross-language communication)
- **MCP**: Model Context Protocol (standard for AI agent tool use)
- **CEO-Style Orchestration**: Human provides high-level direction, agents handle details
