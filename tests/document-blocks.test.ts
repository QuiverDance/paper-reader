import { describe, expect, it } from "vitest";
import {
  detectDocumentReferences,
  groupPageTextItems,
  resolveDocumentReferences,
} from "../src/lib/document-blocks";

describe("document block extraction", () => {
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
});
describe("document references", () => {
  it("detects references and resolves them to caption blocks", () => {
    const blocks = [
      {
        id: "p1-b0",
        documentId: "doc",
        pageNumber: 1,
        type: "paragraph" as const,
        text: "As shown in Fig. 2 and Table 1, latency decreases.",
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
    ];

    const detected = detectDocumentReferences(blocks);
    expect(detected.map((reference) => reference.label)).toEqual([
      "Fig. 2",
      "Table 1",
    ]);

    const resolved = resolveDocumentReferences(blocks, detected);
    expect(resolved.map((reference) => reference.targetPageNumber)).toEqual([
      4, 5,
    ]);
  });
});
