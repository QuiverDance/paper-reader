# ADR 0001: Reconstruct translated papers from a semantic document model

- Status: Accepted
- Date: 2026-07-27

## Context

Paperloom originally translated extracted page blocks and rendered Korean text
over the source PDF. That is useful for fast reading, but Korean prose expands
and wraps differently from English. Fixed source coordinates therefore create
small type, collisions, clipped paragraphs, and a document that still looks
like an English PDF with patches.

Editing PDF content streams directly would retain the same coordinate problem
and would make source glyph encodings, equations, figures, and reading order
harder to verify. The source paper must remain authoritative and unchanged.

## Decision

Paperloom will keep the existing in-page overlay as a fast reading aid and add a
separate translation re-typeset workflow.

The new workflow will:

1. Build a semantic paper model from a digital text PDF.
2. Translate only the abstract body, body prose, explanatory footnotes, and
   figure or table captions.
3. Translate top-level sections with their descendant subsections as one
   context, splitting only at subsection boundaries when required.
4. Preserve cover metadata, headings, citations, references, equations, and
   text inside figures or tables.
5. Recompose preserved text as searchable text, and carry source equations and
   figure/table regions as vector-preserving PDF fragments when reliable.
6. Reflow into a separate PDF with the source page size and column count, but
   permit different line breaks, pagination, and asset coordinates.
7. Require side-by-side review. Content-integrity failures block export; visual
   warnings may be acknowledged.
8. Run structure analysis and PDF creation locally. Only translatable prose is
   sent to the selected model connection.
9. Guarantee the first high-quality path for digital English-to-Korean papers,
   on CPU-only ordinary laptops. OCR and scanned PDFs remain unsupported.

Direct OpenAI-compatible connections are stable. A Codex-session bridge may be
offered as beta through Codex's official local interface without reading Codex
credentials.

## Consequences

- The translated PDF is a derivative document rather than a modified source.
- Page numbers and coordinates are not stable across source and translation.
- Paperloom needs a resumable project record, semantic validation, font assets,
  a PDF composition module, and a review experience.
- Figure/table hover previews remain an app feature. Exported PDFs use links.
- High-fidelity reconstruction can fail on unusual PDFs; those failures must be
  visible instead of silently dropping content.
- A one-time Korean typesetting package download is acceptable and must show its
  size before installation.

## Rejected alternatives

### Continue fixed-coordinate overlays

Rejected as the final-document path because translated prose cannot reliably fit
English line and page geometry.

### Patch PDF content streams in place

Rejected because PDF streams are output instructions rather than a semantic
document source and because the original must remain unchanged.

### Require OCR or a vision model for every paper

Rejected for the first release because the agreed scope is digital text PDFs and
must not require a dedicated GPU or high-end local hardware.
