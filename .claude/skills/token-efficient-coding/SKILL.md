---
name: token-efficient-coding
description: Enforces token-efficient, production-grade coding behavior for agents. Optimized for diff-only edits, deterministic reviews, debugging, and test generation with minimal output tokens.
---

# Token-Efficient Coding Behavior

## Core Principle

Produce correct, minimal code changes with minimal tokens. Favor unified diffs, deterministic output formats, and implicit reasoning.

---

## Default Behavior (Always Apply)

**Output constraints:**
- Do not restate the user's prompt
- Do not provide background or tutorials unless asked
- Do not offer alternatives unless requested
- Prefer small, targeted edits over full rewrites
- Keep explanations to **one sentence max** unless required for correctness

---

## Output Formats by Task Type (Mandatory)

| Task | Output Format |
|-----|---------------|
| Bug fix | `file:line` → 1-sentence root cause → unified diff |
| Refactor | unified diff only (≤120 lines) |
| Code review | exactly 8 bullets: 3 bugs, 3 improvements, 2 questions (≤14 words each) |
| Tests | only new or modified test files |
| Simple code generation | code only, no commentary |

---

## Blocked Protocol (Strict)

If missing information prevents progress, output **only**:

```
BLOCKED: <one-line reason>
- <required input 1>
- <required input 2>
```

No additional text.

---

## Task-Specific Rules

### Bug Hunting
1. Output suspected `file:line`
2. One-sentence root cause
3. Minimal unified diff patch
4. No additional explanation

### Refactoring
- Unified diff format only
- ≤120 lines of change
- Preserve behavior unless explicitly requested
- Match existing code style (naming, logging, error handling)

### Code Review
- Exactly 8 bullets
- 3 bugs, 3 improvements, 2 questions
- Each bullet ≤14 words
- Focus on correctness, security, and maintainability

### Writing Tests
- Output only new or modified test files
- Match existing test style and helpers
- Cover only the relevant change

---

## Reasoning Policy

Keep reasoning implicit.

Surface reasoning **only** when required for correctness in:
- concurrency or race conditions
- distributed systems
- security-sensitive changes
- tricky invariants or correctness constraints

---

## Batch Processing

When multiple tasks are provided:
- Process all tasks in **one response**
- Clearly label each section (e.g., `--- a.ts ---`, `STEP A`)
- Stop immediately if blocked on any task
- Output the smallest viable change per task

---

## Model Selection Guidance

- **Cheaper models**: scanning, pattern matching, simple generation, option listing
- **Mid-tier models**: constrained refactors, optimizations
- **Top-tier models**: distributed systems, idempotency, race conditions, architecture

---

## Pattern Matching

When an example is provided:
1. Match its structure, naming, and conventions
2. Apply the same patterns to the new requirement
3. Output only new code or unified diff
4. Do not explain the patterns used

---

## Quality Checklist

All output must:
- Match repository conventions
- Prefer standard library and existing dependencies
- Include tests for bug fixes when feasible
- Build successfully (or state why not)
- Never introduce secrets or credentials

If security impact exists, flag it in **exactly one bullet**.

---

## Output Examples

### Bug Fix

```
src/utils/parser.ts:42
Array accessed without bounds check after empty input case.

diff --git a/src/utils/parser.ts b/src/utils/parser.ts
index 123..456 789
--- a/src/utils/parser.ts
+++ b/src/utils/parser.ts
@@ -40,7 +40,7 @@ export function parseTokens(input: string): Token[] {
-  if (input.length === 0) return [];
+  if (!input?.length) return [];
   return input.split(',').map(s => s.trim());
 }
```

### Code Review

```
Bugs:
- Missing null check on line 23
- Race condition in concurrent updates
- SQL injection via user input

Improvements:
- Add type guards for validation
- Extract magic numbers to constants
- Use async/await instead of callbacks

Questions:
- Should this cache results?
- Is retry logic needed?
```

### Refactor

```
diff --git a/src/service.ts b/src/service.ts
[unified diff, <120 lines]
```

### Tests

```ts
// Only new or modified test files
import { describe, it, expect } from 'vitest';
[...]
```
