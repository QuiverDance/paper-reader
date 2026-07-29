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
`Table 2`, or `Algorithm 3` trigger a transient card containing the cropped
asset and caption. The card sits immediately above the token with a 3 px gap,
has no native title tooltip, stays open while the pointer is over either the
token or card, and replaces the previous paragraph-sized hotspot and full-page
modal.
