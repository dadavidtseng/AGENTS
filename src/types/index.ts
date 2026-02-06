/**
 * Type definitions for mcp-server-quest
 * Combines Shrimp's task management patterns with spec-workflow's approval system
 */

/**
 * Quest status lifecycle
 * - draft: Initial creation, not yet submitted
 * - pending_approval: Awaiting approval via Discord/Slack/Dashboard
 * - approved: Approved and ready for task splitting
 * - rejected: Rejected by reviewer
 * - in_progress: Tasks are being executed
 * - completed: All tasks completed successfully
 * - cancelled: Quest cancelled by user
 */
export type QuestStatus =
    | 'draft'
    | 'pending_approval'
    | 'approved'
    | 'rejected'
    | 'in_progress'
    | 'completed'
    | 'cancelled';

/**
 * Task execution status
 * - pending: Task created but not started
 * - assigned: Task assigned to an agent but not yet started
 * - in_progress: Task currently being executed
 * - completed: Task successfully completed
 * - failed: Task execution failed
 */
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

/**
 * Agent role types for capability matching
 * - artist: Creative visual work
 * - designer: UI/UX and system design
 * - programmer: Code implementation
 */
export type AgentRole = 'artist' | 'designer' | 'programmer';

/**
 * Agent availability status
 * - available: Ready to accept tasks
 * - busy: Currently executing tasks
 * - offline: Not available for task assignment
 */
export type AgentStatus = 'available' | 'busy' | 'offline';

/**
 * Approval decision types
 * - approved: Quest approved, proceed to task splitting
 * - revision_requested: Changes required before approval
 * - rejected: Quest rejected, will not proceed
 */
export type ApprovalDecisionType = 'approved' | 'revision_requested' | 'rejected';

/**
 * Communication platform types
 * - discord: Discord channel/thread
 * - slack: Slack channel/thread
 * - dashboard: Web dashboard interface
 */
export type Platform = 'discord' | 'slack' | 'dashboard';

/**
 * File relationship types for task context
 * - TO_MODIFY: File that will be modified by this task
 * - REFERENCE: File to reference for context
 * - CREATE: New file to be created
 * - DEPENDENCY: File that this task depends on
 * - OTHER: Other file relationship
 */
export type FileRelationType = 'TO_MODIFY' | 'REFERENCE' | 'CREATE' | 'DEPENDENCY' | 'OTHER';

/**
 * Related file metadata for task context
 */
export interface RelatedFile {
    /** Absolute or relative path to the file */
    path: string;
    /** Type of relationship to the task */
    type: FileRelationType;
    /** Description of why this file is related */
    description: string;
    /** Starting line number (1-based, optional) */
    lineStart?: number;
    /** Ending line number (1-based, optional) */
    lineEnd?: number;
}

/**
 * Task artifacts produced during execution
 * Contains structured information about what was implemented
 */
export interface TaskArtifacts {
    /** API endpoints created or modified */
    apiEndpoints?: Array<{
        method: string;
        path: string;
        purpose: string;
        requestFormat: string;
        responseFormat: string;
        location: string;
    }>;
    /** UI components created */
    components?: Array<{
        name: string;
        type: string;
        purpose: string;
        location: string;
        props: string;
        exports: string[];
    }>;
    /** Utility functions created */
    functions?: Array<{
        name: string;
        purpose: string;
        location: string;
        signature: string;
        isExported: boolean;
    }>;
    /** Classes created */
    classes?: Array<{
        name: string;
        purpose: string;
        location: string;
        methods: string[];
        isExported: boolean;
    }>;
    /** Frontend-backend integrations */
    integrations?: Array<{
        description: string;
        frontendComponent: string;
        backendEndpoint: string;
        dataFlow: string;
    }>;

    /** Additional metadata (flexible for future extensions) */
    [key: string]: any;
}

/**
 * Task analysis for deep technical assessment
 * Provides structured analysis before implementation
 */
export interface TaskAnalysis {
    /** Analysis identifier (UUID) */
    analysisId: string;
    /** Task identifier */
    taskId: string;
    /** Summary of task objectives and scope */
    summary: string;
    /** Initial concept and technical approach */
    initialConcept: string;
    /** Technical feasibility assessment */
    feasibility: {
        /** Overall feasibility rating (1-5, 5 being most feasible) */
        rating: number;
        /** Feasibility explanation */
        explanation: string;
        /** Identified risks and challenges */
        risks: string[];
        /** Mitigation strategies */
        mitigations: string[];
    };
    /** Structured technical analysis */
    technicalAnalysis: {
        /** Architectural approach */
        architecture: string;
        /** Key technical decisions */
        keyDecisions: string[];
        /** Dependencies and prerequisites */
        dependencies: string[];
        /** Pseudocode or high-level logic flow */
        pseudocode?: string;
    };
    /** Implementation strategy */
    implementationStrategy: {
        /** Step-by-step approach */
        steps: string[];
        /** Estimated complexity (low, medium, high) */
        complexity: 'low' | 'medium' | 'high';
        /** Testing strategy */
        testingApproach: string;
    };
    /** Previous analysis (for iterative refinement) */
    previousAnalysis?: string;
    /** Analysis timestamp */
    timestamp: Date;
    /** Agent or user who performed analysis */
    analyzedBy?: string;
}

/**
 * Task Reflection - Critical review and improvement suggestions
 * Used for quality assurance and approach optimization
 */
export interface TaskReflection {
    /** Reflection identifier (UUID) */
    reflectionId: string;
    /** Task identifier */
    taskId: string;
    /** Summary of task objectives and current approach */
    summary: string;
    /** Detailed analysis of implementation and approach */
    analysis: string;
    /** Quality assessment */
    qualityAssessment: {
        /** Completeness rating (1-5, 5 being most complete) */
        completeness: number;
        /** Code quality rating (1-5, 5 being highest quality) */
        codeQuality: number;
        /** Adherence to best practices (1-5, 5 being best) */
        bestPractices: number;
        /** Overall assessment notes */
        notes: string;
    };
    /** Identified strengths in current approach */
    strengths: string[];
    /** Identified weaknesses or concerns */
    weaknesses: string[];
    /** Improvement suggestions */
    improvements: string[];
    /** Alternative approaches to consider */
    alternatives?: string[];
    /** Reflection timestamp */
    timestamp: Date;
    /** Agent or user who performed reflection */
    reflectedBy?: string;
}

/**
 * Task definition following Shrimp's task management pattern
 */
export interface Task {
    /** Unique task identifier (UUID) */
    id: string;
    /** Parent quest identifier */
    questId: string;
    /** Task name/title */
    name: string;
    /** Detailed task description */
    description: string;
    /** Current execution status */
    status: TaskStatus;
    /** Assigned agent ID (optional) */
    assignedAgent?: string;
    /** Implementation guide (includes role, requirements, restrictions) */
    implementationGuide: string;
    /** Verification criteria (success criteria) */
    verificationCriteria: string;
    /** Task IDs this task depends on */
    dependencies: string[];
    /** Files related to this task */
    relatedFiles: RelatedFile[];
    /** Task creation timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
    /** Task start timestamp (optional) */
    startedAt?: Date;
    /** Task completion timestamp (optional) */
    completedAt?: Date;
    /** Artifacts produced during task execution (optional) */
    artifacts?: TaskArtifacts;
    /** Task analysis for technical assessment (optional) */
    analysis?: TaskAnalysis;
    /** Task reflection for quality review and improvement (optional) */
    reflection?: TaskReflection;
    /** Additional metadata (flexible for future extensions) */
    metadata?: Record<string, any>;
}

/**
 * Research State - Tracks technology exploration and solution research
 * Used for iterative research and knowledge building
 */
export interface ResearchState {
    /** Research identifier (UUID) */
    researchId: string;
    /** Quest identifier */
    questId: string;
    /** Research topic or question */
    topic: string;
    /** Previous research state (for iterative refinement) */
    previousState?: string;
    /** Current research findings and state */
    currentState: string;
    /** Next steps for continued research */
    nextSteps: string[];
    /** Research timestamp */
    timestamp: Date;
    /** Researcher identifier (agent or user) */
    researchedBy?: string;
}

/**
 * Conversation context for quest creation
 * Tracks where the quest originated for approval routing
 */
export interface ConversationContext {
    /** Platform where quest was created */
    platform: Platform;
    /** Channel or room ID */
    channelId: string;
    /** Thread ID for threaded conversations (optional) */
    threadId?: string;
    /** User ID who created the quest */
    userId: string;
}

/**
 * Approval decision record
 */
export interface ApprovalDecision {
    /** Unique approval identifier (UUID) */
    approvalId: string;
    /** Quest being approved */
    questId: string;
    /** Approval decision */
    decision: ApprovalDecisionType;
    /** User who made the decision */
    approvedBy: string;
    /** Platform where approval was made */
    approvedVia: Platform;
    /** Optional feedback/comments */
    feedback?: string;
    /** Timestamp of approval decision */
    timestamp: Date;
}

/**
 * Quest definition - main orchestration unit
 * Combines requirements, design, tasks, and approval workflow
 */
export interface Quest {
    /** Unique quest identifier (UUID) */
    questId: string;
    /** Human-readable quest name */
    questName: string;
    /** Brief description of the quest */
    description: string;
    /** Current quest status */
    status: QuestStatus;
    /** Requirements document (markdown) */
    requirements: string;
    /** Design document (markdown) */
    design: string;
    /** List of tasks (populated after quest_split_tasks) */
    tasks: Task[];
    /** History of approval decisions */
    approvalHistory: ApprovalDecision[];
    /** Original conversation context */
    conversationContext: ConversationContext;
    /** Quest creation timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
    /** Revision number (increments with quest_revise) */
    revisionNumber: number;
    /** Additional metadata (cancellation info, etc.) */
    metadata?: Record<string, any>;
    /** Research states for technology exploration (optional) */
    researchStates?: ResearchState[];
}

/**
 * Agent definition for task assignment
 */
export interface Agent {
    /** Unique agent identifier */
    agentId: string;
    /** Agent name */
    name: string;
    /** Agent role for capability matching */
    role: AgentRole;
    /** Specific capabilities (e.g., ["TypeScript", "React", "Node.js"]) */
    capabilities: string[];
    /** Current availability status */
    status: AgentStatus;
    /** Currently assigned task IDs */
    currentTasks: string[];
    /** Maximum concurrent tasks this agent can handle */
    maxConcurrentTasks: number;
    /** Last activity timestamp */
    lastSeen: Date;
}

/**
 * Quest template for rapid quest creation
 */
export interface QuestTemplate {
    /** Template name/identifier */
    name: string;
    /** Requirements document template */
    requirementsTemplate: string;
    /** Design document template */
    designTemplate: string;
    /** Pre-defined tasks template */
    tasksTemplate: any[];
}

/**
 * Implementation log entry for completed tasks
 * Creates a searchable knowledge base of what was implemented
 */
export interface ImplementationLogEntry {
    /** Unique log entry identifier (UUID) */
    logId: string;
    /** Quest identifier */
    questId: string;
    /** Task identifier */
    taskId: string;
    /** Task name */
    taskName: string;
    /** Summary of what was implemented */
    summary: string;
    /** Detailed implementation notes */
    details: string;
    /** Structured artifacts (API endpoints, components, functions, etc.) */
    artifacts: TaskArtifacts;
    /** Challenges encountered during implementation */
    challenges?: string;
    /** Solutions applied to overcome challenges */
    solutions?: string;
    /** Lessons learned for future reference */
    lessonsLearned?: string;
    /** Agent who implemented the task */
    implementedBy?: string;
    /** Timestamp when log was created */
    timestamp: Date;
}
