# mcp-server-quest - Requirements Specification

**Version:** 1.0.0
**Date:** 2026-01-19
**Status:** Draft
**Author:** System Architect

## 1. Executive Summary

### 1.1 Project Overview

**mcp-server-quest** is a comprehensive MCP (Model Context Protocol) server that orchestrates multi-agent workflows with human-in-the-loop approval. It serves as the central task management and coordination system for the KĀDI agent ecosystem, replacing mcp-shrimp-task-manager with enhanced capabilities for quest-based workflows, multi-channel approvals, and real-time visualization.

### 1.2 Key Objectives

- **Replace mcp-shrimp-task-manager** with enhanced quest-based workflow management
- **Integrate approval workflow** supporting Discord, Slack, and web dashboard interfaces
- **Provide comprehensive task engine** with dependency tracking, Git versioning, and execution guidance
- **Enable multi-agent coordination** through KĀDI event-driven architecture
- **Deliver real-time monitoring** via modern web dashboard with WebSocket updates

### 1.3 Success Criteria

- ✅ agent-producer successfully creates and manages quests via KĀDI broker
- ✅ Human users can approve quests from Discord, Slack, or web dashboard
- ✅ Worker agents (agent-artist, etc.) execute tasks using quest MCP tools
- ✅ Dashboard provides real-time progress tracking and approval interface
- ✅ Complete replacement of mcp-shrimp-task-manager functionality
- ✅ Full audit trail with Git versioning and approval history

## 2. System Context

### 2.1 Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    KĀDI Broker                              │
│                  (ws://localhost:8080)                      │
└────────────┬────────────────────────────────────────────────┘
             │
    ┌────────┼────────────┐
    │        │            │
┌───▼──┐ ┌──▼───┐ ┌──────▼────────┐
│agent-│ │ mcp- │ │ worker agents │
│prod. │ │quest │ │ (artist, etc.)│
└──┬───┘ └──┬───┘ └───────────────┘
   │        │
   │   ┌────▼────┐
   └───►Dashboard│
       └─────────┘
```

### 2.2 User Personas

#### **Primary Users**

1. **Human Users (Quest Requesters)**
   - Role: Product owners, art directors, project managers
   - Platforms: Discord, Slack, Web Dashboard
   - Needs: Request work, approve plans, monitor progress

2. **agent-producer (Orchestrator Agent)**
   - Role: Quest coordinator, task planner, approval requester
   - Platform: KĀDI broker (MCP upstream)
   - Needs: Create quests, split tasks, assign to workers, track completion

3. **Worker Agents (Executors)**
   - Examples: agent-artist, agent-designer, agent-programmer
   - Platform: KĀDI broker (event-driven)
   - Needs: Receive assignments, get task details, update status, submit results

#### **Secondary Users**

4. **System Administrators**
   - Role: Deploy and configure mcp-server-quest
   - Platform: CLI, configuration files
   - Needs: Easy deployment, monitoring, troubleshooting

## 3. Functional Requirements

### 3.1 Quest Management

#### FR-1.1: Quest Creation
**Priority:** Critical
**User Story:** As agent-producer, I want to create a quest from a natural language description so that I can coordinate work for human users.

**Acceptance Criteria:**
- [ ] agent-producer calls `quest_create` via KĀDI broker with quest description
- [ ] System uses Claude API to generate `requirements.md` and `design.md`
- [ ] Quest is stored in `.quest-data/quests/{quest-id}/` with unique UUID
- [ ] Quest status is set to `draft`
- [ ] Returns quest ID and generated documents

**Technical Details:**
```typescript
quest_create(params: {
  description: string;           // Natural language quest description
  requestedBy: string;           // User ID (Discord/Slack/email)
  channel: string;               // Channel ID or 'dashboard'
  platform: 'discord' | 'slack' | 'dashboard';
}): Promise<{
  questId: string;
  requirements: string;          // Generated requirements.md content
  design: string;                // Generated design.md content
  status: 'draft';
}>;
```

#### FR-1.2: Quest Document Generation
**Priority:** Critical
**User Story:** As agent-producer, I want AI-generated requirements and design documents so that human users can review structured plans.

**Acceptance Criteria:**
- [ ] System generates `requirements.md` with: Overview, User Stories, Acceptance Criteria, Constraints
- [ ] System generates `design.md` with: Design Approach, Technical Specifications, Reference Materials, Task Breakdown Summary
- [ ] Documents are written as Markdown files in quest directory
- [ ] Documents are committed to Git with message: "feat: create quest {quest-name}"
- [ ] Documents are human-readable and professionally formatted

**Template Structure:**
```markdown
# {Quest Name} - Requirements

## Overview
[AI-generated overview from description]

## User Stories
- As a [role], I want [goal] so that [benefit]

## Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]

## Constraints
- Budget: [estimate]
- Timeline: [estimate]
- Technical: [constraints]
```

#### FR-1.3: Quest Revision with Feedback
**Priority:** High
**User Story:** As a human user, I want to request revisions to a quest plan so that the final plan meets my requirements.

**Acceptance Criteria:**
- [ ] agent-producer calls `quest_revise` with human feedback
- [ ] System regenerates `requirements.md` and `design.md` incorporating feedback (updated in place)
- [ ] Previous versions accessible via Git history (`git log`, `git show`)
- [ ] Revision count is tracked in quest metadata
- [ ] Git commit created: "feat: revise quest {quest-name} (revision #{N})"

**Technical Details:**
```typescript
quest_revise(params: {
  questId: string;
  feedback: string;              // Human feedback text
  revisedBy: string;             // User ID who requested revision
}): Promise<{
  questId: string;
  revisionNumber: number;
  requirements: string;          // Updated requirements.md content
  design: string;                // Updated design.md content
}>;
```

#### FR-1.4: Quest Status Tracking
**Priority:** High
**User Story:** As any user, I want to query quest status so that I can monitor progress.

**Acceptance Criteria:**
- [ ] System tracks quest lifecycle: `draft` → `pending_approval` → `approved` → `in_progress` → `completed`
- [ ] `quest_get_status` returns current status, progress percentage, assigned agents
- [ ] Status updates are broadcasted via WebSocket to dashboard
- [ ] Status changes are logged with timestamp and actor

**Quest Status States:**
```typescript
type QuestStatus =
  | 'draft'              // Created, not yet submitted for approval
  | 'pending_approval'   // Submitted, awaiting human decision
  | 'approved'           // Approved, ready for task splitting
  | 'in_progress'        // Tasks being executed by workers
  | 'completed'          // All tasks completed
  | 'rejected'           // Rejected by human
  | 'cancelled';         // Cancelled before completion
```

### 3.2 Approval Workflow

#### FR-2.1: Multi-Channel Approval Request
**Priority:** Critical
**User Story:** As agent-producer, I want to request quest approval via Discord, Slack, or dashboard so that humans can review and approve plans.

**Acceptance Criteria:**
- [ ] agent-producer calls `quest_request_approval` with quest ID
- [ ] Quest status changes to `pending_approval`
- [ ] System generates approval message formatted for target platform
- [ ] Discord/Slack: Sends embedded message with action buttons (Approve, Revise, Reject)
- [ ] Dashboard: Creates notification in approval queue with visual indicator
- [ ] Approval request includes: quest name, requirements summary, design summary, estimates
- [ ] System tracks conversation context (platform, channel, thread, user)

**Technical Details:**
```typescript
quest_request_approval(params: {
  questId: string;
}): Promise<{
  approvalId: string;
  message: {
    summary: string;             // Brief overview
    requirements: string;        // Formatted for platform
    design: string;              // Formatted for platform
    estimates: {
      totalTasks: number;
      estimatedHours: number;
      assignedAgents: string[];
    };
  };
  conversationContext: {
    platform: string;
    channelId: string;
    threadId?: string;
    userId: string;
  };
}>;
```

#### FR-2.2: Approval Decision Processing
**Priority:** Critical
**User Story:** As a human user, I want to approve, revise, or reject quests from any interface so that I have flexibility in how I review plans.

**Acceptance Criteria:**
- [ ] Human can approve from Discord button click, Slack button click, or dashboard form
- [ ] All channels call the same `quest_submit_approval` tool
- [ ] System records: decision, approver ID, platform, timestamp, feedback (if any)
- [ ] Approval history saved to `.quest-data/quests/{quest-id}/approval-history.json`
- [ ] On approval: Quest status → `approved`, publishes KĀDI event `quest.approved`
- [ ] On revision: Calls `quest_revise` automatically, re-submits for approval
- [ ] On rejection: Quest status → `rejected`, notifies agent-producer
- [ ] Decision is broadcasted to all connected dashboard clients via WebSocket

**Technical Details:**
```typescript
quest_submit_approval(params: {
  questId: string;
  decision: 'approved' | 'revision_requested' | 'rejected';
  approvedBy: string;            // User ID
  approvedVia: 'discord' | 'slack' | 'dashboard';
  feedback?: string;             // Required for revision/rejection
  timestamp: string;
}): Promise<{
  success: boolean;
  nextAction: 'execute' | 'revise' | 'cancel';
  questStatus: QuestStatus;
}>;
```

#### FR-2.3: Cross-Channel Notification
**Priority:** High
**User Story:** As a human user, I want to be notified when quest status changes, regardless of which channel I used.

**Acceptance Criteria:**
- [ ] Approval decision notifies original platform (Discord/Slack thread or dashboard)
- [ ] Dashboard receives real-time updates via WebSocket for all quest events
- [ ] Notifications include: quest name, status, decision maker, timestamp
- [ ] Discord/Slack notifications link to dashboard for detailed view
- [ ] Dashboard notifications show inline without page refresh

### 3.3 Task Management (Shrimp Replacement)

#### FR-3.1: Task Splitting with Dependencies
**Priority:** Critical
**User Story:** As agent-producer, I want to split approved quests into executable tasks with dependencies so that workers can execute them in order.

**Acceptance Criteria:**
- [ ] agent-producer calls `quest_split_tasks` after approval
- [ ] System uses Claude API with Shrimp's task splitting logic (plan → analyze → reflect → split)
- [ ] Tasks are stored in `.quest-data/quests/{quest-id}/tasks.json`
- [ ] Each task includes: id, name, description, implementationGuide, verificationCriteria, dependencies, relatedFiles, assignedAgent
- [ ] Task dependencies are validated (no circular dependencies)
- [ ] Tasks follow Shrimp's granularity rules (1-2 day work units)
- [ ] Git commit created: "feat: split quest {quest-name} into {N} tasks"

**Task Data Model:**
```typescript
interface Task {
  id: string;                    // UUID
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignedAgent?: string;        // Agent role (artist, designer, programmer)
  implementationGuide: string;   // Detailed execution instructions
  verificationCriteria: string;  // Quality gates and acceptance criteria
  dependencies: string[];        // Task IDs that must complete first
  relatedFiles: Array<{
    path: string;
    type: 'TO_MODIFY' | 'REFERENCE' | 'CREATE' | 'DEPENDENCY' | 'OTHER';
    description: string;
    lineStart?: number;          // Must be > 0 if specified
    lineEnd?: number;            // Must be > 0 if specified
  }>;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  artifacts?: {
    files: string[];
    metadata: any;
  };
}
```

#### FR-3.2: Agent Assignment with Capability Matching
**Priority:** High
**User Story:** As agent-producer, I want to assign tasks to capable agents so that work is distributed efficiently.

**Acceptance Criteria:**
- [ ] System maintains agent registry with capabilities
- [ ] agent-producer calls `quest_assign_tasks` with quest ID
- [ ] System matches task requirements to agent capabilities
- [ ] Tasks are assigned to available agents (not offline or overloaded)
- [ ] Assignment is recorded in task metadata
- [ ] KĀDI events published: `{role}.task.assigned` for each assignment
- [ ] Agent workload is tracked (current task count per agent)

**Technical Details:**
```typescript
quest_assign_tasks(params: {
  questId: string;
  assignments?: Array<{          // Optional manual overrides
    taskId: string;
    agentRole: string;
  }>;
}): Promise<{
  assignments: Array<{
    taskId: string;
    taskName: string;
    assignedTo: string;           // Agent role
    eventPublished: boolean;
  }>;
}>;
```

#### FR-3.3: Task Execution by Worker Agents
**Priority:** Critical
**User Story:** As a worker agent (agent-artist), I want to get task details and execution guidance so that I can complete assigned work.

**Acceptance Criteria:**
- [ ] Worker agent receives KĀDI event `{role}.task.assigned`
- [ ] Worker calls `quest_get_task_details` to retrieve full task info
- [ ] Task details include: name, description, implementationGuide, verificationCriteria, relatedFiles, quest context (requirements.md, design.md)
- [ ] Worker executes task according to implementation guide
- [ ] Worker calls `quest_update_task_status` to mark in_progress
- [ ] Worker calls `quest_submit_task_result` upon completion with artifacts
- [ ] System validates completion against verificationCriteria

**Technical Details:**
```typescript
quest_get_task_details(params: {
  taskId: string;
}): Promise<{
  task: Task;
  questContext: {
    questId: string;
    questName: string;
    requirements: string;        // Full requirements.md content
    design: string;              // Full design.md content
  };
}>;

quest_update_task_status(params: {
  taskId: string;
  status: 'in_progress' | 'completed' | 'failed';
  agentId: string;
}): Promise<{ success: boolean }>;

quest_submit_task_result(params: {
  taskId: string;
  agentId: string;
  artifacts: {
    files: string[];             // File paths to generated artifacts
    metadata?: any;
  };
  summary: string;               // Completion summary
}): Promise<{ success: boolean }>;
```

#### FR-3.4: Task Verification
**Priority:** High
**User Story:** As agent-producer, I want to verify completed tasks so that quality standards are maintained.

**Acceptance Criteria:**
- [ ] agent-producer calls `quest_verify_task` after worker completion
- [ ] System checks artifacts against verificationCriteria
- [ ] Scoring system (0-100) assesses quality
- [ ] Tasks scoring >= 80 are marked completed
- [ ] Tasks scoring < 80 require revision or manual review
- [ ] Verification results stored in task metadata
- [ ] Git commit if artifacts modify repository

**Technical Details:**
```typescript
quest_verify_task(params: {
  taskId: string;
  score: number;                 // 0-100
  summary: string;
  verifiedBy: string;            // agent-producer or human user ID
}): Promise<{
  success: boolean;
  taskStatus: 'completed' | 'needs_revision';
  message: string;
}>;
```

### 3.4 Agent Coordination

#### FR-4.1: Agent Registration
**Priority:** High
**User Story:** As a worker agent, I want to register my capabilities when I start so that I can receive appropriate task assignments.

**Acceptance Criteria:**
- [ ] Worker agent calls `quest_register_agent` on startup
- [ ] System stores agent metadata: id, name, role, capabilities, status, maxConcurrentTasks
- [ ] Agent registry persisted to `.quest-data/agents.json`
- [ ] Registration published as KĀDI event: `agent.registered`
- [ ] Duplicate registrations update existing record

**Technical Details:**
```typescript
quest_register_agent(params: {
  agentId: string;
  name: string;
  role: 'artist' | 'designer' | 'programmer';
  capabilities: string[];        // e.g., ["image-generation", "character-design"]
  maxConcurrentTasks: number;
}): Promise<{
  success: boolean;
  agentId: string;
}>;
```

#### FR-4.2: Agent Status Tracking
**Priority:** Medium
**User Story:** As agent-producer, I want to query agent availability so that I can assign tasks to available agents.

**Acceptance Criteria:**
- [ ] System tracks agent status: `available`, `busy`, `offline`
- [ ] Agent status updated when tasks are assigned/completed
- [ ] `quest_list_agents` returns all agents with current status and workload
- [ ] Agents not seen for > 5 minutes marked as `offline`
- [ ] Dashboard shows real-time agent status

**Technical Details:**
```typescript
quest_list_agents(params: {
  status?: 'available' | 'busy' | 'offline';
  role?: string;
}): Promise<{
  agents: Array<{
    agentId: string;
    name: string;
    role: string;
    status: string;
    currentTasks: string[];
    capabilities: string[];
    lastSeen: Date;
  }>;
}>;
```

### 3.5 Dashboard & Visualization

#### FR-5.1: Real-Time Dashboard
**Priority:** High
**User Story:** As a human user, I want a web dashboard to monitor quest progress in real-time.

**Acceptance Criteria:**
- [ ] Dashboard accessible at `http://localhost:8888`
- [ ] Shows: Pending Approvals, In Progress Quests, Completed Quests
- [ ] Real-time updates via WebSocket (no page refresh required)
- [ ] Quest cards show: name, status, progress percentage, assigned agents, requester
- [ ] Click quest card to view detailed quest page

#### FR-5.2: Approval Interface
**Priority:** Critical
**User Story:** As a human user, I want to review and approve quests from the dashboard.

**Acceptance Criteria:**
- [ ] Approval page displays: requirements.md (rendered Markdown), design.md (rendered Markdown)
- [ ] Shows estimated: total tasks, hours, assigned agents
- [ ] Provides approval actions: Approve, Request Revision, Reject
- [ ] Revision request opens feedback textarea (required field)
- [ ] Approval decision immediately updates quest status
- [ ] Notifies agent-producer via KĀDI event

#### FR-5.3: Task Execution Monitoring
**Priority:** High
**User Story:** As a human user, I want to see detailed task execution progress.

**Acceptance Criteria:**
- [ ] Quest detail page shows task list with status indicators
- [ ] Tasks displayed with: name, status, assigned agent, progress
- [ ] Visual dependency graph (optional)
- [ ] Real-time task status updates via WebSocket
- [ ] Click task to view: implementation guide, verification criteria, artifacts

#### FR-5.4: Agent Monitoring
**Priority:** Medium
**User Story:** As a human user or administrator, I want to monitor agent status and workload.

**Acceptance Criteria:**
- [ ] Dashboard shows agent list with: name, role, status, current tasks
- [ ] Visual indicators: 🟢 Available, 🟡 Busy, 🔴 Offline
- [ ] Agent workload statistics: completed tasks, failed tasks, current load
- [ ] Click agent to view: capabilities, task history, performance metrics

### 3.6 Data Persistence & Versioning

#### FR-6.1: File-Based Storage with Git
**Priority:** Critical
**User Story:** As a system, I want to store all quest data with Git versioning for audit trail and recovery.

**Acceptance Criteria:**
- [ ] All quest data stored in `.quest-data/` directory
- [ ] Directory structure:
  ```
  .quest-data/
    quests/
      {quest-id}/
        requirements.md          # Human-readable requirements
        design.md                # Human-readable design
        tasks.json               # Agent-parseable structured tasks
        approval-history.json
    templates/
      art-project/
        requirements-template.md
        design-template.md
        tasks-template.json
      code-feature/
        requirements-template.md
        design-template.md
        tasks-template.json
      design-system/
        requirements-template.md
        design-template.md
        tasks-template.json
    agents.json
    .git/
  ```
- [ ] Mixed file format strategy:
  - `.md` files for human-readable documentation (requirements, design)
  - `.json` files for agent-parseable structured data (tasks, approval history)
  - Rationale: Different audiences (humans vs agents) benefit from format-appropriate representation
- [ ] Git repository initialized in `.quest-data/` on first run
- [ ] All changes committed with descriptive messages (following Shrimp pattern)
- [ ] Git history provides full audit trail without creating versioned files (requirements-v2.md, etc.)
- [ ] When quest is revised, requirements.md and design.md are updated in place
- [ ] Previous versions accessible via `git log` and `git show` commands

#### FR-6.2: Quest Templates
**Priority:** Medium
**User Story:** As agent-producer, I want to use predefined quest templates to speed up common workflows.

**Acceptance Criteria:**
- [ ] Built-in templates: Art Project, Code Feature, Design System
- [ ] Each template is a directory containing three separate template files:
  - `requirements-template.md`: Markdown template for quest requirements
  - `design-template.md`: Markdown template for quest design
  - `tasks-template.json`: JSON template for task structure
- [ ] `quest_create_from_template` tool available
- [ ] Templates stored in `.quest-data/templates/{template-name}/`
- [ ] Templates use placeholder syntax `{{VARIABLE_NAME}}` for dynamic substitution
- [ ] Example template structure:
  ```markdown
  # requirements-template.md
  # {{PROJECT_NAME}} - Requirements

  ## Overview
  {{DESCRIPTION}}

  ## Deliverables
  - [ ] {{DELIVERABLE_1}}
  ```
  ```markdown
  # design-template.md
  # {{PROJECT_NAME}} - Design

  ## Art Style
  {{STYLE_GUIDELINES}}
  ```
  ```json
  # tasks-template.json
  [
    {
      "name": "{{TASK_NAME}}",
      "description": "{{TASK_DESCRIPTION}}",
      "implementationGuide": "{{GUIDE}}",
      "verificationCriteria": "{{CRITERIA}}"
    }
  ]
  ```

## 4. Non-Functional Requirements

### 4.1 Performance

**NFR-4.1.1: Response Time**
- MCP tool calls respond within 2 seconds (excluding Claude API calls)
- Claude API-dependent operations (quest creation, task splitting) complete within 30 seconds
- Dashboard page load within 1 second
- WebSocket message latency < 100ms

**NFR-4.1.2: Scalability**
- Support 50+ concurrent quests
- Support 10+ worker agents
- Handle 1000+ tasks across all quests
- Dashboard supports 20+ concurrent user connections

### 4.2 Reliability

**NFR-4.2.1: Availability**
- MCP server uptime 99.9% (excluding maintenance)
- Graceful degradation if Claude API unavailable
- Automatic reconnection to KĀDI broker on disconnect

**NFR-4.2.2: Data Integrity**
- Git commits never lose data
- Quest approval decisions persisted immediately
- Task assignments atomically recorded
- Crash recovery restores last committed state

### 4.3 Security

**NFR-4.3.1: Access Control**
- Dashboard localhost-only by default (configurable for production)
- No authentication required for MVP (localhost trust model)
- Future: Optional basic auth or OAuth for production deployments

**NFR-4.3.2: Data Privacy**
- All data stored locally in `.quest-data/`
- No external data transmission except Claude API calls
- Quest descriptions and artifacts remain on local filesystem

### 4.4 Usability

**NFR-4.4.1: Dashboard UX**
- Mobile-responsive design (optional for MVP)
- Dark mode support (inherit from spec-workflow)
- Intuitive navigation with breadcrumbs
- Real-time updates without jarring UI changes

**NFR-4.4.2: Error Messages**
- Human-readable error messages for MCP tool failures
- Clear guidance on how to fix common errors
- Validation errors show field-level feedback

### 4.5 Maintainability

**NFR-4.5.1: Code Quality**
- TypeScript with strict type checking
- Comprehensive JSDoc comments
- Modular architecture (tools, models, dashboard separated)
- 80%+ code coverage with unit tests (aspirational)

**NFR-4.5.2: Documentation**
- README with setup instructions
- API documentation for all MCP tools
- Architecture diagram
- Deployment guide

## 5. Technical Constraints

### 5.1 Dependencies

**Required:**
- Node.js >= 18.0.0
- TypeScript >= 5.3.0
- @modelcontextprotocol/sdk (MCP server SDK)
- @kadi.build/core (KĀDI client, not direct dependency but required by broker)
- Anthropic SDK (for Claude API)
- Fastify (dashboard server)
- React 18+ (dashboard frontend)

**Optional:**
- Git (for versioning, fallback to no-versioning mode if unavailable)

### 5.2 Integration Points

**KĀDI Broker:**
- WebSocket connection to `ws://localhost:8080`
- MCP upstream configuration in broker's `mcp-upstreams.json`
- Event subscription/publishing for agent coordination

**agent-producer:**
- Calls mcp-server-quest tools via KĀDI broker's MCP upstream
- Listens to quest events: `quest.approved`, `quest.revised`, `quest.cancelled`

**Worker Agents:**
- Call mcp-server-quest tools directly for task operations
- Listen to KĀDI events: `{role}.task.assigned`, `{role}.task.cancelled`

**Discord/Slack Bots:**
- Hosted in agent-producer process
- Call mcp-server-quest tools on behalf of human users
- Send approval messages with action buttons

### 5.3 Environment

**Development:**
- Localhost-only (127.0.0.1)
- Hot reload with `tsx watch`
- Dashboard dev server on port 5173

**Production:**
- Configurable bind address (localhost or 0.0.0.0)
- Compiled TypeScript to JavaScript
- Dashboard production build served by Fastify

## 6. Migration & Compatibility

### 6.1 Migration from mcp-shrimp-task-manager

**Phase 1: Parallel Deployment (Weeks 1-2)**
- agent-producer continues using Shrimp for existing tasks
- New quests use mcp-server-quest
- Both servers run simultaneously in KĀDI broker

**Phase 2: Feature Parity (Weeks 3-4)**
- All Shrimp tools replicated in Quest
- Migration script to convert Shrimp tasks to Quest tasks (optional)
- Documentation for switching agent-producer to Quest

**Phase 3: Deprecation (Week 5+)**
- Remove Shrimp from KĀDI broker configuration
- Archive Shrimp data to `.quest-data/legacy/`
- Update all agent-producer calls to use Quest tools

### 6.2 Breaking Changes

**From Shrimp to Quest:**
- Tool names change: `shrimp_*` → `quest_*`
- Data location changes: `shrimp_data/` → `.quest-data/`
- Quest model adds requirements.md and design.md (not in Shrimp)
- Approval workflow is new (not in Shrimp)

**Mitigation:**
- Provide compatibility layer (optional wrapper tools)
- Detailed migration guide
- Support both systems during transition period

## 7. Out of Scope (Future Enhancements)

### 7.1 Not in MVP

- [ ] Multi-user approval (requires 2+ approvers)
- [ ] Cost tracking in currency (time-based only in MVP)
- [ ] Email notifications (Discord/Slack only in MVP)
- [ ] User-defined quest templates (built-in only in MVP)
- [ ] Advanced analytics and reporting
- [ ] Quest scheduling (start date, deadlines)
- [ ] Quest dependencies (one quest depends on another)
- [ ] AI-powered task optimization and reassignment
- [ ] Mobile app
- [ ] OAuth authentication
- [ ] Multi-language support (English only in MVP)

### 7.2 Potential Future Features

- [ ] Quest cloning (duplicate quest with modifications)
- [ ] Task delegation (agent can sub-assign tasks)
- [ ] Parallel task execution (multiple agents on same quest)
- [ ] Quest rollback (undo task execution)
- [ ] Integration with project management tools (Jira, Linear)
- [ ] Advanced agent capabilities (skill-based routing)
- [ ] Quest marketplace (share templates)
- [ ] Webhook notifications for external systems

## 8. Acceptance Criteria Summary

### 8.1 Must Have (MVP)

- [x] Quest creation with AI-generated requirements and design documents
- [x] Multi-channel approval workflow (Discord, Slack, Dashboard)
- [x] Task splitting with dependency tracking (Shrimp parity)
- [x] Agent registration and capability matching
- [x] Worker agent task execution via MCP tools
- [x] Real-time web dashboard with approval interface
- [x] Git versioning for all quest data
- [x] Complete replacement of mcp-shrimp-task-manager functionality

### 8.2 Should Have (Post-MVP)

- [ ] Built-in quest templates
- [ ] Advanced task verification with automated scoring
- [ ] Agent performance metrics
- [ ] Quest search and filtering
- [ ] Approval statistics and reporting

### 8.3 Nice to Have (Future)

- [ ] Multi-user approval workflow
- [ ] Cost tracking in currency
- [ ] Email notifications
- [ ] Mobile-responsive dashboard
- [ ] Quest templates marketplace

## 9. Glossary

**Quest:** A coordinated work unit containing requirements, design, and executable tasks
**agent-producer:** Orchestrator agent that creates quests and coordinates workers
**Worker Agent:** Execution agent (agent-artist, agent-designer, etc.) that performs tasks
**KĀDI Broker:** WebSocket message broker for inter-agent communication
**MCP (Model Context Protocol):** Protocol for AI tool invocation
**Task:** Atomic work unit with implementation guide and verification criteria
**Approval Workflow:** Human review and approval of quest plans before execution
**Dashboard:** Real-time web interface for quest monitoring and approval

## 10. Revision History

| Version | Date       | Author            | Changes                          |
|---------|------------|-------------------|----------------------------------|
| 1.0.0   | 2026-01-19 | System Architect  | Initial requirements document    |

## 11. Approval Sign-Off

**This requirements document requires approval before proceeding to design phase.**

**Stakeholders:**
- [ ] Project Owner: @user
- [ ] Technical Lead: @system
- [ ] agent-producer Representative: (automated approval via implementation)

**Approval Decision:**
- ⬜ Approved - Proceed to design phase
- ⬜ Revision Required - See feedback below
- ⬜ Rejected - Specify reasons

**Feedback:**
_[Provide feedback here if revision required or rejection]_

**End of Requirements Document**
