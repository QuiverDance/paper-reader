# ADR 0003: Prefer native PDF input for paper-wide Ask

- Status: Accepted
- Date: 2026-07-28

## Context

Questions about a paper benefit from its full argument, figures, tables,
equations, and page layout. Text-only page or selection scopes omit that context.
Some model APIs accept PDFs natively, while generic OpenAI-compatible endpoints
and the Codex bridge cannot be assumed to do so. Sending the unchanged file also
transmits cover metadata, affiliations, contacts, and references even when those
items should not be used as answer evidence.

## Decision

Ask always operates at paper scope.

- A selected passage is optional focus, not the complete context.
- A profile that explicitly supports native PDF input receives the unchanged
  source PDF on the first Ask; its remote identity is reused.
- The UI discloses whole-file transmission and the provider's deletion support.
- The model is instructed to exclude proceedings cover text, affiliations,
  contacts, and bibliography from answer evidence.
- Other profiles receive locally filtered paper-wide text.
- If filtered text exceeds the configured context capacity, Paperloom builds and
  caches a hierarchical section digest instead of truncating.
- The answer records which context mode was used and exposes only verified
  source page/section links.

## Consequences

- Ask can reason over visual material when the provider supports it.
- Native PDF requests can use substantially more provider tokens.
- Provider capability and remote-file lifecycle metadata become part of model
  profile/project state.
- Text extraction and semantic mapping remain necessary for fallback and
  verifiable evidence.

## Rejected alternatives

### Always send extracted text

Rejected because figures, equations, and layout context are lost on capable
models.

### Always send the PDF to compatible-looking endpoints

Rejected because OpenAI-compatible chat endpoints do not imply file-input or
remote-deletion support.

### Truncate to the configured context window

Rejected because the omission would be silent and could remove the exact section
needed to answer.
