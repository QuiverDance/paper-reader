import { describe, expect, it } from "vitest";
import {
  availableTranslationHeight,
  availableTranslationWidth,
  translationFontBounds,
  translationMaskRect,
} from "../src/lib/translation-layout";
import type { DocumentBlock } from "../src/types";

function block(
  id: string,
  y: number,
  height: number,
  overrides: Partial<DocumentBlock> = {},
): DocumentBlock {
  return {
    id,
    documentId: "doc",
    pageNumber: 1,
    type: "paragraph",
    text: "Source paragraph",
    bbox: { x: 0.1, y, width: 0.38, height },
    fontSize: 10,
    readingOrder: 0,
    translatable: true,
    ...overrides,
  };
}

describe("translated page layout", () => {
  it("adds only a hairline margin around the source mask", () => {
    const mask = translationMaskRect(block("a", 0.2, 0.08));
    expect(mask.x).toBeCloseTo(0.0992);
    expect(mask.y).toBeCloseTo(0.1992);
    expect(mask.width).toBeCloseTo(0.3816);
    expect(mask.height).toBeCloseTo(0.0816);
  });

  it("uses nearby whitespace without crossing the next column block", () => {
    const current = block("a", 0.2, 0.08);
    const next = block("b", 0.34, 0.08);
    const otherColumn = block("c", 0.29, 0.08, {
      bbox: { x: 0.58, y: 0.29, width: 0.32, height: 0.08 },
    });

    const height = availableTranslationHeight(current, [
      current,
      otherColumn,
      next,
    ]);
    expect(height).toBeGreaterThan(current.bbox.height);
    expect(translationMaskRect(current).y + height).toBeLessThan(next.bbox.y);
  });

  it("lets short headings use safe horizontal whitespace", () => {
    const current = block("a", 0.2, 0.03, {
      type: "heading",
      bbox: { x: 0.1, y: 0.2, width: 0.12, height: 0.03 },
    });
    const rightColumn = block("b", 0.2, 0.03, {
      bbox: { x: 0.55, y: 0.2, width: 0.32, height: 0.03 },
    });

    const width = availableTranslationWidth(current, [
      current,
      rightColumn,
    ]);
    expect(width).toBeGreaterThan(current.bbox.width);
    expect(translationMaskRect(current).x + width).toBeLessThan(
      rightColumn.bbox.x,
    );
  });

  it("derives a bounded font range from PDF size and zoom", () => {
    expect(
      translationFontBounds(
        { type: "paragraph", fontSize: 12 },
        1,
      ),
    ).toEqual({ min: 6.72, max: 16.48 });
  });
});
