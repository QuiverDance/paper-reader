import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW_STATE,
  MAX_SCALE,
  MIN_SCALE,
  mergeViewState,
  normalizeAnchor,
  normalizeRotation,
  scaleBy,
  shouldApplyScrollAnchor,
} from "../src/lib/reader-state";

describe("reader state", () => {
  it("normalizes a page anchor into the loaded document", () => {
    expect(normalizeAnchor({ pageNumber: 99, relativeOffsetY: -0.2 }, 12)).toEqual(
      { pageNumber: 12, relativeOffsetY: 0 },
    );
  });

  it("normalizes positive and negative rotations", () => {
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
  });

  it("clamps zoom at both supported bounds", () => {
    expect(scaleBy(MAX_SCALE, "in")).toBe(MAX_SCALE);
    expect(scaleBy(MIN_SCALE, "out")).toBe(MIN_SCALE);
  });

  it("merges an external pane update without losing scale mode", () => {
    const result = mergeViewState(
      DEFAULT_VIEW_STATE,
      { pageNumber: 4, relativeOffsetY: 0.75, rotation: 90 },
      8,
    );
    expect(result).toMatchObject({
      pageNumber: 4,
      relativeOffsetY: 0.75,
      scaleValue: "page-width",
      rotation: 90,
    });
  });

  it("does not reapply a scroll anchor that the same pane just reported", () => {
    const anchor = { pageNumber: 4, relativeOffsetY: 0.37 };

    expect(shouldApplyScrollAnchor(anchor, anchor)).toBe(false);
    expect(
      shouldApplyScrollAnchor(
        { pageNumber: 5, relativeOffsetY: 0 },
        anchor,
      ),
    ).toBe(true);
  });
});
