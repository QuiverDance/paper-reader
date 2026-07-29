import { describe, expect, it } from "vitest";
import {
  mergeReferenceRects,
  referencePreviewCaption,
  referencePreviewPosition,
} from "../src/lib/reference-preview";
import type {
  DocumentBlock,
  DocumentReference,
  TranslationRecord,
} from "../src/types";

describe("reference preview positioning", () => {
  it("keeps the card directly above the hovered token with a narrow gap", () => {
    const position = referencePreviewPosition(
      {
        left: 545,
        top: 386,
        right: 564,
        bottom: 394,
        width: 19,
        height: 8,
      },
      { width: 1280, height: 720 },
    );

    const cardBottomOnScreen = 720 - position.bottom;

    expect(cardBottomOnScreen).toBe(383);
    expect(386 - cardBottomOnScreen).toBe(3);
    expect(position.maxHeight).toBeLessThanOrEqual(375);
  });
});

describe("reference token highlighting", () => {
  it("merges PDF.js glyph fragments into one continuous token highlight", () => {
    const merged = mergeReferenceRects([
      { x: 0.2, y: 0.3, width: 0.03, height: 0.012 },
      { x: 0.231, y: 0.299, width: 0.004, height: 0.013 },
      { x: 0.238, y: 0.3, width: 0.02, height: 0.012 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ x: 0.2, y: 0.299 });
    expect(merged[0].width).toBeCloseTo(0.058);
    expect(merged[0].height).toBeCloseTo(0.013);
  });
});

describe("reference preview captions", () => {
  const sourceReference: DocumentReference = {
    id: "algorithm-reference",
    sourceBlockId: "algorithm-prose",
    label: "Algorithm 1",
    kind: "code",
    number: "1",
    sourcePageNumber: 8,
    sourceStart: 29,
    sourceEnd: 40,
    targetBlockId: "algorithm-code",
    targetPageNumber: 8,
    targetBbox: { x: 0.08, y: 0.08, width: 0.4, height: 0.35 },
  };
  const blocks: DocumentBlock[] = [
    {
      id: "algorithm-prose",
      documentId: "paper",
      pageNumber: 8,
      type: "paragraph",
      text:
        "The procedure is detailed in Algorithm 1. Before each batch is formed, the scheduler inspects each request.",
      bbox: { x: 0.52, y: 0.1, width: 0.4, height: 0.08 },
      readingOrder: 0,
      translatable: true,
    },
    {
      id: "algorithm-code",
      documentId: "paper",
      pageNumber: 8,
      type: "code-listing",
      text:
        "Algorithm 1 Balanced Batch Formation 1: procedure AddBundleHit(Q, B) 2: for each r in Q do",
      bbox: { x: 0.08, y: 0.08, width: 0.4, height: 0.35 },
      readingOrder: 1,
      translatable: false,
    },
  ];
  const translations: TranslationRecord[] = [
    {
      id: "algorithm-prose-ko",
      documentId: "paper",
      blockId: "algorithm-prose",
      targetLanguage: "ko",
      sourceText: blocks[0].text,
      translatedText:
        "절차는 알고리즘 1에 상세히 제시되어 있다. 각 배치를 구성하기 전에 스케줄러가 요청을 검사한다.",
      status: "translated",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  ];
  const translatedBlocks: DocumentBlock[] = [
    {
      id: "algorithm-prose-ko",
      documentId: "paper-ko",
      pageNumber: 8,
      type: "paragraph",
      text:
        "절차는 알고리즘 1에 상세히 제시되어 있다. 각 배치를 구성하기 전에 스케줄러가 요청을 검사한다.",
      bbox: { x: 0.52, y: 0.1, width: 0.4, height: 0.08 },
      readingOrder: 0,
      translatable: false,
    },
  ];

  it("shows a concise source title instead of duplicating the entire code block", () => {
    expect(
      referencePreviewCaption({
        surface: "original",
        reference: sourceReference,
        sourceReferences: [sourceReference],
        sourceBlocks: blocks,
        translatedBlocks,
        translations,
        translationParagraphs: [
          {
            id: "algorithm-prose",
            blockIds: ["algorithm-prose"],
            text: blocks[0].text,
          },
        ],
      }),
    ).toBe("Algorithm 1: Balanced Batch Formation");
  });

  it("uses the translated reference sentence as a code description", () => {
    expect(
      referencePreviewCaption({
        surface: "translation",
        reference: { ...sourceReference, label: "알고리즘 1" },
        sourceReferences: [sourceReference],
        sourceBlocks: blocks,
        translatedBlocks,
        translations,
        translationParagraphs: [
          {
            id: "algorithm-prose",
            blockIds: ["algorithm-prose"],
            text: blocks[0].text,
          },
        ],
      }),
    ).toBe("절차는 알고리즘 1에 상세히 제시되어 있다.");
  });

  it("uses the visible translated PDF sentence when saved translation records are unavailable", () => {
    expect(
      referencePreviewCaption({
        surface: "translation",
        reference: {
          ...sourceReference,
          sourceBlockId: "algorithm-prose-ko",
          label: "알고리즘 1",
        },
        sourceReferences: [sourceReference],
        sourceBlocks: blocks,
        translatedBlocks: [
          {
            ...translatedBlocks[0],
            text:
              "절차는 알고리즘 1에 상세히 Even with balanced batching, some batches can still be 제시되어 loading-bound. 있다. 각 배치를 구성하기 전에 스케줄러가 요청을 검사한다.",
          },
        ],
        translations: [],
        translationParagraphs: [],
      }),
    ).toBe("절차는 알고리즘 1에 상세히 제시되어 있다.");
  });

  it.each([
    {
      kind: "figure" as const,
      number: "2",
      sourceLabel: "Figure 2",
      sourceCaption: "Figure 2: Cache hit rate by page size.",
      translatedLabel: "그림 2",
      translatedCaption: "그림 2: 페이지 크기별 캐시 적중률.",
      blockType: "figure-caption" as const,
    },
    {
      kind: "table" as const,
      number: "1",
      sourceLabel: "Table 1",
      sourceCaption: "Table 1: Dataset statistics.",
      translatedLabel: "표 1",
      translatedCaption: "표 1: 데이터셋 통계.",
      blockType: "table-caption" as const,
    },
  ])(
    "uses the visible translated $kind caption instead of the English source caption",
    ({
      kind,
      number,
      sourceLabel,
      sourceCaption,
      translatedLabel,
      translatedCaption,
      blockType,
    }) => {
      const sourceCaptionBlock: DocumentBlock = {
        id: `${kind}-caption`,
        documentId: "paper",
        pageNumber: 4,
        type: blockType,
        text: sourceCaption,
        bbox: { x: 0.08, y: 0.1, width: 0.4, height: 0.05 },
        readingOrder: 1,
        translatable: true,
      };
      const sourceAssetReference: DocumentReference = {
        id: `${kind}-reference`,
        sourceBlockId: `${kind}-prose`,
        label: sourceLabel,
        kind,
        number,
        sourcePageNumber: 4,
        sourceStart: 10,
        sourceEnd: 18,
        targetBlockId: sourceCaptionBlock.id,
        targetPageNumber: 4,
        targetBbox: sourceCaptionBlock.bbox,
      };

      expect(
        referencePreviewCaption({
          surface: "translation",
          reference: {
            ...sourceAssetReference,
            sourceBlockId: `${kind}-prose-ko`,
            label: translatedLabel,
          },
          sourceReferences: [sourceAssetReference],
          sourceBlocks: [sourceCaptionBlock],
          translatedBlocks: [
            {
              ...sourceCaptionBlock,
              id: `${kind}-caption-ko`,
              documentId: "paper-ko",
              type: "paragraph",
              text: translatedCaption,
              translatable: false,
            },
          ],
          translations: [],
          translationParagraphs: [],
        }),
      ).toBe(translatedCaption);
    },
  );

  it("never falls back to an English asset caption on the translated surface", () => {
    const sourceCaptionBlock: DocumentBlock = {
      id: "figure-caption",
      documentId: "paper",
      pageNumber: 4,
      type: "figure-caption",
      text: "Figure 2: Cache hit rate by page size.",
      bbox: { x: 0.08, y: 0.1, width: 0.4, height: 0.05 },
      readingOrder: 1,
      translatable: true,
    };
    const sourceFigureReference: DocumentReference = {
      id: "figure-reference",
      sourceBlockId: "figure-prose",
      label: "Figure 2",
      kind: "figure",
      number: "2",
      sourcePageNumber: 4,
      sourceStart: 10,
      sourceEnd: 18,
      targetBlockId: sourceCaptionBlock.id,
      targetPageNumber: 4,
      targetBbox: sourceCaptionBlock.bbox,
    };

    expect(
      referencePreviewCaption({
        surface: "translation",
        reference: { ...sourceFigureReference, label: "그림 2" },
        sourceReferences: [sourceFigureReference],
        sourceBlocks: [sourceCaptionBlock],
        translatedBlocks: [],
        translations: [
          {
            id: "bad-figure-caption-ko",
            documentId: "paper",
            blockId: sourceCaptionBlock.id,
            targetLanguage: "ko",
            sourceText: sourceCaptionBlock.text,
            translatedText: sourceCaptionBlock.text,
            status: "translated",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
        translationParagraphs: [],
      }),
    ).toBe("그림 2의 원문 이미지");
  });

  it("uses a Korean code fallback when no translated explanation exists", () => {
    expect(
      referencePreviewCaption({
        surface: "translation",
        reference: { ...sourceReference, label: "알고리즘 1" },
        sourceReferences: [sourceReference],
        sourceBlocks: blocks,
        translatedBlocks: [],
        translations: [],
        translationParagraphs: [],
      }),
    ).toBe("알고리즘 1의 원문 코드");
  });

  it("matches a clean caption translation by source text when structure block ids change", () => {
    const sourceCaptionBlock: DocumentBlock = {
      id: "figure-caption-v10",
      documentId: "paper",
      pageNumber: 7,
      type: "figure-caption",
      text:
        "Figure 7: Scheduling Policies in Strata. Orange blocks denote cache misses.",
      bbox: { x: 0.52, y: 0.1, width: 0.4, height: 0.08 },
      readingOrder: 1,
      translatable: true,
    };
    const sourceFigureReference: DocumentReference = {
      id: "figure-7-reference",
      sourceBlockId: "figure-7-prose",
      label: "Figure 7",
      kind: "figure",
      number: "7",
      sourcePageNumber: 8,
      sourceStart: 10,
      sourceEnd: 18,
      targetBlockId: sourceCaptionBlock.id,
      targetPageNumber: 7,
      targetBbox: sourceCaptionBlock.bbox,
    };

    expect(
      referencePreviewCaption({
        surface: "translation",
        reference: { ...sourceFigureReference, label: "그림 7" },
        sourceReferences: [sourceFigureReference],
        sourceBlocks: [sourceCaptionBlock],
        translatedBlocks: [
          {
            ...sourceCaptionBlock,
            id: "figure-caption-ko",
            documentId: "paper-ko",
            text:
              "Figure 7: Scheduling Policies in Strata. 그림 7: Strata의 스케줄링 정책. Orange blocks denote cache misses. 또한 다음 본문이 이어진다.",
            translatable: false,
          },
        ],
        translations: [
          {
            id: "figure-caption-v9-ko",
            documentId: "paper",
            blockId: "figure-caption-v9",
            targetLanguage: "ko",
            sourceText: sourceCaptionBlock.text,
            translatedText:
              "그림 7: Strata의 스케줄링 정책. 주황색 블록은 캐시 미스를 나타낸다.",
            status: "translated",
            updatedAt: "2026-07-29T00:00:00.000Z",
          },
        ],
        translationParagraphs: [],
      }),
    ).toBe(
      "그림 7: Strata의 스케줄링 정책. 주황색 블록은 캐시 미스를 나타낸다.",
    );
  });
});
