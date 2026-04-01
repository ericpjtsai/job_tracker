Run a **three-role review** of the current plan or proposed changes. Each role should evaluate independently with full depth, then synthesize.

Read the full role definitions from these files before evaluating — they contain project-specific context, established patterns, known tech debt, and anti-patterns:

1. `.claude/commands/review-product.md` — Senior Product Director
2. `.claude/commands/review-design.md` — Senior Product Designer  
3. `.claude/commands/review-eng.md` — Senior Full Stack Engineer / Tech Lead

## Process

### Step 1: Product Director review
Evaluate user impact, flow completeness, feedback loops, scope management, mental model alignment, and prioritization. Flag anti-patterns (over-engineering for one user, building admin UIs for rarely-changed config). Recommend what to cut.

### Step 2: Design review
Evaluate against the established pattern library (middot separators, pill toggles, tag editors, collapsible cards, loading spinners, inline confirmation, toast feedback). Check mobile responsiveness, input validation, accessibility, visual consistency. Flag any pattern violations.

### Step 3: Engineering review
Evaluate data integrity (race conditions, dedup safety, schema validation), error handling, performance on hot paths, security (regex injection, XSS, auth), code duplication, migration safety, type safety, and observability. Reference known tech debt (maybeSingle bug, Gemini SDK, vestigial columns).

## Output format

For each role, provide:
- **Must fix** — blocking issues that would cause confusion, bugs, or security problems
- **Should fix** — important gaps that degrade the experience or reliability
- **Consider** — future improvements and polish

Then add:

### Synthesis
The **5 most important changes** across all three roles, ranked by impact. For each:
1. What the issue is
2. Which role(s) flagged it
3. The recommended fix
4. Effort estimate (trivial / small / medium / large)

### Verdict
One of:
- **Ship it** — plan is solid, proceed with implementation
- **Ship with fixes** — proceed but address the Must Fix items first
- **Rethink** — fundamental issues that need a different approach
