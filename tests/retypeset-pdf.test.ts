import { describe, expect, it } from "vitest";
import {
  academicTextLines,
  equationSourceCrop,
  inferBodyFontSize,
  inferFrontMatterRect,
  isStandaloneMarker,
  justifiedLineSegments,
  localizeDocumentReferenceLabels,
  planRetypesetContent,
  usesWholeBlockBoldFont,
} from "../src/lib/retypeset-pdf";
import { createRetypesetProject } from "../src/lib/semantic-paper";
import type {
  DocumentBlock,
  SemanticPaper,
  TranslationRecord,
} from "../src/types";

describe("re-typeset front matter", () => {
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

  it("localizes every linked asset label before drawing translated prose", () => {
    expect(
      localizeDocumentReferenceLabels(
        "Figure 2와 Table 1은 Algorithm 3, Listing 4, Code 5를 함께 설명한다.",
      ),
    ).toBe("그림 2와 표 1은 알고리즘 3, 목록 4, 코드 5를 함께 설명한다.");
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

  it("plans content once and keeps the best translation for each block", () => {
    const blocks: DocumentBlock[] = [
      {
        id: "caption",
        documentId: "paper",
        pageNumber: 2,
        type: "figure-caption",
        text: "Figure 1: Result.",
        bbox: { x: 0.1, y: 0.3, width: 0.4, height: 0.04 },
        readingOrder: 2,
        translatable: true,
      },
      {
        id: "body",
        documentId: "paper",
        pageNumber: 2,
        type: "paragraph",
        text: "Body.",
        bbox: { x: 0.1, y: 0.4, width: 0.4, height: 0.04 },
        readingOrder: 1,
        translatable: true,
      },
    ];
    const paper: SemanticPaper = {
      documentId: "paper",
      contentStartPage: 2,
      sections: [],
      assets: [
        {
          id: "figure-1",
          kind: "figure",
          number: "1",
          captionBlockId: "caption",
          pageNumber: 2,
          bbox: { x: 0.1, y: 0.1, width: 0.4, height: 0.2 },
          sectionId: "root",
          contentBlockIds: ["chart-label"],
        },
      ],
      blockSectionIds: {},
      translatableBlockIds: ["body", "caption"],
      preservedBlockIds: [],
      columnCount: 2,
      bodyFontStyle: "serif",
    };
    const project = createRetypesetProject("paper", "ko", "profile");
    const translation = (
      id: string,
      status: TranslationRecord["status"],
      text: string,
      updatedAt: string,
    ): TranslationRecord => ({
      id,
      documentId: "paper",
      blockId: "body",
      targetLanguage: "ko",
      sourceText: "Body.",
      translatedText: text,
      status,
      updatedAt,
    });

    const plan = planRetypesetContent(
      blocks,
      paper,
      [
        translation(
          "translated",
          "translated",
          "정상 번역",
          "2026-07-28T00:00:00.000Z",
        ),
        translation(
          "newer-failure",
          "failed",
          "",
          "2026-07-29T00:00:00.000Z",
        ),
      ],
      project,
    );

    expect(plan.orderedBlocks.map((block) => block.id)).toEqual([
      "body",
      "caption",
    ]);
    expect(plan.translationByBlock.get("body")?.id).toBe("translated");
    expect(plan.assetsByCaption.get("caption")?.id).toBe("figure-1");
    expect(plan.assetContentBlockIds.has("chart-label")).toBe(true);
  });
});
