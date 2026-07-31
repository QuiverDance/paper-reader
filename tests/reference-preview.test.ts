import { describe, expect, it } from "vitest";
import {
  attachReferencePreviewTargets,
  buildCompanionReferences,
  mergeReferenceRects,
  nextReferencePreviewHoverState,
  referencePreviewCaption,
  referencePreviewDisplaySize,
  referencePreviewMediaMaxHeight,
  referencePreviewPosition,
  referenceRectsForPane,
  retargetReferenceTokens,
  translatedReferenceCaption,
} from "../src/lib/reference-preview";
import type {
  DocumentBlock,
  DocumentReference,
  PaperAsset,
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

    const cardBottomOnScreen = 720 - position.bottom!;

    expect(cardBottomOnScreen).toBe(383);
    expect(386 - cardBottomOnScreen).toBe(3);
    expect(position.top).toBeUndefined();
    expect(position.maxHeight).toBeLessThanOrEqual(375);
  });

  it("places the card below a near-top token when that keeps the source readable", () => {
    const position = referencePreviewPosition(
      {
        left: 860,
        top: 197,
        right: 895,
        bottom: 213,
        width: 35,
        height: 16,
      },
      { width: 1280, height: 720 },
    );

    expect(position.top).toBe(216);
    expect(position.bottom).toBeUndefined();
    expect(position.maxHeight).toBe(492);
  });

  it("uses the measured caption height instead of a fixed caption allowance", () => {
    expect(referencePreviewMediaMaxHeight(182, 54)).toBe(86);
    expect(referencePreviewMediaMaxHeight(182, 0)).toBe(140);
  });

  it("enlarges a tall asset for reading without shrinking the card below its standard width", () => {
    const displaySize = referencePreviewDisplaySize(
      { width: 277, height: 382 },
      { width: 1280, height: 720 },
      20,
    );
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
      { ...displaySize, captionHeight: 20 },
    );

    expect(displaySize.width).toBeCloseTo(459.732984);
    expect(displaySize.height).toBe(634);
    expect(position).toMatchObject({
      left: 294.5,
      top: 12,
      width: 520,
      maxHeight: 696,
    });
    expect(referencePreviewMediaMaxHeight(696, 20, displaySize.height)).toBe(
      634,
    );
  });
});

describe("reference token highlighting", () => {
  it("keeps the complete asset crop instead of the caption-only bbox", () => {
    const blocks: DocumentBlock[] = [
      {
        id: "caption",
        documentId: "paper",
        pageNumber: 2,
        type: "figure-caption",
        text: "Figure 1: Tree-structured routing.",
        bbox: { x: 0.1, y: 0.43, width: 0.4, height: 0.035 },
        readingOrder: 1,
        translatable: true,
      },
    ];
    const references: DocumentReference[] = [
      {
        id: "reference",
        sourceBlockId: "body",
        label: "Figure 1",
        kind: "figure",
        number: "1",
        sourcePageNumber: 1,
        sourceStart: 12,
        sourceEnd: 20,
        targetBlockId: "caption",
        targetPageNumber: 2,
        targetBbox: blocks[0].bbox,
      },
    ];
    const assets: PaperAsset[] = [
      {
        id: "figure-1",
        kind: "figure",
        number: "1",
        captionBlockId: "caption",
        pageNumber: 2,
        bbox: { x: 0.08, y: 0.08, width: 0.84, height: 0.39 },
        anchor: "page-top",
        cropBottomLimit: 0.485,
        sectionId: "section",
        contentBlockIds: [],
      },
    ];

    expect(
      attachReferencePreviewTargets(blocks, references, assets)[0],
    ).toMatchObject({
      targetBlockId: "caption",
      targetPageNumber: 2,
      targetBbox: { x: 0.08, y: 0.08, width: 0.84, height: 0.39 },
      targetCropBottomLimit: 0.485,
    });
  });

  it("merges PDF.js glyph fragments into one continuous pointer target", () => {
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

  it("keeps source and Korean token rectangles independent", () => {
    const sourceRects = [
      { x: 0.12, y: 0.2, width: 0.06, height: 0.014 },
    ];
    const koreanRects = [
      { x: 0.58, y: 0.64, width: 0.09, height: 0.018 },
    ];

    expect(
      referenceRectsForPane("source", sourceRects, koreanRects),
    ).toBe(sourceRects);
    expect(
      referenceRectsForPane("korean", sourceRects, koreanRects),
    ).toBe(koreanRects);
  });

  it("keeps source token geometry while using the structured asset caption", () => {
    const sourceToken: DocumentReference = {
      id: "raw-reference",
      sourceBlockId: "raw-body",
      label: "Algorithm 1",
      kind: "code",
      number: "1",
      sourcePageNumber: 6,
      sourceStart: 12,
      sourceEnd: 23,
      targetBlockId: "raw-code",
      targetPageNumber: 6,
      targetBbox: { x: 0.52, y: 0.15, width: 0.4, height: 0.3 },
      targetCropBottomLimit: 0.47,
    };
    const structuredTarget: DocumentReference = {
      ...sourceToken,
      id: "structured-reference",
      sourceBlockId: "structured-body",
      targetBlockId: "algorithm-caption",
      targetBbox: { x: 0.52, y: 0.2, width: 0.4, height: 0.25 },
      targetCropBottomLimit: 0.46,
    };

    expect(
      retargetReferenceTokens([sourceToken], [structuredTarget])[0],
    ).toMatchObject({
      id: "raw-reference",
      sourceBlockId: "raw-body",
      sourceStart: 12,
      sourceEnd: 23,
      targetBlockId: "algorithm-caption",
      targetBbox: { x: 0.52, y: 0.2, width: 0.4, height: 0.25 },
      targetCropBottomLimit: 0.46,
    });
  });

  it("keeps the preview open while the pointer crosses from token to card", () => {
    const overToken = nextReferencePreviewHoverState(
      { token: false, card: false },
      "token-enter",
    );
    const crossingGap = nextReferencePreviewHoverState(
      overToken,
      "token-leave",
    );
    const overCard = nextReferencePreviewHoverState(
      crossingGap,
      "card-enter",
    );
    const delayedClose = nextReferencePreviewHoverState(
      overCard,
      "close-timeout",
    );

    expect(overToken.open).toBe(true);
    expect(crossingGap.open).toBe(true);
    expect(overCard.open).toBe(true);
    expect(delayedClose.open).toBe(true);
  });

  it("keeps a clicked preview pinned after pointer leave", () => {
    const pinned = nextReferencePreviewHoverState(
      { token: true, card: false, open: true },
      "pin",
    );
    const left = nextReferencePreviewHoverState(
      pinned,
      "token-leave",
    );
    const delayedClose = nextReferencePreviewHoverState(
      left,
      "close-timeout",
    );

    expect(pinned.pinned).toBe(true);
    expect(delayedClose.open).toBe(true);
    expect(
      nextReferencePreviewHoverState(delayedClose, "unpin").open,
    ).toBe(false);
  });

  it("uses the translated caption in the Korean pane", () => {
    const source = "Figure 3: Dependency-aware prefill overlap.";
    const korean = "그림 3: 의존성 인식 프리필 중첩.";

    expect(referencePreviewCaption("source", source, korean)).toBe(source);
    expect(referencePreviewCaption("korean", source, korean)).toBe(korean);
  });

  it("never substitutes the surrounding body paragraph for a code caption", () => {
    const blocks: DocumentBlock[] = [
      {
        id: "description-head",
        documentId: "paper",
        pageNumber: 3,
        type: "paragraph",
        text: "The scheduler uses a dependency-aware policy",
        bbox: { x: 0.08, y: 0.2, width: 0.4, height: 0.03 },
        readingOrder: 0,
        translatable: true,
      },
      {
        id: "description-tail",
        documentId: "paper",
        pageNumber: 3,
        type: "paragraph",
        text: "as shown in Algorithm 1.",
        bbox: { x: 0.08, y: 0.232, width: 0.4, height: 0.03 },
        sourceStyle: { paragraphStart: false },
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "algorithm-1",
        documentId: "paper",
        pageNumber: 4,
        type: "code-listing",
        text: "Algorithm 1: schedule(requests)",
        bbox: { x: 0.08, y: 0.2, width: 0.4, height: 0.25 },
        readingOrder: 2,
        translatable: false,
      },
    ];
    const reference: DocumentReference = {
      id: "code-reference",
      sourceBlockId: "description-tail",
      descriptionBlockId: "description-tail",
      label: "알고리즘 1",
      kind: "code",
      number: "1",
      sourcePageNumber: 3,
      sourceStart: 10,
      sourceEnd: 17,
      targetBlockId: "algorithm-1",
      targetPageNumber: 4,
      targetBbox: { x: 0.08, y: 0.2, width: 0.4, height: 0.25 },
    };
    const translations: TranslationRecord[] = [
      {
        id: "translation",
        documentId: "paper",
        blockId: "description-head",
        targetLanguage: "ko",
        sourceText:
          "The scheduler uses a dependency-aware policy as shown in Algorithm 1.",
        translatedText:
          "스케줄러는 알고리즘 1에 제시된 의존성 인식 정책을 사용한다.",
        status: "translated",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ];

    expect(
      translatedReferenceCaption(
        reference,
        blocks,
        translations,
        ["description-head", "description-tail"],
      ),
    ).toBeUndefined();
  });

  it("localizes an English asset label left in a translated caption", () => {
    const blocks: DocumentBlock[] = [
      {
        id: "figure-caption",
        documentId: "paper",
        pageNumber: 6,
        type: "figure-caption",
        text: "Figure 5: Coroutine primitives used on sequence.",
        bbox: { x: 0.52, y: 0.28, width: 0.4, height: 0.03 },
        readingOrder: 1,
        translatable: true,
      },
    ];
    const reference: DocumentReference = {
      id: "figure-reference",
      sourceBlockId: "body",
      label: "그림 5(a)",
      kind: "figure",
      number: "5",
      subpart: "a",
      sourcePageNumber: 7,
      sourceStart: 10,
      sourceEnd: 17,
      targetBlockId: "figure-caption",
      targetPageNumber: 6,
      targetBbox: blocks[0].bbox,
    };
    const translations: TranslationRecord[] = [
      {
        id: "caption-translation",
        documentId: "paper",
        blockId: "figure-caption",
        targetLanguage: "ko",
        sourceText: blocks[0].text,
        translatedText:
          "Figure 5: 시퀀스에 사용되는 코루틴 프리미티브.",
        status: "translated",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ];

    expect(
      translatedReferenceCaption(
        reference,
        blocks,
        translations,
        ["figure-caption"],
      ),
    ).toBe("그림 5: 시퀀스에 사용되는 코루틴 프리미티브.");
  });

  it("uses only the translated algorithm caption for a code preview", () => {
    const blocks: DocumentBlock[] = [
      {
        id: "algorithm-caption",
        documentId: "paper",
        pageNumber: 4,
        type: "code-caption" as DocumentBlock["type"],
        text: "Algorithm 1 Semantic Similarity and Confidence-based Early Exit",
        bbox: { x: 0.08, y: 0.18, width: 0.4, height: 0.03 },
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "algorithm-code",
        documentId: "paper",
        pageNumber: 4,
        type: "code-listing",
        text: "1: procedure METRICQ(outputs)",
        bbox: { x: 0.08, y: 0.215, width: 0.4, height: 0.22 },
        readingOrder: 2,
        translatable: false,
      },
    ];
    const reference: DocumentReference = {
      id: "code-reference",
      sourceBlockId: "body",
      label: "알고리즘 1",
      kind: "code",
      number: "1",
      sourcePageNumber: 3,
      sourceStart: 10,
      sourceEnd: 17,
      targetBlockId: "algorithm-caption",
      targetPageNumber: 4,
      targetBbox: { x: 0.08, y: 0.215, width: 0.4, height: 0.22 },
    };
    const translations: TranslationRecord[] = [
      {
        id: "caption-translation",
        documentId: "paper",
        blockId: "algorithm-caption",
        targetLanguage: "ko",
        sourceText:
          "Algorithm 1 Semantic Similarity and Confidence-based Early Exit",
        translatedText: "알고리즘 1 의미 유사도 및 신뢰도 기반 조기 종료",
        status: "translated",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    ];

    expect(
      translatedReferenceCaption(
        reference,
        blocks,
        translations,
        ["algorithm-caption"],
      ),
    ).toBe("알고리즘 1 의미 유사도 및 신뢰도 기반 조기 종료");
  });

  it("builds Korean hotspots only from localized in-text references", () => {
    const koreanBlocks: DocumentBlock[] = [
      {
        id: "ko-body",
        documentId: "paper-ko",
        pageNumber: 3,
        type: "paragraph",
        text: "그림 2에서 처리량 향상을 확인할 수 있다.",
        bbox: { x: 0.54, y: 0.62, width: 0.38, height: 0.06 },
        readingOrder: 1,
        translatable: true,
      },
      {
        id: "hidden-source-form",
        documentId: "paper-ko",
        pageNumber: 3,
        type: "paragraph",
        text: "Figure 2 shows throughput improvements.",
        bbox: { x: 0.08, y: 0.18, width: 0.38, height: 0.06 },
        readingOrder: 2,
        translatable: true,
      },
      {
        id: "ko-caption",
        documentId: "paper-ko",
        pageNumber: 3,
        type: "figure-caption",
        text: "그림 2: 처리량 비교.",
        bbox: { x: 0.52, y: 0.48, width: 0.4, height: 0.03 },
        readingOrder: 3,
        translatable: true,
      },
      {
        id: "unresolved",
        documentId: "paper-ko",
        pageNumber: 3,
        type: "paragraph",
        text: "그림 9는 존재하지 않는다.",
        bbox: { x: 0.54, y: 0.7, width: 0.38, height: 0.04 },
        readingOrder: 4,
        translatable: true,
      },
    ];
    const sourceReferences: DocumentReference[] = [
      {
        id: "source-ref",
        sourceBlockId: "source-body",
        label: "Figure 2",
        kind: "figure",
        number: "2",
        sourcePageNumber: 2,
        sourceStart: 0,
        sourceEnd: 8,
        targetBlockId: "source-caption",
        targetPageNumber: 3,
        targetBbox: { x: 0.045, y: 0.1, width: 0.91, height: 0.34 },
      },
    ];

    const companion = buildCompanionReferences(
      koreanBlocks,
      sourceReferences,
    );

    expect(companion).toHaveLength(1);
    expect(companion[0]).toMatchObject({
      sourceBlockId: "ko-body",
      label: "그림 2",
      targetBlockId: "source-caption",
      targetPageNumber: 3,
    });
  });
});
