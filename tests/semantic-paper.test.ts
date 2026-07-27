import { describe, expect, it } from "vitest";
import { groupPageTextItems } from "../src/lib/document-blocks";
import {
  analyzeSemanticPaper,
  createRetypesetProject,
  validateRetypesetProject,
} from "../src/lib/semantic-paper";
import type { DocumentBlock } from "../src/types";

function block(
  id: string,
  type: DocumentBlock["type"],
  text: string,
  pageNumber: number,
  readingOrder: number,
  x = 0.08,
  width = 0.38,
): DocumentBlock {
  return {
    id,
    documentId: "paper",
    pageNumber,
    type,
    text,
    bbox: { x, y: 0.1 + readingOrder * 0.07, width, height: 0.045 },
    fontSize: type === "heading" ? 12 : 9,
    readingOrder,
    translatable: true,
  };
}

describe("semantic paper analysis", () => {
  it("groups descendant subsections under one top-level context", () => {
    const blocks = [
      block("title", "title", "A Paper", 1, 0, 0.1, 0.8),
      block("h1", "heading", "2 Methods", 1, 1),
      block("p1", "paragraph", "We train the model.", 1, 2),
      block("h11", "heading", "2.1 Data", 2, 0),
      block("p2", "paragraph", "We use a public dataset.", 2, 1),
      block("refs", "heading", "References", 3, 0),
      block("r1", "paragraph", "[1] Smith. A reference.", 3, 1),
    ];

    const paper = analyzeSemanticPaper(blocks);
    const methods = paper.sections.find((section) => section.title === "2 Methods");
    const data = paper.sections.find((section) => section.title === "2.1 Data");

    expect(methods?.childIds).toEqual([data?.id]);
    expect(data?.topLevelId).toBe(methods?.id);
    expect(paper.translatableBlockIds).toEqual(["p1", "p2"]);
    expect(paper.preservedBlockIds).toContain("r1");
  });

  it("blocks export for untranslated prose and clears it with a source fallback", () => {
    const blocks = [
      block("h1", "heading", "1 Introduction", 1, 0),
      block("p1", "paragraph", "The source paragraph.", 1, 1),
    ];
    const paper = analyzeSemanticPaper(blocks);
    const project = createRetypesetProject("paper", "ko", "profile");

    expect(
      validateRetypesetProject(paper, blocks, [], [], project).map(
        (warning) => warning.kind,
      ),
    ).toEqual(["missing-translation"]);

    expect(
      validateRetypesetProject(
        paper,
        blocks,
        [],
        [],
        { ...project, sourceFallbackBlockIds: ["p1"] },
      ),
    ).toEqual([]);
  });

  it("detects two-column source geometry", () => {
    const blocks = [
      ...Array.from({ length: 4 }, (_, index) =>
        block(`l${index}`, "paragraph", `Left ${index}`, 1, index, 0.08),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        block(`r${index}`, "paragraph", `Right ${index}`, 1, index + 4, 0.54),
      ),
    ];
    expect(analyzeSemanticPaper(blocks).columnCount).toBe(2);
  });

  it("keeps text inside a source figure in the preserved vector asset", () => {
    const blocks = groupPageTextItems(
      [
        { str: "A Small Paper", x: 70, y: 780, width: 140, height: 20, fontSize: 20 },
        { str: "Abstract", x: 55, y: 730, width: 50, height: 11, fontSize: 11 },
        { str: "This paper presents a useful result [1].", x: 55, y: 710, width: 210, height: 10, fontSize: 10 },
        { str: "1 Introduction", x: 55, y: 675, width: 90, height: 12, fontSize: 12 },
        { str: "Figure 1 summarizes the method.", x: 55, y: 650, width: 170, height: 10, fontSize: 10 },
        { str: "SOURCE FIGURE", x: 105, y: 552, width: 110, height: 14, fontSize: 14 },
        { str: "Figure 1. Overview of the method.", x: 55, y: 480, width: 165, height: 8, fontSize: 8 },
        { str: "E = mc^2", x: 130, y: 440, width: 55, height: 12, fontSize: 12 },
        { str: "References", x: 55, y: 390, width: 70, height: 12, fontSize: 12 },
        { str: "[1] Smith. A useful reference.", x: 55, y: 368, width: 160, height: 9, fontSize: 9 },
      ],
      {
        documentId: "fixture",
        pageNumber: 1,
        pageWidth: 595,
        pageHeight: 842,
      },
    );
    const paper = analyzeSemanticPaper(blocks);
    const sourceFigure = blocks.find((candidate) => candidate.text === "SOURCE FIGURE");

    expect(paper.assets).toHaveLength(1);
    expect(paper.translatableBlockIds.map(
      (id) => blocks.find((candidate) => candidate.id === id)?.text,
    )).toEqual([
      "This paper presents a useful result [1].",
      "Figure 1 summarizes the method.",
      "Figure 1. Overview of the method.",
    ]);
    expect(paper.assets[0].contentBlockIds).toContain(sourceFigure?.id);
  });
});
