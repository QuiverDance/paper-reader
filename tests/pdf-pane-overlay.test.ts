import { describe, expect, it } from "vitest";
import {
  referenceRectStyle,
  rotateNormalizedRect,
} from "../src/lib/pdf-pane-overlay";

describe("PDF pane overlay geometry", () => {
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
});
