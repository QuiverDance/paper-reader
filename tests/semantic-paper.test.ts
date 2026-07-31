import { describe, expect, it } from "vitest";
import { groupPageTextItems } from "../src/lib/document-blocks";
import {
  analyzeSemanticPaper,
  createRetypesetProject,
  inferAssetRect,
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

  it("does not turn bold chart text into a paper section", () => {
    const blocks = [
      {
        ...block("h31", "heading", "3.1 Transfer Efficiency", 4, 0),
        bbox: { x: 0.52, y: 0.72, width: 0.38, height: 0.02 },
      },
      {
        ...block(
          "paragraph-start",
          "paragraph",
          "This paragraph begins before the page break and continues",
          4,
          1,
          0.52,
        ),
        bbox: { x: 0.52, y: 0.78, width: 0.38, height: 0.11 },
      },
      {
        ...block(
          "chart-axis",
          "heading",
          "32 Theoretical Bandwidth (GB/s)",
          5,
          0,
          0.2,
          0.17,
        ),
        bbox: { x: 0.2, y: 0.18, width: 0.17, height: 0.02 },
        fontSize: 11,
      },
      {
        ...block(
          "caption",
          "figure-caption",
          "Figure 3: Bandwidth utilization.",
          5,
          1,
        ),
        bbox: { x: 0.09, y: 0.27, width: 0.39, height: 0.025 },
        fontSize: 7,
      },
      {
        ...block(
          "paragraph-end",
          "paragraph",
          "underutilization on platforms with faster interconnects.",
          5,
          2,
        ),
        bbox: { x: 0.09, y: 0.33, width: 0.39, height: 0.08 },
      },
      {
        ...block("h32", "heading", "3.2 Scheduling", 5, 3),
        bbox: { x: 0.09, y: 0.46, width: 0.39, height: 0.02 },
      },
    ];

    const paper = analyzeSemanticPaper(blocks);
    const transfer = paper.sections.find(
      (section) => section.title === "3.1 Transfer Efficiency",
    );

    expect(paper.assets[0].contentBlockIds).toContain("chart-axis");
    expect(paper.sections.map((section) => section.title)).not.toContain(
      "32 Theoretical Bandwidth (GB/s)",
    );
    expect(transfer?.blockIds).toContain("paragraph-end");
    expect(paper.blockSectionIds["paragraph-end"]).toBe(transfer?.id);
  });

  it("keeps a malformed chart block with an oversized bbox inside its figure", () => {
    const blocks = [
      {
        ...block(
          "chart-fragment",
          "equation",
          "Agent 2 4B 100% 82% Layer #1 Layer #2",
          2,
          0,
          0.12,
          0.59,
        ),
        bbox: { x: 0.12, y: 0.16, width: 0.59, height: 0.47 },
        translatable: false,
      },
      {
        ...block(
          "caption",
          "figure-caption",
          "Figure 1: Conventional all-to-all connected MoA system.",
          2,
          1,
          0.045,
          0.91,
        ),
        bbox: { x: 0.045, y: 0.33, width: 0.91, height: 0.03 },
      },
      {
        ...block(
          "body",
          "paragraph",
          "The translated body begins below the figure.",
          2,
          2,
          0.08,
          0.39,
        ),
        bbox: { x: 0.08, y: 0.39, width: 0.39, height: 0.08 },
      },
    ];

    const paper = analyzeSemanticPaper(blocks);

    expect(paper.assets[0].bbox).toMatchObject({
      x: 0.045,
      width: 0.91,
    });
    expect(paper.assets[0].contentBlockIds).toContain("chart-fragment");
  });

  it("excludes leading cover pages and running furniture from the paper flow", () => {
    const blocks = [
      block("cover", "title", "Conference Proceedings", 1, 0, 0.1, 0.8),
      block("paper-title", "title", "A Systems Paper", 2, 0, 0.1, 0.8),
      block("authors", "authors", "Ada Researcher", 2, 1, 0.1, 0.8),
      block("abstract-label", "abstract", "Abstract", 2, 2),
      block("abstract-body", "abstract", "The abstract body.", 2, 3),
      block("intro", "heading", "1 Introduction", 2, 4),
      block("body", "paragraph", "The body begins.", 2, 5),
      block(
        "footer",
        "running-footer",
        "Systems Conference 1",
        2,
        6,
      ),
    ];

    const paper = analyzeSemanticPaper(blocks);

    expect(paper.contentStartPage).toBe(2);
    expect(paper.translatableBlockIds).toEqual(["abstract-body", "body"]);
    expect(paper.preservedBlockIds).toEqual(
      expect.arrayContaining(["cover", "paper-title", "authors", "footer"]),
    );
  });

  it("captures chart labels inside the figure instead of using them as its top edge", () => {
    const blocks = [
      block("right-body", "paragraph", "Right-column body prose ".repeat(8), 3, 0, 0.52),
      {
        ...block("tick", "paragraph", "1.0", 3, 1, 0.11, 0.02),
        bbox: { x: 0.11, y: 0.1, width: 0.02, height: 0.01 },
      },
      {
        ...block(
          "legend",
          "heading",
          "CDF of Load / Compute Ratio I/O Stall with Strata",
          3,
          2,
          0.26,
          0.19,
        ),
        bbox: { x: 0.26, y: 0.17, width: 0.19, height: 0.05 },
        fontSize: 6,
      },
      {
        ...block(
          "caption",
          "figure-caption",
          "Figure 1: Benchmark profile.",
          3,
          3,
          0.09,
          0.39,
        ),
        bbox: { x: 0.09, y: 0.34, width: 0.39, height: 0.02 },
      },
    ];

    const rect = inferAssetRect(
      blocks,
      blocks.find((candidate) => candidate.id === "caption")!,
    );

    expect(rect.y).toBeLessThanOrEqual(0.1);
    expect(rect.height).toBeGreaterThan(0.2);
  });

  it("treats a centered caption spanning the gutter as a full-width figure", () => {
    const columnBodies = [
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `left-${index}`,
          "paragraph",
          `Left-column body prose ${index}. `.repeat(8),
          11,
          index,
          0.08,
        ),
        bbox: {
          x: 0.08,
          y: 0.62 + index * 0.08,
          width: 0.39,
          height: 0.05,
        },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `right-${index}`,
          "paragraph",
          `Right-column body prose ${index}. `.repeat(8),
          11,
          index + 3,
          0.53,
        ),
        bbox: {
          x: 0.53,
          y: 0.62 + index * 0.08,
          width: 0.39,
          height: 0.05,
        },
      })),
    ];
    const caption = {
      ...block(
        "centered-caption",
        "figure-caption",
        "Figure 8: End-to-end benchmark performance comparison.",
        11,
        6,
        0.274,
        0.448,
      ),
      bbox: { x: 0.274, y: 0.56, width: 0.448, height: 0.013 },
    };

    const rect = inferAssetRect([...columnBodies, caption], caption);

    expect(rect).toMatchObject({ x: 0.045, width: 0.91 });
    expect(rect.y).toBeLessThanOrEqual(0.1);
    expect(rect.height).toBeGreaterThan(0.44);
  });

  it("keeps a narrow centered caption attached to its full-width figure", () => {
    const columnBodies = [
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `left-body-${index}`,
          "paragraph",
          "Left-column body prose. ".repeat(8),
          4,
          index,
          0.08,
        ),
        bbox: {
          x: 0.08,
          y: 0.56 + index * 0.1,
          width: 0.39,
          height: 0.08,
        },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `right-body-${index}`,
          "paragraph",
          "Right-column body prose. ".repeat(8),
          4,
          index + 3,
          0.53,
        ),
        bbox: {
          x: 0.53,
          y: 0.56 + index * 0.1,
          width: 0.39,
          height: 0.08,
        },
      })),
    ];
    const caption = {
      ...block(
        "batchgen-figure-2-caption",
        "figure-caption",
        "Figure 2: Challenges in MoE batch inference.",
        4,
        2,
        0.355,
        0.29,
      ),
      bbox: { x: 0.355, y: 0.285, width: 0.29, height: 0.018 },
    };

    expect(inferAssetRect([...columnBodies, caption], caption)).toMatchObject({
      x: 0.045,
      width: 0.91,
    });
  });

  it("keeps subfigure descriptions inside a full-width figure crop", () => {
    const blocks = [
      {
        ...block(
          "subfigure-i",
          "paragraph",
          "(i) Activation percentage of three candidate models on datasets (top) and dynamic early-exit latency breakdown (bottom).",
          10,
          0,
          0.09,
          0.39,
        ),
        bbox: { x: 0.09, y: 0.31, width: 0.39, height: 0.055 },
      },
      {
        ...block(
          "subfigure-ii",
          "paragraph",
          "(ii) Experiment results on datasets. Top: per-sample normalized latency. Bottom: overall test accuracies.",
          10,
          1,
          0.52,
          0.39,
        ),
        bbox: { x: 0.52, y: 0.31, width: 0.39, height: 0.055 },
      },
      {
        ...block(
          "subfigure-iii",
          "paragraph",
          "(iii) Normalized average second-layer latency with different prefill-decode optimizations.",
          10,
          2,
          0.27,
          0.46,
        ),
        bbox: { x: 0.27, y: 0.48, width: 0.46, height: 0.035 },
      },
      {
        ...block(
          "caption",
          "figure-caption",
          "Figure 4: Summary of performance and ablation results.",
          10,
          3,
          0.24,
          0.52,
        ),
        bbox: { x: 0.24, y: 0.56, width: 0.52, height: 0.025 },
      },
      {
        ...block(
          "next-heading",
          "heading",
          "5.3 Final Experiment & Result Discussions",
          10,
          4,
          0.09,
          0.82,
        ),
        bbox: { x: 0.09, y: 0.63, width: 0.82, height: 0.025 },
      },
    ];

    const rect = inferAssetRect(
      blocks,
      blocks.find((candidate) => candidate.id === "caption")!,
    );

    expect(rect.y).toBeLessThanOrEqual(0.1);
    expect(rect.height).toBeGreaterThan(0.44);
  });

  it("does not swallow an earlier caption when figures are stacked", () => {
    const columnBodies = [
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `left-${index}`,
          "paragraph",
          `Left-column prose ${index}.`,
          12,
          index,
          0.08,
        ),
        bbox: {
          x: 0.08,
          y: 0.55 + index * 0.08,
          width: 0.38,
          height: 0.05,
        },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `right-${index}`,
          "paragraph",
          `Right-column prose ${index}.`,
          12,
          index + 3,
          0.54,
        ),
        bbox: {
          x: 0.54,
          y: 0.55 + index * 0.08,
          width: 0.38,
          height: 0.05,
        },
      })),
    ];
    const blocks = [
      {
        ...block(
          "figure-11-reference",
          "paragraph",
          "Figure 11 compares the workload patterns in this experiment. ".repeat(3),
          12,
          6,
          0.54,
        ),
        bbox: { x: 0.54, y: 0.06, width: 0.38, height: 0.05 },
      },
      {
        ...block(
          "figure-10-caption",
          "figure-caption",
          "Figure 10: Performance across page sizes.",
          12,
          7,
          0.54,
        ),
        bbox: { x: 0.54, y: 0.23, width: 0.38, height: 0.025 },
      },
      {
        ...block(
          "figure-11-label",
          "paragraph",
          "Strata Baseline Throughput",
          12,
          8,
          0.62,
          0.22,
        ),
        bbox: { x: 0.62, y: 0.31, width: 0.22, height: 0.03 },
        fontSize: 6,
      },
      {
        ...block(
          "figure-11-caption",
          "figure-caption",
          "Figure 11: Breakdown across workload patterns.",
          12,
          9,
          0.54,
        ),
        bbox: { x: 0.54, y: 0.44, width: 0.38, height: 0.025 },
      },
      ...columnBodies,
    ];

    const paper = analyzeSemanticPaper(blocks);
    const figureEleven = paper.assets.find((asset) => asset.number === "11");

    expect(figureEleven?.bbox.y).toBeGreaterThan(0.255);
    expect(figureEleven?.contentBlockIds).not.toContain("figure-10-caption");
    expect(paper.translatableBlockIds).toContain("figure-10-caption");
  });

  it("captures a table above a below-table caption", () => {
    const blocks = [
      {
        ...block(
          "table-header",
          "paragraph",
          "Dataset Average Input Average Output Queries",
          9,
          0,
          0.53,
          0.39,
        ),
        bbox: { x: 0.53, y: 0.09, width: 0.39, height: 0.06 },
      },
      {
        ...block(
          "table-values",
          "paragraph",
          "21613 15.60 105 2410",
          9,
          1,
          0.62,
          0.28,
        ),
        bbox: { x: 0.62, y: 0.11, width: 0.28, height: 0.04 },
      },
      {
        ...block(
          "table-caption",
          "table-caption",
          "Table 1: Dataset statistics.",
          9,
          2,
          0.63,
          0.17,
        ),
        bbox: { x: 0.63, y: 0.18, width: 0.17, height: 0.02 },
      },
      {
        ...block(
          "body-after",
          "paragraph",
          "The body continues below the table. ".repeat(8),
          9,
          3,
          0.52,
          0.4,
        ),
        bbox: { x: 0.52, y: 0.22, width: 0.4, height: 0.4 },
      },
    ];

    const rect = inferAssetRect(
      blocks,
      blocks.find((candidate) => candidate.id === "table-caption")!,
    );

    expect(rect.y).toBeLessThan(0.12);
    expect(rect.y + rect.height).toBeLessThanOrEqual(0.18);
  });

  it("captures a table above its caption when extraction merged all cells into one block", () => {
    const blocks = [
      {
        ...block(
          "merged-table",
          "paragraph",
          "LooGLE NarrativeQA ReviewMT ShareGPT avg. in avg. out # contexts # queries 21613 15.60 105 2410 54797 13.00 50 1461",
          9,
          0,
          0.53,
          0.39,
        ),
        bbox: { x: 0.53, y: 0.09, width: 0.39, height: 0.07 },
      },
      {
        ...block(
          "table-caption",
          "table-caption",
          "Table 1: Dataset statistics.",
          9,
          1,
          0.63,
          0.17,
        ),
        bbox: { x: 0.63, y: 0.18, width: 0.17, height: 0.02 },
      },
      {
        ...block(
          "body-after",
          "paragraph",
          "State-of-the-art baselines are compared in the following experiments. ".repeat(
            5,
          ),
          9,
          2,
          0.52,
          0.4,
        ),
        bbox: { x: 0.52, y: 0.22, width: 0.4, height: 0.36 },
      },
    ];

    const rect = inferAssetRect(
      blocks,
      blocks.find((candidate) => candidate.id === "table-caption")!,
    );

    expect(rect.y).toBeLessThan(0.12);
    expect(rect.y + rect.height).toBeLessThanOrEqual(0.18);
  });

  it("translates an algorithm caption while preserving only its code asset", () => {
    const blocks = [
      {
        ...block(
          "algorithm-caption",
          "code-caption",
          "Algorithm 1 Semantic Similarity and Confidence-based Early Exit",
          6,
          0,
          0.53,
          0.39,
        ),
        bbox: { x: 0.53, y: 0.16, width: 0.39, height: 0.025 },
      },
      {
        ...block(
          "algorithm-code",
          "code-listing",
          "1: procedure METRICQ(outputs) 2: confidence ← geometricMean(outputs)",
          6,
          1,
          0.53,
          0.39,
        ),
        bbox: { x: 0.53, y: 0.19, width: 0.39, height: 0.24 },
        translatable: false,
      },
      {
        ...block(
          "body-after",
          "paragraph",
          "The algorithm combines confidence with semantic similarity.",
          6,
          2,
          0.53,
          0.39,
        ),
        bbox: { x: 0.53, y: 0.46, width: 0.39, height: 0.06 },
      },
    ];

    const paper = analyzeSemanticPaper(blocks);

    expect(paper.assets).toEqual([
      expect.objectContaining({
        kind: "code",
        number: "1",
        captionBlockId: "algorithm-caption",
        contentBlockIds: ["algorithm-code"],
        bbox: { x: 0.522, y: 0.188, width: 0.406, height: 0.25 },
      }),
    ]);
    expect(paper.translatableBlockIds).toContain("algorithm-caption");
    expect(paper.preservedBlockIds).toContain("algorithm-code");
    expect(paper.translatableBlockIds).not.toContain("algorithm-code");
  });

  it("keeps every extracted fragment inside a multi-block algorithm asset", () => {
    const columnBodies = [
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `left-body-${index}`,
          "paragraph",
          "Left-column body prose. ".repeat(8),
          8,
          index + 10,
          0.08,
        ),
        bbox: {
          x: 0.08,
          y: 0.5 + index * 0.1,
          width: 0.39,
          height: 0.08,
        },
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...block(
          `right-body-${index}`,
          "paragraph",
          "Right-column body prose. ".repeat(8),
          8,
          index + 20,
          0.53,
        ),
        bbox: {
          x: 0.53,
          y: 0.5 + index * 0.1,
          width: 0.39,
          height: 0.08,
        },
      })),
    ];
    const blocks = [
      {
        ...block(
          "algorithm-caption",
          "code-caption",
          "Algorithm 1: Scheduling model forward pass",
          8,
          0,
          0.095,
          0.3,
        ),
        bbox: { x: 0.095, y: 0.094, width: 0.3, height: 0.013 },
      },
      {
        ...block(
          "algorithm-input",
          "code-listing",
          "Input: attention batch size",
          8,
          1,
          0.104,
          0.338,
        ),
        bbox: { x: 0.104, y: 0.112, width: 0.338, height: 0.041 },
      },
      {
        ...block(
          "algorithm-line",
          "code-listing",
          "1 Function FORWARDPASS",
          8,
          2,
          0.091,
          0.261,
        ),
        bbox: { x: 0.091, y: 0.166, width: 0.261, height: 0.015 },
      },
      {
        ...block(
          "algorithm-inline-prose",
          "paragraph",
          "foreach layer l = 1 to L do",
          8,
          3,
          0.13,
          0.162,
        ),
        bbox: { x: 0.13, y: 0.181, width: 0.162, height: 0.012 },
      },
      {
        ...block(
          "algorithm-tail",
          "code-listing",
          "YIELD S; 11 12",
          8,
          4,
          0.086,
          0.338,
        ),
        bbox: { x: 0.086, y: 0.282, width: 0.338, height: 0.083 },
      },
      {
        ...block(
          "next-heading",
          "heading",
          "5 System Design and Implementation",
          8,
          5,
          0.088,
          0.325,
        ),
        bbox: { x: 0.088, y: 0.402, width: 0.325, height: 0.015 },
      },
      ...columnBodies,
    ];

    const paper = analyzeSemanticPaper(blocks);
    const asset = paper.assets[0];

    expect(asset.bbox).toEqual({
      x: 0.045,
      y: 0.11,
      width: 0.44,
      height: 0.28400000000000003,
    });
    expect(asset).toMatchObject({ anchor: "column-top" });
    expect(asset.cropBottomLimit).toBeCloseTo(0.399);
    expect(asset.contentBlockIds).toEqual(
      expect.arrayContaining([
        "algorithm-input",
        "algorithm-line",
        "algorithm-inline-prose",
        "algorithm-tail",
      ]),
    );
    expect(paper.translatableBlockIds).not.toContain(
      "algorithm-inline-prose",
    );
  });

  it("keeps a tall top-of-column figure as one registered source asset", () => {
    const blocks = [
      {
        ...block(
          "figure-code-top",
          "code-listing",
          "class SequenceCompute: seq_id: int; max_out: int",
          6,
          0,
          0.08,
          0.39,
        ),
        bbox: { x: 0.08, y: 0.055, width: 0.39, height: 0.045 },
        translatable: false,
      },
      {
        ...block(
          "figure-code-body",
          "code-listing",
          "async def yield(...)\nasync def combine(...)\ndef callback(...)",
          6,
          1,
          0.08,
          0.39,
        ),
        bbox: { x: 0.08, y: 0.12, width: 0.39, height: 0.19 },
        translatable: false,
      },
      {
        ...block(
          "figure-subpart-a",
          "paragraph",
          "(a) Sequence computation states and functions.",
          6,
          2,
          0.14,
          0.28,
        ),
        bbox: { x: 0.14, y: 0.325, width: 0.28, height: 0.018 },
      },
      {
        ...block(
          "figure-subpart-b",
          "paragraph",
          "(b) Module wrapper definition and coroutine creation.",
          6,
          3,
          0.12,
          0.32,
        ),
        bbox: { x: 0.12, y: 0.47, width: 0.32, height: 0.018 },
      },
      {
        ...block(
          "figure-caption",
          "figure-caption",
          "Figure 4: Sequence coroutine abstraction.",
          6,
          4,
          0.12,
          0.32,
        ),
        bbox: { x: 0.12, y: 0.565, width: 0.32, height: 0.02 },
      },
      {
        ...block(
          "next-heading",
          "heading",
          "4 The Sequence Coroutine Model",
          6,
          5,
          0.08,
          0.39,
        ),
        bbox: { x: 0.08, y: 0.61, width: 0.39, height: 0.025 },
      },
      {
        ...block(
          "right-column-body",
          "paragraph",
          "Right-column body prose. ".repeat(12),
          6,
          6,
          0.53,
          0.39,
        ),
        bbox: { x: 0.53, y: 0.52, width: 0.39, height: 0.2 },
      },
    ];

    const asset = analyzeSemanticPaper(blocks).assets[0];

    expect(asset.bbox.y).toBeLessThanOrEqual(0.055);
    expect(asset.contentBlockIds).toEqual(
      expect.arrayContaining([
        "figure-code-top",
        "figure-code-body",
        "figure-subpart-a",
        "figure-subpart-b",
      ]),
    );
  });
});
