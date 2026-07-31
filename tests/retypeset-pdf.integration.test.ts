import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
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

const serifPath =
  process.env.PAPERLOOM_TEST_SERIF_FONT ??
  resolve("tmp/pdfs/fonts/NanumMyeongjo-Regular.ttf");
const sansPath =
  process.env.PAPERLOOM_TEST_SANS_FONT ??
  resolve("tmp/pdfs/fonts/NanumGothic-Regular.ttf");
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
  it("starts translated prose below a top-anchored source asset", async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([595, 842]);
    const sourceFont = await source.embedFont(StandardFonts.Helvetica);
    page.drawRectangle({
      x: 315,
      y: 500,
      width: 260,
      height: 230,
      borderWidth: 1,
      borderColor: rgb(0.1, 0.1, 0.1),
    });
    page.drawText("SOURCE ALGORITHM", {
      x: 350,
      y: 690,
      size: 12,
      font: sourceFont,
    });
    page.drawText("Algorithm 2: Scheduling Sequence Computation", {
      x: 315,
      y: 750,
      size: 8,
      font: sourceFont,
    });
    const sourceBytes = await source.save();
    const blocks: DocumentBlock[] = [
      {
        id: "body",
        documentId: "top-asset",
        pageNumber: 1,
        type: "paragraph",
        text: "Long translated body.",
        bbox: rectFromPdf(55, 460, 230, 260),
        fontSize: 10,
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "algorithm-caption",
        documentId: "top-asset",
        pageNumber: 1,
        type: "code-caption",
        text: "Algorithm 2: Scheduling Sequence Computation",
        bbox: { x: 0.53, y: 0.094, width: 0.39, height: 0.018 },
        fontSize: 8,
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "algorithm-code",
        documentId: "top-asset",
        pageNumber: 1,
        type: "code-listing",
        text: "SOURCE ALGORITHM",
        bbox: { x: 0.53, y: 0.11, width: 0.39, height: 0.284 },
        fontSize: 8,
        readingOrder: 2,
        translatable: false,
      },
    ];
    const paper = analyzeSemanticPaper(blocks);
    paper.columnCount = 2;
    paper.assets[0] = {
      ...paper.assets[0],
      bbox: { x: 0.515, y: 0.11, width: 0.44, height: 0.284 },
      anchor: "column-top",
      contentBlockIds: ["algorithm-code"],
    };
    const project = createRetypesetProject("top-asset", "ko", "test");
    const translations: TranslationRecord[] = [
      {
        id: "body:ko",
        documentId: "top-asset",
        blockId: "body",
        targetLanguage: "ko",
        sourceText: "Long translated body.",
        translatedText: Array.from(
          { length: 320 },
          () => "FLOWMARK",
        ).join(" "),
        status: "translated",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        id: "algorithm-caption:ko",
        documentId: "top-asset",
        blockId: "algorithm-caption",
        targetLanguage: "ko",
        sourceText: "Algorithm 2: Scheduling Sequence Computation",
        translatedText: "알고리즘 2: 시퀀스 계산 스케줄링",
        status: "translated",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ];

    const result = await createRetypesetPdf({
      sourceBytes: new Uint8Array(sourceBytes),
      sourceTitle: "Top asset",
      blocks,
      paper,
      translations,
      project,
      serifFontBytes: new Uint8Array(readFileSync(serifPath)),
      sansFontBytes: new Uint8Array(readFileSync(sansPath)),
      generatedAt: new Date("2026-07-31T00:00:00Z"),
    });
    const rendered = await getDocument({ data: result.bytes.slice() }).promise;
    const renderedPage = await rendered.getPage(1);
    const content = await renderedPage.getTextContent();
    const rightColumnFlow = content.items.flatMap((item) =>
      "str" in item &&
      item.str.includes("FLOWMARK") &&
      item.transform[4] > 300
        ? [item.transform[5]]
        : [],
    );

    expect(rightColumnFlow.length).toBeGreaterThan(0);
    expect(Math.max(...rightColumnFlow)).toBeLessThan(500);
    await rendered.cleanup();
  });

  it("draws one translated paragraph for source fragments spanning columns", async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const blocks: DocumentBlock[] = [
      {
        id: "qwen-left",
        documentId: "logical-paragraph",
        pageNumber: 1,
        type: "paragraph",
        text: "Leading models include Claude 4 and the Qwen",
        bbox: rectFromPdf(55, 100, 230, 60),
        fontSize: 9,
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "qwen-right",
        documentId: "logical-paragraph",
        pageNumber: 1,
        type: "paragraph",
        text: "series [46], which support long context windows.",
        bbox: rectFromPdf(310, 740, 230, 60),
        fontSize: 9,
        readingOrder: 1,
        translatable: true,
      },
    ];
    const paper = analyzeSemanticPaper(blocks);
    const project = createRetypesetProject(
      "logical-paragraph",
      "ko",
      "test",
    );
    const result = await createRetypesetPdf({
      sourceBytes: new Uint8Array(sourceBytes),
      sourceTitle: "Logical paragraph",
      blocks,
      paper,
      translations: [
        {
          id: "qwen-left:ko",
          documentId: "logical-paragraph",
          blockId: "qwen-left",
          targetLanguage: "ko",
          sourceText:
            "Leading models include Claude 4 and the Qwen series [46], which support long context windows.",
          translatedText: "Unified paragraph translation.",
          status: "translated",
          sectionId: "front-matter",
          updatedAt: "2026-07-29T00:00:00.000Z",
        },
      ],
      project,
      serifFontBytes: new Uint8Array(readFileSync(serifPath)),
      sansFontBytes: new Uint8Array(readFileSync(sansPath)),
      generatedAt: new Date("2026-07-29T00:00:00Z"),
    });

    expect(result.warnings).toEqual([]);
    const rendered = await getDocument({ data: result.bytes.slice() }).promise;
    const page = await rendered.getPage(1);
    const content = await page.getTextContent();
    const text = content.items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join(" ");
    expect(text.match(/Unified paragraph translation\./g)).toHaveLength(1);
    await rendered.cleanup();
  });

  it("creates a searchable Korean derivative with vector and non-WinAnsi source text", async () => {
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
    page.drawText("Ada Left", {
      x: 90,
      y: 750,
      size: 10,
      font: serif,
    });
    page.drawText("Turing Right", {
      x: 400,
      y: 750,
      size: 10,
      font: serif,
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
        id: "author-left",
        documentId: "fixture",
        pageNumber: 1,
        type: "authors",
        text: "Ada Left",
        bbox: rectFromPdf(90, 750, 80, 12),
        fontSize: 10,
        readingOrder: 1,
        translatable: false,
      },
      {
        id: "author-right",
        documentId: "fixture",
        pageNumber: 1,
        type: "authors",
        text: "Turing Right",
        bbox: rectFromPdf(400, 750, 90, 12),
        fontSize: 10,
        readingOrder: 2,
        translatable: false,
      },
      {
        id: "abstract-heading",
        documentId: "fixture",
        pageNumber: 1,
        type: "abstract",
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
        text: "1 Introduction ˇ",
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
    const rendered = await getDocument({ data: result.bytes.slice() }).promise;
    const renderedPage = await rendered.getPage(1);
    const renderedText = await renderedPage.getTextContent();
    const sourceFigure = renderedText.items.find(
      (item) => "str" in item && item.str.includes("SOURCE FIGURE"),
    );
    const abstractTranslation = renderedText.items.find(
      (item) => "str" in item && item.str.includes("본 논문"),
    );
    const abstractLabels = renderedText.items.filter(
      (item) => "str" in item && item.str === "Abstract",
    );
    const visibleAbstractLabels = abstractLabels.filter(
      (item) =>
        "transform" in item &&
        item.transform[4] > 200,
    );
    expect(sourceFigure).toBeDefined();
    expect(abstractTranslation).toBeDefined();
    expect(visibleAbstractLabels).toHaveLength(1);
    if (sourceFigure && "transform" in sourceFigure) {
      expect(sourceFigure.transform[4]).toBeCloseTo(105, 0);
      expect(sourceFigure.transform[5]).toBeCloseTo(552, 0);
    }
    if (abstractTranslation && "transform" in abstractTranslation) {
      expect(abstractTranslation.transform[5]).toBeLessThan(730);
    }
    if (
      visibleAbstractLabels[0] &&
      "transform" in visibleAbstractLabels[0]
    ) {
      expect(visibleAbstractLabels[0].transform[4]).toBeGreaterThan(250);
    }
    await rendered.cleanup();

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

  it("moves wrapped text horizontally when it advances to the second column", async () => {
    const source = await PDFDocument.create();
    source.addPage([595, 842]);
    const sourceBytes = await source.save();
    const blocks: DocumentBlock[] = [
      {
        id: "title",
        documentId: "column-overflow",
        pageNumber: 1,
        type: "title",
        text: "Column Overflow",
        bbox: rectFromPdf(55, 780, 485, 24),
        fontSize: 20,
        readingOrder: 0,
        translatable: false,
      },
      {
        id: "body",
        documentId: "column-overflow",
        pageNumber: 1,
        type: "paragraph",
        text: "Long source body.",
        bbox: rectFromPdf(55, 720, 230, 620),
        fontSize: 10,
        readingOrder: 1,
        translatable: true,
      },
    ];
    const paper = analyzeSemanticPaper(blocks);
    paper.columnCount = 2;
    const project = createRetypesetProject(
      "column-overflow",
      "ko",
      "test",
    );
    const repeatedText = Array.from(
      { length: 130 },
      () => "Long context cache scheduling improves throughput and latency.",
    ).join(" ");
    const translations: TranslationRecord[] = [
      {
        id: "body:ko",
        documentId: "column-overflow",
        blockId: "body",
        targetLanguage: "ko",
        sourceText: "Long source body.",
        translatedText: repeatedText,
        status: "translated",
        updatedAt: new Date().toISOString(),
      },
    ];

    const result = await createRetypesetPdf({
      sourceBytes: new Uint8Array(sourceBytes),
      sourceTitle: "Column Overflow",
      blocks,
      paper,
      translations,
      project,
      serifFontBytes: new Uint8Array(readFileSync(serifPath)),
      sansFontBytes: new Uint8Array(readFileSync(sansPath)),
    });
    const generated = await getDocument({
      data: result.bytes.slice(),
    }).promise;
    const firstPage = await generated.getPage(1);
    const content = await firstPage.getTextContent();
    const textPositions = content.items.flatMap((item) =>
      "str" in item && item.str.includes("Long")
        ? [{ x: item.transform[4], y: item.transform[5] }]
        : [],
    );

    expect(textPositions.some(({ x }) => x < 200)).toBe(true);
    expect(textPositions.some(({ x }) => x > 300)).toBe(true);
    expect(Math.max(...textPositions.map(({ y }) => y))).toBeLessThan(770);
  });
});
