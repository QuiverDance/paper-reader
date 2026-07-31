import { describe, expect, it } from "vitest";
import {
  chooseReferenceTokenRects,
  reconcileOverlayPages,
  referenceRectStyle,
  rotateNormalizedRect,
} from "../src/lib/pdf-pane-overlay";

describe("PDF pane overlay geometry", () => {
  it("uses the PDF-native link to select the matching text token", () => {
    const wrong = [
      { x: 0.12, y: 0.2, width: 0.08, height: 0.016 },
    ];
    const linked = [
      { x: 0.62, y: 0.68, width: 0.1, height: 0.016 },
    ];

    expect(
      chooseReferenceTokenRects(
        [
          { rects: wrong, distance: 0.01 },
          { rects: linked, distance: 0.3 },
        ],
        [{ x: 0.66, y: 0.68, width: 0.025, height: 0.016 }],
      ),
    ).toEqual(linked);
  });

  it("rotates normalized rectangles without changing their covered area", () => {
    const source = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
    const expectRect = (
      actual: typeof source,
      expected: typeof source,
    ) => {
      expect(actual.x).toBeCloseTo(expected.x);
      expect(actual.y).toBeCloseTo(expected.y);
      expect(actual.width).toBeCloseTo(expected.width);
      expect(actual.height).toBeCloseTo(expected.height);
    };

    expectRect(rotateNormalizedRect(source, 90), {
      x: 0.7,
      y: 0.1,
      width: 0.1,
      height: 0.3,
    });
    expectRect(rotateNormalizedRect(source, 180), {
      x: 0.6,
      y: 0.7,
      width: 0.3,
      height: 0.1,
    });
    expectRect(rotateNormalizedRect(source, 270), {
      x: 0.2,
      y: 0.6,
      width: 0.1,
      height: 0.3,
    });
  });

  it("converts the rotated rectangle into one overlay style", () => {
    expect(
      referenceRectStyle(
        { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
        90,
      ),
    ).toEqual({
      left: "70%",
      top: "10%",
      width: "10%",
      height: "30%",
    });
  });

  it("uses the same padded box for the visible reference and pointer target", () => {
    expect(
      referenceRectStyle(
        { x: 0.2, y: 0.3, width: 0.04, height: 0.01 },
        0,
        { padding: 2 },
      ),
    ).toEqual({
      left: "calc(20% - 2px)",
      top: "calc(30% - 2px)",
      width: "calc(4% + 4px)",
      height: "calc(1% + 4px)",
    });
  });

  it("keeps stable overlay pages and revises only the rendered text layer", () => {
    const firstHost = {};
    const secondHost = {};
    const current = [
      { pageNumber: 1, host: firstHost, revision: 2 },
      { pageNumber: 2, host: secondHost, revision: 4 },
    ];
    const discovered = [
      { pageNumber: 1, host: firstHost },
      { pageNumber: 2, host: secondHost },
    ];

    expect(reconcileOverlayPages(current, discovered)).toBe(current);

    const revised = reconcileOverlayPages(current, discovered, 2);
    expect(revised[0]).toBe(current[0]);
    expect(revised[1]).toEqual({
      pageNumber: 2,
      host: secondHost,
      revision: 5,
    });
  });
});
