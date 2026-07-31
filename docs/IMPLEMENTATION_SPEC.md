# Paperloom bilingual Korean-paper viewer specification

## Goal

Make an unchanged English source paper and a saved Korean re-typeset easy to
read together. Korean is the only user-facing translation target in the first
release.

## Primary flow

1. The user opens a PDF.
2. Paperloom identifies it from a hash of the file contents.
3. The main viewer opens side by side: source on the left, Korean paper on the
   right. Both panes navigate independently and either pane can expand.
4. If an accepted Korean paper already exists, Paperloom restores it without
   translation. Otherwise the right pane shows `한국어 논문 만들기`.
5. Generation translates semantic sections with a paper-wide terminology brief,
   checkpoints completed work, composes a Korean PDF, validates it automatically,
   and applies it in the Korean pane without opening a modal.
6. The applied result, protected manual corrections, warnings, and Ask history
   are stored locally and restored on the next open.

## In scope

- PDF open, recent papers, and recent-title search.
- Independent source/Korean page, zoom, fit, rotate, and pane expansion controls.
- Named direct-API and Codex model profiles.
- Model profile and supported reasoning-effort switching in the main viewer.
- Digital-PDF semantic analysis into title, heading, prose, caption, footnote,
  equation, reference, running-furniture, and preserved-code concepts.
- One explicit whole-paper Korean generation action; no generation on open.
- Hierarchical section translation with a paper-wide translation brief,
  checkpoints, cancellation, retry, and protected manual corrections.
- Translation requests operate on logical paragraphs: physical PDF fragments
  split across columns or pages are joined before translation and rendered once
  from their first fragment. Paragraph starts are inferred from source
  indentation, vertical spacing, bold leads, and heading boundaries rather than
  capitalization alone, so a capitalized sentence may still continue across a
  page. Locked manual corrections remain merge barriers.
- Inline equations and citations are protected as immutable translation tokens.
  Korean rendering uses an embedded math-symbol fallback font so Greek letters
  and operators remain visible, while source bold leads and fully bold blocks
  retain their weight.
- The source title and author region is copied from the source page before the
  translated Abstract and body are composed, preserving its original positions,
  font weights, and mixed author/affiliation styling.
- Continuous Korean prose flow around source-registered figure, table, and code
  slots. Every source page has a corresponding Korean page, and each asset keeps
  its source page, coordinates, dimensions, and complete unclipped content.
  Prose-only continuation pages may be inserted when the remaining text cannot
  fit readably around those fixed slots.
- Automatic integrity blockers, visual warnings, inline post-generation
  translation editing, safe replacement candidates, and PDF export.
- Highlights, paper-level notes, contextual term lookup, and figure/table
  reference preview.
- One persistent paper-wide Ask thread with copy and save-as-note.
- Ask selected text as optional focus, never as the sole context.
- Native source-PDF Ask input when the selected API profile declares support;
  otherwise filtered paper-wide text or a cached hierarchical digest.
- Ask answers with verified source page/section evidence links when resolvable.
- SQLite persistence in Tauri and browser fallbacks for development.

## Removed

- Selection, current-page, page-range, and whole-document coordinate translation.
- Translation overlays, in-place source patching, and their translation list,
  edit, retry, masking, and progress UI.
- Ask selection/page/manual-block scope controls.
- Linked pane navigation and manual stacked layout. Narrow windows may stack
  responsively.
- Target-language selection.
- Watched folders, recursive scanning, tags, and missing-file management.
- OpenCode TOML configuration import.

Legacy local records for removed features are not deleted automatically.

## Explicitly out of scope

- OCR-backed Korean re-typesetting for scanned PDFs.
- Translation of equations, table cells, source code, or text inside figures.
- Cross-document RAG, embeddings, vector databases, clustering, or comparison.
- Cloud sync, accounts, and collaboration.
- Generic third-party ChatGPT OAuth. The optional Codex bridge delegates sign-in
  to the official local Codex interface.
- Pixel-identical prose pagination or freely floating assets that leave their
  source-corresponding page, coordinates, or dimensions.

## Important decisions

1. The source PDF remains authoritative and is never modified.
2. Source identity comes from exact PDF contents, not its name or path.
3. Korean generation and Ask share the active paper model, but switching a
   model never regenerates an accepted Korean paper implicitly.
4. Regeneration creates a candidate. The current result remains readable until
   the candidate succeeds and passes automatic integrity validation, after which
   it is applied atomically without a manual acceptance step.
5. Translation sends only translatable prose. Native-PDF Ask may send the whole
   PDF after disclosure, including metadata and references, while instructing
   the model not to use excluded material as answer evidence.
6. Native PDF upload is lazy on first Ask, reused per paper/provider, and remote
   deletion is requested when the project or provider connection is removed.
7. Paper-wide Ask context includes title, abstract, headings, body, explanatory
   footnotes, and captions; it excludes proceedings covers, affiliations,
   contacts, and bibliography from answer evidence.
8. Paper-wide context is never silently truncated. Oversize text uses a cached
   hierarchical section digest and discloses that fact in the UI.
9. Content-integrity failures block automatic application and export. Visual
   layout warnings remain visible but do not silently drop content.
10. The quality-guaranteed first target is digital English-to-Korean.
11. Figures, tables, and code listings remain in source-registered asset slots;
    only Korean prose reflows around them or onto continuation pages.
12. Registered title/author front matter establishes the shared body-flow start
    below that region. Equation and algorithm crops include a small stroke-safe
    margin so glyphs and rules outside the extracted text box are not clipped.
13. Page extraction and independent section translation use bounded parallelism;
    translation checkpoints are serialized before persistence.

## Completion checks

- Unit tests cover content identity, filtered paper-wide context, digest choice,
  provider PDF capability selection, evidence parsing, semantic extraction,
  source-registered asset placement, and provider response parsing.
- Reader-state tests verify independent panes and no persisted sync dependency.
- Reopening the same PDF bytes from another path restores the accepted Korean
  paper and project.
- A production frontend build succeeds.
- A generated multi-page Korean PDF contains selectable Korean text, preserved
  assets/code, and no integrity blockers before export.
- The main screen is visually exercised in empty-Korean, generating, restored,
  expanded-pane, Ask, and inline-editing states.
- Tauri source compiles when the Rust toolchain is available.
