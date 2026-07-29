# ADR 0004: Generate and edit the Korean paper inside its viewer pane

- Status: Accepted
- Date: 2026-07-28
- Supersedes: ADR 0001 and ADR 0002 clauses requiring manual review and acceptance

## Context

The source paper already remains visible on the left and the generated Korean
paper can be corrected after generation. A full-screen review dialog repeats the
same comparison, interrupts reading, and adds a manual acceptance step without
improving the normal workflow.

## Decision

- `한국어 논문 만들기` starts font preparation, whole-paper translation,
  composition, and validation directly in the Korean pane.
- A candidate that passes automatic integrity validation replaces the current
  Korean PDF atomically. No review modal or manual acceptance action is required.
- During regeneration the current Korean PDF remains readable.
- Integrity failures keep the current PDF and surface an error. Visual warnings
  do not block application.
- `내용 수정` opens an editor inside the Korean pane. Saved corrections are
  locked and protected from later regeneration.
- Export and regeneration remain direct Korean-pane actions.

## Consequences

- First-time generation requires one user action instead of a multi-step modal.
- The application needs explicit inline progress for font installation,
  translation checkpoints, composition, and application.
- Automatic validation becomes the sole replacement gate and therefore must
  fail closed for missing or damaged content.
- Manual corrections remain available without making every generation a review
  task.
