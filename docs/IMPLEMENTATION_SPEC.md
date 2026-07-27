# Paperloom MVP completion specification

## Goal

Complete the local-first MVP described in the original product brief while
preserving the existing PDF reader and synchronized split-view behavior.

## In scope

- Library folders, recursive PDF discovery, rescan, missing-file state, search,
  recent documents, and user tags.
- PDF.js text extraction into normalized document blocks with basic title,
  heading, paragraph, caption, footnote, and unknown classification.
- OpenAI-compatible provider settings stored locally.
- Block translation for a selection, page, page range, or whole document;
  progress, cancellation between batches, retry, cache, editing, masking, and
  in-place re-typesetting.
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
- Exporting a newly typeset translated PDF.
- Cross-document RAG, embeddings, vector databases, clustering, or comparison.
- Cloud sync, accounts, collaboration, or OAuth providers.

## Important decisions

1. The PDF remains the source of truth and is never modified.
2. All page geometry is stored as normalized coordinates.
3. Translation is re-typeset in place: an HTML page layer samples and masks the
   source-text background, then fits translated text back into the same geometry.
   Annotation overlays remain separate, and PDF.js still controls zoom/rotation.
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

## Completion checks

- Existing reader-state tests remain green.
- Pure block extraction, reference detection, and provider response parsing are
  covered by unit tests.
- Production frontend build succeeds.
- A generated multi-page PDF can be opened and exercised in single, split,
  translated, annotated, and question-tool states.
- Tauri source compiles when the Rust toolchain is available.
