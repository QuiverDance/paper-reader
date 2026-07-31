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
import { inferContentStartPage } from "./document-blocks";
import { translationParagraphsForPaper } from "./translation-paragraphs";

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

export function isCodeLike(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return (
    /(?:=>|===?|!==?|<=|>=|\+\+|--|&&|\|\||::|[{};])/u.test(
      normalized,
    ) ||
    /\b(?:class|def|function|import|from|return|const|let|var|for|while|if|else|try|catch)\b[^{.;]*(?:[({:=])/iu.test(
      normalized,
    ) ||
    /(?:\w+\.)+\w+\s*\(|\w+\s*\([^)]*\)\s*(?:\{|:|=>)/u.test(
      normalized,
    )
  );
}

export function looksLikeNaturalProse(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || isCodeLike(normalized) || isEquationLike(normalized)) {
    return false;
  }
  const words = normalized.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const letters = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const sentenceLike =
    /^[a-z]/.test(normalized) || /[.!?]["')\]]*$/.test(normalized);
  return (
    words.length >= 5 &&
    letters / Math.max(1, normalized.length) >= 0.65 &&
    sentenceLike
  );
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
  if (
    (block.type === "equation" || block.type === "code-listing") &&
    looksLikeNaturalProse(block.text)
  ) {
    return true;
  }
  if (inReferences) return false;
  if (
    block.type === "title" ||
    block.type === "authors" ||
    block.type === "heading" ||
    block.type === "equation" ||
    block.type === "reference-entry" ||
    block.type === "running-header" ||
    block.type === "running-footer" ||
    block.type === "unknown"
  ) {
    return false;
  }
  if (block.type === "footnote") return isExplanatoryFootnote(block);
  if (
    block.type === "abstract" ||
    block.type === "paragraph" ||
    block.type === "figure-caption" ||
    block.type === "table-caption" ||
    block.type === "code-caption"
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
      : block.type === "code-caption"
        ? /^(?:Algorithm|Listing|Code|알고리즘|목록|코드)\s*(\d+[a-z]?)/i
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

function looksLikeBodyProse(block: DocumentBlock): boolean {
  if (block.type !== "paragraph" && block.type !== "abstract") return false;
  const text = block.text.trim();
  if (text.length < 90 || block.bbox.width < 0.25 || block.bbox.height < 0.025) {
    return false;
  }
  const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
  return letters / Math.max(1, text.length) >= 0.45;
}

function looksLikeSubfigureDescription(block: DocumentBlock): boolean {
  return /^\s*\((?:[ivxlcdm]+|[a-z])\)\s+/i.test(block.text);
}

function looksLikeTabularContent(block: DocumentBlock): boolean {
  const text = block.text.trim();
  const numericTokens =
    text.match(
      /(?:^|\s)[#]?(?:\d+(?:[.,]\d+)?|[-–—])(?=\s|$)/g,
    ) ?? [];
  const tableVocabulary =
    /\b(?:avg|average|dataset|model|queries|contexts|input|output|latency|throughput|rate|size)\b/i.test(
      text,
    );
  return (
    block.bbox.height <= 0.13 &&
    block.bbox.width >= 0.16 &&
    numericTokens.length >= 3 &&
    (tableVocabulary || numericTokens.length >= 6)
  );
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
  const captionRight = caption.bbox.x + caption.bbox.width;
  const captionBridgesColumns =
    caption.bbox.width >= 0.18 &&
    caption.bbox.x > 0.18 &&
    captionRight < 0.82 &&
    Math.abs(captionCenter - 0.5) < 0.08;
  const fullWidthAsset =
    columnCount === 1 ||
    caption.bbox.width >= 0.58 ||
    captionBridgesColumns;
  // PDF text extraction cannot see vector/raster graphics. Use the source
  // column bounds horizontally, then infer the vertical gap around the caption.
  // This favors a little whitespace over clipping the actual figure or table.
  const x = fullWidthAsset ? 0.045 : captionCenter < 0.5 ? 0.045 : 0.515;
  const width = fullWidthAsset ? 0.91 : 0.44;

  if (caption.type === "code-caption") {
    const contentBoundary = pageBlocks
      .filter(
        (block) =>
          block.id !== caption.id &&
          block.bbox.y >= captionBottom &&
          (block.type === "heading" ||
            ((block.type === "figure-caption" ||
              block.type === "table-caption" ||
              block.type === "code-caption" ||
              looksLikeBodyProse(block)) &&
              sameColumn(block, caption))),
      )
      .reduce(
        (nearest, block) => Math.min(nearest, block.bbox.y),
        Math.min(0.96, captionBottom + 0.48),
      );
    const codeBlocks = pageBlocks.filter(
      (block) =>
        block.id !== caption.id &&
        (block.type === "code-listing" || block.type === "equation") &&
        block.bbox.y >= captionTop - 0.003 &&
        block.bbox.y < contentBoundary &&
        sameColumn(block, caption),
    );
    if (codeBlocks.length) {
      const padding = 0.008;
      const contentBottom = Math.max(
        ...codeBlocks.map(
          (block) => block.bbox.y + block.bbox.height,
        ),
      );
      const boundaryIsDisplayEdge =
        contentBoundary < 0.96 &&
        contentBoundary - contentBottom <= 0.06;
      const top = clamp(captionBottom + 0.003);
      const bottom = clamp(
        boundaryIsDisplayEdge
          ? contentBoundary - padding
          : contentBottom + padding,
      );
      const left =
        columnCount === 2
          ? x
          : clamp(
              Math.min(...codeBlocks.map((block) => block.bbox.x)) - padding,
            );
      const right =
        columnCount === 2
          ? x + width
          : clamp(
              Math.max(
                ...codeBlocks.map(
                  (block) => block.bbox.x + block.bbox.width,
                ),
              ) + padding,
            );
      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
    }
    return {
      x,
      y: clamp(captionBottom + 0.006),
      width: Math.min(width, 1 - x),
      height: 0.12,
    };
  }

  if (caption.type === "table-caption") {
    const tableAbove = pageBlocks.filter(
      (block) =>
        block.bbox.y + block.bbox.height <= captionTop + 0.003 &&
        block.bbox.y >= Math.max(0.035, captionTop - 0.28) &&
        sameColumn(block, caption) &&
        block.type !== "heading" &&
        block.type !== "footnote" &&
        block.type !== "figure-caption" &&
        block.type !== "table-caption" &&
        (!looksLikeBodyProse(block) || looksLikeTabularContent(block)) &&
        block.text.trim().length > 1,
    );
    if (
      tableAbove.length >= 2 ||
      tableAbove.some(looksLikeTabularContent)
    ) {
      const top = Math.max(
        0.035,
        Math.min(...tableAbove.map((block) => block.bbox.y)) - 0.008,
      );
      return {
        x,
        y: clamp(top),
        width: Math.min(width, 1 - x),
        height: clamp(captionTop - top - 0.006),
      };
    }
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
  const previousBottom = precedingBlocks
    .filter(
      (block) =>
        block.type === "figure-caption" ||
        block.type === "table-caption" ||
        (block.type === "heading" &&
          /^(?:\d+(?:\.\d+)*\.?\s+|references|bibliography|abstract\b)/i.test(
            block.text.trim(),
          ) &&
          (block.fontSize ?? 0) >= (caption.fontSize ?? 8) * 1.1 &&
          block.bbox.height >= 0.012) ||
        block.type === "abstract" ||
        (looksLikeBodyProse(block) &&
          !looksLikeSubfigureDescription(block)),
    )
    .reduce(
      (nearest, block) =>
        Math.max(nearest, block.bbox.y + block.bbox.height),
      Math.max(referenceBoundary, 0.035),
    );
  const y = clamp(Math.min(captionTop - 0.07, previousBottom + 0.008));
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: clamp(captionTop - y - 0.006),
  };
}

function inferAssetAnchor(
  blocks: DocumentBlock[],
  caption: DocumentBlock,
  bbox: NormalizedRect,
  columnCount: 1 | 2,
): PaperAsset["anchor"] {
  const groupTop = Math.min(caption.bbox.y, bbox.y);
  if (groupTop > 0.13) return "inline";

  const hasSourceContentAbove = blocks.some((block) => {
    if (
      block.id === caption.id ||
      block.pageNumber !== caption.pageNumber ||
      block.bbox.y + block.bbox.height > groupTop + 0.003 ||
      !sameColumn(block, caption)
    ) {
      return false;
    }
    return (
      block.type === "heading" ||
      block.type === "abstract" ||
      looksLikeBodyProse(block)
    );
  });
  if (hasSourceContentAbove) return "inline";

  return columnCount === 1 || bbox.width >= 0.75
    ? "page-top"
    : "column-top";
}

function inferAssetCropBottomLimit(
  blocks: DocumentBlock[],
  caption: DocumentBlock,
  bbox: NormalizedRect,
  contentBlockIds: string[],
): number | undefined {
  const assetBottom = bbox.y + bbox.height;
  const contentIds = new Set(contentBlockIds);
  const nextStructuralTop = blocks
    .filter((candidate) => {
      if (
        candidate.pageNumber !== caption.pageNumber ||
        contentIds.has(candidate.id) ||
        candidate.bbox.y < assetBottom - 0.004 ||
        !sameColumn(candidate, caption)
      ) {
        return false;
      }
      return (
        candidate.type === "heading" ||
        candidate.type === "abstract" ||
        candidate.type === "figure-caption" ||
        candidate.type === "table-caption" ||
        candidate.type === "code-caption" ||
        looksLikeBodyProse(candidate)
      );
    })
    .reduce(
      (nearest, candidate) => Math.min(nearest, candidate.bbox.y),
      1,
    );
  if (nextStructuralTop >= 1) return undefined;
  return clamp(Math.max(assetBottom, nextStructuralTop - 0.003));
}

function inferPaperAssets(blocks: DocumentBlock[]): PaperAsset[] {
  const columnCount = estimateColumnCount(blocks);
  return blocks.flatMap((block) => {
    if (
      block.type !== "figure-caption" &&
      block.type !== "table-caption" &&
      block.type !== "code-caption"
    ) {
      return [];
    }
    const kind =
      block.type === "table-caption"
        ? "table"
        : block.type === "code-caption"
          ? "code"
          : "figure";
    const bbox = inferAssetRect(blocks, block);
    const contentBlockIds = blocks
      .filter((candidate) => {
        if (
          candidate.id === block.id ||
          candidate.pageNumber !== block.pageNumber
        ) {
          return false;
        }
        const centerX = candidate.bbox.x + candidate.bbox.width / 2;
        const centerY = candidate.bbox.y + candidate.bbox.height / 2;
        const horizontalTolerance = 0.025;
        const verticalTolerance = 0.012;
        const centerInsideAsset =
          centerX >= bbox.x - horizontalTolerance &&
          centerX <= bbox.x + bbox.width + horizontalTolerance &&
          centerY >= bbox.y - verticalTolerance &&
          centerY <= bbox.y + bbox.height + verticalTolerance;
        const overlapWidth = Math.max(
          0,
          Math.min(
            candidate.bbox.x + candidate.bbox.width,
            bbox.x + bbox.width,
          ) - Math.max(candidate.bbox.x, bbox.x),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(
            candidate.bbox.y + candidate.bbox.height,
            bbox.y + bbox.height,
          ) - Math.max(candidate.bbox.y, bbox.y),
        );
        const candidateArea =
          candidate.bbox.width * candidate.bbox.height;
        const substantialPreservedOverlap =
          (candidate.type === "equation" ||
            candidate.type === "code-listing" ||
            candidate.type === "heading" ||
            candidate.type === "unknown") &&
          candidateArea > 0 &&
          (overlapWidth * overlapHeight) / candidateArea >= 0.2;
        return (
          centerInsideAsset ||
          substantialPreservedOverlap
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
        anchor: inferAssetAnchor(blocks, block, bbox, columnCount),
        cropBottomLimit: inferAssetCropBottomLimit(
          blocks,
          block,
          bbox,
          contentBlockIds,
        ),
        sectionId: "front-matter",
        contentBlockIds,
      },
    ];
  });
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
  const contentStartPage = inferContentStartPage(ordered);
  const paperBlocks = ordered.filter(
    (block) =>
      block.pageNumber >= contentStartPage &&
      block.type !== "running-header" &&
      block.type !== "running-footer",
  );
  const preliminaryAssets = inferPaperAssets(paperBlocks);
  const assetContentIds = new Set(
    preliminaryAssets.flatMap((asset) => asset.contentBlockIds),
  );
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
    if (
      block.pageNumber < contentStartPage ||
      block.type === "running-header" ||
      block.type === "running-footer"
    ) {
      sections[0].blockIds.push(block.id);
      blockSectionIds[block.id] = "front-matter";
      preservedBlockIds.push(block.id);
      continue;
    }
    const normalized = block.text.trim();
    const abstractLabelOnly =
      block.type === "abstract" && ABSTRACT_HEADING.test(normalized);
    if (
      !assetContentIds.has(block.id) &&
      (block.type === "heading" || abstractLabelOnly)
    ) {
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
    const equation = isEquationLike(block.text);
    const translatable =
      !assetContentIds.has(block.id) &&
      !equation &&
      isTranslatableSemanticBlock(block, inReferences);
    if (translatable) translatableBlockIds.push(block.id);
    else preservedBlockIds.push(block.id);
  }

  const assets = preliminaryAssets.map((asset) => ({
    ...asset,
    sectionId: blockSectionIds[asset.captionBlockId] ?? "front-matter",
  }));
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
    contentStartPage,
    sections,
    assets,
    blockSectionIds,
    translatableBlockIds: filteredTranslatableBlockIds,
    preservedBlockIds,
    columnCount: estimateColumnCount(paperBlocks),
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
    acceptedAt: previous?.acceptedAt,
    acceptedProfileId: previous?.acceptedProfileId,
    acceptedEffort: previous?.acceptedEffort,
    questionDigest: previous?.questionDigest,
    questionDigestSignature: previous?.questionDigestSignature,
    nativePdfFileIds: previous?.nativePdfFileIds ?? {},
    documentStructure: previous?.documentStructure,
    tokenUsage: previous?.tokenUsage,
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

  const translationParagraphs = translationParagraphsForPaper(
    blocks,
    paper.translatableBlockIds,
    new Set(
      translations
        .filter(
          (item) =>
            item.targetLanguage === project.targetLanguage && item.locked,
        )
        .map((item) => item.blockId),
    ),
  );
  for (const paragraph of translationParagraphs) {
    if (
      !translated.has(paragraph.id) &&
      !paragraph.blockIds.some((blockId) => fallbacks.has(blockId))
    ) {
      warnings.push({
        id: `missing-translation:${paragraph.id}`,
        severity: "integrity",
        kind: "missing-translation",
        blockId: paragraph.id,
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
        message: `${
          asset.kind === "figure"
            ? "그림"
            : asset.kind === "table"
              ? "표"
              : "코드"
        } ${asset.number}의 원본 영역을 확정하지 못했습니다.`,
      });
    }
  }

  for (const block of blocks) {
    if (
      isEquationLike(block.text) &&
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
