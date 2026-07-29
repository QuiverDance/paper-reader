import type { DocumentBlock } from "../types";

export type TranslationParagraph = {
  id: string;
  blockIds: string[];
  text: string;
  sourceStyle?: DocumentBlock["sourceStyle"];
};

export function translationSourceText(block: DocumentBlock): string {
  if (block.type === "abstract") {
    return block.text.replace(/^abstract(?:\s*[:.—-]\s*|\s+)/i, "").trim();
  }
  return block.text.trim();
}

function orderedBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
}

function isProseFragment(block: DocumentBlock): boolean {
  return (
    block.type === "paragraph" ||
    block.type === "abstract" ||
    block.type === "footnote"
  );
}

function endsLogicalParagraph(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text.trim());
}

function startsLikeContinuation(text: string): boolean {
  const normalized = text.trim();
  return (
    /^[a-z0-9[(]/.test(normalized) ||
    /^(?:and|as|at|but|by|for|from|in|into|of|on|or|than|that|the|to|via|when|where|which|while|with)\b/i.test(
      normalized,
    )
  );
}

function endsWithContinuationCue(text: string): boolean {
  return /\b(?:a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|via|with)$/i.test(
    text.trim(),
  );
}

function sameColumn(left: DocumentBlock, right: DocumentBlock): boolean {
  const leftCenter = left.bbox.x + left.bbox.width / 2;
  const rightCenter = right.bbox.x + right.bbox.width / 2;
  return Math.abs(leftCenter - rightCenter) < 0.16;
}

function crossesColumnBoundary(
  left: DocumentBlock,
  right: DocumentBlock,
): boolean {
  const leftCenter = left.bbox.x + left.bbox.width / 2;
  const rightCenter = right.bbox.x + right.bbox.width / 2;
  return (
    left.pageNumber === right.pageNumber &&
    leftCenter < 0.5 &&
    rightCenter >= 0.5 &&
    left.bbox.y + left.bbox.height >= 0.68 &&
    right.bbox.y <= 0.32
  );
}

function crossesPageBoundary(
  left: DocumentBlock,
  right: DocumentBlock,
): boolean {
  return (
    right.pageNumber === left.pageNumber + 1 &&
    left.bbox.y + left.bbox.height >= 0.68 &&
    right.bbox.y <= 0.58
  );
}

function continuesParagraph(
  left: DocumentBlock,
  right: DocumentBlock,
): boolean {
  const leftText = translationSourceText(left);
  const rightText = translationSourceText(right);
  if (
    left.logicalBlockId &&
    left.logicalBlockId === right.logicalBlockId &&
    left.documentId === right.documentId &&
    isProseFragment(left) &&
    isProseFragment(right)
  ) {
    return true;
  }
  if (
    left.documentId !== right.documentId ||
    !isProseFragment(left) ||
    !isProseFragment(right) ||
    right.sourceStyle?.paragraphStart === true
  ) {
    return false;
  }
  const leftFont = left.fontSize ?? 0;
  const rightFont = right.fontSize ?? 0;
  if (
    leftFont > 0 &&
    rightFont > 0 &&
    Math.abs(leftFont - rightFont) > Math.max(leftFont, rightFont) * 0.2
  ) {
    return false;
  }
  const continuationLanguage =
    right.sourceStyle?.paragraphStart === false ||
    startsLikeContinuation(rightText) ||
    endsWithContinuationCue(leftText) ||
    /-\s*$/.test(leftText);
  if (!continuationLanguage) return false;

  const sameColumnGap =
    left.pageNumber === right.pageNumber &&
    right.readingOrder === left.readingOrder + 1 &&
    sameColumn(left, right) &&
    right.bbox.y >= left.bbox.y &&
    right.bbox.y - (left.bbox.y + left.bbox.height) <= 0.045;
  const boundaryContinuation =
    crossesColumnBoundary(left, right) ||
    crossesPageBoundary(left, right);
  if (
    endsLogicalParagraph(leftText) &&
    right.sourceStyle?.paragraphStart !== false
  ) {
    return false;
  }
  return (
    sameColumnGap ||
    boundaryContinuation
  );
}

function joinParagraphFragments(left: string, right: string): string {
  if (/-\s*$/.test(left) && /^[a-z]/.test(right.trim())) {
    return `${left.replace(/-\s*$/, "")}${right.trim()}`;
  }
  return `${left.trim()} ${right.trim()}`.trim();
}

export function groupTranslationParagraphs(
  blocks: DocumentBlock[],
  barrierBlockIds: ReadonlySet<string> = new Set(),
): TranslationParagraph[] {
  const groups: TranslationParagraph[] = [];
  let previousProseBlock: DocumentBlock | undefined;
  let previousProseGroup: TranslationParagraph | undefined;
  for (const block of orderedBlocks(blocks)) {
    const prose = isProseFragment(block);
    if (
      prose &&
      previousProseBlock &&
      previousProseGroup &&
      !barrierBlockIds.has(previousProseBlock.id) &&
      !barrierBlockIds.has(block.id) &&
      continuesParagraph(previousProseBlock, block)
    ) {
      previousProseGroup.blockIds.push(block.id);
      previousProseGroup.text = joinParagraphFragments(
        previousProseGroup.text,
        translationSourceText(block),
      );
    } else {
      const group: TranslationParagraph = {
        id: block.id,
        blockIds: [block.id],
        text: translationSourceText(block),
        ...(block.sourceStyle ? { sourceStyle: block.sourceStyle } : {}),
      };
      groups.push(group);
      if (prose) previousProseGroup = group;
    }
    if (prose) previousProseBlock = block;
  }
  return groups;
}

export function translationParagraphsForPaper(
  blocks: DocumentBlock[],
  translatableBlockIds: string[],
  barrierBlockIds?: ReadonlySet<string>,
): TranslationParagraph[] {
  const translatable = new Set(translatableBlockIds);
  return groupTranslationParagraphs(
    blocks.filter((block) => translatable.has(block.id)),
    barrierBlockIds,
  );
}
