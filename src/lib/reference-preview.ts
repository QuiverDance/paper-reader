import type {
  AnnotationSource,
  DocumentBlock,
  DocumentReference,
  NormalizedRect,
  ReferenceAnchor,
  TranslationRecord,
} from "../types";
import type { TranslationParagraph } from "./translation-paragraphs";

type ViewportSize = {
  width: number;
  height: number;
};

export type ReferencePreviewPosition = {
  left: number;
  bottom: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 3;

type ReferencePreviewCaptionOptions = {
  surface: AnnotationSource;
  reference: DocumentReference;
  sourceReferences: DocumentReference[];
  sourceBlocks: DocumentBlock[];
  translatedBlocks: DocumentBlock[];
  translations: TranslationRecord[];
  translationParagraphs: TranslationParagraph[];
};

function unionRects(left: NormalizedRect, right: NormalizedRect): NormalizedRect {
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
    (left, right) =>
      left.y - right.y ||
      left.x - right.x,
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

function codeListingTitle(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^((?:Algorithm|Listing|Code)\s*\d+[a-z]?)\s*[:.-]?\s*(.*?)(?=\s+\d+\s*:\s*(?:procedure|function|for|if|while|return)\b|$)/i,
  );
  if (!match) return undefined;
  const label = match[1].trim();
  const title = match[2].trim().replace(/[.:;-]+$/, "");
  return title ? `${label}: ${title}` : label;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeInterleavedSourceProse(text: string): string {
  const hasKorean = /[가-힣]/.test(text);
  const hasEnglishProseRun =
    /(?:\b[A-Za-z][A-Za-z0-9'’-]*(?:-[A-Za-z0-9'’-]+)?\b[\s,;:()]*){4,}/.test(
      text,
    );
  if (!hasKorean || !hasEnglishProseRun) return text;
  return text.replace(
    /\b[A-Za-z][A-Za-z0-9'’-]*(?:-[A-Za-z0-9'’-]+)?\b[.,;:!?]?/g,
    " ",
  );
}

function referenceSentence(
  text: string,
  reference: DocumentReference,
): string | undefined {
  const normalized = removeInterleavedSourceProse(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([.!?。！？])/g, "$1")
    .trim();
  const pattern = new RegExp(
    `(?:알고리즘|목록|코드)\\s*${escapePattern(reference.number)}\\b`,
    "i",
  );
  return (normalized.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [normalized])
    .map((sentence) => sentence.trim())
    .find((sentence) => pattern.test(sentence));
}

function translatedRecord(
  blockId: string | undefined,
  translations: TranslationRecord[],
): TranslationRecord | undefined {
  if (!blockId) return undefined;
  return translations.find(
    (translation) =>
      translation.blockId === blockId &&
      translation.status === "translated" &&
      translation.translatedText.trim(),
  );
}

function normalizedSourceText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function localizedReferenceLabel(
  reference: DocumentReference,
  sourceCaption?: string,
): string {
  if (reference.kind === "figure") return `그림 ${reference.number}`;
  if (reference.kind === "table") return `표 ${reference.number}`;
  const source = `${reference.label} ${sourceCaption ?? ""}`;
  const label = /^(?:목록|Listing)\b/i.test(source)
    ? "목록"
    : /^(?:코드|Code)\b/i.test(source)
      ? "코드"
      : "알고리즘";
  return `${label} ${reference.number}`;
}

function koreanCaption(text: string): string | undefined {
  const cleaned = removeInterleavedSourceProse(text)
    .replace(/\b(?:Fig(?:ure)?\.?)\s*(\d+[a-z]?)\b/gi, "그림 $1")
    .replace(/\bTable\s*(\d+[a-z]?)\b/gi, "표 $1")
    .replace(/\bAlgorithm\s*(\d+[a-z]?)\b/gi, "알고리즘 $1")
    .replace(/\bListing\s*(\d+[a-z]?)\b/gi, "목록 $1")
    .replace(/\bCode\s*(\d+[a-z]?)\b/gi, "코드 $1")
    .replace(/\s+/g, " ")
    .replace(/\s+([.!?。！？])/g, "$1")
    .trim();
  const description = cleaned.replace(
    /(?:그림|표|알고리즘|목록|코드)\s*\d+[a-z]?/gi,
    "",
  );
  return /[가-힣]/.test(description) ? cleaned : undefined;
}

function visibleTranslatedAssetCaption(
  blocks: DocumentBlock[],
  reference: DocumentReference,
): string | undefined {
  if (reference.kind === "code") return undefined;
  const type =
    reference.kind === "figure" ? "figure-caption" : "table-caption";
  const label = localizedReferenceLabel(reference);
  const pattern = new RegExp(
    `(?:^|\\s)${escapePattern(label)}\\s*[:：.]`,
    "i",
  );
  const candidates = [...blocks].sort(
    (left, right) =>
      Number(right.type === type) - Number(left.type === type),
  );
  for (const block of candidates) {
    const sourceLabelPattern =
      reference.kind === "figure"
        ? new RegExp(
            `\\b(?:Fig(?:ure)?\\.?)\\s*${escapePattern(reference.number)}\\b`,
            "i",
          )
        : new RegExp(
            `\\bTable\\s*${escapePattern(reference.number)}\\b`,
            "i",
          );
    if (sourceLabelPattern.test(block.text) && pattern.test(block.text)) {
      continue;
    }
    const caption = koreanCaption(block.text);
    if (!caption) continue;
    const match = caption.match(pattern);
    if (!match) continue;
    const start = (match.index ?? 0) + (match[0].startsWith(" ") ? 1 : 0);
    return caption.slice(start).trim();
  }
  return undefined;
}

function storedTranslatedCaption(
  targetBlock: DocumentBlock | undefined,
  targetBlockId: string | undefined,
  translations: TranslationRecord[],
): string | undefined {
  if (!targetBlock && !targetBlockId) return undefined;
  const sourceText = targetBlock
    ? normalizedSourceText(targetBlock.text)
    : undefined;
  const candidates = translations
    .filter(
      (translation) =>
        translation.status === "translated" &&
        translation.translatedText.trim() &&
        (translation.blockId === targetBlockId ||
          (sourceText !== undefined &&
            normalizedSourceText(translation.sourceText) === sourceText)),
    )
    .sort(
      (left, right) =>
        Number(right.blockId === targetBlockId) -
          Number(left.blockId === targetBlockId) ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  for (const candidate of candidates) {
    const caption = koreanCaption(candidate.translatedText);
    if (caption) return caption;
  }
  return undefined;
}

function translatedFallback(
  reference: DocumentReference,
  sourceCaption?: string,
): string {
  const label = localizedReferenceLabel(reference, sourceCaption);
  if (reference.kind === "figure") return `${label}의 원문 이미지`;
  if (reference.kind === "table") return `${label}의 원문 표`;
  return `${label}의 원문 코드`;
}

export function referencePreviewCaption({
  surface,
  reference,
  sourceReferences,
  sourceBlocks,
  translatedBlocks,
  translations,
  translationParagraphs,
}: ReferencePreviewCaptionOptions): string | undefined {
  const sourceReference =
    sourceReferences.find(
      (candidate) =>
        candidate.kind === reference.kind &&
        candidate.number.toLowerCase() === reference.number.toLowerCase() &&
        candidate.targetBlockId === reference.targetBlockId,
    ) ??
    sourceReferences.find(
      (candidate) =>
        candidate.kind === reference.kind &&
        candidate.number.toLowerCase() === reference.number.toLowerCase(),
    );
  const targetBlock = sourceBlocks.find(
    (block) =>
      block.id === (sourceReference?.targetBlockId ?? reference.targetBlockId),
  );
  const sourceCaption =
    reference.kind === "code"
      ? codeListingTitle(targetBlock?.text ?? "")
      : targetBlock?.text.trim();

  if (surface === "original") return sourceCaption;

  if (reference.kind === "code") {
    const visibleTranslatedBlock = translatedBlocks.find(
      (block) => block.id === reference.sourceBlockId,
    );
    const visibleDescription = visibleTranslatedBlock
      ? referenceSentence(visibleTranslatedBlock.text, reference)
      : undefined;
    if (visibleDescription) return visibleDescription;
  }

  const translatedCaption = storedTranslatedCaption(
    targetBlock,
    sourceReference?.targetBlockId ?? reference.targetBlockId,
    translations,
  );
  if (translatedCaption) return translatedCaption;

  if (reference.kind !== "code") {
    const visibleCaption = visibleTranslatedAssetCaption(
      translatedBlocks,
      reference,
    );
    if (visibleCaption) return visibleCaption;
  }

  if (reference.kind === "code" && sourceReference) {
    const paragraph = translationParagraphs.find((candidate) =>
      candidate.blockIds.includes(sourceReference.sourceBlockId),
    );
    const description = translatedRecord(
      paragraph?.id ?? sourceReference.sourceBlockId,
      translations,
    )?.translatedText;
    const sentence = description
      ? referenceSentence(description, reference)
      : undefined;
    if (sentence) return sentence;
    const translatedDescription = description
      ? koreanCaption(description)
      : undefined;
    if (translatedDescription) return translatedDescription;
  }

  return translatedFallback(reference, sourceCaption);
}

export function referencePreviewPosition(
  anchor: ReferenceAnchor,
  viewport: ViewportSize,
): ReferencePreviewPosition {
  const width = Math.min(
    520,
    Math.max(240, viewport.width - VIEWPORT_MARGIN * 2),
  );
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      anchor.left + anchor.width / 2 - width / 2,
      viewport.width - width - VIEWPORT_MARGIN,
    ),
  );

  return {
    left,
    bottom: viewport.height - anchor.top + ANCHOR_GAP,
    width,
    maxHeight: Math.max(
      1,
      Math.min(520, anchor.top - ANCHOR_GAP - VIEWPORT_MARGIN),
    ),
  };
}
