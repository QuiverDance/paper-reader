# ADR 0005: Register assets to source pages and preview exact references inline

- Status: Accepted
- Date: 2026-07-28
- Supersedes: ADR 0002 clauses that allow source-style floating assets

Paperloom will give every source page a corresponding Korean page and reserve
each figure, table, and code listing at its source coordinates and dimensions.
Korean prose flows continuously through every remaining region and may pull
later prose forward; when readable text still does not fit, prose-only pages
such as `3-A` are inserted after the corresponding page. This deliberately
trades identical prose pagination for directly comparable asset placement,
dense academic layout, and complete unclipped assets.

In both panes, only exact numbered reference tokens such as `Figure 1`,
`Figure 2a`, `Table 2`, or `Algorithm 3` trigger a card containing the complete
parent asset and caption. A subpart mention such as `Figure 2a` therefore shows
the complete Figure 2 asset rather than attempting to infer and crop panel a.

The document-understanding model owns the semantic reference-to-parent decision.
Its result is grounded against the exact source text and known asset inventory.
PDF-native link annotations provide token geometry when present; exact text
ranges are the fallback, and a deterministic parser is used only when grounded
model output is unavailable. Source and Korean panes share asset identity but
maintain independent token geometry.

The Korean pane uses the translated asset caption and localizes its numbered
label, while the source pane keeps the source caption. Reference labels are
protected during translation so their kind, number, and subpart survive exactly.
When PDF extraction splits one code display into several code and prose blocks,
all fragments from its caption to the next structural boundary form one parent
asset. None of those fragments may be registered or laid out independently.

The card sits immediately above the token with a 3 px gap, has no native title
tooltip, and stays open while the pointer is over either the token or card.
Hover remains transient, while clicking a token pins the card until it is
explicitly closed. This replaces paragraph-sized hotspots and full-page modals.
