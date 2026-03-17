# M7 Tasks Document — Clean Up, Documentation, Presentation

## Milestone Overview

| Milestone | Focus | Tasks | Est. Hours |
|-----------|-------|-------|------------|
| M7 | Code Cleanup, Documentation Updates, Technical Design Document, Thesis Defense Materials | 18 | 56.0 - 84.0 |

## Task Groups

| Group | Tasks | Focus | Est. Hours |
|-------|-------|-------|------------|
| Code Cleanup and Refactoring | 7.1 - 7.5 | Remove experimental code, eliminate duplication, add tests, resolve TODOs | 12.0 - 18.0 |
| Documentation Updates | 7.6 - 7.9 | Steering docs, README.md, CLAUDE.md, consistency review | 12.0 - 18.0 |
| Technical Design Document (TDD) | 7.10 - 7.14 | Architecture docs, API docs, research methodology, evaluation, future work | 16.0 - 24.0 |
| Thesis Defense Materials | 7.15 - 7.18 | Slides, demo video, practice, Q&A preparation | 16.0 - 24.0 |

## Important Dates

| Date | Event |
|------|-------|
| April 15, 2026 | M7 Start |
| April 28, 2026 | M7 End |
| May 5-7, 2026 | Thesis Defense |
| May 8, 2026 | Thesis Exhibition |

---

- [ ] 7.1. Remove experimental and dead code
  - File: Various files across all repositories
  - Audit all repositories for experimental code, unused imports, commented-out code, and dead code paths
  - Remove all identified dead code while preserving functionality
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Clean codebase for thesis submission
  - _Leverage: All repository source code_
  - _Requirements: M6 complete, all features stable_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Senior Developer with expertise in code cleanup | Task: Audit all repositories for experimental code, unused imports, commented-out code, and dead code paths, removing all identified dead code while preserving functionality | Restrictions: Must not break any existing functionality, run tests after each removal, document what was removed | Success: No experimental or dead code remains, all tests pass, removal documented_

- [ ] 7.2. Refactor duplicated logic
  - File: Various files across all repositories
  - Identify and refactor duplicated logic across repositories into shared modules in agents-library
  - Apply DRY principle systematically
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Eliminate code duplication
  - _Leverage: agents-library (shared module target)_
  - _Requirements: 7.1 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Senior Developer with expertise in refactoring | Task: Identify and refactor duplicated logic across repositories into shared modules in agents-library, applying DRY principle systematically | Restrictions: Must maintain backward compatibility, move shared logic to agents-library, update all consumers | Success: Duplication eliminated, shared modules in agents-library, all consumers updated_

- [ ] 7.3. Add comprehensive tests
  - File: Various test files across all repositories
  - Add unit tests and integration tests to achieve >80% test coverage across all repositories
  - Focus on critical paths: task execution, KĀDI communication, quest workflow
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Ensure code quality for thesis
  - _Leverage: Existing test infrastructure_
  - _Requirements: 7.2 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA Engineer with expertise in test coverage | Task: Add unit tests and integration tests to achieve >80% test coverage across all repositories, focusing on critical paths (task execution, KĀDI communication, quest workflow) | Restrictions: Must cover critical paths first, use existing test frameworks, include both positive and negative test cases | Success: Test coverage >80%, critical paths fully tested, all tests pass_

- [ ] 7.4. Resolve all TODO/FIXME comments
  - File: Various files across all repositories
  - Search for and resolve all TODO, FIXME, HACK, and XXX comments across all repositories
  - Either implement the TODO or remove it with justification
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Clean up technical debt markers
  - _Leverage: All repository source code_
  - _Requirements: 7.1 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Senior Developer with expertise in technical debt resolution | Task: Search for and resolve all TODO, FIXME, HACK, and XXX comments across all repositories, either implementing the TODO or removing it with justification | Restrictions: Must document resolution for each TODO, do not leave any unresolved, test after each change | Success: No TODO/FIXME/HACK/XXX comments remain, all resolutions documented_

- [ ] 7.5. Code review and polish
  - File: Various files across all repositories
  - Perform final code review across all repositories for code style consistency, naming conventions, and documentation
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Final code quality pass
  - _Leverage: structure.md coding standards_
  - _Requirements: 7.1-7.4 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Senior Developer with expertise in code review | Task: Perform final code review across all repositories for code style consistency, naming conventions, and documentation quality | Restrictions: Must check all repositories, ensure consistent style, verify all public APIs are documented | Success: Code style is consistent, naming conventions followed, all public APIs documented_

- [ ] 7.6. Revise steering documents (product.md, tech.md, structure.md)
  - File: C:\GitHub\AGENTS\.spec-workflow\steering\
  - Update product.md, tech.md, and structure.md to reflect final system state after M6
  - Ensure all architecture decisions, technology choices, and project structure are accurately documented
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Ensure steering documents are current
  - _Leverage: C:\GitHub\AGENTS\.spec-workflow\steering\_
  - _Requirements: M6 complete_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Writer with expertise in architecture documentation | Task: Update product.md, tech.md, and structure.md to reflect final system state after M6, ensuring all architecture decisions, technology choices, and project structure are accurately documented | Restrictions: Must reflect actual system state, update all diagrams, verify all references are correct | Success: Steering documents accurately reflect final system, all diagrams updated, references correct_

- [ ] 7.7. Update all README.md files in child projects
  - File: Various README.md files
  - Update README.md in all child projects (agent-worker, shadow-agent-worker, agent-producer, mcp-server-quest, mcp-client-quest, agents-library, ability-file-management, agent-worker-python, DaemonAgent)
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Ensure all project documentation is current
  - _Leverage: structure.md documentation patterns_
  - _Requirements: M6 complete_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Writer with expertise in developer documentation | Task: Update README.md in all child projects to reflect final system state, including setup instructions, usage examples, and architecture overview | Restrictions: Must follow structure.md patterns, verify all instructions work, include up-to-date examples | Success: All README.md files updated, instructions work, examples are accurate_

- [ ] 7.8. Update all CLAUDE.md files in child projects
  - File: Various CLAUDE.md files
  - Update CLAUDE.md in all child projects with current key files, common tasks, and patterns
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Ensure AI assistant context is current
  - _Leverage: structure.md documentation patterns_
  - _Requirements: 7.7 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Writer with expertise in AI context documentation | Task: Update CLAUDE.md in all child projects with current key files, common tasks, and patterns for AI assistant context | Restrictions: Must reflect actual file structure, include common development tasks, document key patterns | Success: All CLAUDE.md files updated, key files listed correctly, common tasks documented_

- [ ] 7.9. Documentation consistency review
  - File: All documentation files
  - Review all documentation across all repositories for consistency in terminology, formatting, and cross-references
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Ensure documentation consistency
  - _Leverage: All documentation files_
  - _Requirements: 7.6-7.8 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Editor with expertise in documentation consistency | Task: Review all documentation across all repositories for consistency in terminology, formatting, and cross-references | Restrictions: Must check all cross-references, verify consistent terminology, ensure formatting matches structure.md | Success: Documentation is consistent across all repositories, no broken references, terminology unified_

- [ ] 7.10. Write architecture documentation for TDD
  - File: C:\GitHub\AGENTS\Docs\tdd\architecture.md
  - Write comprehensive architecture documentation covering system overview, component interactions, data flow, and deployment topology
  - Include architecture diagrams (Mermaid or similar)
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Architecture section of Technical Design Document
  - _Leverage: product.md, tech.md, structure.md, design.md_
  - _Requirements: 7.6 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Software Architect with expertise in technical documentation | Task: Write comprehensive architecture documentation covering system overview, component interactions, data flow, deployment topology, and technology stack with architecture diagrams | Restrictions: Must be academically rigorous, include diagrams, reference actual implementation | Success: Architecture documentation is comprehensive, diagrams are clear, suitable for thesis_

- [ ] 7.11. Write API documentation for TDD
  - File: C:\GitHub\AGENTS\Docs\tdd\api.md
  - Write comprehensive API documentation covering KĀDI broker API, MCP tool interfaces, agent registration protocol, and event schemas
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: API section of Technical Design Document
  - _Leverage: M4 API documentation (task 4.17)_
  - _Requirements: 7.10 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Writer with expertise in API documentation | Task: Write comprehensive API documentation covering KĀDI broker API, MCP tool interfaces, agent registration protocol, and event schemas for the Technical Design Document | Restrictions: Must be academically rigorous, include request/response examples, document all protocols | Success: API documentation is comprehensive, all interfaces documented, suitable for thesis_

- [ ] 7.12. Write research methodology section for TDD
  - File: C:\GitHub\AGENTS\Docs\tdd\methodology.md
  - Write research methodology section covering design decisions, evaluation approach, and comparison with related work
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Methodology section of Technical Design Document
  - _Leverage: Development plan, spec-workflow documents_
  - _Requirements: None_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Academic Researcher with expertise in thesis writing | Task: Write research methodology section covering design decisions, evaluation approach, comparison with related work (AutoGPT, CrewAI, LangGraph), and justification for architectural choices | Restrictions: Must be academically rigorous, cite related work, justify all design decisions | Success: Methodology section is rigorous, design decisions justified, related work compared_

- [ ] 7.13. Write evaluation results section for TDD
  - File: C:\GitHub\AGENTS\Docs\tdd\evaluation.md
  - Write evaluation results section documenting system performance, scalability, and capability metrics
  - Include benchmark results, workflow success rates, and cross-language communication metrics
  - Time Estimate: [3.0, 4.0] hours
  - Purpose: Evaluation section of Technical Design Document
  - _Leverage: M3-M6 completion reports, test results_
  - _Requirements: M6 complete_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Academic Researcher with expertise in evaluation | Task: Write evaluation results section documenting system performance, scalability, capability metrics, benchmark results, workflow success rates, and cross-language communication metrics | Restrictions: Must include quantitative metrics, present results objectively, discuss limitations | Success: Evaluation section includes metrics, results are objective, limitations discussed_

- [ ] 7.14. Write future work section for TDD
  - File: C:\GitHub\AGENTS\Docs\tdd\future-work.md
  - Write future work section identifying potential improvements, extensions, and research directions
  - Time Estimate: [1.0, 2.0] hours
  - Purpose: Future work section of Technical Design Document
  - _Leverage: M3-M6 completion reports, known limitations_
  - _Requirements: 7.13 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Academic Researcher with expertise in thesis writing | Task: Write future work section identifying potential improvements, extensions, and research directions based on system limitations and emerging technologies | Restrictions: Must be realistic, reference actual limitations, suggest concrete next steps | Success: Future work section identifies meaningful directions, grounded in actual limitations_

- [ ] 7.15. Create defense slides (30-40 slides)
  - File: C:\GitHub\AGENTS\Docs\defense\slides.pptx
  - Create 30-40 defense slides covering: Introduction, Problem Statement, Related Work, Architecture, Implementation, Evaluation, Demo, Conclusion, Future Work
  - Time Estimate: [6.0, 8.0] hours
  - Purpose: Thesis defense presentation
  - _Leverage: TDD sections from tasks 7.10-7.14_
  - _Requirements: 7.10-7.14 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Academic Presenter with expertise in thesis defense | Task: Create 30-40 defense slides covering Introduction, Problem Statement, Related Work, Architecture, Implementation, Evaluation, Demo, Conclusion, and Future Work | Restrictions: Must be visually clean, include architecture diagrams, keep text minimal on slides, include speaker notes | Success: Slides are professional, cover all required sections, suitable for 30-minute defense_

- [ ] 7.16. Record demo video (10-15 minutes)
  - File: C:\GitHub\AGENTS\Docs\defense\demo-video.mp4
  - Record 10-15 minute demo video showing complete system capabilities
  - Cover: quest creation, multi-agent orchestration, cross-language agents, DaemonAgent integration, dashboard monitoring
  - Time Estimate: [4.0, 6.0] hours
  - Purpose: Thesis defense demo
  - _Leverage: Working system, M4 demo video (shorter version)_
  - _Requirements: System fully operational_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical Presenter with expertise in demo creation | Task: Record 10-15 minute demo video showing complete system capabilities including quest creation, multi-agent orchestration, cross-language agents, DaemonAgent integration, and dashboard monitoring | Restrictions: Must be professional quality, show real system operation, include narration, cover all major features | Success: Demo video recorded, covers all features, professional quality, suitable for thesis defense_

- [ ] 7.17. Practice presentations (3+ times)
  - File: C:\GitHub\AGENTS\Docs\defense\practice-notes.md
  - Practice defense presentation at least 3 times, documenting timing, weak points, and improvements
  - Time Estimate: [3.0, 5.0] hours
  - Purpose: Prepare for thesis defense
  - _Leverage: Defense slides from task 7.15_
  - _Requirements: 7.15, 7.16 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Academic Presenter | Task: Practice defense presentation at least 3 times, documenting timing for each section, identifying weak points, and making improvements after each practice | Restrictions: Must practice full presentation including demo, time each section, document improvements | Success: Presentation practiced 3+ times, timing documented, weak points addressed_

- [ ] 7.18. Prepare Q&A materials
  - File: C:\GitHub\AGENTS\Docs\defense\qa-preparation.md
  - Prepare Q&A materials anticipating likely questions about architecture decisions, scalability, security, comparison with alternatives, and limitations
  - Time Estimate: [2.0, 3.0] hours
  - Purpose: Prepare for thesis defense Q&A
  - _Leverage: TDD sections, known limitations_
  - _Requirements: 7.15 completed_
  - _Prompt: Implement the task for spec M7-cleanup-documentation-presentation, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Academic Researcher with expertise in thesis defense | Task: Prepare Q&A materials anticipating likely questions about architecture decisions, scalability, security, comparison with alternatives (AutoGPT, CrewAI, LangGraph), and limitations | Restrictions: Must cover technical, methodological, and practical questions, prepare concise answers, include backup slides | Success: Q&A materials comprehensive, answers are concise, backup slides prepared_
