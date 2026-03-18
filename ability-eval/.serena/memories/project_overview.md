# ability-eval — Project Overview

## Purpose
Stateless evaluation engine ability for KĀDI. Analyzes code diffs, test results, logs, behavior traces, and UI screenshots. Produces structured scores, pass/fail verdicts, and improvement suggestions.

## Tech Stack
- TypeScript, Node.js 18+, ESM modules
- @kadi.build/core (KadiClient, z/zod)
- model-manager gateway for all LLM calls (OpenAI-compatible API)
- Supports multimodal (vision) models for visual evaluation

## Structure
Single-file ability: `index.ts`

## Tools (9 total)
### Text-based evaluation:
- `eval_code_diff` — code diff quality review
- `eval_test_results` — test output analysis
- `eval_logs` — log anomaly detection
- `eval_behavior_trace` — agent behavior analysis
- `eval_task_completion` — requirements vs deliverables
- `eval_custom` — user-defined rubric
- `eval_compare` — compare two solutions

### Visual evaluation (task 4.52):
- `eval_visual` — screenshot vs UI requirements (layout, readability, accessibility)
- `eval_visual_regression` — before/after screenshot comparison with regression detection

## Key Patterns
- All LLM calls via model-manager `/v1/chat/completions`
- JSON response format with verdict/score/criteria/suggestions
- `imageToContentBlock()` converts file path/URL/base64/data URI to OpenAI vision format
- Configurable pass threshold for visual regression (default 80)
