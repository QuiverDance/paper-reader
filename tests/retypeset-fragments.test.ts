import { describe, expect, it } from "vitest";
import { shouldRegisterPreservedFragment } from "../src/lib/retypeset-pdf";
import type { DocumentBlock } from "../src/types";

function block(
  id: string,
  type: DocumentBlock["type"],
  text: string,
): DocumentBlock {
  return {
    id,
    documentId: "paper",
    pageNumber: 3,
    type,
    text,
    bbox: { x: 0.08, y: 0.1, width: 0.4, height: 0.05 },
    fontSize: 9,
    readingOrder: 0,
    translatable: type !== "equation" && type !== "code-listing",
  };
}

describe("registered source fragments", () => {
  it("does not draw an asset-internal code or equation block a second time", () => {
    const chartLegend = block(
      "chart-legend",
      "code-listing",
      "Measured Latency (ms) Theoretical Latency (ms)",
    );

    expect(
      shouldRegisterPreservedFragment(
        chartLegend,
        new Set([chartLegend.id]),
      ),
    ).toBe(false);
  });

  it("does not preserve a prose line even when structure reconstruction mislabeled it as an equation", () => {
    const leakedProse = block(
      "leaked-prose",
      "equation",
      "and when cache loading stalls are unavoidable, the scheduler",
    );

    expect(
      shouldRegisterPreservedFragment(leakedProse, new Set()),
    ).toBe(false);
  });

  it("does not preserve a translated paragraph merely because it contains inline math", () => {
    const inlineMathProse = block(
      "inline-math-prose",
      "paragraph",
      "where t ℓ,i is the runtime of agent a ℓ,i.",
    );

    expect(
      shouldRegisterPreservedFragment(inlineMathProse, new Set()),
    ).toBe(false);
  });

  it("still preserves standalone equations and code outside assets", () => {
    expect(
      shouldRegisterPreservedFragment(
        block("equation", "equation", "C = λ · L"),
        new Set(),
      ),
    ).toBe(true);
    expect(
      shouldRegisterPreservedFragment(
        block("code", "code-listing", "for (const item of items)"),
        new Set(),
      ),
    ).toBe(true);
  });
});
