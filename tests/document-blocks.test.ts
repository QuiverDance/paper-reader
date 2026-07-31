import { describe, expect, it } from "vitest";
import {
  extractDocumentBlocks,
  groupPageTextItems,
  inferContentStartPage,
  normalizeDocumentBlocks,
} from "../src/lib/document-blocks";
import {
  detectDocumentReferences,
  resolveDocumentReferences,
} from "../src/lib/document-references";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DocumentBlock } from "../src/types";

describe("document block extraction", () => {
  it("extracts independent PDF pages concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const document = {
      numPages: 3,
      getPage: async (pageNumber: number) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return {
          getViewport: () => ({ width: 600, height: 800 }),
          getTextContent: async () => ({
            items: [
              {
                str: `Page ${pageNumber} content.`,
                transform: [10, 0, 0, 10, 72, 700],
                width: 120,
                height: 10,
              },
            ],
          }),
        };
      },
    } as unknown as PDFDocumentProxy;

    await extractDocumentBlocks(document, "concurrent");

    expect(maxActive).toBeGreaterThanOrEqual(2);
  });

  it("does not merge rotated side metadata into body prose", async () => {
    const document = {
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 600, height: 800 }),
        getTextContent: async () => ({
          items: [
            {
              str: "arXiv:2512.18126v1 [cs.AI] 19 Dec 2025",
              transform: [0, 20, -20, 0, 32, 540],
              width: 300,
              height: 20,
            },
            {
              str: "The body paragraph continues here.",
              transform: [10, 0, 0, 10, 72, 540],
              width: 210,
              height: 10,
            },
          ],
        }),
      }),
    } as unknown as PDFDocumentProxy;

    const blocks = await extractDocumentBlocks(document, "side-metadata");

    expect(blocks.map((block) => block.text)).toEqual([
      "The body paragraph continues here.",
    ]);
  });

  it("merges nearby lines into a normalized paragraph block", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "The proposed method improves",
          x: 72,
          y: 700,
          width: 180,
          height: 12,
          fontSize: 12,
        },
        {
          str: "accuracy on the benchmark.",
          x: 72,
          y: 684,
          width: 160,
          height: 12,
          fontSize: 12,
        },
      ],
      { documentId: "doc", pageNumber: 1, pageWidth: 600, pageHeight: 800 },
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      documentId: "doc",
      pageNumber: 1,
      type: "paragraph",
      text: "The proposed method improves accuracy on the benchmark.",
      readingOrder: 0,
    });
    expect(blocks[0].bbox).toEqual({
      x: 0.12,
      y: 0.11,
      width: 0.3,
      height: 0.035,
    });
  });

  it("marks an unindented page-top body block as a continuation candidate", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "This sentence continues the paragraph from the previous page.",
          x: 54,
          y: 742,
          width: 240,
          height: 10,
          fontSize: 10,
          fontName: "body",
        },
      ],
      { documentId: "page-continuation", pageNumber: 2, pageWidth: 612, pageHeight: 792 },
    );

    expect(blocks[0].sourceStyle?.paragraphStart).toBe(false);
  });

  it("splits body paragraphs at source indentation and bold lead boundaries", () => {
    const items = [
      {
        str: "The first paragraph ends here.",
        x: 318,
        y: 700,
        width: 210,
        height: 10,
        fontSize: 10,
        fontName: "body",
      },
      {
        str: "To transfer data, the second paragraph begins here.",
        x: 328,
        y: 686,
        width: 220,
        height: 10,
        fontSize: 10,
        fontName: "body",
      },
      {
        str: "and continues on the normal column edge.",
        x: 318,
        y: 674,
        width: 205,
        height: 10,
        fontSize: 10,
        fontName: "body",
      },
      {
        str: "Cost of Large Pages.",
        x: 318,
        y: 660,
        width: 95,
        height: 10,
        fontSize: 10,
        fontName: "bold",
      },
      {
        str: "However, this bold lead starts a third paragraph.",
        x: 415,
        y: 660,
        width: 140,
        height: 10,
        fontSize: 10,
        fontName: "body",
      },
      {
        str: "This preference starts the fourth paragraph.",
        x: 328,
        y: 646,
        width: 220,
        height: 10,
        fontSize: 10,
        fontName: "body",
      },
    ];

    const blocks = groupPageTextItems(items, {
      documentId: "paragraph-style",
      pageNumber: 4,
      pageWidth: 612,
      pageHeight: 792,
    });
    const paragraphs = blocks.filter((block) => block.type === "paragraph");

    expect(paragraphs.map((block) => block.text)).toEqual([
      "The first paragraph ends here.",
      "To transfer data, the second paragraph begins here. and continues on the normal column edge.",
      "Cost of Large Pages. However, this bold lead starts a third paragraph.",
      "This preference starts the fourth paragraph.",
    ]);
    expect(
      (
        paragraphs[2] as DocumentBlock & {
          sourceStyle?: { boldLead?: boolean };
        }
      ).sourceStyle?.boldLead,
    ).toBe(true);
  });

  it("keeps an uppercase wrapped heading tail out of its first paragraph", () => {
    const items = [
      {
        str: "3.1 Low Bandwidth Utilization in KV Cache",
        x: 54,
        y: 140,
        width: 240,
        height: 12,
        fontSize: 12,
        fontName: "bold",
      },
      {
        str: "Transfers",
        x: 81,
        y: 126,
        width: 50,
        height: 12,
        fontSize: 12,
        fontName: "bold",
      },
      {
        str: "The achievable throughput is constrained by Little's Law.",
        x: 54,
        y: 108,
        width: 240,
        height: 10,
        fontSize: 10,
        fontName: "body",
      },
    ];

    const blocks = normalizeDocumentBlocks(
      groupPageTextItems(items, {
        documentId: "wrapped-heading",
        pageNumber: 4,
        pageWidth: 612,
        pageHeight: 792,
      }),
    );

    expect(blocks.map(({ type, text }) => ({ type, text }))).toEqual([
      {
        type: "heading",
        text: "3.1 Low Bandwidth Utilization in KV Cache Transfers",
      },
      {
        type: "paragraph",
        text: "The achievable throughput is constrained by Little's Law.",
      },
    ]);
  });

  it("classifies headings and figure captions", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "3. Experimental Results",
          x: 70,
          y: 720,
          width: 230,
          height: 17,
          fontSize: 17,
        },
        {
          str: "Figure 2. Throughput by batch size.",
          x: 80,
          y: 140,
          width: 250,
          height: 10,
          fontSize: 10,
        },
      ],
      { documentId: "doc", pageNumber: 3, pageWidth: 600, pageHeight: 800 },
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "figure-caption",
    ]);
  });

  it("preserves a numbered algorithm as one vector block", () => {
    const blocks: DocumentBlock[] = [
      {
        id: "algorithm",
        documentId: "paper",
        pageNumber: 3,
        type: "paragraph",
        text: "Algorithm 1 Balanced Batch Formation 1: procedure AddBundleHit(Q, B)",
        bbox: { x: 0.09, y: 0.09, width: 0.3, height: 0.08 },
        fontSize: 10,
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "algorithm-lines",
        documentId: "paper",
        pageNumber: 3,
        type: "paragraph",
        text: "2: 3: 4: 5: function BatchFormation(Q) 6: return B",
        bbox: { x: 0.1, y: 0.15, width: 0.31, height: 0.22 },
        fontSize: 10,
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "body",
        documentId: "paper",
        pageNumber: 3,
        type: "paragraph",
        text: "The prose after the algorithm remains a separate paragraph.",
        bbox: { x: 0.09, y: 0.41, width: 0.39, height: 0.08 },
        fontSize: 10,
        readingOrder: 2,
        translatable: true,
      },
    ];

    const normalized = normalizeDocumentBlocks(blocks);
    const algorithm = normalized.find((block) => block.id === "algorithm");

    expect(normalized).toHaveLength(2);
    expect(algorithm).toMatchObject({
      type: "equation",
      translatable: false,
      bbox: { x: 0.085, width: 0.4 },
    });
    expect(algorithm?.bbox.height).toBeGreaterThan(0.29);
    expect(normalized.find((block) => block.id === "body")?.type).toBe(
      "paragraph",
    );
  });

  it("does not mistake a body sentence beginning with a figure reference for a caption", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "Figure 2 summarizes the experiment.",
          x: 72,
          y: 700,
          width: 210,
          height: 10,
          fontSize: 10,
        },
        {
          str: "Figure 2. Throughput by batch size.",
          x: 72,
          y: 140,
          width: 210,
          height: 8,
          fontSize: 8,
        },
      ],
      { documentId: "doc", pageNumber: 2, pageWidth: 600, pageHeight: 800 },
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "figure-caption",
    ]);
  });

  it("keeps same-height text in separate columns", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "The left column starts here",
          x: 72,
          y: 700,
          width: 190,
          height: 10,
          fontSize: 10,
        },
        {
          str: "The right column starts here",
          x: 330,
          y: 700,
          width: 190,
          height: 10,
          fontSize: 10,
        },
        {
          str: "and continues on its next line.",
          x: 72,
          y: 686,
          width: 180,
          height: 10,
          fontSize: 10,
        },
        {
          str: "and also continues independently.",
          x: 330,
          y: 686,
          width: 188,
          height: 10,
          fontSize: 10,
        },
      ],
      { documentId: "doc", pageNumber: 1, pageWidth: 600, pageHeight: 800 },
    );

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.text)).toEqual([
      "The left column starts here and continues on its next line.",
      "The right column starts here and also continues independently.",
    ]);
    expect(blocks.every((block) => block.bbox.width < 0.4)).toBe(true);
  });

  it("does not merge a numbered heading into its paragraph", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "2. Layout Model",
          x: 72,
          y: 700,
          width: 110,
          height: 11,
          fontSize: 11,
        },
        {
          str: "Each block stores normalized coordinates.",
          x: 72,
          y: 685,
          width: 220,
          height: 10,
          fontSize: 10,
        },
      ],
      { documentId: "doc", pageNumber: 1, pageWidth: 600, pageHeight: 800 },
    );

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
    ]);
  });

  it("does not mistake a numeric body fragment for a section heading", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "464 GB of LPDDR5X DRAM, providing up to 384 GB/s of",
          x: 72,
          y: 700,
          width: 235,
          height: 10,
          fontSize: 10,
        },
      ],
      { documentId: "doc", pageNumber: 9, pageWidth: 600, pageHeight: 800 },
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("recognizes a proceedings cover, paper title page, and repeated footer", () => {
    const makeBlock = (
      id: string,
      pageNumber: number,
      type: DocumentBlock["type"],
      text: string,
      y: number,
      fontSize = 10,
    ): DocumentBlock => ({
      id,
      documentId: "proceedings-paper",
      pageNumber,
      type,
      text,
      bbox: { x: 0.08, y, width: 0.84, height: 0.02 },
      fontSize,
      readingOrder: Number(id.match(/\d+$/)?.[0] ?? 0),
      translatable: type !== "unknown",
    });
    const blocks = normalizeDocumentBlocks([
      makeBlock("cover-1", 1, "title", "Conference proceedings", 0.25, 24),
      makeBlock("cover-2", 1, "paragraph", "Sponsored open access", 0.75),
      makeBlock("paper-title", 2, "heading", "A Systems Paper", 0.1, 18),
      makeBlock("paper-author", 2, "heading", "Ada Researcher", 0.18, 12),
      makeBlock("abstract-label", 2, "abstract", "Abstract", 0.3, 11),
      {
        ...makeBlock(
          "right-continuation",
          2,
          "paragraph",
          "The right column continues later.",
          0.32,
        ),
        bbox: { x: 0.52, y: 0.32, width: 0.4, height: 0.4 },
        readingOrder: 3,
      },
      {
        ...makeBlock(
          "abstract-body",
          2,
          "paragraph",
          "The paper begins here.",
          0.34,
        ),
        bbox: { x: 0.08, y: 0.34, width: 0.4, height: 0.25 },
        readingOrder: 4,
      },
      makeBlock("intro", 2, "heading", "1 Introduction", 0.5, 12),
      makeBlock("footer-2", 2, "paragraph", "Systems Conference 1", 0.955, 8),
      makeBlock("body-3", 3, "paragraph", "The paper continues.", 0.12),
      makeBlock("footer-3", 3, "paragraph", "Systems Conference 2", 0.955, 8),
    ]);

    expect(inferContentStartPage(blocks)).toBe(2);
    expect(blocks.find((block) => block.id === "paper-title")?.type).toBe(
      "title",
    );
    expect(blocks.find((block) => block.id === "paper-author")?.type).toBe(
      "authors",
    );
    expect(
      blocks
        .filter((block) => block.id.startsWith("footer-"))
        .map((block) => [block.type, block.translatable]),
    ).toEqual([
      ["running-footer", false],
      ["running-footer", false],
    ]);
    expect(
      blocks
        .filter(
          (block) =>
            block.id === "abstract-body" ||
            block.id === "right-continuation",
        )
        .sort((left, right) => left.readingOrder - right.readingOrder)
        .map((block) => block.id),
    ).toEqual(["abstract-body", "right-continuation"]);
  });

  it("does not treat a centered abstract label as a right column", () => {
    const makeBlock = (
      id: string,
      type: DocumentBlock["type"],
      text: string,
      y: number,
      x: number,
      width: number,
    ): DocumentBlock => ({
      id,
      documentId: "paper",
      pageNumber: 1,
      type,
      text,
      bbox: { x, y, width, height: 0.03 },
      fontSize: type === "heading" || type === "title" ? 14 : 10,
      readingOrder: 0,
      translatable: type === "paragraph",
    });
    const blocks = normalizeDocumentBlocks([
      makeBlock("title", "title", "A Systems Paper", 0.1, 0.12, 0.76),
      makeBlock("authors", "authors", "Ada Researcher", 0.22, 0.38, 0.24),
      makeBlock("abstract-label", "heading", "A BSTRACT", 0.35, 0.44, 0.12),
      makeBlock(
        "abstract-body",
        "paragraph",
        "This paper presents the method.",
        0.39,
        0.12,
        0.76,
      ),
      makeBlock("intro", "heading", "1 Introduction", 0.58, 0.08, 0.22),
      makeBlock(
        "intro-body",
        "paragraph",
        "The introduction begins here.",
        0.62,
        0.12,
        0.76,
      ),
    ]);

    expect(blocks.map((block) => block.id)).toEqual([
      "title",
      "authors",
      "abstract-label",
      "abstract-body",
      "intro",
      "intro-body",
    ]);
  });

  it("keeps wrapped caption lines in the caption instead of body prose", () => {
    const blocks = normalizeDocumentBlocks([
      {
        id: "caption",
        documentId: "paper",
        pageNumber: 1,
        type: "figure-caption",
        text: "Figure 1: Cache hierarchy overview.",
        bbox: { x: 0.08, y: 0.31, width: 0.4, height: 0.018 },
        fontSize: 8,
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "caption-continuation",
        documentId: "paper",
        pageNumber: 1,
        type: "paragraph",
        text: "The arrows show movement across cache levels.",
        bbox: { x: 0.08, y: 0.331, width: 0.4, height: 0.036 },
        fontSize: 8,
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "body",
        documentId: "paper",
        pageNumber: 1,
        type: "paragraph",
        text: "Strata uses this hierarchy to reduce recomputation.",
        bbox: { x: 0.08, y: 0.405, width: 0.4, height: 0.05 },
        fontSize: 10,
        readingOrder: 2,
        translatable: true,
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      id: "caption",
      type: "figure-caption",
      text:
        "Figure 1: Cache hierarchy overview. " +
        "The arrows show movement across cache levels.",
    });
    expect(blocks[0].bbox.height).toBeCloseTo(0.057);
    expect(blocks[1].id).toBe("body");
  });

  it("keeps a wrapped numbered section title in one heading block", () => {
    const blocks = normalizeDocumentBlocks([
      {
        id: "abstract-label",
        documentId: "paper",
        pageNumber: 1,
        type: "abstract",
        text: "Abstract",
        bbox: { x: 0.2, y: 0.1, width: 0.1, height: 0.014 },
        fontSize: 10,
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "heading",
        documentId: "paper",
        pageNumber: 1,
        type: "heading",
        text: "5.2.1 How does the performance compare",
        bbox: { x: 0.08, y: 0.2, width: 0.4, height: 0.014 },
        fontSize: 10,
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "heading-tail",
        documentId: "paper",
        pageNumber: 1,
        type: "paragraph",
        text: "to state-of-the-art serving systems?",
        bbox: { x: 0.13, y: 0.216, width: 0.35, height: 0.028 },
        fontSize: 10,
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "body",
        documentId: "paper",
        pageNumber: 1,
        type: "paragraph",
        text: "The experiment compares all baselines.",
        bbox: { x: 0.08, y: 0.27, width: 0.4, height: 0.05 },
        fontSize: 10,
        readingOrder: 2,
        translatable: true,
      },
    ]);

    expect(blocks).toHaveLength(3);
    expect(blocks.find((block) => block.id === "heading")).toMatchObject({
      id: "heading",
      type: "heading",
      text:
        "5.2.1 How does the performance compare " +
        "to state-of-the-art serving systems?",
      translatable: false,
    });
    expect(blocks.find((block) => block.id === "body")?.type).toBe(
      "paragraph",
    );
  });

  it("separates a short wrapped heading tail from the following body", () => {
    const blocks = normalizeDocumentBlocks(
      groupPageTextItems(
        [
          {
            str: "Abstract",
            x: 150,
            y: 740,
            width: 60,
            height: 10,
            fontSize: 10,
          },
          {
            str: "5.3.2 Can Strata alleviate the burden of choosing a page",
            x: 72,
            y: 700,
            width: 235,
            height: 10,
            fontSize: 10,
          },
          {
            str: "size?",
            x: 100,
            y: 687,
            width: 28,
            height: 10,
            fontSize: 10,
          },
          {
            str: "As discussed earlier, page size introduces trade-offs.",
            x: 72,
            y: 674,
            width: 230,
            height: 10,
            fontSize: 10,
          },
        ],
        {
          documentId: "paper",
          pageNumber: 1,
          pageWidth: 600,
          pageHeight: 800,
        },
      ),
    );

    expect(
      blocks.find((block) => block.type === "heading")?.text,
    ).toBe(
      "5.3.2 Can Strata alleviate the burden of choosing a page size?",
    );
    expect(
      blocks.find((block) =>
        block.text.startsWith("As discussed earlier"),
      )?.type,
    ).toBe("paragraph");
  });

  it("keeps source code as a non-translatable vector block", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "const cachedPages = pages.filter((page) => page.valid);",
          x: 72,
          y: 700,
          width: 260,
          height: 9,
          fontSize: 9,
        },
      ],
      {
        documentId: "paper",
        pageNumber: 3,
        pageWidth: 600,
        pageHeight: 800,
      },
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "code-listing",
      translatable: false,
    });
  });

  it("keeps superscript dimensions in their surrounding prose line", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "hidden states (T ∈ R",
          x: 72,
          y: 700,
          width: 100,
          height: 11,
          fontSize: 11,
        },
        {
          str: "n × h",
          x: 164,
          y: 706,
          width: 22,
          height: 8,
          fontSize: 8,
        },
        {
          str: ") from the embedding model.",
          x: 187,
          y: 700,
          width: 126,
          height: 11,
          fontSize: 11,
        },
      ],
      {
        documentId: "paper",
        pageNumber: 6,
        pageWidth: 600,
        pageHeight: 800,
      },
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(
      "hidden states (T ∈ R n × h) from the embedding model.",
    );
  });
});
describe("document references", () => {
  it("detects references and resolves them to caption blocks", () => {
    const blocks = [
      {
        id: "p1-b0",
        documentId: "doc",
        pageNumber: 1,
        type: "paragraph" as const,
        text:
          "As shown in Fig. 2 and Table 1, Algorithm 3 reduces latency.",
        bbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.08 },
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "p4-b0",
        documentId: "doc",
        pageNumber: 4,
        type: "figure-caption" as const,
        text: "Figure 2. End-to-end latency.",
        bbox: { x: 0.12, y: 0.72, width: 0.65, height: 0.06 },
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "p5-b0",
        documentId: "doc",
        pageNumber: 5,
        type: "table-caption" as const,
        text: "Table 1. Accuracy results.",
        bbox: { x: 0.1, y: 0.15, width: 0.7, height: 0.05 },
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "p6-b0",
        documentId: "doc",
        pageNumber: 6,
        type: "equation" as const,
        text: "Algorithm 3 Balanced Batch Formation 1: procedure BuildBatch(Q)",
        bbox: { x: 0.1, y: 0.15, width: 0.4, height: 0.28 },
        readingOrder: 0,
        translatable: false,
      },
    ];

    const detected = detectDocumentReferences(blocks);
    expect(detected.map((reference) => reference.label)).toEqual([
      "Fig. 2",
      "Table 1",
      "Algorithm 3",
    ]);
    expect(
      detected.map(({ kind, sourceStart, sourceEnd }) => ({
        kind,
        sourceStart,
        sourceEnd,
      })),
    ).toEqual([
      { kind: "figure", sourceStart: 12, sourceEnd: 18 },
      { kind: "table", sourceStart: 23, sourceEnd: 30 },
      { kind: "code", sourceStart: 32, sourceEnd: 43 },
    ]);

    const resolved = resolveDocumentReferences(blocks, detected);
    expect(resolved.map((reference) => reference.targetPageNumber)).toEqual([
      4, 5, 6,
    ]);
  });

  it("resolves subfigure references to the complete parent figure", () => {
    const blocks = [
      {
        id: "body",
        documentId: "doc",
        pageNumber: 3,
        type: "paragraph" as const,
        text:
          "Figure 2a shows routing while Figure 5 A shows batch formation.",
        bbox: { x: 0.08, y: 0.22, width: 0.4, height: 0.08 },
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "figure-2-caption",
        documentId: "doc",
        pageNumber: 4,
        type: "figure-caption" as const,
        text: "Figure 2: End-to-end architecture.",
        bbox: { x: 0.08, y: 0.48, width: 0.4, height: 0.04 },
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "figure-5-caption",
        documentId: "doc",
        pageNumber: 7,
        type: "figure-caption" as const,
        text: "Figure 5: Batch formation.",
        bbox: { x: 0.08, y: 0.48, width: 0.4, height: 0.04 },
        readingOrder: 2,
        translatable: true,
      },
    ];

    const resolved = resolveDocumentReferences(blocks);

    expect(resolved).toMatchObject([
      {
        label: "Figure 2a",
        number: "2",
        subpart: "a",
        targetBlockId: "figure-2-caption",
        targetPageNumber: 4,
      },
      {
        label: "Figure 5 A",
        number: "5",
        subpart: "a",
        targetBlockId: "figure-5-caption",
        targetPageNumber: 7,
      },
    ]);
  });

  it("does not create hotspots from bibliography entries", () => {
    const blocks = [
      {
        id: "body",
        documentId: "doc",
        pageNumber: 2,
        type: "paragraph" as const,
        text: "Figure 2 shows the result.",
        bbox: { x: 0.1, y: 0.2, width: 0.38, height: 0.06 },
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "reference",
        documentId: "doc",
        pageNumber: 9,
        type: "reference-entry" as const,
        text: "[4] Figure 8 benchmark dataset, 2025.",
        bbox: { x: 0.1, y: 0.2, width: 0.38, height: 0.06 },
        readingOrder: 1,
        translatable: false,
      },
    ];

    expect(
      detectDocumentReferences(blocks).map((reference) => reference.label),
    ).toEqual(["Figure 2"]);
  });

  it("classifies localized Korean labels as captions", () => {
    const blocks = groupPageTextItems(
      [
        {
          str: "그림 2: 처리량과 지연 시간 비교.",
          x: 60,
          y: 350,
          width: 210,
          height: 8,
          fontSize: 8,
        },
      ],
      {
        documentId: "paper-ko",
        pageNumber: 3,
        pageWidth: 600,
        pageHeight: 800,
      },
    );

    expect(blocks[0].type).toBe("figure-caption");
  });
});
