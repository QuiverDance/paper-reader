import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFName,
  PDFPage,
  PDFFont,
  rgb,
  StandardFonts,
} from "pdf-lib";
import type {
  DocumentBlock,
  NormalizedRect,
  PaperAsset,
  RetypesetProject,
  RetypesetWarning,
  SemanticPaper,
  TranslationRecord,
} from "../types";
import {
  containsEmbeddedNaturalProse,
  isEquationLike,
  looksLikeNaturalProse,
} from "./semantic-paper";
import { translationParagraphsForPaper } from "./translation-paragraphs";

type RetypesetPdfOptions = {
  sourceBytes: Uint8Array;
  sourceTitle: string;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  translations: TranslationRecord[];
  project: RetypesetProject;
  serifFontBytes: Uint8Array;
  serifBoldFontBytes?: Uint8Array;
  sansFontBytes: Uint8Array;
  sansBoldFontBytes?: Uint8Array;
  mathFontBytes?: Uint8Array;
  generatedAt?: Date;
};

type RetypesetPdfResult = {
  bytes: Uint8Array;
  warnings: RetypesetWarning[];
  pageCount: number;
};

type FontSet = {
  koreanBody: PDFFont;
  koreanBodyBold: PDFFont;
  koreanSans: PDFFont;
  koreanSansBold: PDFFont;
  math: PDFFont;
  latinBody: PDFFont;
  latinSans: PDFFont;
  latinBold: PDFFont;
};

type LayoutState = {
  page: PDFPage;
  pageIndex: number;
  column: number;
  y: number;
};

type LinkPosition = {
  page: PDFPage;
  x: number;
  y: number;
  width: number;
  height: number;
  key: string;
};

type Destination = {
  page: PDFPage;
  y: number;
};

type ReservedSlot = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const PAGE_MARGIN_RATIO = 0.075;
const PAGE_TOP_RATIO = 0.07;
const PAGE_BOTTOM_RATIO = 0.065;
const COLUMN_GUTTER_RATIO = 0.035;
const KOREAN_BODY_VISUAL_SCALE = 0.9;
const MIN_BODY_SIZE = 7.6;
const MAX_BODY_SIZE = 10.1;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]): number {
  if (!values.length) return 10;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function inferBodyFontSize(blocks: DocumentBlock[]): number {
  return clamp(
    median(
      blocks
        .filter((block) => block.type === "paragraph" && block.fontSize)
        .map((block) => block.fontSize!),
    ) * KOREAN_BODY_VISUAL_SCALE,
    MIN_BODY_SIZE,
    MAX_BODY_SIZE,
  );
}

export function usesWholeBlockBoldFont(block: DocumentBlock): boolean {
  return (
    block.type !== "paragraph" &&
    block.type !== "abstract" &&
    block.type !== "footnote" &&
    block.sourceStyle?.fontWeight === "bold" &&
    !block.sourceStyle?.boldLead
  );
}

export function localizeDocumentReferenceLabels(text: string): string {
  return text
    .replace(/\b(?:Fig(?:ure)?\.?)\s*(\d+[a-z]?)\b/gi, "그림 $1")
    .replace(/\bTable\s*(\d+[a-z]?)\b/gi, "표 $1")
    .replace(/\bAlgorithm\s*(\d+[a-z]?)\b/gi, "알고리즘 $1")
    .replace(/\bListing\s*(\d+[a-z]?)\b/gi, "목록 $1")
    .replace(/\bCode\s*(\d+[a-z]?)\b/gi, "코드 $1");
}

function sourceCrop(
  rect: NormalizedRect,
  width: number,
  height: number,
): { left: number; bottom: number; right: number; top: number } {
  return {
    left: clamp(rect.x * width, 0, width),
    bottom: clamp((1 - rect.y - rect.height) * height, 0, height),
    right: clamp((rect.x + rect.width) * width, 0, width),
    top: clamp((1 - rect.y) * height, 0, height),
  };
}

export function equationSourceCrop(
  rect: NormalizedRect,
  width: number,
  height: number,
): { left: number; bottom: number; right: number; top: number } {
  const crop = sourceCrop(rect, width, height);
  const padding = 4;
  const rounded = (value: number) => Number(value.toFixed(6));
  return {
    left: rounded(Math.max(0, crop.left - padding)),
    bottom: rounded(Math.max(0, crop.bottom - padding)),
    right: rounded(Math.min(width, crop.right + padding)),
    top: rounded(Math.min(height, crop.top + padding)),
  };
}

export function inferFrontMatterRect(
  blocks: DocumentBlock[],
  contentStartPage: number,
): NormalizedRect | null {
  const frontMatter = blocks.filter(
    (block) =>
      block.pageNumber === contentStartPage &&
      (block.type === "title" || block.type === "authors"),
  );
  if (
    !frontMatter.some((block) => block.type === "title") ||
    !frontMatter.some((block) => block.type === "authors")
  ) {
    return null;
  }

  const padding = 0.015;
  const left = clamp(
    Math.min(...frontMatter.map((block) => block.bbox.x)) - padding,
    0,
    1,
  );
  const top = clamp(
    Math.min(...frontMatter.map((block) => block.bbox.y)) - padding,
    0,
    1,
  );
  const right = clamp(
    Math.max(
      ...frontMatter.map((block) => block.bbox.x + block.bbox.width),
    ) + padding,
    0,
    1,
  );
  const abstractTop = blocks
    .filter(
      (block) =>
        block.pageNumber === contentStartPage &&
        (block.type === "abstract" ||
          /^abstract$/i.test(block.text.trim())),
    )
    .reduce((nearest, block) => Math.min(nearest, block.bbox.y), 1);
  const paddedBottom = clamp(
    Math.max(
      ...frontMatter.map((block) => block.bbox.y + block.bbox.height),
    ) + padding,
    0,
    1,
  );
  const bottom =
    abstractTop < 1
      ? Math.min(paddedBottom, Math.max(top, abstractTop - 0.006))
      : paddedBottom;
  const rounded = (value: number) => Number(value.toFixed(6));
  return {
    x: rounded(left),
    y: rounded(top),
    width: rounded(right - left),
    height: rounded(bottom - top),
  };
}

export function isStandaloneMarker(block: DocumentBlock): boolean {
  return (
    (block.type === "unknown" || block.type === "footnote") &&
    /^[\d*†‡]+$/.test(block.text.trim()) &&
    block.bbox.width <= 0.04 &&
    block.bbox.height <= 0.03
  );
}

export function shouldRegisterPreservedFragment(
  block: DocumentBlock,
  assetContentBlockIds: ReadonlySet<string>,
): boolean {
  if (assetContentBlockIds.has(block.id)) return false;
  if (block.type === "code-listing") {
    return !(
      looksLikeNaturalProse(block.text) ||
      containsEmbeddedNaturalProse(block.text)
    );
  }
  return isEquationLike(block.text);
}

export function shouldOmitMixedSourceFragment(
  block: DocumentBlock,
): boolean {
  return (
    (block.type === "code-listing" || block.type === "equation") &&
    containsEmbeddedNaturalProse(block.text)
  );
}

function graphemes(value: string): string[] {
  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    return [...segmenter.segment(value)].map((segment) => segment.segment);
  }
  return Array.from(value);
}

function splitLongToken(
  token: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
) {
  const chunks: string[] = [];
  let current = "";
  for (const character of graphemes(token)) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function canEncodeText(font: PDFFont, text: string, size: number): boolean {
  try {
    font.widthOfTextAtSize(text, size);
    return true;
  } catch {
    return false;
  }
}

export type AcademicTextLine = {
  text: string;
  paragraphEnd: boolean;
};

export function academicTextLines(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
): AcademicTextLine[] {
  const paragraphs = text.replace(/\r/g, "").split(/\n+/);
  const lines: AcademicTextLine[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push({ text: "", paragraphEnd: true });
      continue;
    }
    let line = "";
    for (const rawWord of words) {
      const pieces =
        font.widthOfTextAtSize(rawWord, size) > width
          ? splitLongToken(rawWord, font, size, width)
          : [rawWord];
      for (const word of pieces) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > width) {
          lines.push({ text: line, paragraphEnd: false });
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push({ text: line, paragraphEnd: true });
  }
  return lines;
}

export function wrapAcademicText(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
): string[] {
  return academicTextLines(text, font, size, width).map((line) => line.text);
}

export type AcademicLineSegment = {
  text: string;
  start: number;
  end: number;
  xOffset: number;
  width: number;
  font?: PDFFont;
};

export function justifiedLineSegments(
  line: AcademicTextLine,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
): AcademicLineSegment[] {
  const naturalWidth = font.widthOfTextAtSize(line.text, size);
  const natural = [
    {
      text: line.text,
      start: 0,
      end: line.text.length,
      xOffset: 0,
      width: naturalWidth,
    },
  ];
  if (line.paragraphEnd || !line.text) return natural;

  const words = [...line.text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    width: font.widthOfTextAtSize(match[0], size),
  }));
  if (words.length < 2) return natural;
  const wordWidth = words.reduce((total, word) => total + word.width, 0);
  if (wordWidth >= width) return natural;
  const gap = (width - wordWidth) / (words.length - 1);
  let xOffset = 0;
  return words.map((word) => {
    const segment = { ...word, xOffset };
    xOffset += word.width + gap;
    return segment;
  });
}

function blockText(
  block: DocumentBlock,
  translations: ReadonlyMap<string, TranslationRecord>,
  project: RetypesetProject,
  translatable: ReadonlySet<string>,
): { text: string; translated: boolean; missing: boolean } {
  if (!translatable.has(block.id)) {
    return { text: block.text, translated: false, missing: false };
  }
  const translation = translations.get(block.id);
  if (translation?.status === "translated" && translation.translatedText.trim()) {
    return {
      text: localizeDocumentReferenceLabels(translation.translatedText.trim()),
      translated: true,
      missing: false,
    };
  }
  if (project.sourceFallbackBlockIds.includes(block.id)) {
    return { text: block.text, translated: false, missing: false };
  }
  return { text: "[번역 필요]", translated: true, missing: true };
}

function detectInlineLinks(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  lineHeight: number,
  links: LinkPosition[],
  segments?: AcademicLineSegment[],
) {
  const positionedSegments =
    segments && segments.length
      ? segments
      : [
          {
            text,
            start: 0,
            end: text.length,
            xOffset: 0,
            width: font.widthOfTextAtSize(text, size),
          },
        ];
  const offsetAt = (index: number) => {
    for (const segment of positionedSegments) {
      if (index < segment.start) return segment.xOffset;
      if (index <= segment.end) {
        return (
          segment.xOffset +
          (segment.font ?? font).widthOfTextAtSize(
            segment.text.slice(0, Math.max(0, index - segment.start)),
            size,
          )
        );
      }
    }
    const last = positionedSegments[positionedSegments.length - 1];
    return last ? last.xOffset + last.width : 0;
  };
  const patterns: Array<{ regex: RegExp; key: (match: RegExpExecArray) => string }> = [
    {
      regex: /(?:그림|Figure|Fig\.)\s*(\d+[a-z]?)/gi,
      key: (match) => `figure:${match[1].toLowerCase()}`,
    },
    {
      regex: /(?:표|Table)\s*(\d+[a-z]?)/gi,
      key: (match) => `table:${match[1].toLowerCase()}`,
    },
    {
      regex: /\[(\d+)\]/g,
      key: (match) => `reference:${match[1]}`,
    },
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const prefix = text.slice(0, match.index);
      const matched = match[0];
      const start = offsetAt(prefix.length);
      const end = offsetAt(prefix.length + matched.length);
      links.push({
        page,
        x: x + start,
        y: y - 1,
        width: Math.max(0, end - start),
        height: lineHeight,
        key: pattern.key(match as RegExpExecArray),
      });
    }
  }
}

function addGoToLink(
  document: PDFDocument,
  source: LinkPosition,
  destination: Destination,
) {
  const destinationArray = document.context.obj([
    destination.page.ref,
    PDFName.of("XYZ"),
    null,
    destination.y,
    null,
  ]);
  const annotation = document.context.register(
    document.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [
        source.x,
        source.y,
        source.x + source.width,
        source.y + source.height,
      ],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "GoTo",
        D: destinationArray,
      },
    }),
  );
  source.page.node.addAnnot(annotation);
}

function referenceDestination(block: DocumentBlock): string | null {
  const match = block.text.trim().match(/^\[?(\d+)\]?(?:[.)]|\s)/);
  return match ? `reference:${match[1]}` : null;
}

export type RetypesetContentPlan = {
  orderedBlocks: DocumentBlock[];
  translationByBlock: ReadonlyMap<string, TranslationRecord>;
  translatableBlockIds: ReadonlySet<string>;
  continuationBlockIds: ReadonlySet<string>;
  assetsByCaption: ReadonlyMap<string, PaperAsset>;
  assetContentBlockIds: ReadonlySet<string>;
  frontMatterRect: NormalizedRect | null;
  frontMatterBlockIds: ReadonlySet<string>;
};

function prefersTranslation(
  candidate: TranslationRecord,
  current: TranslationRecord,
): boolean {
  const statusRank = (record: TranslationRecord) =>
    record.status === "translated" ? 2 : record.status === "pending" ? 1 : 0;
  return (
    statusRank(candidate) > statusRank(current) ||
    (statusRank(candidate) === statusRank(current) &&
      candidate.updatedAt.localeCompare(current.updatedAt) > 0)
  );
}

export function planRetypesetContent(
  blocks: DocumentBlock[],
  paper: SemanticPaper,
  translations: TranslationRecord[],
  project: RetypesetProject,
): RetypesetContentPlan {
  const translationByBlock = new Map<string, TranslationRecord>();
  for (const translation of translations) {
    if (translation.targetLanguage !== project.targetLanguage) continue;
    const current = translationByBlock.get(translation.blockId);
    if (!current || prefersTranslation(translation, current)) {
      translationByBlock.set(translation.blockId, translation);
    }
  }
  const translatableBlockIds = new Set(paper.translatableBlockIds);
  const lockedBlockIds = new Set(
    translations
      .filter(
        (item) =>
          item.targetLanguage === project.targetLanguage && item.locked,
      )
      .map((item) => item.blockId),
  );
  const continuationBlockIds = new Set(
    translationParagraphsForPaper(
      blocks,
      paper.translatableBlockIds,
      lockedBlockIds,
    ).flatMap((paragraph) => paragraph.blockIds.slice(1)),
  );
  const assetsByCaption = new Map(
    paper.assets.map((asset) => [asset.captionBlockId, asset]),
  );
  const assetContentBlockIds = new Set(
    paper.assets.flatMap((asset) => asset.contentBlockIds),
  );
  const frontMatterRect = inferFrontMatterRect(
    blocks,
    paper.contentStartPage,
  );
  const frontMatterBlockIds = new Set(
    frontMatterRect
      ? blocks
          .filter(
            (block) =>
              block.pageNumber === paper.contentStartPage &&
              (block.type === "title" || block.type === "authors"),
          )
          .map((block) => block.id)
      : [],
  );
  const orderedBlocks = [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );

  return {
    orderedBlocks,
    translationByBlock,
    translatableBlockIds,
    continuationBlockIds,
    assetsByCaption,
    assetContentBlockIds,
    frontMatterRect,
    frontMatterBlockIds,
  };
}

export async function createRetypesetPdf(
  options: RetypesetPdfOptions,
): Promise<RetypesetPdfResult> {
  const {
    sourceBytes,
    sourceTitle,
    blocks,
    paper,
    translations,
    project,
    serifFontBytes,
    serifBoldFontBytes,
    sansFontBytes,
    sansBoldFontBytes,
    mathFontBytes,
  } = options;
  const generatedAt = options.generatedAt ?? new Date();
  const source = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const fonts: FontSet = {
    // pdf-lib/fontkit's CJK subsetting is not rendered consistently by
    // Poppler and several native viewers. These static Korean TTFs compress
    // well when embedded in full and keep searchable text interoperable.
    koreanBody: await output.embedFont(serifFontBytes, { subset: false }),
    koreanBodyBold: await output.embedFont(
      serifBoldFontBytes ?? serifFontBytes,
      { subset: false },
    ),
    koreanSans: await output.embedFont(sansFontBytes, { subset: false }),
    koreanSansBold: await output.embedFont(
      sansBoldFontBytes ?? sansFontBytes,
      { subset: false },
    ),
    math: await output.embedFont(mathFontBytes ?? sansFontBytes, {
      subset: false,
    }),
    latinBody: await output.embedFont(StandardFonts.TimesRoman),
    latinSans: await output.embedFont(StandardFonts.Helvetica),
    latinBold: await output.embedFont(StandardFonts.HelveticaBold),
  };

  const firstSourcePage = source.getPage(0);
  const sourceSize = firstSourcePage.getSize();
  const pageWidth = sourceSize.width;
  const pageHeight = sourceSize.height;
  const margin = pageWidth * PAGE_MARGIN_RATIO;
  const top = pageHeight * (1 - PAGE_TOP_RATIO);
  const bottom = pageHeight * PAGE_BOTTOM_RATIO;
  const gutter = pageWidth * COLUMN_GUTTER_RATIO;
  const columns = paper.columnCount;
  const columnWidth =
    columns === 2
      ? (pageWidth - margin * 2 - gutter) / 2
      : pageWidth - margin * 2;
  const columnX = (column: number) =>
    margin + (columns === 2 ? column * (columnWidth + gutter) : 0);
  const bodySize = inferBodyFontSize(blocks);
  const bodyLineHeight = bodySize * 1.62;
  const warnings: RetypesetWarning[] = [];
  const links: LinkPosition[] = [];
  const returnLinks: LinkPosition[] = [];
  const destinations = new Map<string, Destination>();
  const firstReferences = new Map<string, Destination>();
  const {
    orderedBlocks,
    translationByBlock,
    translatableBlockIds: translatable,
    continuationBlockIds,
    assetsByCaption,
    assetContentBlockIds,
    frontMatterRect,
    frontMatterBlockIds,
  } = planRetypesetContent(
    blocks,
    paper,
    translations,
    project,
  );
  const leadingPageCount = Math.max(
    0,
    Math.min(source.getPageCount(), paper.contentStartPage - 1),
  );
  if (leadingPageCount > 0) {
    const leadingPages = await output.copyPages(
      source,
      Array.from({ length: leadingPageCount }, (_, index) => index),
    );
    for (const page of leadingPages) output.addPage(page);
  }

  const correspondingPages: PDFPage[] = [];
  let frontMatterSourcePageCopied = false;
  for (
    let sourceIndex = leadingPageCount;
    sourceIndex < source.getPageCount();
    sourceIndex += 1
  ) {
    const sourcePageSize = source.getPage(sourceIndex).getSize();
    if (
      frontMatterRect &&
      sourceIndex === paper.contentStartPage - 1
    ) {
      const [copiedPage] = await output.copyPages(source, [sourceIndex]);
      output.addPage(copiedPage);
      const preservedBottom =
        (1 - frontMatterRect.y - frontMatterRect.height) *
        sourcePageSize.height;
      copiedPage.drawRectangle({
        x: 0,
        y: 0,
        width: sourcePageSize.width,
        height: Math.max(0, preservedBottom),
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
      correspondingPages.push(copiedPage);
      frontMatterSourcePageCopied = true;
    } else {
      correspondingPages.push(
        output.addPage([sourcePageSize.width, sourcePageSize.height]),
      );
    }
  }
  const reservations = new Map<number, ReservedSlot[]>();
  const reserveSlot = (
    pageNumber: number,
    rect: NormalizedRect,
    padding = bodySize * 0.35,
  ) => {
    const pageIndex = pageNumber - 1;
    const slot: ReservedSlot = {
      left: rect.x * pageWidth - padding,
      right: (rect.x + rect.width) * pageWidth + padding,
      top: (1 - rect.y) * pageHeight + padding,
      bottom: (1 - rect.y - rect.height) * pageHeight - padding,
    };
    reservations.set(pageIndex, [
      ...(reservations.get(pageIndex) ?? []),
      slot,
    ]);
  };
  const drawRegisteredFragment = async (
    pageNumber: number,
    rect: NormalizedRect,
    kind: "asset" | "equation" = "asset",
  ): Promise<boolean> => {
    const sourcePage = source.getPage(pageNumber - 1);
    const outputPage = output.getPage(pageNumber - 1);
    if (!sourcePage || !outputPage) return false;
    const size = sourcePage.getSize();
    const crop =
      kind === "equation"
        ? equationSourceCrop(rect, size.width, size.height)
        : sourceCrop(rect, size.width, size.height);
    const width = crop.right - crop.left;
    const height = crop.top - crop.bottom;
    if (width <= 2 || height <= 2) return false;
    const embedded = await output.embedPage(sourcePage, crop);
    outputPage.drawPage(embedded, {
      x: crop.left,
      y: crop.bottom,
      width,
      height,
    });
    reserveSlot(pageNumber, rect);
    return true;
  };

  const addPage = (): LayoutState => {
    const page = output.addPage([pageWidth, pageHeight]);
    return {
      page,
      pageIndex: output.getPageCount() - 1,
      column: 0,
      y: top,
    };
  };
  let state: LayoutState = correspondingPages.length
    ? {
        page: correspondingPages[0],
        pageIndex: leadingPageCount,
        column: 0,
        y: top,
      }
    : addPage();
  let columnTop = top;

  const advanceColumn = () => {
    if (columns === 2 && state.column === 0) {
      state.column = 1;
      state.y = columnTop;
    } else {
      const nextPageIndex = state.pageIndex + 1;
      state =
        nextPageIndex < source.getPageCount()
          ? {
              page: output.getPage(nextPageIndex),
              pageIndex: nextPageIndex,
              column: 0,
              y: top,
            }
          : addPage();
      columnTop = top;
    }
  };

  const ensureHeight = (height: number) => {
    let settled = false;
    while (!settled) {
      const left = columnX(state.column);
      const right = left + columnWidth;
      const collision = (reservations.get(state.pageIndex) ?? [])
        .filter(
          (slot) =>
            slot.right > left &&
            slot.left < right &&
            state.y > slot.bottom &&
            state.y - height < slot.top,
        )
        .sort((leftSlot, rightSlot) => rightSlot.top - leftSlot.top)[0];
      if (collision) {
        state.y = collision.bottom - bodySize * 0.35;
        continue;
      }
      if (state.y - height < bottom) {
        advanceColumn();
        continue;
      }
      settled = true;
    }
  };

  const advanceToFloatTop = () => {
    if (Math.abs(state.y - columnTop) > 5) {
      advanceColumn();
    }
  };

  const drawLines = (
    text: string,
    {
      font,
      size,
      lineHeight,
      color = rgb(0.08, 0.08, 0.08),
      align = "left",
      spacingAfter = bodySize * 0.55,
      indentFirst = 0,
      boldLead = false,
      boldFont,
    }: {
      font: PDFFont;
      size: number;
      lineHeight: number;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "center" | "justify";
      spacingAfter?: number;
      indentFirst?: number;
      boldLead?: boolean;
      boldFont?: PDFFont;
    },
    width = columnWidth,
    x?: number,
  ) => {
    // PDF's built-in Latin fonts use WinAnsi and reject valid source
    // characters such as ˇ. Keep their familiar appearance for encodable
    // text, but fall back to the embedded Unicode fonts for the whole block.
    const renderFont = canEncodeText(font, text, size)
      ? font
      : font === fonts.latinBody
        ? fonts.koreanBody
        : fonts.koreanSans;
    const renderBoldFont =
      boldFont && canEncodeText(boldFont, text, size)
        ? boldFont
        : renderFont;
    const needsMathFont = (value: string) =>
      /[\u0370-\u03ff\u1f00-\u1fff\u2070-\u209f\u2190-\u22ff\u27c0-\u2bff]/u.test(
        value,
      );
    const widthWithMathFallback = (
      value: string,
      primaryFont: PDFFont,
      atSize: number,
    ) =>
      graphemes(value).reduce(
        (total, character) =>
          total +
          (needsMathFont(character) ? fonts.math : primaryFont)
            .widthOfTextAtSize(character, atSize),
        0,
      );
    const wrappingFont = (primaryFont: PDFFont) => ({
      widthOfTextAtSize: (value: string, atSize: number) =>
        widthWithMathFallback(value, primaryFont, atSize),
    });
    const lines = academicTextLines(
      text,
      wrappingFont(boldLead ? renderBoldFont : renderFont),
      size,
      width - indentFirst,
    );
    const leadMatch = boldLead
      ? text.trim().match(/^.*?[.!?](?:\s|$)/)
      : null;
    let boldWordsRemaining = leadMatch
      ? leadMatch[0].trim().split(/\s+/).filter(Boolean).length
      : 0;
    for (let index = 0; index < lines.length; index += 1) {
      ensureHeight(lineHeight);
      const line = lines[index];
      const indent = index === 0 ? indentFirst : 0;
      const availableWidth = width - indent;
      const styledWords = boldLead
        ? [...line.text.matchAll(/\S+/g)].map((match) => {
            const styledFont =
              boldWordsRemaining > 0 ? renderBoldFont : renderFont;
            if (boldWordsRemaining > 0) boldWordsRemaining -= 1;
            return {
              text: match[0],
              start: match.index,
              end: match.index + match[0].length,
              width: widthWithMathFallback(match[0], styledFont, size),
              font: styledFont,
            };
          })
        : [];
      const naturalSpace = renderFont.widthOfTextAtSize(" ", size);
      const styledWordWidth = styledWords.reduce(
        (total, word) => total + word.width,
        0,
      );
      const styledGap =
        align === "justify" &&
        !line.paragraphEnd &&
        styledWords.length >= 2 &&
        styledWordWidth < availableWidth
          ? (availableWidth - styledWordWidth) / (styledWords.length - 1)
          : naturalSpace;
      let styledOffset = 0;
      const styledSegments = styledWords.map((word) => {
        const segment = { ...word, xOffset: styledOffset };
        styledOffset += word.width + styledGap;
        return segment;
      });
      const lineWidth = boldLead
        ? Math.max(0, styledOffset - styledGap)
        : widthWithMathFallback(line.text, renderFont, size);
      const segments = boldLead
        ? styledSegments
        : (align === "justify"
            ? justifiedLineSegments(
                line,
                wrappingFont(renderFont),
                size,
                availableWidth,
              )
            : [
                {
                  text: line.text,
                  start: 0,
                  end: line.text.length,
                  xOffset: 0,
                  width: lineWidth,
                },
              ]).map((segment) => ({ ...segment, font: renderFont }));
      const fontRuns = segments.flatMap((segment) => {
        const runs: AcademicLineSegment[] = [];
        let sourceOffset = 0;
        let runOffset = 0;
        for (const character of graphemes(segment.text)) {
          const characterFont = needsMathFont(character)
            ? fonts.math
            : segment.font;
          const characterWidth = characterFont.widthOfTextAtSize(
            character,
            size,
          );
          const previous = runs.at(-1);
          if (
            previous &&
            previous.font === characterFont &&
            previous.end === segment.start + sourceOffset
          ) {
            previous.text += character;
            previous.end += character.length;
            previous.width += characterWidth;
          } else {
            runs.push({
              text: character,
              start: segment.start + sourceOffset,
              end: segment.start + sourceOffset + character.length,
              xOffset: segment.xOffset + runOffset,
              width: characterWidth,
              font: characterFont,
            });
          }
          sourceOffset += character.length;
          runOffset += characterWidth;
        }
        return runs;
      });
      const lineX = x ?? columnX(state.column);
      const drawX =
        align === "center"
          ? lineX + Math.max(0, (width - lineWidth) / 2)
          : lineX + indent;
      for (const segment of fontRuns) {
        state.page.drawText(segment.text, {
          x: drawX + segment.xOffset,
          y: state.y - size,
          size,
          font: segment.font,
          color,
        });
      }
      detectInlineLinks(
        state.page,
        line.text,
        drawX,
        state.y - size,
        renderFont,
        size,
        lineHeight,
        links,
        fontRuns,
      );
      state.y -= lineHeight;
    }
    state.y -= spacingAfter;
  };

  const drawVectorFragment = async (
    pageNumber: number,
    rect: NormalizedRect,
    maxWidth: number,
    kind: "asset" | "equation",
  ): Promise<{ height: number; x: number; y: number } | null> => {
    const sourcePage = source.getPage(pageNumber - 1);
    if (!sourcePage) return null;
    const size = sourcePage.getSize();
    const crop =
      kind === "equation"
        ? equationSourceCrop(rect, size.width, size.height)
        : sourceCrop(rect, size.width, size.height);
    const cropWidth = crop.right - crop.left;
    const cropHeight = crop.top - crop.bottom;
    if (cropWidth <= 2 || cropHeight <= 2) return null;
    const embedded = await output.embedPage(sourcePage, crop);
    const scale = Math.min(1, maxWidth / cropWidth);
    const width = cropWidth * scale;
    const height = cropHeight * scale;
    ensureHeight(height + bodySize);
    const x = columnX(state.column) + Math.max(0, (maxWidth - width) / 2);
    const y = state.y - height;
    state.page.drawPage(embedded, { x, y, width, height });
    state.y = y - (kind === "asset" ? bodySize * 0.65 : bodySize * 0.4);
    return { height, x, y };
  };

  const drawAsset = async (asset: PaperAsset) => {
    const key = `${asset.kind}:${asset.number.toLowerCase()}`;
    const wide = asset.bbox.width > 0.64 && columns === 2;
    if (wide && (state.column !== 0 || state.y < top - 5)) {
      state = addPage();
      columnTop = top;
    }
    const availableWidth = wide ? pageWidth - margin * 2 : columnWidth;
    const originalColumn = state.column;
    if (wide) state.column = 0;
    try {
      const placed = await drawVectorFragment(
        asset.pageNumber,
        asset.bbox,
        availableWidth,
        "asset",
      );
      if (!placed) throw new Error("empty crop");
      destinations.set(key, { page: state.page, y: placed.y + placed.height });
      const returnSource = firstReferences.get(key);
      const returnText = "본문으로 돌아가기";
      const returnSize = 6.5;
      const returnWidth = fonts.koreanSans.widthOfTextAtSize(
        returnText,
        returnSize,
      );
      const returnX =
        columnX(state.column) + Math.max(0, availableWidth - returnWidth);
      state.page.drawText(returnText, {
        x: returnX,
        y: state.y + 1,
        size: returnSize,
        font: fonts.koreanSans,
        color: rgb(0.28, 0.42, 0.55),
      });
      returnLinks.push({
        page: state.page,
        x: returnX,
        y: state.y,
        width: returnWidth,
        height: returnSize + 2,
        key,
      });
      if (returnSource) void returnSource;
      state.y -= bodySize;
    } catch {
      warnings.push({
        id: `damaged-asset:${asset.id}`,
        severity: "integrity",
        kind: "damaged-asset",
        blockId: asset.captionBlockId,
        message: `${asset.kind === "figure" ? "그림" : "표"} ${asset.number}의 벡터 영역을 가져오지 못했습니다.`,
      });
      drawLines("[원본 자산 영역을 확인해 주세요]", {
        font: fonts.koreanSans,
        size: bodySize * 0.86,
        lineHeight: bodyLineHeight,
        color: rgb(0.72, 0.15, 0.13),
      });
    } finally {
      if (wide) {
        state.column = originalColumn;
        if (columns === 2) {
          state.column = 0;
          columnTop = state.y;
        }
      }
    }
  };

  const registeredAssetIds = new Set<string>();
  for (const asset of paper.assets) {
    if (await drawRegisteredFragment(asset.pageNumber, asset.bbox)) {
      registeredAssetIds.add(asset.id);
      destinations.set(
        `${asset.kind}:${asset.number.toLowerCase()}`,
        {
          page: output.getPage(asset.pageNumber - 1),
          y: (1 - asset.bbox.y) * pageHeight,
        },
      );
    } else {
      warnings.push({
        id: `damaged-asset:${asset.id}`,
        severity: "integrity",
        kind: "damaged-asset",
        blockId: asset.captionBlockId,
        message: `${asset.kind} ${asset.number}의 원본 위치를 보존하지 못했습니다.`,
      });
    }
  }

  const registeredPreservedBlocks = new Set<string>();
  for (const block of blocks) {
    if (!shouldRegisterPreservedFragment(block, assetContentBlockIds)) continue;
    if (
      await drawRegisteredFragment(
        block.pageNumber,
        block.bbox,
        block.type === "equation" || isEquationLike(block.text)
          ? "equation"
          : "asset",
      )
    ) {
      registeredPreservedBlocks.add(block.id);
    } else {
      warnings.push({
        id: `damaged-${block.type === "code-listing" ? "asset" : "equation"}:${block.id}`,
        severity: "integrity",
        kind:
          block.type === "code-listing"
            ? "damaged-asset"
            : "damaged-equation",
        blockId: block.id,
        message:
          block.type === "code-listing"
            ? "코드 블록을 원본 위치에 보존하지 못했습니다."
            : "수식을 원본 위치에 보존하지 못했습니다.",
      });
    }
  }

  let frontMatterRegistered = false;
  if (frontMatterRect) {
    if (frontMatterSourcePageCopied) {
      reserveSlot(paper.contentStartPage, frontMatterRect);
      frontMatterRegistered = true;
    }
    if (
      frontMatterRegistered &&
      state.pageIndex === paper.contentStartPage - 1
    ) {
      const frontMatterBottom =
        (1 - frontMatterRect.y - frontMatterRect.height) * pageHeight;
      state.y = Math.min(
        state.y,
        frontMatterBottom - bodySize * 0.65,
      );
      columnTop = state.y;
    }
  }

  const anchoredCaptionIds = new Set<string>();
  for (const block of blocks) {
    if (
      block.type !== "figure-caption" &&
      block.type !== "table-caption"
    ) {
      continue;
    }
    const page = output.getPage(block.pageNumber - 1);
    if (!page) continue;
    const rendered = blockText(
      block,
      translationByBlock,
      project,
      translatable,
    );
    if (rendered.missing) {
      warnings.push({
        id: `missing-translation:${block.id}`,
        severity: "integrity",
        kind: "missing-translation",
        blockId: block.id,
        message: "번역되지 않은 캡션이 원문으로 표시됩니다.",
      });
    }
    const font = rendered.translated ? fonts.koreanBody : fonts.latinBody;
    const size = bodySize * 0.86;
    const lineHeight = size * (rendered.translated ? 1.48 : 1.35);
    const x = block.bbox.x * pageWidth;
    const width = block.bbox.width * pageWidth;
    const lines = wrapAcademicText(rendered.text, font, size, width);
    let y = (1 - block.bbox.y) * pageHeight - size;
    for (const line of lines) {
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color: rgb(0.08, 0.08, 0.08),
      });
      detectInlineLinks(
        page,
        line,
        x,
        y,
        font,
        size,
        lineHeight,
        links,
      );
      y -= lineHeight;
    }
    const usedHeight = Math.max(
      block.bbox.height,
      (lines.length * lineHeight + bodySize * 0.35) / pageHeight,
    );
    reserveSlot(block.pageNumber, {
      ...block.bbox,
      height: Math.min(1 - block.bbox.y, usedHeight),
    });
    anchoredCaptionIds.add(block.id);
  }

  const drawnAssets = new Set<string>(registeredAssetIds);
  let frontMatterDrawn = frontMatterRegistered;
  let frontMatterFallback = false;

  for (const block of orderedBlocks) {
    if (
      block.pageNumber < paper.contentStartPage ||
      block.type === "running-header" ||
      block.type === "running-footer" ||
      isStandaloneMarker(block)
    ) {
      continue;
    }
    if (continuationBlockIds.has(block.id)) continue;
    if (frontMatterBlockIds.has(block.id) && !frontMatterFallback) {
      if (!frontMatterDrawn && frontMatterRect) {
        const placed = await drawVectorFragment(
          paper.contentStartPage,
          frontMatterRect,
          pageWidth - margin * 2,
          "asset",
        );
        if (placed) {
          frontMatterDrawn = true;
          columnTop = state.y;
        } else {
          frontMatterFallback = true;
        }
      }
      if (frontMatterDrawn) continue;
    }
    if (
      registeredPreservedBlocks.has(block.id) ||
      anchoredCaptionIds.has(block.id)
    ) {
      continue;
    }
    if (shouldOmitMixedSourceFragment(block)) continue;
    if (assetContentBlockIds.has(block.id)) continue;
    const asset = assetsByCaption.get(block.id);
    const preserveFragment = shouldRegisterPreservedFragment(
      block,
      assetContentBlockIds,
    );
    const equation = isEquationLike(block.text);

    if (asset?.kind === "figure" && !drawnAssets.has(asset.id)) {
      advanceToFloatTop();
      await drawAsset(asset);
      drawnAssets.add(asset.id);
    }

    if (block.type === "code-listing" && preserveFragment) {
      advanceToFloatTop();
      const wide = block.bbox.width > 0.64 && columns === 2;
      if (wide && (state.column !== 0 || state.y < top - 5)) {
        state = addPage();
        columnTop = top;
      }
      if (wide) state.column = 0;
      try {
        const placed = await drawVectorFragment(
          block.pageNumber,
          block.bbox,
          wide ? pageWidth - margin * 2 : columnWidth,
          "asset",
        );
        if (!placed) throw new Error("empty code listing crop");
      } catch {
        warnings.push({
          id: `damaged-asset:${block.id}`,
          severity: "integrity",
          kind: "damaged-asset",
          blockId: block.id,
          message: "코드 블록의 원본 영역을 가져오지 못했습니다.",
        });
      } finally {
        if (wide) {
          state.column = 0;
          columnTop = state.y;
        }
      }
      continue;
    }

    if (equation) {
      try {
        const placed = await drawVectorFragment(
          block.pageNumber,
          block.bbox,
          columnWidth,
          "equation",
        );
        if (!placed) throw new Error("empty equation crop");
      } catch {
        warnings.push({
          id: `damaged-equation:${block.id}`,
          severity: "integrity",
          kind: "damaged-equation",
          blockId: block.id,
          message: "수식의 원본 벡터 영역을 가져오지 못했습니다.",
        });
      }
      continue;
    }

    const rendered = blockText(
      block,
      translationByBlock,
      project,
      translatable,
    );
    if (rendered.missing) {
      warnings.push({
        id: `missing-translation:${block.id}`,
        severity: "integrity",
        kind: "missing-translation",
        blockId: block.id,
        message: "번역되지 않은 블록이 미리보기에 남아 있습니다.",
      });
    }

    if (
      block.type === "abstract" &&
      /^abstract$/i.test(block.text.trim())
    ) {
      ensureHeight(bodyLineHeight * 2);
      drawLines(
        "Abstract",
        {
          font: fonts.latinBold,
          size: clamp(block.fontSize ?? bodySize * 1.04, bodySize, 13),
          lineHeight: bodyLineHeight,
          align: "center",
          spacingAfter: bodySize * 0.45,
        },
        columnWidth,
      );
      continue;
    }

    if (block.type === "title") {
      ensureHeight(bodySize * 5);
      drawLines(
        rendered.text,
        {
          font: fonts.latinBold,
          size: clamp(block.fontSize ?? bodySize * 1.8, 14, 22),
          lineHeight: clamp(block.fontSize ?? bodySize * 1.8, 14, 22) * 1.25,
          align: "center",
          spacingAfter: bodySize * 1.25,
        },
        pageWidth - margin * 2,
        margin,
      );
      columnTop = state.y;
      continue;
    }
    if (block.type === "authors") {
      drawLines(
        rendered.text,
        {
          font: fonts.latinSans,
          size: clamp(block.fontSize ?? bodySize, 8, 12),
          lineHeight: bodyLineHeight,
          align: "center",
          spacingAfter: bodySize,
        },
        pageWidth - margin * 2,
        margin,
      );
      columnTop = state.y;
      continue;
    }
    if (block.type === "heading") {
      ensureHeight(bodyLineHeight * 2.2);
      state.y -= bodySize * 0.4;
      drawLines(rendered.text, {
        font: fonts.latinBold,
        size: clamp(block.fontSize ?? bodySize * 1.15, bodySize, 15),
        lineHeight: bodyLineHeight * 1.08,
        spacingAfter: bodySize * 0.55,
      });
      if (/^(references|bibliography)$/i.test(block.text.trim())) {
        destinations.set("references", { page: state.page, y: state.y });
      }
      continue;
    }

    const referenceKey = referenceDestination(block);
    if (referenceKey) {
      destinations.set(referenceKey, { page: state.page, y: state.y });
    }

    if (
      block.type === "abstract" &&
      /^abstract(?:\s|[:.—-])/i.test(block.text)
    ) {
      drawLines(
        "Abstract",
        {
          font: fonts.latinBold,
          size: bodySize * 1.04,
          lineHeight: bodyLineHeight,
          align: "center",
          spacingAfter: bodySize * 0.45,
        },
        columnWidth,
      );
    }

    const isCaption =
      block.type === "figure-caption" || block.type === "table-caption";
    if (
      asset?.kind === "table" &&
      !drawnAssets.has(asset.id)
    ) {
      advanceToFloatTop();
    }
    const sourceUsesBold = usesWholeBlockBoldFont(block);
    const font = rendered.translated
      ? sourceUsesBold
        ? paper.bodyFontStyle === "sans"
          ? fonts.koreanSansBold
          : fonts.koreanBodyBold
        : paper.bodyFontStyle === "sans"
          ? fonts.koreanSans
          : fonts.koreanBody
      : block.type === "reference-entry"
        ? fonts.latinBody
        : fonts.latinBody;
    const boldFont = rendered.translated
      ? paper.bodyFontStyle === "sans"
        ? fonts.koreanSansBold
        : fonts.koreanBodyBold
      : fonts.latinBold;
    const size =
      isCaption || block.type === "footnote" ? bodySize * 0.86 : bodySize;
    drawLines(rendered.text, {
      font,
      size,
      lineHeight: size * (rendered.translated ? 1.62 : 1.42),
      align:
        rendered.translated &&
        (block.type === "paragraph" ||
          block.type === "abstract" ||
          block.type === "footnote")
          ? "justify"
          : "left",
      spacingAfter: isCaption ? bodySize * 0.75 : bodySize * 0.58,
      indentFirst:
        block.type === "paragraph" && rendered.translated ? bodySize : 0,
      boldLead: block.sourceStyle?.boldLead ?? false,
      boldFont,
    });

    if (asset?.kind === "table" && !drawnAssets.has(asset.id)) {
      await drawAsset(asset);
      drawnAssets.add(asset.id);
    }
  }

  const pages = output.getPages();
  const generatedLabel = `Paperloom으로 생성한 비공식 한국어 번역본 · ${generatedAt
    .toISOString()
    .slice(0, 10)}`;
  pages[leadingPageCount]?.drawText(generatedLabel, {
    x: margin,
    y: pageHeight * 0.025,
    size: 6.4,
    font: fonts.koreanSans,
    color: rgb(0.42, 0.42, 0.42),
  });
  for (let index = leadingPageCount; index < pages.length; index += 1) {
    const label =
      index < source.getPageCount()
        ? String(index + 1)
        : `${source.getPageCount()}-${String.fromCharCode(
            65 + index - source.getPageCount(),
          )}`;
    const width = fonts.latinSans.widthOfTextAtSize(label, 7);
    pages[index].drawText(label, {
      x: (pageWidth - width) / 2,
      y: pageHeight * 0.025,
      size: 7,
      font: fonts.latinSans,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  for (const link of links) {
    if (!firstReferences.has(link.key)) {
      firstReferences.set(link.key, { page: link.page, y: link.y });
    }
    const destination = destinations.get(link.key);
    if (destination) addGoToLink(output, link, destination);
  }
  for (const link of returnLinks) {
    const destination = firstReferences.get(link.key);
    if (destination) addGoToLink(output, link, destination);
  }

  output.setTitle(`${sourceTitle} - 비공식 한국어 번역본`);
  output.setAuthor("Paperloom");
  output.setSubject("Unofficial Korean translation re-typeset");
  output.setCreator("Paperloom");
  output.setProducer("Paperloom semantic re-typesetting");
  output.setKeywords([
    "Paperloom",
    "unofficial translation",
    "Korean",
    sourceTitle,
  ]);
  output.setCreationDate(generatedAt);
  output.setModificationDate(generatedAt);

  return {
    bytes: await output.save({ useObjectStreams: true }),
    warnings,
    pageCount: output.getPageCount(),
  };
}
