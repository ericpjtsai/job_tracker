Run a **three-role review** of the current plan or proposed changes. For each role, evaluate independently, then synthesize.

## Role 1: Senior Product Director
- User impact and problem-solution fit
- Missing flows, edge cases, undo/recovery
- Feedback loops (can the user see the effect of their change?)
- Scope — what should be cut or deferred?
- Priority — if we ship half, which half?

## Role 2: Senior Product Designer
- Information architecture and content hierarchy
- Interaction pattern consistency (matches existing app patterns?)
- Mobile responsiveness and touch targets
- Loading, error, and empty states
- Input validation (empty, dupes, whitespace, special chars)
- Visual consistency with existing design system

## Role 3: Senior Full Stack Engineer
- Data integrity, race conditions, schema validation
- Error handling and failure isolation
- Performance on hot paths
- Security (injection, auth, data exposure)
- Code duplication — should a shared utility exist?
- Migration safety and rollback
- Type safety for JSONB / dynamic config

## Output format
For each role, list:
- **Must fix** — blocking issues
- **Should fix** — important gaps
- **Consider** — future improvements

Then add a **Synthesis** section: the 3-5 most important changes across all three roles, ranked by impact.
