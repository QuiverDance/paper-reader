import { describe, expect, it, vi } from "vitest";
import {
  parseDocumentStructureResponse,
  planDocumentStructureWindows,
  reconstructDocumentStructure,
} from "../src/lib/document-structure";
import { analyzeSemanticPaper } from "../src/lib/semantic-paper";
import { groupTranslationParagraphs } from "../src/lib/translation-paragraphs";
import type { LlmMessage } from "../src/lib/llm";
import type {
  DocumentBlock,
  DocumentSourceLine,
  LlmTokenUsage,
} from "../src/types";

function line(
  id: string,
  text: string,
  pageNumber = 6,
): DocumentSourceLine {
  return {
    id,
    pageNumber,
    column: 2,
    text,
    bbox: {
      x: 0.52,
      y: 0.1 + Number(id.replace(/\D/g, "")) * 0.02,
      width: 0.4,
      height: 0.012,
    },
    fontSize: 10,
    fontWeight: "normal",
    fontStyle: "normal",
  };
}

function fragment(
  id: string,
  text: string,
  sourceLines: DocumentSourceLine[],
  type: DocumentBlock["type"] = "paragraph",
): DocumentBlock {
  return {
    id,
    documentId: "strata",
    pageNumber: sourceLines[0].pageNumber,
    type,
    text,
    bbox: sourceLines[0].bbox,
    fontSize: 10,
    sourceStyle: {
      fontWeight: "normal",
      fontStyle: "normal",
      paragraphStart: true,
    },
    sourceLines,
    readingOrder: 0,
    translatable: type === "paragraph",
  };
}

const exactUsage: LlmTokenUsage = {
  inputTokens: 120,
  outputTokens: 18,
  totalTokens: 138,
  estimated: false,
};

describe("LLM document structure reconstruction", () => {
  it("grounds subfigure mentions while targeting the complete parent figure", async () => {
    const blocks = [
      fragment(
        "body",
        "As shown in Figure 2a, the router prunes inactive agents.",
        [
          line(
            "body-line",
            "As shown in Figure 2a, the router prunes inactive agents.",
            3,
          ),
        ],
      ),
      fragment(
        "caption",
        "Figure 2: Tree-structured routing.",
        [
          line(
            "caption-line",
            "Figure 2: Tree-structured routing.",
            4,
          ),
        ],
        "figure-caption",
      ),
    ];
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [
          { kind: "paragraph", ranges: [[1, 1]] },
          { kind: "figure-caption", ranges: [[2, 2]] },
        ],
        references: [
          {
            lineId: 1,
            label: "Figure 2a",
            subpart: "a",
            target: {
              kind: "figure",
              number: "2",
            },
          },
        ],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "batchgen",
      blocks,
      maxContextSize: 128_000,
      complete,
    });

    expect(reconstructed.references).toMatchObject([
      {
        label: "Figure 2a",
        number: "2",
        subpart: "a",
        sourcePageNumber: 3,
        targetBlockId: "batchgen-structure-2-2",
        targetPageNumber: 4,
      },
    ]);
  });

  it("restores the Strata sentence instead of promoting its number to a section", async () => {
    const blocks = [
      fragment(
        "before",
        "Strata confines kernels to a small subset of SMs, as few as",
        [line("l1", "Strata confines kernels to a small subset of SMs, as few as")],
      ),
      fragment(
        "false-heading",
        "1. This targeted allocation, when combined with low-level in-",
        [line("l2", "1. This targeted allocation, when combined with low-level in-")],
        "heading",
      ),
      fragment(
        "after",
        "structions to bypass the cache, minimizes interference.",
        [line("l3", "structions to bypass the cache, minimizes interference.")],
      ),
      fragment(
        "real-heading",
        "4.2 Cache-Aware Scheduling",
        [line("l4", "4.2 Cache-Aware Scheduling")],
        "heading",
      ),
    ];
    let capturedMessages: LlmMessage[] = [];
    const complete = vi.fn(async (messages: LlmMessage[]) => {
      capturedMessages = messages;
      return {
        content: JSON.stringify({
          blocks: [
            { kind: "paragraph", ranges: [[1, 3]] },
            { kind: "heading", level: 2, ranges: [[4, 4]] },
          ],
        }),
        usage: exactUsage,
      };
    });

    const reconstructed = await reconstructDocumentStructure({
      documentId: "strata",
      blocks,
      maxContextSize: 128_000,
      complete,
    });
    const paragraphs = groupTranslationParagraphs(
      reconstructed.blocks.filter((block) => block.type === "paragraph"),
    );
    const paper = analyzeSemanticPaper(reconstructed.blocks);
    const structureInput = JSON.parse(
      capturedMessages[1].content,
    ) as {
      lines: Array<{ id: number; i: number; y: number }>;
    };

    expect(complete).toHaveBeenCalledOnce();
    expect(structureInput.lines[0]).toMatchObject({
      id: 1,
      i: 520,
      y: 120,
    });
    expect(paragraphs[0].text).toBe(
      "Strata confines kernels to a small subset of SMs, as few as 1. This targeted allocation, when combined with low-level instructions to bypass the cache, minimizes interference.",
    );
    expect(
      paper.sections.some((section) =>
        /targeted allocation/i.test(section.title),
      ),
    ).toBe(false);
    expect(paper.sections.some((section) => section.title === "4.2 Cache-Aware Scheduling")).toBe(true);
    expect(reconstructed.usage).toEqual(exactUsage);
  });

  it("keeps the Strata 3.1 sentence together across a page boundary even when the model splits it", async () => {
    const pageTail: DocumentSourceLine = {
      ...line("page-tail", "imum supported size in vLLM for CUDA GPUs [48]. This", 4),
      column: 2,
      bbox: { x: 0.57, y: 0.88, width: 0.37, height: 0.018 },
    };
    const pageHead: DocumentSourceLine = {
      ...line(
        "page-head",
        "underutilization is exacerbated on platforms with even higher",
        5,
      ),
      column: 1,
      bbox: { x: 0.08, y: 0.36, width: 0.39, height: 0.018 },
    };
    const pageFooter: DocumentSourceLine = {
      ...line(
        "page-footer",
        "20th USENIX Symposium on Operating Systems Design and Implementation 3",
        4,
      ),
      column: 2,
      bbox: { x: 0.35, y: 0.95, width: 0.59, height: 0.018 },
    };
    const figureCaption: DocumentSourceLine = {
      ...line(
        "figure-caption",
        "Figure 3: Latency and bandwidth utilization of loading KV caches.",
        5,
      ),
      column: 1,
      bbox: { x: 0.08, y: 0.26, width: 0.39, height: 0.05 },
    };
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [
          { kind: "paragraph", ranges: [[1, 1]] },
          { kind: "running-footer", ranges: [[2, 2]] },
          { kind: "figure-caption", ranges: [[3, 3]] },
          { kind: "paragraph", ranges: [[4, 4]] },
        ],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "strata",
      blocks: [
        fragment("page-4-tail", pageTail.text, [pageTail]),
        fragment(
          "page-4-footer",
          pageFooter.text,
          [pageFooter],
          "running-footer",
        ),
        fragment(
          "page-5-figure-caption",
          figureCaption.text,
          [figureCaption],
          "figure-caption",
        ),
        fragment("page-5-head", pageHead.text, [pageHead]),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(
      groupTranslationParagraphs(
        reconstructed.blocks.filter(
          (block) => block.type === "paragraph",
        ),
      ).map((paragraph) => paragraph.text),
    ).toEqual([
      "imum supported size in vLLM for CUDA GPUs [48]. This underutilization is exacerbated on platforms with even higher",
    ]);
  });

  it("never joins a bottom footnote to body prose in the next column", () => {
    const footnote: DocumentBlock = {
      ...fragment(
        "physical-footnote",
        "* Equal contribution.",
        [
          {
            ...line("physical-footnote-1", "* Equal contribution.", 2),
            column: 1,
            bbox: { x: 0.106, y: 0.898, width: 0.13, height: 0.011 },
            fontSize: 7.9701,
          },
        ],
        "footnote",
      ),
      logicalBlockId: "physical-footnote",
      readingOrder: 9,
      fontSize: 7.9701,
      bbox: { x: 0.106, y: 0.898, width: 0.13, height: 0.011 },
      translatable: true,
    };
    const body: DocumentBlock = {
      ...fragment(
        "physical-body",
        "Normal body prose continues at the top of the next column.",
        [
          {
            ...line(
              "physical-body-1",
              "Normal body prose continues at the top of the next column.",
              2,
            ),
            column: 2,
            bbox: { x: 0.519, y: 0.268, width: 0.395, height: 0.012 },
            fontSize: 9.9626,
          },
        ],
      ),
      logicalBlockId: "physical-body",
      readingOrder: 10,
      fontSize: 9.9626,
      bbox: { x: 0.519, y: 0.268, width: 0.395, height: 0.012 },
      sourceStyle: {
        fontWeight: "normal",
        fontStyle: "normal",
        paragraphStart: false,
      },
      translatable: true,
    };

    expect(
      groupTranslationParagraphs([footnote, body]).map(
        (paragraph) => paragraph.text,
      ),
    ).toEqual([footnote.text, body.text]);
  });

  it("repairs prose that the model mislabeled as preserved math or code", async () => {
    const prose = [
      line(
        "prose-1",
        "and when cache loading stalls are unavoidable, the scheduler",
      ),
      line("prose-2", "prioritizes requests whose data is already available."),
    ];
    const actualEquation = line("equation-3", "C = λ · L");
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [
          { kind: "equation", ranges: [[1, 1]] },
          { kind: "code-listing", ranges: [[2, 2]] },
          { kind: "equation", ranges: [[3, 3]] },
        ],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "strata",
      blocks: [
        fragment("prose-1", prose[0].text, [prose[0]]),
        fragment("prose-2", prose[1].text, [prose[1]]),
        fragment(
          "actual-equation",
          actualEquation.text,
          [actualEquation],
          "equation",
        ),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(
      reconstructed.blocks.map((block) => [block.type, block.text]),
    ).toEqual([
      ["paragraph", prose[0].text],
      ["paragraph", prose[1].text],
      ["equation", actualEquation.text],
    ]);
    expect(
      analyzeSemanticPaper(reconstructed.blocks).translatableBlockIds,
    ).toEqual([
      reconstructed.blocks[0].id,
      reconstructed.blocks[1].id,
    ]);
  });

  it("repairs a bold lead sentence that the model expands into a heading", async () => {
    const lead = line(
      "lead-1",
      "1 Redundant connections among agents. Most existing MoA systems adopt an all-to-all agent",
      1,
    );
    const continuation = line(
      "lead-2",
      "connection topology, as illustrated in Fig. 1(i).",
      1,
    );
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [
          { kind: "heading", level: 1, ranges: [[1, 1]] },
          { kind: "paragraph", ranges: [[2, 2]] },
        ],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: [
        fragment("bold-lead", lead.text, [lead], "heading"),
        fragment("continuation", continuation.text, [continuation]),
      ],
      maxContextSize: 128_000,
      complete,
    });
    const paper = analyzeSemanticPaper(reconstructed.blocks);

    expect(reconstructed.blocks[0]).toMatchObject({
      type: "paragraph",
      text: lead.text,
      sourceStyle: {
        fontWeight: "normal",
        boldLead: true,
      },
      translatable: true,
    });
    expect(paper.translatableBlockIds).toContain(
      reconstructed.blocks[0].id,
    );
    expect(
      paper.sections.some((section) =>
        section.title.includes("Redundant connections"),
      ),
    ).toBe(false);
  });

  it("separates prose from equations when the model preserves them as one block", async () => {
    const mixedLines = [
      line(
        "mixed-1",
        "The E2E latency accumulates these worst-case layer times,",
        5,
      ),
      line("mixed-2", "P all = Σ T ℓ.", 5),
      line(
        "mixed-3",
        "In the proposed tree topology, each successor waits only for its connected precursors, so the",
        5,
      ),
      line(
        "mixed-4",
        "inference latency of a layer is optimized to:",
        5,
      ),
      line("mixed-5", "T ℓ = max max t c,", 5),
    ];
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [{ kind: "equation", ranges: [[1, 5]] }],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: mixedLines.map((sourceLine, index) =>
        fragment(
          `mixed-${index + 1}`,
          sourceLine.text,
          [sourceLine],
          index === 1 || index === 4 ? "equation" : "paragraph",
        ),
      ),
      maxContextSize: 128_000,
      complete,
    });
    const paper = analyzeSemanticPaper(reconstructed.blocks);

    expect(
      reconstructed.blocks.map((block) => [block.type, block.text]),
    ).toEqual([
      ["paragraph", mixedLines[0].text],
      ["equation", mixedLines[1].text],
      [
        "paragraph",
        mixedLines[2].text,
      ],
      ["paragraph", mixedLines[3].text],
      ["equation", mixedLines[4].text],
    ]);
    expect(
      groupTranslationParagraphs(
        reconstructed.blocks.filter((block) =>
          paper.translatableBlockIds.includes(block.id),
        ),
      ).map((paragraph) => paragraph.text),
    ).toEqual([
      mixedLines[0].text,
      `${mixedLines[2].text} ${mixedLines[3].text}`,
    ]);
  });

  it("separates prose and math when the model calls the mixed block code", async () => {
    const mixedLines = [
      line(
        "code-mixed-1",
        "The E2E latency accumulates these worst-case layer times,",
        5,
      ),
      line("code-mixed-2", "P all = Σ T ℓ.", 5),
      line(
        "code-mixed-3",
        "Each successor waits only for its connected precursor agents.",
        5,
      ),
      line("code-mixed-4", "T ℓ = max max t c,", 5),
    ];
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [{ kind: "code-listing", ranges: [[1, 4]] }],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: mixedLines.map((sourceLine, index) =>
        fragment(
          `code-mixed-${index + 1}`,
          sourceLine.text,
          [sourceLine],
          index === 1 || index === 3 ? "equation" : "paragraph",
        ),
      ),
      maxContextSize: 128_000,
      complete,
    });

    expect(
      reconstructed.blocks.map((block) => block.type),
    ).toEqual([
      "paragraph",
      "equation",
      "paragraph",
      "equation",
    ]);
  });

  it("separates a numbered algorithm caption from its preserved code", async () => {
    const algorithmLines = [
      line(
        "algorithm-1",
        "Algorithm 1 Semantic Similarity and Confidence-based Early Exit",
        6,
      ),
      line(
        "algorithm-2",
        "Input metric matrices and confidence scores.",
        6,
      ),
      line("algorithm-3", "C = Σ i C i", 6),
    ];
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [{ kind: "code-listing", ranges: [[1, 3]] }],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: [
        fragment(
          "algorithm",
          algorithmLines.map((item) => item.text).join(" "),
          algorithmLines,
          "code-listing",
        ),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(
      reconstructed.blocks.map(({ type, text, translatable }) => ({
        type,
        text,
        translatable,
      })),
    ).toEqual([
      {
        type: "code-caption",
        text: algorithmLines[0].text,
        translatable: true,
      },
      {
        type: "code-listing",
        text: algorithmLines.slice(1).map((item) => item.text).join(" "),
        translatable: false,
      },
    ]);
  });

  it("repairs a numbered algorithm caption even when the model calls it a paragraph", async () => {
    const algorithmLines = [
      line(
        "algorithm-paragraph-1",
        "Algorithm 1 Semantic Similarity and Confidence-based Early Exit",
        6,
      ),
      line(
        "algorithm-paragraph-2",
        "1: function METRICQ(outputs, confidences)",
        6,
      ),
      line("algorithm-paragraph-3", "2: return score", 6),
    ];
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [{ kind: "paragraph", ranges: [[1, 3]] }],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: [
        fragment(
          "algorithm-paragraph",
          algorithmLines.map((item) => item.text).join(" "),
          algorithmLines,
          "code-listing",
        ),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(
      reconstructed.blocks.map(({ type, text, translatable }) => ({
        type,
        text,
        translatable,
      })),
    ).toEqual([
      {
        type: "code-caption",
        text: algorithmLines[0].text,
        translatable: true,
      },
      {
        type: "code-listing",
        text: algorithmLines.slice(1).map((item) => item.text).join(" "),
        translatable: false,
      },
    ]);
  });

  it("does not promote an Algorithm reference sentence to a code caption", async () => {
    const proseLines = [
      line(
        "algorithm-prose-1",
        "Algorithm 1 shows our innovative agent early-exit mechanism that jointly considers output confidence and",
        6,
      ),
      line(
        "algorithm-prose-2",
        "semantic-level similarity.",
        6,
      ),
    ];
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [{ kind: "code-listing", ranges: [[1, 2]] }],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: [
        fragment(
          "algorithm-prose",
          proseLines.map((item) => item.text).join(" "),
          proseLines,
          "code-listing",
        ),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(
      reconstructed.blocks.map(({ type, text, translatable }) => ({
        type,
        text,
        translatable,
      })),
    ).toEqual([
      {
        type: "paragraph",
        text: proseLines.map((item) => item.text).join(" "),
        translatable: true,
      },
    ]);
  });

  it("repairs figure and table captions that the model calls paragraphs", async () => {
    const figureLines = [
      line("figure-caption-1", "Figure 2: Faster-MoA overview from three dimensions.", 5),
      line("figure-caption-2", "The design uses three underlying LLM sizes.", 5),
    ];
    const bodyLine = line(
      "figure-body",
      "Figure 2 shows how the requests move through the serving system.",
      5,
    );
    const tableLine = line(
      "table-caption",
      "Table 1: End-to-end latency across benchmarks.",
      9,
    );
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [
          { kind: "paragraph", ranges: [[1, 3]] },
          { kind: "paragraph", ranges: [[4, 4]] },
        ],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: [
        fragment(
          "figure-caption",
          figureLines.map((item) => item.text).join(" "),
          figureLines,
          "figure-caption",
        ),
        fragment("figure-body", bodyLine.text, [bodyLine], "paragraph"),
        fragment("table-caption", tableLine.text, [tableLine], "table-caption"),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(
      reconstructed.blocks.map(({ type, text }) => ({ type, text })),
    ).toEqual([
      {
        type: "figure-caption",
        text: figureLines.map((item) => item.text).join(" "),
      },
      {
        type: "paragraph",
        text: bodyLine.text,
      },
      {
        type: "table-caption",
        text: tableLine.text,
      },
    ]);
  });

  it("does not crop distant equations and the prose between them as one rectangle", async () => {
    const upperLeft: DocumentSourceLine = {
      ...line("crop-1", "P =", 5),
      bbox: { x: 0.807, y: 0.814, width: 0.073, height: 0.019 },
    };
    const upperRight: DocumentSourceLine = {
      ...line("crop-2", "∑ ℓ = 1 T ℓ", 5),
      bbox: { x: 0.826, y: 0.824, width: 0.06, height: 0.018 },
    };
    const lowerEquation: DocumentSourceLine = {
      ...line("crop-3", "T ≈ max t", 5),
      bbox: { x: 0.445, y: 0.888, width: 0.156, height: 0.025 },
    };
    const complete = vi.fn(async () => ({
      content: JSON.stringify({
        blocks: [{ kind: "equation", ranges: [[1, 3]] }],
      }),
      usage: exactUsage,
    }));

    const reconstructed = await reconstructDocumentStructure({
      documentId: "faster-moa",
      blocks: [
        fragment("upper-left", upperLeft.text, [upperLeft], "equation"),
        fragment("upper-right", upperRight.text, [upperRight], "equation"),
        fragment(
          "lower-equation",
          lowerEquation.text,
          [lowerEquation],
          "equation",
        ),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(reconstructed.blocks).toHaveLength(2);
    expect(reconstructed.blocks.map((block) => block.type)).toEqual([
      "equation",
      "equation",
    ]);
    expect(reconstructed.blocks[0].bbox.height).toBeLessThan(0.04);
    expect(reconstructed.blocks[1].bbox.y).toBeGreaterThan(0.87);
  });

  it("rejects a structure response that omits source lines", () => {
    expect(() =>
      parseDocumentStructureResponse(
        JSON.stringify({
          blocks: [{ kind: "paragraph", ranges: [[1, 2]] }],
        }),
        { start: 1, end: 3 },
      ),
    ).toThrow(/누락/);
  });

  it("accepts a corrected structure response on the third attempt", async () => {
    let attempts = 0;
    const complete = vi.fn(async () => {
      attempts += 1;
      return {
        content: JSON.stringify({
          blocks:
            attempts < 3
              ? [
                  { kind: "paragraph", ranges: [[1, 1]] },
                  { kind: "paragraph", ranges: [[1, 1]] },
                ]
              : [{ kind: "paragraph", ranges: [[1, 1]] }],
        }),
        usage: exactUsage,
      };
    });

    const reconstructed = await reconstructDocumentStructure({
      documentId: "retry",
      blocks: [
        fragment(
          "retry-block",
          "A valid paragraph.",
          [line("retry-1", "A valid paragraph.")],
        ),
      ],
      maxContextSize: 128_000,
      complete,
    });

    expect(reconstructed.blocks).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(reconstructed.requestCount).toBe(3);
  });

  it("accepts one logical paragraph split around preserved page material", () => {
    expect(
      parseDocumentStructureResponse(
        JSON.stringify({
          blocks: [
            {
              kind: "paragraph",
              ranges: [
                [1, 1],
                [4, 4],
              ],
            },
            { kind: "running-footer", ranges: [[2, 2]] },
            { kind: "figure-caption", ranges: [[3, 3]] },
          ],
        }),
        { start: 1, end: 4 },
      )[0],
    ).toMatchObject({
      kind: "paragraph",
      ranges: [
        [1, 1],
        [4, 4],
      ],
      start: 1,
      end: 4,
    });
  });

  it("uses large token-budget windows rather than one request per line", () => {
    const lines = Array.from({ length: 240 }, (_, index) => ({
      sequence: index + 1,
      source: line(
        `line-${index + 1}`,
        `A dense academic source line number ${index + 1} with enough text to consume tokens.`,
        Math.floor(index / 30) + 1,
      ),
      hint: "paragraph" as const,
      sourceBlockId: `block-${index + 1}`,
    }));

    const windows = planDocumentStructureWindows(lines, 1_200);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows.length).toBeLessThan(20);
    expect(windows[0].targetStart).toBe(1);
    expect(windows.at(-1)?.targetEnd).toBe(240);
  });
});
