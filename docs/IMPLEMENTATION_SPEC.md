# Paperloom semantic re-typesetting specification

## Goal

Preserve the local-first PDF reader while adding a separate, reviewable Korean
translation re-typeset that reads like a composed academic paper.

## In scope

- Library folders, recursive PDF discovery, rescan, missing-file state, search,
  recent documents, and user tags.
- PDF.js text extraction into normalized document blocks with basic title,
  heading, paragraph, caption, footnote, and unknown classification.
- OpenAI-compatible provider settings stored locally.
- Named model connection profiles with secrets stored separately from project
  data, plus an optional beta Codex-session bridge.
- Block translation for a selection, page, page range, or whole document;
  progress, cancellation between batches, retry, cache, editing, masking, and
  in-place re-typesetting.
- Semantic section analysis and hierarchical section translation independent of
  source page boundaries.
- A resumable local re-typeset project with protected manual corrections and
  section checkpoints.
- Korean academic typography, source page size and column-count preservation,
  anchored vector figure/table regions, and source-preserving equation handling.
- Side-by-side review with integrity blockers, visual warnings, direct
  translation editing, and translated PDF export.
- A one-time, size-disclosed Korean typesetting package installed locally.
- Word lookup using the configured provider with a local context cache.
- Figure/Table reference detection and caption-target preview.
- Original/translation highlights and document/page/selection notes.
- Questions over selected text, the current page, or chosen blocks, with
  incremental answer display, history, source display, copy, and save-as-note.
- Persistence in SQLite in Tauri and a browser local-storage fallback for
  development.

## Explicitly out of scope

- OCR for scanned PDFs.
- Translation of equations, table cells, or text inside figures.
- Cross-document RAG, embeddings, vector databases, clustering, or comparison.
- Cloud sync, accounts, and collaboration.
- Generic third-party ChatGPT OAuth. The beta Codex bridge delegates sign-in to
  the official local Codex interface.

## Important decisions

1. The PDF remains the source of truth and is never modified.
2. All page geometry is stored as normalized coordinates.
3. In-place HTML reflow remains a fast reading aid. A final translated document
   is created from a semantic paper model as a separate PDF.
4. The LLM adapter has one small interface and uses a Tauri HTTP command in the
   desktop app; browser development uses `fetch`.
5. API keys are local settings and are never logged or included in repository
   files.
6. A scanned/empty-text page remains readable but reports that text tools are
   unavailable.
7. Translation cancellation is cooperative between batches. An already
   submitted provider request may finish, but no later batch is sent.
8. The first Figure/Table preview may show a generous region around the matched
   caption when a precise object boundary cannot be inferred.
9. Re-typeset translation operates on a top-level section and all descendant
   subsections as one context; oversize sections split only at subsection seams.
10. Missing translations, damaged assets/equations, and broken links block
    export. Spacing and pagination warnings may be acknowledged.
11. The quality-guaranteed first target is digital English-to-Korean. Scanned
    and image-only PDFs remain unsupported.
12. Exported PDFs carry a restrained unofficial-translation note and metadata.

## Completion checks

- Existing reader-state tests remain green.
- Pure block extraction, reference detection, and provider response parsing are
  covered by unit tests.
- Production frontend build succeeds.
- Semantic analysis, section grouping, review validation, and PDF layout are
  covered by pure tests.
- A generated multi-page PDF can be opened and exercised in single, split,
  translated, annotated, and question-tool states.
- A Korean re-typeset fixture renders with selectable Korean text, intact
  preserved assets, and no integrity blockers before export.
- Tauri source compiles when the Rust toolchain is available.
