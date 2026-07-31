# ADR 0006: Move frontend workflows behind deep modules

- Status: Accepted
- Date: 2026-07-28

Paperloom will treat `App.tsx` as the composition root and top-level UI rather
than the owner of application workflows. Document session management, Korean
paper creation, and paper-wide Ask will each move behind a deep module with a
small state-and-command interface.

The workflow cores will remain independent of React and will connect to the UI
through thin hooks. Only effectful capabilities such as model access, project
storage, PDF generation, file export, and cancellation will be injected;
pure calculations remain ordinary imports. Each module owns its asynchronous
ordering, cancellation, stale-result rejection, and stable failure states.

This refactoring must preserve current behavior. Characterization tests will
lock down consent, checkpoints, atomic candidate application, persistence, and
document-switch cancellation before orchestration moves out of `App.tsx`.
`retypeset-pdf.ts` and the Rust backend will not be split merely because of
their size during this phase. Unused legacy source interfaces may be removed,
but existing local records will not be migrated or deleted.
