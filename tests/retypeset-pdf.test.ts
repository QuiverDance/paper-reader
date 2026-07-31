import { describe, expect, it } from "vitest";
import {
  academicTextLines,
  equationSourceCrop,
  inferBodyFontSize,
  inferCaptionFontSize,
  inferFrontMatterRect,
  isStandaloneMarker,
  justifiedLineSegments,
  registeredEquationPadding,
  usesWholeBlockBoldFont,
} from "../src/lib/retypeset-pdf";
import {
  createRegisteredAssetSlot,
  sourceRegisteredAssetCrop,
} from "../src/lib/source-registered-assets";
import type { DocumentBlock, PaperAsset } from "../src/types";

describe("re-typeset front matter", () => {
  it("keeps translated captions near the readable body size", () => {
    expect(inferCaptionFontSize(9)).toBeCloseTo(8.55);
  });

  it("blocks prose from the top of a column through a top-anchored asset", () => {
    const asset: PaperAsset = {
      id: "algorithm-2",
      kind: "code",
      number: "2",
      captionBlockId: "algorithm-2-caption",
      pageNumber: 8,
      bbox: { x: 0.515, y: 0.11, width: 0.44, height: 0.284 },
      anchor: "column-top",
      sectionId: "section-5",
      contentBlockIds: ["algorithm-2-code"],
    };

    expect(
      createRegisteredAssetSlot(
        asset,
        { x: 0.53, y: 0.094, width: 0.39, height: 0.018 },
        { pageTop: 0.043, pageWidth: 595, pageHeight: 842 },
      ),
    ).toEqual({
      assetId: "algorithm-2",
      pageNumber: 8,
      mediaRect: {
        x: 0.508277,
        y: 0.11,
        width: 0.453445,
        height: 0.300627,
      },
      captionRect: { x: 0.53, y: 0.094, width: 0.39, height: 0.018 },
      exclusionRect: {
        x: 0.508277,
        y: 0.043,
        width: 0.453445,
        height: 0.367627,
      },
      anchor: "column-top",
    });
  });

  it("adds a bounded safety margin around source-registered asset crops", () => {
    expect(
      sourceRegisteredAssetCrop(
        { x: 0.515, y: 0.11, width: 0.44, height: 0.284 },
        595,
        842,
        "code",
      ),
    ).toEqual({
      left: 302.425,
      bottom: 496.252,
      right: 572.225,
      top: 749.38,
    });
  });

  it("stops a padded source crop before the next structural block", () => {
    expect(
      sourceRegisteredAssetCrop(
        { x: 0.045, y: 0.11, width: 0.44, height: 0.284 },
        595,
        842,
        "code",
        0.399,
      ),
    ).toEqual({
      left: 22.775,
      bottom: 506.042,
      right: 292.575,
      top: 749.38,
    });
  });

  it("visually scales Korean body type below the source Latin point size", () => {
    const paragraph = (fontSize: number): DocumentBlock => ({
      id: `body-${fontSize}`,
      documentId: "paper",
      pageNumber: 2,
      type: "paragraph",
      text: "Body",
      bbox: { x: 0.1, y: 0.2, width: 0.35, height: 0.05 },
      readingOrder: 0,
      translatable: true,
      fontSize,
    });

    expect(inferBodyFontSize([paragraph(9.8), paragraph(10.2)])).toBe(9);
  });

  it("keeps translated body regular while preserving non-body bold blocks", () => {
    const block = (type: DocumentBlock["type"]): DocumentBlock => ({
      id: type,
      documentId: "paper",
      pageNumber: 2,
      type,
      text: "Text",
      bbox: { x: 0.1, y: 0.2, width: 0.35, height: 0.05 },
      readingOrder: 0,
      translatable: true,
      sourceStyle: { fontWeight: "bold" },
    });

    expect(usesWholeBlockBoldFont(block("paragraph"))).toBe(false);
    expect(usesWholeBlockBoldFont(block("abstract"))).toBe(false);
    expect(usesWholeBlockBoldFont(block("figure-caption"))).toBe(true);
  });

  it("justifies each body line except the final line of a paragraph", () => {
    const font = {
      widthOfTextAtSize: (text: string) => text.length * 10,
    };
    const lines = academicTextLines("aa bb cccc dd\nee ff", font, 1, 55);

    expect(lines).toEqual([
      { text: "aa bb", paragraphEnd: false },
      { text: "cccc", paragraphEnd: false },
      { text: "dd", paragraphEnd: true },
      { text: "ee ff", paragraphEnd: true },
    ]);
    expect(justifiedLineSegments(lines[0], font, 1, 55)).toEqual([
      { text: "aa", start: 0, end: 2, xOffset: 0, width: 20 },
      { text: "bb", start: 3, end: 5, xOffset: 35, width: 20 },
    ]);
    expect(justifiedLineSegments(lines[1], font, 1, 55)).toHaveLength(1);
    expect(justifiedLineSegments(lines[2], font, 1, 55)).toHaveLength(1);
    expect(justifiedLineSegments(lines[3], font, 1, 55)).toHaveLength(1);
  });

  it("keeps a localized asset reference together when wrapping body text", () => {
    const font = {
      widthOfTextAtSize: (text: string) => text.length * 10,
    };

    expect(
      academicTextLines("앞말 그림 2a와 뒤", font, 1, 60),
    ).toEqual([
      { text: "앞말", paragraphEnd: false },
      { text: "그림 2a와", paragraphEnd: false },
      { text: "뒤", paragraphEnd: true },
    ]);
  });

  it("captures the original title and multi-column author region together", () => {
    const block = (
      id: string,
      type: DocumentBlock["type"],
      x: number,
      y: number,
      width: number,
      height: number,
    ): DocumentBlock => ({
      id,
      documentId: "paper",
      pageNumber: 2,
      type,
      text: id,
      bbox: { x, y, width, height },
      readingOrder: 0,
      translatable: false,
    });
    const blocks = [
      block("title", "title", 0.1, 0.12, 0.8, 0.03),
      block("author-left", "authors", 0.18, 0.18, 0.25, 0.08),
      block("author-right", "authors", 0.58, 0.18, 0.25, 0.08),
      block("abstract", "abstract", 0.08, 0.32, 0.4, 0.3),
    ];

    expect(inferFrontMatterRect(blocks, 2)).toEqual({
      x: 0.085,
      y: 0.105,
      width: 0.83,
      height: 0.17,
    });
  });

  it("falls back to normal text reflow when there is no author region", () => {
    const titleOnly: DocumentBlock[] = [
      {
        id: "title",
        documentId: "paper",
        pageNumber: 1,
        type: "title",
        text: "Title only",
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.04 },
        readingOrder: 0,
        translatable: false,
      },
    ];

    expect(inferFrontMatterRect(titleOnly, 1)).toBeNull();
  });

  it("drops isolated footnote markers without dropping real footnote text", () => {
    const marker: DocumentBlock = {
      id: "marker",
      documentId: "paper",
      pageNumber: 10,
      type: "footnote",
      text: "1",
      bbox: { x: 0.53, y: 0.88, width: 0.005, height: 0.008 },
      readingOrder: 0,
      translatable: false,
    };

    expect(isStandaloneMarker(marker)).toBe(true);
    expect(
      isStandaloneMarker({
        ...marker,
        id: "footnote-text",
        text: "1 Warmup is disabled for this experiment.",
        bbox: { x: 0.53, y: 0.88, width: 0.38, height: 0.03 },
      }),
    ).toBe(false);
  });

  it("pads an equation crop so vector strokes outside the text box are preserved", () => {
    expect(
      equationSourceCrop(
        { x: 0.2, y: 0.3, width: 0.4, height: 0.05 },
        500,
        800,
      ),
    ).toEqual({
      left: 96,
      bottom: 516,
      right: 304,
      top: 564,
    });
  });

  it("uses tight registered crops for compact equation fragments", () => {
    expect(
      registeredEquationPadding({
        x: 0.807,
        y: 0.814,
        width: 0.079,
        height: 0.028,
      }),
    ).toBe(0.75);
    expect(
      registeredEquationPadding({
        x: 0.2,
        y: 0.4,
        width: 0.35,
        height: 0.08,
      }),
    ).toBe(4);
  });
});
