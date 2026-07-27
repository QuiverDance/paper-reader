import type {
  DocumentBlock,
  DocumentReference,
  NormalizedRect,
  PaperAsset,
  PaperSection,
  RetypesetProject,
  RetypesetWarning,
  SemanticPaper,
  TranslationRecord,
} from "../types";

const REFERENCES_HEADING = /^(references|bibliography)$/i;
const ABSTRACT_HEADING = /^abstract$/i;
const EXPLANATORY_FOOTNOTE =
  /\b(?:see|note|means|defined|available|corresponds|indicates|because|where)\b/i;
const FRONT_MATTER_NOTE =
  /(?:@|university|institute|department|corresponding author|affiliation|equal contribution)/i;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function validRect(rect: NormalizedRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0.003 &&
    rect.height > 0.003 &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= 1.002 &&
    rect.y + rect.height <= 1.002
  );
}

function sortBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
}

export function headingLevel(text: string): number {
  const match = text.trim().match(/^(\d+(?:\.\d+)*)\.?\s+/);
  if (!match) return 1;
  return Math.min(6, match[1].split(".").length);
}

export function isEquationLike(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > 240) return false;
  const letters = (normalized.match(/[A-Za-z가-힣]/g) ?? []).length;
  const math = (
    normalized.match(/[=+\-−×÷∑∏√∞≤≥≈≠∫∂∇α-ωΑ-Ω^_{}[\]]/g) ?? []
  ).length;
  return math >= 1 && letters / normalized.length < 0.42;
}

function isExplanatoryFootnote(block: DocumentBlock): boolean {
  if (block.type !== "footnote") return false;
  if (block.pageNumber === 1 && FRONT_MATTER_NOTE.test(block.text)) return false;
  return block.pageNumber > 1 || EXPLANATORY_FOOTNOTE.test(block.text);
}

function isTranslatableSemanticBlock(
  block: DocumentBlock,
  inReferences: boolean,
): boolean {
  if (inReferences) return false;
  if (
    block.type === "title" ||
    block.type === "authors" ||
    block.type === "heading" ||
    block.type === "equation" ||
    block.type === "reference-entry" ||
    block.type === "unknown"
  ) {
    return false;
  }
  if (block.type === "footnote") return isExplanatoryFootnote(block);
  if (
    block.type === "abstract" ||
    block.type === "paragraph" ||
    block.type === "figure-caption" ||
    block.type === "table-caption"
  ) {
    return block.translatable;
  }
  return false;
}

function estimateColumnCount(blocks: DocumentBlock[]): 1 | 2 {
  const body = blocks.filter(
    (block) =>
      block.type === "paragraph" &&
      block.bbox.width > 0.18 &&
      block.bbox.width < 0.62,
  );
  if (body.length < 6) return 1;
  const left = body.filter((block) => block.bbox.x < 0.43).length;
  const right = body.filter((block) => block.bbox.x > 0.43).length;
  return left >= 3 && right >= 3 ? 2 : 1;
}

function assetNumber(block: DocumentBlock): string {
  const match = block.text.match(
    block.type === "table-caption"
      ? /^Table\s*(\d+[a-z]?)/i
      : /^(?:Fig(?:ure)?\.?)\s*(\d+[a-z]?)/i,
  );
  return match?.[1] ?? "?";
}

function sameColumn(left: DocumentBlock, right: DocumentBlock): boolean {
  const start = Math.max(left.bbox.x, right.bbox.x);
  const end = Math.min(
    left.bbox.x + left.bbox.width,
    right.bbox.x + right.bbox.width,
  );
  return end - start >= Math.min(left.bbox.width, right.bbox.width) * 0.35;
}

export function inferAssetRect(
  blocks: DocumentBlock[],
  caption: DocumentBlock,
): NormalizedRect {
  const pageBlocks = sortBlocks(
    blocks.filter(
      (block) =>
        block.pageNumber === caption.pageNumber && block.id !== caption.id,
    ),
  );
  const captionTop = caption.bbox.y;
  const captionBottom = caption.bbox.y + caption.bbox.height;
  const columnCount = estimateColumnCount(blocks);
  const captionCenter = caption.bbox.x + caption.bbox.width / 2;
  const fullWidthAsset = columnCount === 1 || caption.bbox.width >= 0.58;
  // PDF text extraction cannot see vector/raster graphics. Use the source
  // column bounds horizontally, then infer the vertical gap around the caption.
  // This favors a little whitespace over clipping the actual figure or table.
  const x = fullWidthAsset ? 0.045 : captionCenter < 0.5 ? 0.045 : 0.515;
  const width = fullWidthAsset ? 0.91 : 0.44;

  if (caption.type === "table-caption") {
    const nextTop = pageBlocks
      .filter(
        (block) =>
          block.bbox.y >= captionBottom &&
          sameColumn(block, caption) &&
          block.type !== "footnote" &&
          (block.type === "heading" ||
            block.type === "figure-caption" ||
            block.type === "table-caption" ||
            block.text.length >= 70),
      )
      .reduce((nearest, block) => Math.min(nearest, block.bbox.y), 0.96);
    const bottom = Math.min(0.96, Math.max(captionBottom + 0.08, nextTop - 0.008));
    return {
      x,
      y: clamp(captionBottom + 0.006),
      width: Math.min(width, 1 - x),
      height: clamp(bottom - captionBottom - 0.006),
    };
  }

  const escapedNumber = assetNumber(caption).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const assetReference = new RegExp(
    `\\b(?:fig(?:ure)?\\.?|table)\\s*${escapedNumber}\\b`,
    "i",
  );
  const precedingBlocks = pageBlocks.filter(
    (block) =>
      block.bbox.y + block.bbox.height <= captionTop &&
      sameColumn(block, caption) &&
      block.type !== "footnote",
  );
  const referenceBoundary = precedingBlocks
    .filter(
      (block) =>
        (block.type === "paragraph" || block.type === "abstract") &&
        assetReference.test(block.text),
    )
    .reduce(
      (nearest, block) =>
        Math.max(nearest, block.bbox.y + block.bbox.height),
      0,
    );
  const previousBottom =
    referenceBoundary ||
    precedingBlocks
      .filter(
        (block) =>
          block.type === "heading" ||
          block.type === "abstract" ||
          (block.type === "paragraph" &&
            block.text.length >= 24 &&
            !/^[A-Z0-9\s+\-_=().]+$/.test(block.text)),
      )
      .reduce(
        (nearest, block) =>
          Math.max(nearest, block.bbox.y + block.bbox.height),
        Math.max(0.035, captionTop - 0.36),
      );
  const y = clamp(Math.min(captionTop - 0.07, previousBottom + 0.008));
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: clamp(captionTop - y - 0.006),
  };
}

function createSection(
  id: string,
  title: string,
  level: number,
  headingBlockId?: string,
  parentId?: string,
  topLevelId = id,
): PaperSection {
  return {
    id,
    title,
    level,
    parentId,
    headingBlockId,
    blockIds: headingBlockId ? [headingBlockId] : [],
    childIds: [],
    topLevelId,
  };
}

export function analyzeSemanticPaper(
  blocks: DocumentBlock[],
  references: DocumentReference[] = [],
): SemanticPaper {
  const ordered = sortBlocks(blocks);
  const sections: PaperSection[] = [
    createSection("front-matter", "Front matter", 0),
  ];
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const stack: PaperSection[] = [];
  const blockSectionIds: Record<string, string> = {};
  const translatableBlockIds: string[] = [];
  const preservedBlockIds: string[] = [];
  let current = sections[0];
  let inReferences = false;
  let referenceHeadingBlockId: string | undefined;

  for (const block of ordered) {
    const normalized = block.text.trim();
    const abstractLabelOnly =
      block.type === "abstract" && ABSTRACT_HEADING.test(normalized);
    if (block.type === "heading" || abstractLabelOnly) {
      const level = abstractLabelOnly ? 1 : headingLevel(normalized);
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      const parent = stack.at(-1);
      const id = `section-${block.id}`;
      const topLevelId = parent ? parent.topLevelId : id;
      const section = createSection(
        id,
        normalized,
        level,
        block.id,
        parent?.id,
        topLevelId,
      );
      sections.push(section);
      sectionById.set(id, section);
      if (parent) parent.childIds.push(id);
      stack.push(section);
      current = section;
      blockSectionIds[block.id] = id;
      preservedBlockIds.push(block.id);
      if (REFERENCES_HEADING.test(normalized)) {
        inReferences = true;
        referenceHeadingBlockId = block.id;
      }
      continue;
    }

    current.blockIds.push(block.id);
    blockSectionIds[block.id] = current.id;
    const equation = block.type === "equation" || isEquationLike(block.text);
    const translatable =
      !equation && isTranslatableSemanticBlock(block, inReferences);
    if (translatable) translatableBlockIds.push(block.id);
    else preservedBlockIds.push(block.id);
  }

  const assets: PaperAsset[] = ordered.flatMap((block) => {
    if (
      block.type !== "figure-caption" &&
      block.type !== "table-caption"
    ) {
      return [];
    }
    const kind = block.type === "table-caption" ? "table" : "figure";
    const bbox = inferAssetRect(ordered, block);
    const contentBlockIds = ordered
      .filter((candidate) => {
        if (candidate.id === block.id || candidate.pageNumber !== block.pageNumber) {
          return false;
        }
        const centerX = candidate.bbox.x + candidate.bbox.width / 2;
        const centerY = candidate.bbox.y + candidate.bbox.height / 2;
        return (
          centerX >= bbox.x &&
          centerX <= bbox.x + bbox.width &&
          centerY >= bbox.y &&
          centerY <= bbox.y + bbox.height
        );
      })
      .map((candidate) => candidate.id);
    return [
      {
        id: `${kind}-${assetNumber(block)}-${block.id}`,
        kind,
        number: assetNumber(block),
        captionBlockId: block.id,
        pageNumber: block.pageNumber,
        bbox,
        sectionId: blockSectionIds[block.id] ?? "front-matter",
        contentBlockIds,
      },
    ];
  });

  const assetContentIds = new Set(
    assets.flatMap((asset) => asset.contentBlockIds),
  );
  const filteredTranslatableBlockIds = translatableBlockIds.filter(
    (id) => !assetContentIds.has(id),
  );
  for (const id of assetContentIds) {
    if (!preservedBlockIds.includes(id)) preservedBlockIds.push(id);
  }

  // Referenced captions that could not be matched are reported by validation.
  void references;

  return {
    documentId: ordered[0]?.documentId ?? "",
    sections,
    assets,
    blockSectionIds,
    translatableBlockIds: filteredTranslatableBlockIds,
    preservedBlockIds,
    columnCount: estimateColumnCount(ordered),
    bodyFontStyle: "serif",
    referenceHeadingBlockId,
  };
}

export function createRetypesetProject(
  documentId: string,
  targetLanguage: string,
  profileId: string,
  previous?: RetypesetProject | null,
): RetypesetProject {
  const now = new Date().toISOString();
  return {
    id: previous?.id ?? `retypeset-${documentId}`,
    documentId,
    targetLanguage,
    profileId,
    translationBrief: previous?.translationBrief ?? "",
    manuallyEditedBlockIds: previous?.manuallyEditedBlockIds ?? [],
    sourceFallbackBlockIds: previous?.sourceFallbackBlockIds ?? [],
    acknowledgedWarningIds: previous?.acknowledgedWarningIds ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    lastExportedAt: previous?.lastExportedAt,
  };
}

export function validateRetypesetProject(
  paper: SemanticPaper,
  blocks: DocumentBlock[],
  translations: TranslationRecord[],
  references: DocumentReference[],
  project: RetypesetProject,
): RetypesetWarning[] {
  const warnings: RetypesetWarning[] = [];
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const translated = new Map(
    translations
      .filter(
        (item) =>
          item.targetLanguage === project.targetLanguage &&
          item.status === "translated" &&
          item.translatedText.trim(),
      )
      .map((item) => [item.blockId, item]),
  );
  const fallbacks = new Set(project.sourceFallbackBlockIds);

  if (!blocks.length) {
    warnings.push({
      id: "unsupported-source",
      severity: "integrity",
      kind: "unsupported-source",
      message: "추출 가능한 텍스트가 없어 재조판할 수 없습니다.",
    });
  }

  for (const blockId of paper.translatableBlockIds) {
    if (!translated.has(blockId) && !fallbacks.has(blockId)) {
      warnings.push({
        id: `missing-translation:${blockId}`,
        severity: "integrity",
        kind: "missing-translation",
        blockId,
        message: "번역되지 않은 본문 또는 캡션이 있습니다.",
      });
    }
  }

  for (const asset of paper.assets) {
    if (!validRect(asset.bbox) || asset.bbox.height < 0.035) {
      warnings.push({
        id: `damaged-asset:${asset.id}`,
        severity: "integrity",
        kind: "damaged-asset",
        blockId: asset.captionBlockId,
        message: `${asset.kind === "figure" ? "그림" : "표"} ${asset.number}의 원본 영역을 확정하지 못했습니다.`,
      });
    }
  }

  for (const block of blocks) {
    if (
      (block.type === "equation" || isEquationLike(block.text)) &&
      !validRect(block.bbox)
    ) {
      warnings.push({
        id: `damaged-equation:${block.id}`,
        severity: "integrity",
        kind: "damaged-equation",
        blockId: block.id,
        message: "원본 수식 영역이 손상되었습니다.",
      });
    }
  }

  for (const reference of references) {
    if (
      !reference.targetBlockId ||
      !blockById.has(reference.targetBlockId)
    ) {
      if (fallbacks.has(reference.sourceBlockId)) continue;
      warnings.push({
        id: `broken-reference:${reference.id}`,
        severity: "integrity",
        kind: "broken-reference",
        blockId: reference.sourceBlockId,
        message: `${reference.label} 참조 대상을 찾지 못했습니다.`,
      });
    }
  }

  return warnings.map((warning) => ({
    ...warning,
    acknowledged: project.acknowledgedWarningIds.includes(warning.id),
  }));
}
