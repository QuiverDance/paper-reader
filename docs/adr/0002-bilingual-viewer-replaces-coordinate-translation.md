# ADR 0002: Make the saved bilingual viewer the only translation experience

- Status: Accepted
- Date: 2026-07-28
- Supersedes: ADR 0001 clauses that retain the coordinate overlay and allow
  freely relocated assets
- Asset-placement clauses superseded by: ADR 0005

## Context

Paperloom currently contains two competing translation products: coordinate
overlays for selected pages or blocks, and a semantic Korean re-typeset. The
overlay controls, linked panes, and scope choices make the main reader harder to
understand and do not produce the Korean academic paper users expect. Reopening
an unchanged source also needs to restore completed work instead of starting
another conversion.

Korean prose cannot preserve English line and page breaks. Figures, tables, and
code still need familiar academic placement so comparison does not become
disorienting.

## Decision

Paperloom will expose one translation product: an unchanged source PDF beside a
saved Korean re-typeset.

- The default view is source-left and Korean-right with independent controls.
- The Korean pane restores an accepted local result by source-content hash, or
  shows one explicit creation action.
- Coordinate translation scopes, overlays, linked navigation, manual stacked
  layout, and target-language selection are removed.
- Korean prose flows normally across columns and pages.
- Figures, tables, and code use source-style float ordering, span, scale, and
  top/bottom/inline role rather than a forced source page number.
- Regeneration produces a candidate and cannot destroy the accepted result.
- Automatic validation, inline protected manual correction, atomic application,
  and export remain.

## Consequences

- The main viewer has one coherent mental model and fewer persisted states.
- The Korean PDF may have a different page count from the source.
- Pane navigation cannot rely on page-number synchronization.
- Generated PDF bytes and generation state must be stored as part of the local
  re-typeset project.
- Existing overlay and library metadata may remain in old local storage but is
  not surfaced or rewritten by the new UI.

## Rejected alternatives

### Keep the overlay as a quick mode

Rejected because it preserves the competing interaction model and the layout
failure that motivated semantic re-typesetting.

### Force figures and tables onto the same ordinal source page

Rejected because Korean prose expansion would require clipping, overlap, or
unacceptably small type. Source-style floating placement preserves readability
and visual familiarity without fake page equivalence.
