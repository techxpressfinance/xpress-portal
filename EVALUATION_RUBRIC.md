# Evaluation Rubric — INTERNAL ONLY

> ⚠️ **Delete this file before sending the exercise to a candidate.**

Score each area 1–5. The point isn't a perfect total — it's a consistent lens
across candidates and a structure for the follow-up conversation.

## 1. Correctness (×2 weight)
- [ ] Part 1: status filter works; invalid status → 400 (not crash / not ignored)
- [ ] Part 1: all three sorts work; null `due_date` ordering is deliberate + documented
- [ ] Part 2: every legal transition allowed; every illegal one → 400 with a message
- [ ] Part 2: closed is terminal
- [ ] Part 3: create works and refreshes; empty title is blocked
- [ ] Part 4: filter re-fetches via the backend param (not just client-side hiding)

**Tell:** A junior dev who only builds the happy path scores low here. Handling
invalid input and error states is the strongest signal at this level.

## 2. Code quality & fit (×2 weight)
- [ ] Followed existing patterns (lookup tables, `api` client, shared types, schema validation)
- [ ] No copy-paste duplication; reasonable naming
- [ ] Backend validation lives in the right layer (schema/route, not scattered)
- [ ] TypeScript used meaningfully (no stray `any`, types reused from `types/index.ts`)

**Tell:** Did they *read* the codebase and blend in, or bolt on a different style?
This predicts day-to-day maintainability better than raw cleverness.

## 3. Engineering judgment
- [ ] Stayed within scope (~4h); didn't gold-plate
- [ ] Bonus, if attempted, was finished — not three half-done extras
- [ ] `SOLUTION.md` explains decisions and trade-offs honestly
- [ ] Sensible commit history (incremental, readable messages)

## 4. Communication
- [ ] Clear write-up; states assumptions
- [ ] If they emailed questions, were they good questions (specific, after trying)?

## Red flags
- Edits the `TODO`s away without implementing them.
- Status transition "validation" that's actually a no-op or lets closed reopen.
- Reformats/rewrites the whole repo to their taste (ignores existing conventions).
- One giant commit, or code that doesn't run as submitted.
- `SOLUTION.md` / comments don't match what the code actually does (possible
  unowned AI output — probe in the live session).

## Follow-up live session (~30 min) — do this for anyone you'd consider
1. Walk me through your solution.
2. Why did you order null due dates that way?
3. **Live change:** "Add an `assignee` field end-to-end" or "add a `reopened`
   status with rules." Watch them navigate *their own* code and the repo.

The live change is the single best signal — it confirms ownership of the
submission and shows how they'd actually work with you.
