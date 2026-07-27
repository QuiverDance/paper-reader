import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createRetypesetPdf } from "../src/lib/retypeset-pdf";
import {
  analyzeSemanticPaper,
  createRetypesetProject,
} from "../src/lib/semantic-paper";
import type {
  DocumentBlock,
  TranslationRecord,
} from "../src/types";

const serifPath = resolve("tmp/pdfs/fonts/NanumMyeongjo-Regular.ttf");
const sansPath = resolve("tmp/pdfs/fonts/NanumGothic-Regular.ttf");
const hasFonts = existsSync(serifPath) && existsSync(sansPath);

function rectFromPdf(
  x: number,
  y: number,
  width: number,
  height: number,
): DocumentBlock["bbox"] {
  return {
    x: x / 595,
    y: (842 - y - height) / 842,
    width: width / 595,
    height: height / 842,
  };
}

describe.runIf(hasFonts)("re-typeset PDF integration", () => {
  it("creates a searchable Korean derivative with vector source fragments", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([595, 842]);
    const serif = await source.embedFont(StandardFonts.TimesRoman);
    const sansBold = await source.embedFont(StandardFonts.HelveticaBold);
    page.drawText("A Small Paper", {
      x: 70,
      y: 780,
      size: 20,
      font: sansBold,
    });
    page.drawText("Abstract", { x: 55, y: 730, size: 11, font: sansBold });
    page.drawText("This paper presents a useful result [1].", {
      x: 55,
      y: 710,
      size: 10,
      font: serif,
    });
    page.drawText("1 Introduction", {
      x: 55,
      y: 675,
      size: 12,
      font: sansBold,
    });
    page.drawText("Figure 1 summarizes the method.", {
      x: 55,
      y: 650,
      size: 10,
      font: serif,
    });
    page.drawRectangle({
      x: 55,
      y: 500,
      width: 230,
      height: 115,
      borderWidth: 1,
      borderColor: rgb(0.1, 0.2, 0.3),
      color: rgb(0.88, 0.93, 0.96),
    });
    page.drawText("SOURCE FIGURE", {
      x: 105,
      y: 552,
      size: 14,
      font: sansBold,
    });
    page.drawText("Figure 1. Overview of the method.", {
      x: 55,
      y: 480,
      size: 8,
      font: serif,
    });
    page.drawText("E = mc^2", { x: 130, y: 440, size: 12, font: serif });
    page.drawText("References", {
      x: 55,
      y: 390,
      size: 12,
      font: sansBold,
    });
    page.drawText("[1] Smith. A useful reference.", {
      x: 55,
      y: 368,
      size: 9,
      font: serif,
    });
    const sourceBytes = await source.save();

    const blocks: DocumentBlock[] = [
      {
        id: "title",
        documentId: "fixture",
        pageNumber: 1,
        type: "title",
        text: "A Small Paper",
        bbox: rectFromPdf(70, 780, 200, 22),
        fontSize: 20,
        readingOrder: 0,
        translatable: false,
      },
      {
        id: "abstract-heading",
        documentId: "fixture",
        pageNumber: 1,
        type: "heading",
        text: "Abstract",
        bbox: rectFromPdf(55, 730, 80, 12),
        fontSize: 11,
        readingOrder: 1,
        translatable: false,
      },
      {
        id: "abstract-body",
        documentId: "fixture",
        pageNumber: 1,
        type: "abstract",
        text: "This paper presents a useful result [1].",
        bbox: rectFromPdf(55, 710, 260, 12),
        fontSize: 10,
        readingOrder: 2,
        translatable: true,
      },
      {
        id: "intro",
        documentId: "fixture",
        pageNumber: 1,
        type: "heading",
        text: "1 Introduction",
        bbox: rectFromPdf(55, 675, 120, 14),
        fontSize: 12,
        readingOrder: 3,
        translatable: false,
      },
      {
        id: "body",
        documentId: "fixture",
        pageNumber: 1,
        type: "paragraph",
        text: "Figure 1 summarizes the method.",
        bbox: rectFromPdf(55, 650, 220, 12),
        fontSize: 10,
        readingOrder: 4,
        translatable: true,
      },
      {
        id: "caption",
        documentId: "fixture",
        pageNumber: 1,
        type: "figure-caption",
        text: "Figure 1. Overview of the method.",
        bbox: rectFromPdf(55, 480, 230, 10),
        fontSize: 8,
        readingOrder: 5,
        translatable: true,
      },
      {
        id: "equation",
        documentId: "fixture",
        pageNumber: 1,
        type: "equation",
        text: "E = mc^2",
        bbox: rectFromPdf(125, 438, 85, 18),
        fontSize: 12,
        readingOrder: 6,
        translatable: false,
      },
      {
        id: "references",
        documentId: "fixture",
        pageNumber: 1,
        type: "heading",
        text: "References",
        bbox: rectFromPdf(55, 390, 90, 14),
        fontSize: 12,
        readingOrder: 7,
        translatable: false,
      },
      {
        id: "reference-1",
        documentId: "fixture",
        pageNumber: 1,
        type: "reference-entry",
        text: "[1] Smith. A useful reference.",
        bbox: rectFromPdf(55, 368, 230, 11),
        fontSize: 9,
        readingOrder: 8,
        translatable: false,
      },
    ];
    const paper = analyzeSemanticPaper(blocks);
    paper.assets[0].bbox = rectFromPdf(55, 500, 230, 115);
    paper.assets[0].contentBlockIds = [];
    const project = createRetypesetProject("fixture", "ko", "test");
    const translated: Record<string, string> = {
      "abstract-body": "본 논문은 유용한 결과를 제시한다 [1].",
      body: "그림 1은 제안 방법을 요약한다.",
      caption: "그림 1. 제안 방법의 개요.",
    };
    const translations: TranslationRecord[] = Object.entries(translated).map(
      ([blockId, translatedText]) => ({
        id: `${blockId}:ko`,
        documentId: "fixture",
        blockId,
        targetLanguage: "ko",
        sourceText: blocks.find((block) => block.id === blockId)!.text,
        translatedText,
        status: "translated",
        updatedAt: new Date().toISOString(),
      }),
    );

    const result = await createRetypesetPdf({
      sourceBytes: new Uint8Array(sourceBytes),
      sourceTitle: "A Small Paper",
      blocks,
      paper,
      translations,
      project,
      serifFontBytes: new Uint8Array(readFileSync(serifPath)),
      sansFontBytes: new Uint8Array(readFileSync(sansPath)),
      generatedAt: new Date("2026-07-27T00:00:00Z"),
    });

    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
    expect(result.warnings).toEqual([]);
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(reopened.getTitle()).toContain("비공식 한국어 번역본");

    if (process.env.PAPERLOOM_PDF_FIXTURE === "1") {
      const output = resolve("output/pdf");
      mkdirSync(output, { recursive: true });
      writeFileSync(
        resolve(output, "paperloom-source-fixture.pdf"),
        sourceBytes,
      );
      writeFileSync(
        resolve(output, "paperloom-retypeset-fixture.pdf"),
        result.bytes,
      );
    }
  });
});
