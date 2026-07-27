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
import { isEquationLike } from "./semantic-paper";

type RetypesetPdfOptions = {
  sourceBytes: Uint8Array;
  sourceTitle: string;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  translations: TranslationRecord[];
  project: RetypesetProject;
  serifFontBytes: Uint8Array;
  sansFontBytes: Uint8Array;
  generatedAt?: Date;
};

type RetypesetPdfResult = {
  bytes: Uint8Array;
  warnings: RetypesetWarning[];
  pageCount: number;
};

type FontSet = {
  koreanBody: PDFFont;
  koreanSans: PDFFont;
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

const PAGE_MARGIN_RATIO = 0.075;
const PAGE_TOP_RATIO = 0.07;
const PAGE_BOTTOM_RATIO = 0.065;
const COLUMN_GUTTER_RATIO = 0.035;
const MIN_BODY_SIZE = 8.3;
const MAX_BODY_SIZE = 11.2;

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

function localizeAssetLabels(text: string): string {
  return text
    .replace(/\b(?:Fig(?:ure)?\.?)\s*(\d+[a-z]?)\b/gi, "그림 $1")
    .replace(/\bTable\s*(\d+[a-z]?)\b/gi, "표 $1");
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

function graphemes(value: string): string[] {
  if ("Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
    return [...segmenter.segment(value)].map((segment) => segment.segment);
  }
  return Array.from(value);
}

function splitLongToken(token: string, font: PDFFont, size: number, width: number) {
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

export function wrapAcademicText(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
): string[] {
  const paragraphs = text.replace(/\r/g, "").split(/\n+/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const rawWord of words) {
      const pieces =
        font.widthOfTextAtSize(rawWord, size) > width
          ? splitLongToken(rawWord, font as PDFFont, size, width)
          : [rawWord];
      for (const word of pieces) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(candidate, size) > width) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function blockText(
  block: DocumentBlock,
  translations: Map<string, TranslationRecord>,
  project: RetypesetProject,
  translatable: Set<string>,
): { text: string; translated: boolean; missing: boolean } {
  if (!translatable.has(block.id)) {
    return { text: block.text, translated: false, missing: false };
  }
  const translation = translations.get(block.id);
  if (translation?.status === "translated" && translation.translatedText.trim()) {
    return {
      text: localizeAssetLabels(translation.translatedText.trim()),
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
) {
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
      links.push({
        page,
        x: x + font.widthOfTextAtSize(prefix, size),
        y: y - 1,
        width: font.widthOfTextAtSize(matched, size),
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
    sansFontBytes,
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
    koreanSans: await output.embedFont(sansFontBytes, { subset: false }),
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
  const bodySize = clamp(
    median(
      blocks
        .filter((block) => block.type === "paragraph" && block.fontSize)
        .map((block) => block.fontSize!),
    ),
    MIN_BODY_SIZE,
    MAX_BODY_SIZE,
  );
  const bodyLineHeight = bodySize * 1.62;
  const warnings: RetypesetWarning[] = [];
  const links: LinkPosition[] = [];
  const returnLinks: LinkPosition[] = [];
  const destinations = new Map<string, Destination>();
  const firstReferences = new Map<string, Destination>();
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const translationByBlock = new Map(
    translations
      .filter((item) => item.targetLanguage === project.targetLanguage)
      .map((item) => [item.blockId, item]),
  );
  const translatable = new Set(paper.translatableBlockIds);
  const assetsByCaption = new Map(
    paper.assets.map((asset) => [asset.captionBlockId, asset]),
  );
  const assetContentBlockIds = new Set(
    paper.assets.flatMap((asset) => asset.contentBlockIds),
  );

  const addPage = (): LayoutState => {
    const page = output.addPage([pageWidth, pageHeight]);
    return {
      page,
      pageIndex: output.getPageCount() - 1,
      column: 0,
      y: top,
    };
  };
  let state = addPage();

  const advanceColumn = () => {
    if (columns === 2 && state.column === 0) {
      state.column = 1;
      state.y = top;
    } else {
      state = addPage();
    }
  };

  const ensureHeight = (height: number) => {
    if (state.y - height < bottom) advanceColumn();
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
    }: {
      font: PDFFont;
      size: number;
      lineHeight: number;
      color?: ReturnType<typeof rgb>;
      align?: "left" | "center";
      spacingAfter?: number;
      indentFirst?: number;
    },
    width = columnWidth,
    x = columnX(state.column),
  ) => {
    const lines = wrapAcademicText(text, font, size, width - indentFirst);
    for (let index = 0; index < lines.length; index += 1) {
      ensureHeight(lineHeight);
      const line = lines[index];
      const indent = index === 0 ? indentFirst : 0;
      const lineWidth = font.widthOfTextAtSize(line, size);
      const drawX =
        align === "center"
          ? x + Math.max(0, (width - lineWidth) / 2)
          : x + indent;
      state.page.drawText(line, {
        x: drawX,
        y: state.y - size,
        size,
        font,
        color,
      });
      detectInlineLinks(
        state.page,
        line,
        drawX,
        state.y - size,
        font,
        size,
        lineHeight,
        links,
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
    const crop = sourceCrop(rect, size.width, size.height);
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
        }
      }
    }
  };

  const ordered = [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
  const drawnAssets = new Set<string>();

  for (const block of ordered) {
    if (assetContentBlockIds.has(block.id)) continue;
    const asset = assetsByCaption.get(block.id);
    const equation = block.type === "equation" || isEquationLike(block.text);

    if (asset?.kind === "figure" && !drawnAssets.has(asset.id)) {
      await drawAsset(asset);
      drawnAssets.add(asset.id);
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
      drawLines("Abstract", {
        font: fonts.latinBold,
        size: bodySize * 1.04,
        lineHeight: bodyLineHeight,
        spacingAfter: bodySize * 0.35,
      });
    }

    const isCaption =
      block.type === "figure-caption" || block.type === "table-caption";
    const font = rendered.translated
      ? paper.bodyFontStyle === "sans"
        ? fonts.koreanSans
        : fonts.koreanBody
      : block.type === "reference-entry"
        ? fonts.latinBody
        : fonts.latinBody;
    const size =
      isCaption || block.type === "footnote" ? bodySize * 0.86 : bodySize;
    drawLines(rendered.text, {
      font,
      size,
      lineHeight: size * (rendered.translated ? 1.62 : 1.42),
      spacingAfter: isCaption ? bodySize * 0.75 : bodySize * 0.58,
      indentFirst:
        block.type === "paragraph" && rendered.translated ? bodySize : 0,
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
  pages[0]?.drawText(generatedLabel, {
    x: margin,
    y: pageHeight * 0.025,
    size: 6.4,
    font: fonts.koreanSans,
    color: rgb(0.42, 0.42, 0.42),
  });
  for (let index = 0; index < pages.length; index += 1) {
    const label = String(index + 1);
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
