import { describe, expect, it } from "vitest";
import {
  buildReferenceCatalog,
  buildSourceReferenceIndex,
} from "../src/lib/reference-catalog";
import type {
  DocumentBlock,
  TranslationRecord,
} from "../src/types";

function block(
  id: string,
  type: DocumentBlock["type"],
  text: string,
  readingOrder: number,
  bbox = { x: 0.08, y: 0.1 + readingOrder * 0.08, width: 0.4, height: 0.05 },
): DocumentBlock {
  return {
    id,
    documentId: "paper",
    pageNumber: 3,
    type,
    text,
    bbox,
    readingOrder,
    translatable: type === "paragraph" || type.endsWith("caption"),
  };
}

describe("reference catalog", () => {
  it("resolves source and translated references through one stable asset key", () => {
    const sourceBlocks = [
      block("body", "paragraph", "Figure 3 summarizes the result.", 0),
      block(
        "chart-label",
        "unknown",
        "Cache hit rate",
        1,
        { x: 0.1, y: 0.2, width: 0.36, height: 0.12 },
      ),
      block(
        "figure-caption-v10",
        "figure-caption",
        "Figure 3: Cache hit rate by page size.",
        2,
        { x: 0.08, y: 0.34, width: 0.4, height: 0.04 },
      ),
    ];
    const translatedBlocks = [
      {
        ...sourceBlocks[0],
        id: "body-ko",
        documentId: "paper-ko",
        text: "그림 3은 결과를 요약한다.",
      },
    ];
    const translations: TranslationRecord[] = [
      {
        id: "caption-ko",
        documentId: "paper",
        blockId: "figure-caption-v9",
        targetLanguage: "ko",
        sourceText: sourceBlocks[2].text,
        translatedText: "그림 3: 페이지 크기별 캐시 적중률.",
        status: "translated",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
    ];

    const source = buildSourceReferenceIndex(sourceBlocks);
    const catalog = buildReferenceCatalog({
      source,
      translatedBlocks,
      translations,
    });

    expect(source.references).toHaveLength(1);
    expect(source.references[0].targetBlockId).toBe("figure-caption-v10");
    expect(catalog.translation).toHaveLength(1);
    expect(catalog.translation[0].targetBlockId).toBe("figure-caption-v10");
    expect(
      catalog.previewCaption(catalog.translation[0], "translation"),
    ).toBe("그림 3: 페이지 크기별 캐시 적중률.");
  });

  it("indexes code listings once and shares their target with Korean tokens", () => {
    const sourceBlocks = [
      block(
        "body",
        "paragraph",
        "The procedure is detailed in Algorithm 1.",
        0,
      ),
      block(
        "algorithm",
        "code-listing",
        "Algorithm 1 Balanced Batch Formation 1: procedure AddBundleHit(Q, B)",
        1,
      ),
    ];
    const translatedBlocks = [
      {
        ...sourceBlocks[0],
        id: "body-ko",
        documentId: "paper-ko",
        text: "절차는 알고리즘 1에 상세히 제시되어 있다.",
      },
    ];

    const source = buildSourceReferenceIndex(sourceBlocks);
    const catalog = buildReferenceCatalog({
      source,
      translatedBlocks,
      translations: [],
    });

    expect(source.references[0].targetBlockId).toBe("algorithm");
    expect(catalog.translation[0].targetBlockId).toBe("algorithm");
    expect(
      catalog.previewCaption(catalog.translation[0], "translation"),
    ).toBe("절차는 알고리즘 1에 상세히 제시되어 있다.");
  });
});
