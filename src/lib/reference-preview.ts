import type {
  DocumentBlock,
  DocumentReference,
  NormalizedRect,
  PaperAsset,
  ReferenceAnchor,
  TranslationRecord,
} from "../types";
import {
  detectDocumentReferences,
  documentReferenceKey,
  localizeDocumentReferenceLabels,
  parseDocumentReferenceLabel,
} from "./document-references";
import { translationParagraphsForPaper } from "./translation-paragraphs";

type ViewportSize = {
  width: number;
  height: number;
};

type ReferencePreviewSourceSize = {
  width: number;
  height: number;
  captionHeight: number;
};

export type ReferencePreviewPosition = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 3;
const PREVIEW_HORIZONTAL_CHROME_WIDTH = 22;
const PREVIEW_BASE_CHROME_HEIGHT = 42;
const PREVIEW_MAX_MEDIA_WIDTH = 900;
const PREVIEW_MAX_SCALE = 2;
const MISSING_KOREAN_CAPTION = "한국어 소스 설명을 찾지 못했습니다.";

export type ReferencePreviewPane = "source" | "korean";
export type ReferencePreviewHoverState = {
  token: boolean;
  card: boolean;
  pinned?: boolean;
  open?: boolean;
};
export type ReferencePreviewHoverEvent =
  | "token-enter"
  | "token-leave"
  | "card-enter"
  | "card-leave"
  | "pin"
  | "unpin"
  | "close-timeout";

function unionRects(
  left: NormalizedRect,
  right: NormalizedRect,
): NormalizedRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}

export function mergeReferenceRects(
  rects: NormalizedRect[],
): NormalizedRect[] {
  const sorted = [...rects].sort(
    (left, right) => left.y - right.y || left.x - right.x,
  );
  const merged: NormalizedRect[] = [];

  for (const rect of sorted) {
    const previous = merged.at(-1);
    if (!previous) {
      merged.push({ ...rect });
      continue;
    }
    const overlap =
      Math.min(previous.y + previous.height, rect.y + rect.height) -
      Math.max(previous.y, rect.y);
    const sameLine =
      overlap >= Math.min(previous.height, rect.height) * 0.45;
    const gap = rect.x - (previous.x + previous.width);
    const gapTolerance = Math.max(
      0.012,
      Math.max(previous.height, rect.height),
    );
    if (sameLine && gap <= gapTolerance) {
      merged[merged.length - 1] = unionRects(previous, rect);
    } else {
      merged.push({ ...rect });
    }
  }

  return merged;
}

export function referenceRectsForPane<T>(
  pane: ReferencePreviewPane,
  sourceRects: T,
  koreanRects: T,
): T {
  return pane === "source" ? sourceRects : koreanRects;
}

export function nextReferencePreviewHoverState(
  state: ReferencePreviewHoverState,
  event: ReferencePreviewHoverEvent,
): Required<ReferencePreviewHoverState> {
  const pinned = state.pinned ?? false;
  if (event === "token-enter") {
    return { token: true, card: state.card, pinned, open: true };
  }
  if (event === "card-enter") {
    return { token: state.token, card: true, pinned, open: true };
  }
  if (event === "token-leave") {
    return { token: false, card: state.card, pinned, open: true };
  }
  if (event === "card-leave") {
    return { token: state.token, card: false, pinned, open: true };
  }
  if (event === "pin") {
    return { token: state.token, card: state.card, pinned: true, open: true };
  }
  if (event === "unpin") {
    return {
      token: state.token,
      card: state.card,
      pinned: false,
      open: state.token || state.card,
    };
  }
  return {
    token: state.token,
    card: state.card,
    pinned,
    open: pinned || state.token || state.card,
  };
}

export function referencePreviewCaption(
  pane: ReferencePreviewPane,
  sourceCaption?: string,
  translatedCaption?: string,
): string | undefined {
  if (pane === "source") return sourceCaption?.trim() || undefined;
  return translatedCaption?.trim() || MISSING_KOREAN_CAPTION;
}

export function attachReferencePreviewTargets(
  blocks: DocumentBlock[],
  references: DocumentReference[],
  assets: PaperAsset[],
): DocumentReference[] {
  return references.map((reference) => {
    const asset = assets.find(
      (candidate) =>
        candidate.kind === reference.kind &&
        candidate.number.toLowerCase() === reference.number.toLowerCase(),
    );
    if (asset) {
      return {
        ...reference,
        targetBlockId: asset.captionBlockId,
        targetPageNumber: asset.pageNumber,
        targetBbox: asset.bbox,
        targetCropBottomLimit: asset.cropBottomLimit,
      };
    }
    if (reference.kind !== "code") return reference;

    const code = blocks.find(
      (block) =>
        (block.type === "code-listing" || block.type === "equation") &&
        new RegExp(
          `^(?:Algorithm|Listing|Code|알고리즘|목록|코드)\\s*${reference.number}\\b`,
          "i",
        ).test(block.text.trim()),
    );
    if (!code) return reference;
    return {
      ...reference,
      targetBlockId: code.id,
      targetPageNumber: code.pageNumber,
      targetBbox: code.bbox,
    };
  });
}

export function translatedReferenceCaption(
  reference: DocumentReference,
  blocks: DocumentBlock[],
  translations: TranslationRecord[],
  translatableBlockIds: string[],
): string | undefined {
  const translatedByBlockId = new Map(
    translations
      .filter(
        (translation) =>
          translation.status === "translated" &&
          translation.translatedText.trim(),
      )
      .map((translation) => [
        translation.blockId,
        translation.translatedText.trim(),
      ]),
  );
  const lockedBlockIds = new Set(
    translations
      .filter((translation) => translation.locked)
      .map((translation) => translation.blockId),
  );
  const paragraphIdByBlockId = new Map<string, string>();
  for (const paragraph of translationParagraphsForPaper(
    blocks,
    translatableBlockIds,
    lockedBlockIds,
  )) {
    for (const blockId of paragraph.blockIds) {
      paragraphIdByBlockId.set(blockId, paragraph.id);
    }
  }
  const translatedTextForBlock = (blockId?: string) => {
    if (!blockId) return undefined;
    return (
      translatedByBlockId.get(blockId) ??
      translatedByBlockId.get(paragraphIdByBlockId.get(blockId) ?? "")
    );
  };

  const translated = translatedTextForBlock(reference.targetBlockId);
  return translated
    ? localizeDocumentReferenceLabels(translated)
    : undefined;
}

export function retargetReferenceTokens(
  tokenReferences: DocumentReference[],
  targetReferences: DocumentReference[],
): DocumentReference[] {
  const targetByKey = new Map<string, DocumentReference>();
  for (const reference of targetReferences) {
    if (!reference.targetPageNumber || !reference.targetBbox) continue;
    const key = documentReferenceKey(reference);
    if (!targetByKey.has(key)) targetByKey.set(key, reference);
  }
  return tokenReferences.map((reference) => {
    const target = targetByKey.get(documentReferenceKey(reference));
    if (!target) return reference;
    return {
      ...reference,
      descriptionBlockId: target.targetBlockId,
      targetBlockId: target.targetBlockId,
      targetPageNumber: target.targetPageNumber,
      targetBbox: target.targetBbox,
      targetCropBottomLimit: target.targetCropBottomLimit,
    };
  });
}

function isLocalizedReferenceLabel(label: string): boolean {
  return parseDocumentReferenceLabel(label.trim())?.language === "ko";
}

export function buildCompanionReferences(
  koreanBlocks: DocumentBlock[],
  sourceReferences: DocumentReference[],
): DocumentReference[] {
  const sourceByKey = new Map<string, DocumentReference[]>();
  for (const reference of sourceReferences) {
    if (!reference.targetPageNumber || !reference.targetBbox) continue;
    const key = documentReferenceKey(reference);
    sourceByKey.set(key, [
      ...(sourceByKey.get(key) ?? []),
      reference,
    ]);
  }
  const usedByKey = new Map<string, number>();

  return detectDocumentReferences(koreanBlocks).flatMap((candidate) => {
    if (!isLocalizedReferenceLabel(candidate.label)) return [];
    const key = documentReferenceKey(candidate);
    const sources = sourceByKey.get(key) ?? [];
    const used = usedByKey.get(key) ?? 0;
    const source = sources[used];
    if (!source) return [];
    usedByKey.set(key, used + 1);
    return [
      {
        ...candidate,
        id: `companion-${candidate.id}`,
        descriptionBlockId: source.targetBlockId,
        targetBlockId: source.targetBlockId,
        targetPageNumber: source.targetPageNumber,
        targetBbox: source.targetBbox,
        targetCropBottomLimit: source.targetCropBottomLimit,
      },
    ];
  });
}

export function referencePreviewPosition(
  anchor: ReferenceAnchor,
  viewport: ViewportSize,
  sourceSize?: ReferencePreviewSourceSize,
): ReferencePreviewPosition {
  const width = Math.min(
    viewport.width - VIEWPORT_MARGIN * 2,
    Math.max(
      520,
      (sourceSize?.width ?? 498) + PREVIEW_HORIZONTAL_CHROME_WIDTH,
    ),
  );
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      anchor.left + anchor.width / 2 - width / 2,
      viewport.width - width - VIEWPORT_MARGIN,
    ),
  );
  const aboveHeight = Math.max(
    1,
    Math.min(520, anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN),
  );
  const belowHeight = Math.max(
    1,
    Math.min(
      520,
      viewport.height -
        anchor.bottom -
        ANCHOR_GAP -
        VIEWPORT_MARGIN,
    ),
  );
  const preferredHeight = sourceSize
    ? sourceSize.height +
      PREVIEW_BASE_CHROME_HEIGHT +
      Math.max(0, sourceSize.captionHeight)
    : 0;
  if (
    sourceSize &&
    preferredHeight > aboveHeight &&
    preferredHeight > belowHeight
  ) {
    return {
      left,
      top: VIEWPORT_MARGIN,
      width,
      maxHeight: viewport.height - VIEWPORT_MARGIN * 2,
    };
  }

  return belowHeight > aboveHeight
    ? {
        left,
        top: anchor.bottom + ANCHOR_GAP,
        width,
        maxHeight: belowHeight,
      }
    : {
        left,
        bottom: viewport.height - anchor.top + ANCHOR_GAP,
        width,
        maxHeight: aboveHeight,
      };
}

export function referencePreviewDisplaySize(
  sourceSize: { width: number; height: number },
  viewport: ViewportSize,
  captionHeight: number,
): { width: number; height: number } {
  const availableWidth = Math.max(
    1,
    Math.min(
      PREVIEW_MAX_MEDIA_WIDTH,
      viewport.width -
        VIEWPORT_MARGIN * 2 -
        PREVIEW_HORIZONTAL_CHROME_WIDTH,
    ),
  );
  const availableHeight = Math.max(
    1,
    viewport.height -
      VIEWPORT_MARGIN * 2 -
      PREVIEW_BASE_CHROME_HEIGHT -
      Math.max(0, captionHeight),
  );
  const scale = Math.max(
    0.01,
    Math.min(
      PREVIEW_MAX_SCALE,
      availableWidth / Math.max(1, sourceSize.width),
      availableHeight / Math.max(1, sourceSize.height),
    ),
  );
  return {
    width: sourceSize.width * scale,
    height: sourceSize.height * scale,
  };
}

export function referencePreviewMediaMaxHeight(
  cardMaxHeight: number,
  captionHeight: number,
  sourceHeight = Number.POSITIVE_INFINITY,
): number {
  const chromeHeight =
    PREVIEW_BASE_CHROME_HEIGHT + Math.max(0, captionHeight);
  return Math.max(
    1,
    Math.min(sourceHeight, cardMaxHeight - chromeHeight),
  );
}
