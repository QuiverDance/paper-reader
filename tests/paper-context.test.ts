import { describe, expect, it } from "vitest";
import {
  buildDigestSectionInputs,
  buildPaperQuestionContext,
  paperContextMode,
} from "../src/lib/paper-context";
import type {
  DocumentBlock,
  SemanticPaper,
} from "../src/types";

function block(
  id: string,
  type: DocumentBlock["type"],
  text: string,
  pageNumber: number,
  readingOrder: number,
): DocumentBlock {
  return {
    id,
    documentId: "paper",
    type,
    text,
    pageNumber,
    readingOrder,
    bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.05 },
    translatable: type === "paragraph" || type === "abstract",
  };
}

const paper: SemanticPaper = {
  documentId: "paper",
  contentStartPage: 2,
  sections: [
    {
      id: "front-matter",
      title: "Front matter",
      level: 0,
      blockIds: ["title", "abstract"],
      childIds: [],
      topLevelId: "front-matter",
    },
    {
      id: "introduction",
      title: "Introduction",
      level: 1,
      blockIds: ["heading", "body", "caption"],
      childIds: [],
      topLevelId: "introduction",
    },
  ],
  assets: [],
  blockSectionIds: {
    title: "front-matter",
    abstract: "front-matter",
    heading: "introduction",
    body: "introduction",
    caption: "introduction",
  },
  translatableBlockIds: ["abstract", "body", "caption"],
  preservedBlockIds: ["cover", "authors", "contact", "references", "entry"],
  columnCount: 2,
  bodyFontStyle: "serif",
  referenceHeadingBlockId: "references",
};

const blocks = [
  block("cover", "title", "Conference Proceedings", 1, 0),
  block("title", "title", "A Systems Paper", 2, 0),
  block("authors", "authors", "Ada Researcher", 2, 1),
  block("contact", "footnote", "ada@example.com, Example University", 2, 2),
  block("abstract", "abstract", "We present a cache.", 2, 3),
  block("heading", "heading", "Introduction", 3, 0),
  block("body", "paragraph", "The cache reduces latency [1].", 3, 1),
  block("caption", "figure-caption", "Figure 1: Cache levels.", 3, 2),
  block("references", "heading", "References", 9, 0),
  block("entry", "reference-entry", "[1] Prior work.", 9, 1),
];

describe("paper-wide question context", () => {
  it("keeps paper content while excluding cover, identity, and bibliography", () => {
    const context = buildPaperQuestionContext(blocks, paper);

    expect(context.text).toContain("A Systems Paper");
    expect(context.text).toContain("The cache reduces latency [1].");
    expect(context.text).toContain("Figure 1: Cache levels.");
    expect(context.text).not.toContain("Conference Proceedings");
    expect(context.text).not.toContain("Ada Researcher");
    expect(context.text).not.toContain("ada@example.com");
    expect(context.text).not.toContain("Prior work");
    expect(context.sectionTitles).toContain("Introduction");
  });

  it("requires a digest instead of silently truncating an oversize paper", () => {
    const context = {
      ...buildPaperQuestionContext(blocks, paper),
      estimatedTokens: 100_000,
    };
    expect(paperContextMode(context, 16_000, false)).toBe("digest-required");
    expect(paperContextMode(context, 16_000, true)).toBe("digest");
  });

  it("groups digest input by paper section", () => {
    const inputs = buildDigestSectionInputs(blocks, paper);
    expect(inputs.map((input) => input.title)).toEqual([
      "Front matter",
      "Introduction",
    ]);
    expect(inputs[1].text).toContain("[p.3] The cache reduces latency");
  });
});
