---
name: aro-local-ci-gate
description: Enforce mandatory local CI gate before every push. Blocks push if lint,
  typecheck, unit tests, or integration tests fail. Required for all ARO contributors
  and AI agents. NO EXCEPTIONS.
---

# ARO Local CI Gate (MANDATORY)

This skill enforces the mandatory local CI gate defined in `docs/implementation/IMPLEMENTATION-PLAN.md` Section 5.1.

## Mandatory Rule

**Before EVERY push to ANY remote branch, you MUST run:**

```bash
npm run lint && npm run typecheck && npm run test && npm run test:integration
```

### Enforcement Requirements

1. **Block push** if any command fails
2. **Re-run gate** after rebasing/merging from main
3. **No bypass** for urgent/minor changes
4. **Remote CI is still required** (local gate is additive)

## Commands Breakdown

### 1. Lint Check

```bash
npm run lint
```

**What it checks:**
- Code style consistency (ESLint)
- Unused imports/variables
- Potential bugs (no-unused-expressions, etc.)
- Import ordering
- TypeScript-specific rules

**If it fails:**
```bash
# Auto-fix what's possible
npm run lint:fix

# Then manually fix remaining issues
```

### 2. Type Check

```bash
npm run typecheck
```

**What it checks:**
- TypeScript strict mode compliance
- Type inference correctness
- Null/undefined handling
- Generic type constraints
- Module resolution

**If it fails:**
- Read the error message carefully
- Fix type mismatches
- Add proper type annotations
- Handle null/undefined cases explicitly

### 3. Unit Tests

```bash
npm run test
```

**What it checks:**
- All unit tests pass
- Business logic correctness
- Repository operations
- Utility functions
- Validation schemas

**If it fails:**
```bash
# Run specific test file
npm run test -- path/to/test.ts

# Run with verbose output
npm run test -- --reporter=verbose

# Update snapshots (only if intentional)
npm run test -- --update
```

### 4. Integration Tests

```bash
npm run test:integration
```

**What it checks:**
- Database operations
- API endpoint functionality
- External adapter behavior (mocked)
- Workflow execution
- State machine transitions

**If it fails:**
- Check database connection
- Verify test environment setup
- Look at test logs for details
- Check for race conditions

## Git Hook Setup

### Pre-Push Hook Script

Create `.git/hooks/pre-push`:

```bash
#!/bin/bash

echo "Running ARO local CI gate..."

# Run lint
echo "==> Running lint..."
npm run lint
if [ $? -ne 0 ]; then
    echo "❌ Lint failed. Push blocked."
    exit 1
fi

# Run typecheck
echo "==> Running typecheck..."
npm run typecheck
if [ $? -ne 0 ]; then
    echo "❌ TypeCheck failed. Push blocked."
    exit 1
fi

# Run unit tests
echo "==> Running unit tests..."
npm run test
if [ $? -ne 0 ]; then
    echo "❌ Unit tests failed. Push blocked."
    exit 1
fi

# Run integration tests
echo "==> Running integration tests..."
npm run test:integration
if [ $? -ne 0 ]; then
    echo "❌ Integration tests failed. Push blocked."
    exit 1
fi

echo "✅ All checks passed. Proceeding with push."
exit 0
```

### Install Hook

```bash
chmod +x .git/hooks/pre-push
```

## CI Gate for AI Agents

When an AI coding agent completes work, it MUST:

1. Run the full CI gate
2. Report results with pass/fail status
3. Fix any failures before declaring work complete
4. Include CI gate evidence in completion summary

### AI Agent Checklist

Before marking any work package complete:

- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run typecheck` passes with 0 errors
- [ ] `npm run test` passes with 0 failures
- [ ] `npm run test:integration` passes with 0 failures
- [ ] All new code has corresponding tests
- [ ] Coverage maintained above 80%

## Package.json Scripts

Ensure `package.json` has these scripts:

```json
{
  "scripts": {
    "lint": "eslint src --ext .ts --max-warnings 0",
    "lint:fix": "eslint src --ext .ts --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --coverage",
    "test:integration": "vitest run --config vitest.integration.ts",
    "test:watch": "vitest watch",
    "ci:local": "npm run lint && npm run typecheck && npm run test && npm run test:integration",
    "prepush": "npm run ci:local"
  }
}
```

## Failure Response Protocol

### When Lint Fails

1. Run `npm run lint:fix` for auto-fixes
2. Manually fix remaining issues
3. Re-run lint to verify
4. Do NOT proceed until clean

### When TypeCheck Fails

1. Read error message - TypeScript errors are usually clear
2. Fix the specific type issue
3. Common fixes:
   - Add null checks (`if (x === null) return`)
   - Add type annotations
   - Fix generic type parameters
   - Use type guards
4. Re-run typecheck to verify

### When Tests Fail

1. Run failing test in isolation for clearer output
2. Read the assertion error
3. Fix code OR update test if requirements changed
4. Re-run tests to verify
5. Ensure no regression in other tests

### When Integration Tests Fail

1. Check test database is running
2. Verify environment variables
3. Check for port conflicts
4. Look for race conditions
5. Debug with logging enabled

## Output Format

After running CI gate, report:

```
📊 ARO Local CI Gate Results

┌─────────────────────┬────────┬─────────────────────────┐
│ Check               │ Status │ Details                 │
├─────────────────────┼────────┼─────────────────────────┤
│ Lint                │ ✅/❌  │ X errors, Y warnings    │
│ TypeCheck           │ ✅/❌  │ X errors                │
│ Unit Tests          │ ✅/❌  │ X passed, Y failed      │
│ Integration Tests   │ ✅/❌  │ X passed, Y failed      │
└─────────────────────┴────────┴─────────────────────────┘

Coverage: XX%

Overall: ✅ PASS / ❌ FAIL - [reason if failed]
```

## Exemptions

**There are NO exemptions.** Not for:
- "Small changes"
- "Just fixing a typo"
- "It's urgent"
- "CI will catch it"
- "I'm the only developer"

The gate exists to protect production quality.
