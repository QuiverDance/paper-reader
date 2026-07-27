import type {
  DocumentBlock,
  DocumentBlockType,
  NormalizedRect,
} from "../types";

const PDF_TO_CSS_UNITS = 96 / 72;
const MASK_MARGIN = 0.0008;
const BLOCK_GAP = 0.0015;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function horizontalOverlapRatio(
  left: NormalizedRect,
  right: NormalizedRect,
): number {
  const intersection = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  return intersection / Math.max(Math.min(left.width, right.width), 0.0001);
}

function verticalOverlapRatio(
  top: NormalizedRect,
  bottom: NormalizedRect,
): number {
  const intersection = Math.max(
    0,
    Math.min(top.y + top.height, bottom.y + bottom.height) -
      Math.max(top.y, bottom.y),
  );
  return intersection / Math.max(Math.min(top.height, bottom.height), 0.0001);
}

function expansionMultiplier(type: DocumentBlockType): number {
  switch (type) {
    case "title":
      return 1.4;
    case "heading":
      return 1.3;
    case "figure-caption":
    case "table-caption":
      return 1.45;
    case "footnote":
      return 1.3;
    default:
      return 1.65;
  }
}

function horizontalExpansionMultiplier(type: DocumentBlockType): number {
  switch (type) {
    case "heading":
      return 2.1;
    case "title":
      return 1.35;
    case "figure-caption":
    case "table-caption":
      return 1.25;
    default:
      return 1;
  }
}

export function translationMaskRect(block: DocumentBlock): NormalizedRect {
  const x = clampUnit(block.bbox.x - MASK_MARGIN);
  const y = clampUnit(block.bbox.y - MASK_MARGIN);
  const right = clampUnit(block.bbox.x + block.bbox.width + MASK_MARGIN);
  const bottom = clampUnit(block.bbox.y + block.bbox.height + MASK_MARGIN);
  return {
    x,
    y,
    width: Math.max(0.0001, right - x),
    height: Math.max(0.0001, bottom - y),
  };
}

export function availableTranslationWidth(
  block: DocumentBlock,
  pageBlocks: DocumentBlock[],
): number {
  const mask = translationMaskRect(block);
  const originalRight = block.bbox.x + block.bbox.width;
  const nextBlockLeft = pageBlocks
    .filter(
      (candidate) =>
        candidate.id !== block.id &&
        candidate.bbox.x >= originalRight - 0.0005 &&
        verticalOverlapRatio(block.bbox, candidate.bbox) >= 0.35,
    )
    .reduce(
      (nearest, candidate) => Math.min(nearest, candidate.bbox.x),
      1,
    );
  const desiredRight = Math.min(
    1,
    mask.x + mask.width * horizontalExpansionMultiplier(block.type),
  );
  const safeRight = Math.max(
    mask.x + mask.width,
    Math.min(desiredRight, nextBlockLeft - BLOCK_GAP),
  );
  return Math.max(mask.width, safeRight - mask.x);
}

export function availableTranslationHeight(
  block: DocumentBlock,
  pageBlocks: DocumentBlock[],
): number {
  const mask = translationMaskRect(block);
  const originalBottom = block.bbox.y + block.bbox.height;
  const nextBlockTop = pageBlocks
    .filter(
      (candidate) =>
        candidate.id !== block.id &&
        candidate.bbox.y >= originalBottom - 0.0005 &&
        horizontalOverlapRatio(block.bbox, candidate.bbox) >= 0.35,
    )
    .reduce(
      (nearest, candidate) => Math.min(nearest, candidate.bbox.y),
      1,
    );
  const desiredBottom = Math.min(
    1,
    mask.y + mask.height * expansionMultiplier(block.type),
  );
  const safeBottom = Math.max(
    mask.y + mask.height,
    Math.min(desiredBottom, nextBlockTop - BLOCK_GAP),
  );
  return Math.max(mask.height, safeBottom - mask.y);
}

export function translationFontBounds(
  block: Pick<DocumentBlock, "fontSize" | "type">,
  scale: number,
): { min: number; max: number } {
  const sourceSize = Math.max(4, (block.fontSize ?? 10) * scale * PDF_TO_CSS_UNITS);
  const maxMultiplier =
    block.type === "footnote" ||
    block.type === "figure-caption" ||
    block.type === "table-caption"
      ? 0.98
      : 1.03;
  const minMultiplier =
    block.type === "title" || block.type === "heading" ? 0.52 : 0.42;
  const max = Math.min(96, sourceSize * maxMultiplier);
  return {
    min: Math.min(max, Math.max(3.25, sourceSize * minMultiplier)),
    max,
  };
}
