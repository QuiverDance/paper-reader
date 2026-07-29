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
