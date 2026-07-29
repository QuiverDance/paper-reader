import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentReference,
  NormalizedRect,
} from "../types";

export type RawTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
};

type PageContext = {
  documentId: string;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
};

type TextLine = {
  items: RawTextItem[];
  text: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  fontSize: number;
};

type TextLineGroup = {
  lines: TextLine[];
};

function round(value: number): number {
  return Number(value.toFixed(6));
}
function normalizedRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  pageWidth: number,
  pageHeight: number,
): NormalizedRect {
  return {
    x: round(Math.max(0, minX / pageWidth)),
    y: round(Math.max(0, (pageHeight - maxY) / pageHeight)),
    width: round(Math.min(1, (maxX - minX) / pageWidth)),
    height: round(Math.min(1, (maxY - minY) / pageHeight)),
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function joinLineItems(items: RawTextItem[]): string {
  return items
    .sort((left, right) => left.x - right.x)
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?%)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1");
}

function horizontalGap(line: TextLine, item: RawTextItem): number {
  if (item.x > line.maxX) return item.x - line.maxX;
  if (item.x + item.width < line.minX) return line.minX - (item.x + item.width);
  return 0;
}

function makeLines(items: RawTextItem[], pageWidth: number): TextLine[] {
  const sorted = [...items]
    .filter((item) => item.str.trim())
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: TextLine[] = [];

  for (const item of sorted) {
    const tolerance = Math.max(2, item.fontSize * 0.35);
    const line = lines
      .filter(
        (candidate) =>
          Math.abs(candidate.items[0].y - item.y) <=
            Math.max(tolerance, candidate.fontSize * 0.35) &&
          horizontalGap(candidate, item) <=
            Math.max(
              8,
              Math.max(item.fontSize, candidate.fontSize) * 1.8,
              pageWidth * 0.018,
            ),
      )
      .sort(
        (left, right) =>
          horizontalGap(left, item) - horizontalGap(right, item),
      )[0];
    if (line) {
      line.items.push(item);
      line.text = joinLineItems(line.items);
      line.minX = Math.min(line.minX, item.x);
      line.minY = Math.min(line.minY, item.y);
      line.maxX = Math.max(line.maxX, item.x + item.width);
      line.maxY = Math.max(line.maxY, item.y + item.height);
      line.fontSize = Math.max(line.fontSize, item.fontSize);
    } else {
      lines.push({
        items: [item],
        text: item.str.trim(),
        minX: item.x,
        minY: item.y,
        maxX: item.x + item.width,
        maxY: item.y + item.height,
        fontSize: item.fontSize,
      });
    }
  }

  return lines.sort(
    (left, right) => right.maxY - left.maxY || left.minX - right.minX,
  );
}

function isNumberedSectionHeading(text: string): boolean {
  return /^(?:[1-9]\d?)(?:\.\d+)*\.?\s+[A-Z][^\n]{2,100}$/.test(
    text.trim(),
  );
}

function fontNameLooksBold(fontName: string | undefined): boolean {
  return /(?:bold|black|heavy|semibold|demi)/i.test(fontName ?? "");
}

function fontNameLooksItalic(fontName: string | undefined): boolean {
  return /(?:italic|oblique)/i.test(fontName ?? "");
}

function lineFontNames(line: TextLine): string[] {
  return line.items.flatMap((item) => item.fontName ? [item.fontName] : []);
}

function firstLineItem(line: TextLine): RawTextItem | undefined {
  return [...line.items]
    .filter((item) => item.str.trim())
    .sort((left, right) => left.x - right.x)[0];
}

function inferBoldFontNames(lines: TextLine[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const structural =
      isNumberedSectionHeading(line.text) ||
      /^(?:abstract|references|bibliography|acknowledg(?:e)?ments?)$/i.test(
        line.text.trim(),
      );
    for (const fontName of lineFontNames(line)) {
      if (structural || fontNameLooksBold(fontName)) names.add(fontName);
    }
  }
  return names;
}

function lineStartsBold(
  line: TextLine,
  boldFontNames: ReadonlySet<string>,
): boolean {
  const first = firstLineItem(line);
  return Boolean(
    first?.fontName &&
      (boldFontNames.has(first.fontName) ||
        fontNameLooksBold(first.fontName)),
  );
}

function lineIsMostlyBold(
  line: TextLine,
  boldFontNames: ReadonlySet<string>,
): boolean {
  let boldCharacters = 0;
  let characters = 0;
  for (const item of line.items) {
    const length = item.str.trim().length;
    characters += length;
    if (
      item.fontName &&
      (boldFontNames.has(item.fontName) ||
        fontNameLooksBold(item.fontName))
    ) {
      boldCharacters += length;
    }
  }
  return characters > 0 && boldCharacters / characters >= 0.65;
}

function typicalVerticalGap(
  lines: TextLine[],
  pageWidth: number,
): number {
  const gaps: number[] = [];
  for (const line of lines) {
    const next = lines.find(
      (candidate) =>
        candidate.maxY < line.maxY &&
        Math.abs(candidate.minX - line.minX) <= pageWidth * 0.025 &&
        Math.abs(candidate.fontSize - line.fontSize) <=
          Math.max(candidate.fontSize, line.fontSize) * 0.12,
    );
    if (!next) continue;
    const gap = line.minY - next.maxY;
    if (
      gap >= -line.fontSize * 0.2 &&
      gap <= line.fontSize * 0.8
    ) {
      gaps.push(gap);
    }
  }
  return median(gaps);
}

function paragraphBoundaryBetween(
  previous: TextLine,
  next: TextLine,
  pageWidth: number,
  normalVerticalGap: number,
  boldFontNames: ReadonlySet<string>,
): boolean {
  if (!/[.!?]["')\]]*$/.test(previous.text.trim())) return false;
  const indent =
    next.minX - previous.minX >= Math.max(4, next.fontSize * 0.62) &&
    next.minX - previous.minX <= pageWidth * 0.06;
  const boldLead = lineStartsBold(next, boldFontNames);
  const verticalGap = previous.minY - next.maxY;
  const extraParagraphGap =
    normalVerticalGap > 0 &&
    verticalGap >=
      normalVerticalGap + Math.max(0.7, next.fontSize * 0.075) &&
    /^[A-Z0-9("'\[\u201c\u2018]/.test(next.text.trim());
  return indent || boldLead || extraParagraphGap;
}

function isCodeListingText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 12) return false;
  const codeLead =
    /^(?:#include|import\s+\S+|from\s+\S+\s+import|def\s+\w+\s*\(|class\s+\w+|(?:public|private|protected|static)\s+|function\s+\w+\s*\(|(?:const|let|var)\s+\w+\s*=|SELECT\s+.+\s+FROM\s+)/i;
  const codeSyntax =
    /(?:=>|::|&&|\|\||==|!=|<=|>=|\+\+|--|[{}[\]();])/.test(normalized);
  const prosePunctuation = (normalized.match(/[.!?]\s/g) ?? []).length;
  const syntaxCharacters = (normalized.match(/[{}[\]();_=<>]/g) ?? []).length;
  return (
    codeLead.test(normalized) ||
    (codeSyntax &&
      syntaxCharacters >= Math.max(3, normalized.length * 0.045) &&
      prosePunctuation <= 1)
  );
}

function classifyBlock(
  text: string,
  fontSize: number,
  medianFontSize: number,
  pageNumber: number,
  bbox: NormalizedRect,
): DocumentBlockType {
  const normalized = text.trim();
  const explicitFigureCaption =
    /^(?:fig(?:ure)?\.?)\s*\d+[a-z]?\s*[.:)]/i.test(normalized);
  const compactFigureLabel =
    /^(?:fig(?:ure)?\.?)\s*\d+[a-z]?(?:\s|$)/i.test(normalized);
  const explicitTableCaption =
    /^table\s*\d+[a-z]?\s*[.:)]/i.test(normalized);
  const compactTableLabel =
    /^table\s*\d+[a-z]?(?:\s|$)/i.test(normalized);
  const captionSized = fontSize <= medianFontSize * 0.85;
  if (explicitFigureCaption || (compactFigureLabel && captionSized)) {
    return "figure-caption";
  }
  if (explicitTableCaption || (compactTableLabel && captionSized)) {
    return "table-caption";
  }
  if (isCodeListingText(normalized)) return "code-listing";
  if (/^abstract(?:\s|$)/i.test(normalized)) return "abstract";
  if (
    /^(references|bibliography|acknowledg(?:e)?ments?)$/i.test(normalized)
  ) {
    return "heading";
  }
  if (
    pageNumber === 1 &&
    bbox.y < 0.35 &&
    fontSize >= Math.max(14, medianFontSize * 1.35) &&
    normalized.length < 240
  ) {
    return "title";
  }
  if (
    (isNumberedSectionHeading(normalized) ||
      /^[A-Z][^\n]{2,100}$/.test(normalized)) &&
    (fontSize >= medianFontSize * 1.18 ||
      isNumberedSectionHeading(normalized))
  ) {
    return "heading";
  }
  if (bbox.y > 0.88 && fontSize < medianFontSize * 0.9) return "footnote";
  return normalized.length > 1 ? "paragraph" : "unknown";
}

function isTranslatable(type: DocumentBlockType, text: string): boolean {
  if (
    type === "unknown" ||
    type === "running-header" ||
    type === "running-footer" ||
    type === "code-listing"
  ) {
    return false;
  }
  if (/^(references|bibliography)$/i.test(text.trim())) return false;
  if (/^(?:https?:\/\/|www\.|doi:)/i.test(text.trim())) return false;
  const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
  return letters >= Math.max(2, text.length * 0.2);
}

function shouldMergeLines(
  previous: TextLine,
  next: TextLine,
  pageWidth: number,
  normalVerticalGap: number,
  boldFontNames: ReadonlySet<string>,
): boolean {
  const verticalGap = previous.minY - next.maxY;
  const fontDelta = Math.abs(previous.fontSize - next.fontSize);
  const indentationDelta = Math.abs(previous.minX - next.minX);
  const shortQuestionTail =
    previous.text.trim().length <= 48 &&
    /\?$/.test(previous.text.trim()) &&
    indentationDelta > pageWidth * 0.02;
  const specialLine =
    /^(?:fig(?:ure)?\.?|table)\s*\d+[a-z]?\s*[.:)]/i.test(previous.text) ||
    /^(?:fig(?:ure)?\.?|table)\s*\d+[a-z]?\s*[.:)]/i.test(next.text);
  const structuralLine =
    /^(?:abstract|references|bibliography|acknowledg(?:e)?ments?)\s*$/i.test(
      previous.text,
    ) ||
    /^(?:abstract|references|bibliography|acknowledg(?:e)?ments?)\s*$/i.test(
      next.text,
    ) ||
    isNumberedSectionHeading(previous.text) ||
    isNumberedSectionHeading(next.text);
  const headingTailBeforeBody =
    previous.text.trim().length <= 100 &&
    lineStartsBold(previous, boldFontNames) &&
    previous.fontSize >= next.fontSize * 1.12 &&
    !/[.!?:]$/.test(previous.text.trim());
  const paragraphBoundary = paragraphBoundaryBetween(
    previous,
    next,
    pageWidth,
    normalVerticalGap,
    boldFontNames,
  );

  return (
    !specialLine &&
    !structuralLine &&
    !shortQuestionTail &&
    !headingTailBeforeBody &&
    !paragraphBoundary &&
    verticalGap <= Math.max(previous.fontSize, next.fontSize) * 0.9 &&
    verticalGap >= -Math.max(previous.fontSize, next.fontSize) * 0.25 &&
    fontDelta <= Math.max(previous.fontSize, next.fontSize) * 0.2 &&
    indentationDelta <= pageWidth * 0.08
  );
}

export function groupPageTextItems(
  items: RawTextItem[],
  context: PageContext,
): DocumentBlock[] {
  const lines = makeLines(items, context.pageWidth);
  if (!lines.length) return [];
  const lineIndexes = new Map(
    lines.map((line, index) => [line, index + 1]),
  );
  const medianFontSize = median(lines.map((line) => line.fontSize)) || 12;
  const boldFontNames = inferBoldFontNames(lines);
  const normalVerticalGap = typicalVerticalGap(lines, context.pageWidth);
  const groups: TextLineGroup[] = [];

  for (const line of lines) {
    const candidate = groups
      .filter((group) =>
        shouldMergeLines(
          group.lines.at(-1)!,
          line,
          context.pageWidth,
          normalVerticalGap,
          boldFontNames,
        ),
      )
      .sort((left, right) => {
        const leftLast = left.lines.at(-1)!;
        const rightLast = right.lines.at(-1)!;
        const leftGap =
          Math.max(0, leftLast.minY - line.maxY) * 3 +
          Math.abs(leftLast.minX - line.minX);
        const rightGap =
          Math.max(0, rightLast.minY - line.maxY) * 3 +
          Math.abs(rightLast.minX - line.minX);
        return leftGap - rightGap;
      })[0];
    if (candidate) {
      candidate.lines.push(line);
    } else {
      groups.push({ lines: [line] });
    }
  }

  return groups.map(({ lines: group }, readingOrder) => {
    const minX = Math.min(...group.map((line) => line.minX));
    const minY = Math.min(...group.map((line) => line.minY));
    const maxX = Math.max(...group.map((line) => line.maxX));
    const maxY = Math.max(...group.map((line) => line.maxY));
    const bbox = normalizedRect(
      minX,
      minY,
      maxX,
      maxY,
      context.pageWidth,
      context.pageHeight,
    );
    const text = group
      .map((line) => line.text)
      .join(" ")
      .replace(/-\s+([a-z])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const fontSize = Math.max(...group.map((line) => line.fontSize));
    const type = classifyBlock(
      text,
      fontSize,
      medianFontSize,
      context.pageNumber,
      bbox,
    );
    const firstLine = group[0];
    const startsBold = lineStartsBold(firstLine, boldFontNames);
    const boldLead =
      (type === "paragraph" ||
        type === "figure-caption" ||
        type === "table-caption") &&
      startsBold &&
      !lineIsMostlyBold(firstLine, boldFontNames);
    const mostlyBold =
      type === "heading" ||
      type === "title" ||
      group.every((line) => lineIsMostlyBold(line, boldFontNames));
    const centered =
      Math.abs((minX + maxX) / 2 - context.pageWidth / 2) <=
        context.pageWidth * 0.06 &&
      maxX - minX < context.pageWidth * 0.82;
    const firstLineCenter = (firstLine.minX + firstLine.maxX) / 2;
    const sameColumnLines = lines.filter((line) => {
      const center = (line.minX + line.maxX) / 2;
      return (
        (center < context.pageWidth / 2) ===
          (firstLineCenter < context.pageWidth / 2) &&
        line.maxX - line.minX >= context.pageWidth * 0.18 &&
        line.fontSize >= medianFontSize * 0.75 &&
        line.fontSize <= medianFontSize * 1.25
      );
    });
    const columnLeft = sameColumnLines.length
      ? median(sameColumnLines.map((line) => line.minX))
      : firstLine.minX;
    const indented =
      firstLine.minX - columnLeft >= Math.max(4, firstLine.fontSize * 0.62);
    const nearestLineAbove = lines
      .filter((line) => {
        if (line === firstLine || group.includes(line)) return false;
        const center = (line.minX + line.maxX) / 2;
        return (
          (center < context.pageWidth / 2) ===
            (firstLineCenter < context.pageWidth / 2) &&
          line.minY >= firstLine.maxY - firstLine.fontSize * 0.2
        );
      })
      .sort(
        (left, right) =>
          left.minY -
          firstLine.maxY -
          (right.minY - firstLine.maxY),
      )[0];
    const gapAbove = nearestLineAbove
      ? nearestLineAbove.minY - firstLine.maxY
      : Number.POSITIVE_INFINITY;
    const nearbyBodyLine =
      Boolean(nearestLineAbove) &&
      Math.abs((nearestLineAbove?.fontSize ?? 0) - firstLine.fontSize) <=
        firstLine.fontSize * 0.2 &&
      gapAbove <=
        Math.max(
          firstLine.fontSize * 1.8,
          normalVerticalGap + firstLine.fontSize * 0.65,
        );
    const followsStructuralLine =
      Boolean(nearestLineAbove) &&
      (isNumberedSectionHeading(nearestLineAbove!.text) ||
        /^(?:abstract|references|bibliography|acknowledg(?:e)?ments?)$/i.test(
          nearestLineAbove!.text.trim(),
        ) ||
        (lineStartsBold(nearestLineAbove!, boldFontNames) &&
          nearestLineAbove!.fontSize >= firstLine.fontSize * 1.1));
    const paragraphStart =
      type === "paragraph"
        ? boldLead || indented || nearbyBodyLine || followsStructuralLine
        : undefined;
    const sourceLines = group.map((line) => {
      const width = line.maxX - line.minX;
      const center = (line.minX + line.maxX) / 2;
      return {
        id: `${context.documentId}-p${context.pageNumber}-l${lineIndexes.get(line)}`,
        pageNumber: context.pageNumber,
        column:
          width >= context.pageWidth * 0.58
            ? 0 as const
            : center < context.pageWidth / 2
              ? 1 as const
              : 2 as const,
        text: line.text,
        bbox: normalizedRect(
          line.minX,
          line.minY,
          line.maxX,
          line.maxY,
          context.pageWidth,
          context.pageHeight,
        ),
        fontSize: round(line.fontSize),
        fontWeight: lineIsMostlyBold(line, boldFontNames)
          ? "bold" as const
          : "normal" as const,
        fontStyle: line.items.some((item) =>
          fontNameLooksItalic(item.fontName),
        )
          ? "italic" as const
          : "normal" as const,
      };
    });

    return {
      id: `${context.documentId}-p${context.pageNumber}-v10-b${readingOrder}`,
      documentId: context.documentId,
      pageNumber: context.pageNumber,
      type,
      text,
      bbox,
      fontSize: round(fontSize),
      sourceStyle: {
        fontWeight: mostlyBold ? "bold" : "normal",
        fontStyle: group.some((line) =>
          line.items.some((item) => fontNameLooksItalic(item.fontName)),
        )
          ? "italic"
          : "normal",
        textAlign: centered ? "center" : "left",
        paragraphStart,
        boldLead,
      },
      sourceLines,
      readingOrder,
      translatable: isTranslatable(type, text),
    };
  });
}

function runningTextSignature(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function isMarginBlock(block: DocumentBlock): boolean {
  return (
    block.bbox.y >= 0.925 ||
    block.bbox.y + block.bbox.height <= 0.065
  );
}

function isRunningFurniture(block: DocumentBlock): boolean {
  return (
    block.type === "running-header" || block.type === "running-footer"
  );
}

function horizontalOverlapRatio(
  left: NormalizedRect,
  right: NormalizedRect,
): number {
  const overlap = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x),
  );
  return overlap / Math.max(0.001, Math.min(left.width, right.width));
}

function mergeCaptionContinuations(
  blocks: DocumentBlock[],
): DocumentBlock[] {
  const consumed = new Set<string>();
  const merged: DocumentBlock[] = [];
  const pageNumbers = [...new Set(blocks.map((block) => block.pageNumber))];

  for (const pageNumber of pageNumbers) {
    const pageBlocks = blocks
      .filter((block) => block.pageNumber === pageNumber)
      .sort(
        (left, right) =>
          left.bbox.y - right.bbox.y ||
          left.bbox.x - right.bbox.x ||
          left.readingOrder - right.readingOrder,
      );
    for (const block of pageBlocks) {
      if (consumed.has(block.id)) continue;
      if (
        block.type !== "figure-caption" &&
        block.type !== "table-caption"
      ) {
        merged.push({ ...block });
        continue;
      }

      let caption = { ...block, bbox: { ...block.bbox } };
      for (const candidate of pageBlocks) {
        if (
          consumed.has(candidate.id) ||
          candidate.id === caption.id ||
          candidate.type !== "paragraph"
        ) {
          continue;
        }
        const gap =
          candidate.bbox.y - (caption.bbox.y + caption.bbox.height);
        const sameColumn =
          horizontalOverlapRatio(caption.bbox, candidate.bbox) >= 0.65;
        const captionSized =
          (candidate.fontSize ?? 0) <= (caption.fontSize ?? 10) * 1.12;
        if (gap < -0.004 || gap > 0.016 || !sameColumn || !captionSized) {
          continue;
        }

        const right = Math.max(
          caption.bbox.x + caption.bbox.width,
          candidate.bbox.x + candidate.bbox.width,
        );
        const bottom = Math.max(
          caption.bbox.y + caption.bbox.height,
          candidate.bbox.y + candidate.bbox.height,
        );
        caption = {
          ...caption,
          text: `${caption.text.trim()} ${candidate.text.trim()}`,
          sourceLines: [
            ...(caption.sourceLines ?? []),
            ...(candidate.sourceLines ?? []),
          ],
          bbox: {
            x: Math.min(caption.bbox.x, candidate.bbox.x),
            y: Math.min(caption.bbox.y, candidate.bbox.y),
            width:
              right - Math.min(caption.bbox.x, candidate.bbox.x),
            height:
              bottom - Math.min(caption.bbox.y, candidate.bbox.y),
          },
        };
        consumed.add(candidate.id);
      }
      merged.push(caption);
    }
  }

  return merged;
}

function mergeHeadingContinuations(
  blocks: DocumentBlock[],
): DocumentBlock[] {
  const consumed = new Set<string>();
  const merged: DocumentBlock[] = [];
  const pageNumbers = [...new Set(blocks.map((block) => block.pageNumber))];

  for (const pageNumber of pageNumbers) {
    const pageBlocks = blocks
      .filter((block) => block.pageNumber === pageNumber)
      .sort(
        (left, right) =>
          left.bbox.y - right.bbox.y ||
          left.bbox.x - right.bbox.x ||
          left.readingOrder - right.readingOrder,
      );
    for (const block of pageBlocks) {
      if (consumed.has(block.id)) continue;
      if (block.type !== "heading" || !isNumberedSectionHeading(block.text)) {
        merged.push({ ...block });
        continue;
      }

      let heading: DocumentBlock = {
        ...block,
        bbox: { ...block.bbox },
        translatable: false,
      };
      const candidate = pageBlocks.find((next) => {
        if (
          consumed.has(next.id) ||
          next.id === heading.id ||
          (next.type !== "paragraph" && next.type !== "heading") ||
          isNumberedSectionHeading(next.text)
        ) {
          return false;
        }
        const gap = next.bbox.y - (heading.bbox.y + heading.bbox.height);
        const fontDelta = Math.abs(
          (next.fontSize ?? 0) - (heading.fontSize ?? 0),
        );
        const matchingFont =
          fontDelta <= Math.max(0.25, (heading.fontSize ?? 10) * 0.05);
        const looksLikeTail =
          /^[A-Za-z]/.test(next.text.trim()) &&
          !/[.!]$/.test(next.text.trim());
        return (
          gap >= -0.003 &&
          gap <= 0.008 &&
          matchingFont &&
          looksLikeTail &&
          next.text.trim().length <= 100 &&
          next.bbox.height <= 0.05 &&
          horizontalOverlapRatio(heading.bbox, next.bbox) >= 0.65
        );
      });

      if (candidate) {
        const left = Math.min(heading.bbox.x, candidate.bbox.x);
        const top = Math.min(heading.bbox.y, candidate.bbox.y);
        const right = Math.max(
          heading.bbox.x + heading.bbox.width,
          candidate.bbox.x + candidate.bbox.width,
        );
        const bottom = Math.max(
          heading.bbox.y + heading.bbox.height,
          candidate.bbox.y + candidate.bbox.height,
        );
        heading = {
          ...heading,
          text: `${heading.text.trim()} ${candidate.text.trim()}`,
          sourceLines: [
            ...(heading.sourceLines ?? []),
            ...(candidate.sourceLines ?? []),
          ],
          bbox: {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          },
        };
        consumed.add(candidate.id);
      }
      merged.push(heading);
    }
  }

  return merged;
}

function mergeAlgorithmBlocks(
  blocks: DocumentBlock[],
): DocumentBlock[] {
  const consumed = new Set<string>();
  const merged: DocumentBlock[] = [];
  const pageNumbers = [...new Set(blocks.map((block) => block.pageNumber))];

  for (const pageNumber of pageNumbers) {
    const pageBlocks = blocks
      .filter((block) => block.pageNumber === pageNumber)
      .sort(
        (left, right) =>
          left.bbox.y - right.bbox.y ||
          left.bbox.x - right.bbox.x ||
          left.readingOrder - right.readingOrder,
      );

    for (const block of pageBlocks) {
      if (consumed.has(block.id)) continue;
      if (
        block.type !== "paragraph" ||
        !/^Algorithm\s+\d+[.:]?\s+/i.test(block.text.trim())
      ) {
        merged.push({ ...block });
        continue;
      }

      const leaderCenter = block.bbox.x + block.bbox.width / 2;
      const continuations = pageBlocks.filter((candidate) => {
        if (
          consumed.has(candidate.id) ||
          candidate.id === block.id ||
          candidate.type !== "paragraph" ||
          !/^(?:(?:\d+\s*:)\s*)+/i.test(candidate.text.trim())
        ) {
          return false;
        }
        const candidateCenter =
          candidate.bbox.x + candidate.bbox.width / 2;
        return (
          Math.abs(candidateCenter - leaderCenter) < 0.22 &&
          candidate.bbox.y >= block.bbox.y - 0.005 &&
          candidate.bbox.y <= block.bbox.y + 0.36
        );
      });
      for (const continuation of continuations) {
        consumed.add(continuation.id);
      }

      const algorithmBlocks = [block, ...continuations];
      const top = Math.max(
        0.035,
        Math.min(...algorithmBlocks.map((candidate) => candidate.bbox.y)) -
          0.02,
      );
      const bottom = Math.min(
        0.95,
        Math.max(
          ...algorithmBlocks.map(
            (candidate) => candidate.bbox.y + candidate.bbox.height,
          ),
        ) + 0.012,
      );
      const fullWidth = block.bbox.width >= 0.58;
      const x = fullWidth ? 0.045 : leaderCenter < 0.5 ? 0.085 : 0.515;
      const width = fullWidth ? 0.91 : 0.4;
      merged.push({
        ...block,
        type: "equation",
        text: algorithmBlocks
          .map((candidate) => candidate.text.trim())
          .join(" "),
        sourceLines: algorithmBlocks.flatMap(
          (candidate) => candidate.sourceLines ?? [],
        ),
        bbox: {
          x,
          y: top,
          width,
          height: bottom - top,
        },
        translatable: false,
      });
    }
  }

  return merged;
}

export function inferContentStartPage(blocks: DocumentBlock[]): number {
  const pages = [...new Set(blocks.map((block) => block.pageNumber))].sort(
    (left, right) => left - right,
  );
  for (const pageNumber of pages) {
    const pageBlocks = blocks.filter(
      (block) => block.pageNumber === pageNumber && !isRunningFurniture(block),
    );
    const hasAbstract = pageBlocks.some(
      (block) =>
        /^abstract$/i.test(block.text.trim()) ||
        (block.type === "abstract" &&
          /^abstract(?:\s|[:.—-])/i.test(block.text.trim())),
    );
    const hasNumberedSection = pageBlocks.some(
      (block) =>
        block.type === "heading" &&
        isNumberedSectionHeading(block.text),
    );
    const hasTitleCandidate = pageBlocks.some(
      (block) =>
        (block.type === "title" || block.type === "heading") &&
        block.bbox.y < 0.32 &&
        (block.fontSize ?? 0) >= 12,
    );
    if (hasAbstract && (hasNumberedSection || hasTitleCandidate)) {
      return pageNumber;
    }
  }
  return pages[0] ?? 1;
}

export function normalizeDocumentBlocks(
  blocks: DocumentBlock[],
): DocumentBlock[] {
  const structureNormalized = mergeHeadingContinuations(
    mergeCaptionContinuations(mergeAlgorithmBlocks(blocks)),
  );
  const pageSetsBySignature = new Map<string, Set<number>>();
  for (const block of structureNormalized) {
    if (!isMarginBlock(block) || block.text.trim().length > 180) continue;
    const signature = runningTextSignature(block.text);
    if (!signature) continue;
    const pages = pageSetsBySignature.get(signature) ?? new Set<number>();
    pages.add(block.pageNumber);
    pageSetsBySignature.set(signature, pages);
  }

  const normalized = structureNormalized.map((block) => {
    const signature = runningTextSignature(block.text);
    const repeated =
      isMarginBlock(block) &&
      (pageSetsBySignature.get(signature)?.size ?? 0) >= 2;
    if (!repeated) return { ...block };
    return {
      ...block,
      type: (block.bbox.y >= 0.5
        ? "running-footer"
        : "running-header") as DocumentBlockType,
      translatable: false,
    };
  });

  const contentStartPage = inferContentStartPage(normalized);
  const pageBlocks = normalized
    .filter(
      (block) =>
        block.pageNumber === contentStartPage && !isRunningFurniture(block),
    )
    .sort(
      (left, right) =>
        left.bbox.y - right.bbox.y || left.readingOrder - right.readingOrder,
    );
  const abstractTop =
    pageBlocks.find((block) => /^abstract$/i.test(block.text.trim()))?.bbox.y ??
    pageBlocks.find((block) => block.type === "abstract")?.bbox.y ??
    0.34;
  const frontMatter = pageBlocks.filter(
    (block) =>
      block.bbox.y < abstractTop &&
      (block.type === "title" ||
        block.type === "heading" ||
        block.type === "paragraph" ||
        block.type === "authors"),
  );
  const title = [...frontMatter].sort(
    (left, right) =>
      (right.fontSize ?? 0) - (left.fontSize ?? 0) ||
      right.bbox.width - left.bbox.width ||
      left.bbox.y - right.bbox.y,
  )[0];

  const withFrontMatterRoles: DocumentBlock[] = normalized.map(
    (block): DocumentBlock => {
    if (block.id === title?.id) {
      return { ...block, type: "title", translatable: false };
    }
    if (
      title &&
      block.pageNumber === contentStartPage &&
      block.bbox.y > title.bbox.y &&
      block.bbox.y < abstractTop &&
      !isRunningFurniture(block)
    ) {
      return { ...block, type: "authors", translatable: false };
    }
    return block;
    },
  );

  const pageNumbers = [
    ...new Set(withFrontMatterRoles.map((block) => block.pageNumber)),
  ].sort((left, right) => left - right);
  return pageNumbers.flatMap((pageNumber) => {
    const pageBlocksForOrdering = withFrontMatterRoles.filter(
      (block) => block.pageNumber === pageNumber,
    );
    const byPosition = (left: DocumentBlock, right: DocumentBlock) =>
      left.bbox.y - right.bbox.y ||
      left.bbox.x - right.bbox.x ||
      left.readingOrder - right.readingOrder;
    if (pageNumber < contentStartPage) {
      return [...pageBlocksForOrdering]
        .sort(byPosition)
        .map((block, readingOrder) => ({ ...block, readingOrder }));
    }

    const furniture = pageBlocksForOrdering
      .filter(isRunningFurniture)
      .sort(byPosition);
    const content = pageBlocksForOrdering.filter(
      (block) => !isRunningFurniture(block),
    );
    const preamble =
      pageNumber === contentStartPage
        ? content
            .filter(
              (block) =>
                block.type === "title" ||
                block.type === "authors" ||
                /^abstract$/i.test(block.text.trim()),
            )
            .sort(byPosition)
        : [];
    const preambleIds = new Set(preamble.map((block) => block.id));
    const body = content.filter((block) => !preambleIds.has(block.id));
    const narrow = body.filter((block) => block.bbox.width < 0.58);
    const twoColumns =
      narrow.some((block) => block.bbox.x < 0.43) &&
      narrow.some((block) => block.bbox.x > 0.43);
    const orderedBody = [...body].sort((left, right) => {
      if (twoColumns) {
        const leftColumn = left.bbox.x + left.bbox.width / 2 < 0.5 ? 0 : 1;
        const rightColumn = right.bbox.x + right.bbox.width / 2 < 0.5 ? 0 : 1;
        if (leftColumn !== rightColumn) return leftColumn - rightColumn;
      }
      return byPosition(left, right);
    });

    return [...preamble, ...orderedBody, ...furniture].map(
      (block, readingOrder) => ({ ...block, readingOrder }),
    );
  });
}

export async function extractDocumentBlocks(
  document: PDFDocumentProxy,
  documentId: string,
  onProgress?: (pageNumber: number, pageCount: number) => void,
): Promise<DocumentBlock[]> {
  const pageBlocks: DocumentBlock[][] = Array.from(
    { length: document.numPages },
    () => [],
  );
  let nextPageNumber = 1;
  let completedPages = 0;
  const extractPage = async (pageNumber: number) => {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: RawTextItem[] = content.items.flatMap((item) => {
      if (!("str" in item) || !item.str.trim()) return [];
      const transform = item.transform;
      const fontSize = Math.hypot(transform[2], transform[3]) ||
        Math.hypot(transform[0], transform[1]) ||
        item.height ||
        10;
      return [
        {
          str: item.str,
          x: transform[4],
          y: transform[5],
          width: item.width,
          height: item.height || fontSize,
          fontSize,
          fontName: item.fontName,
        },
      ];
    });
    pageBlocks[pageNumber - 1] = groupPageTextItems(items, {
      documentId,
      pageNumber,
      pageWidth: viewport.width,
      pageHeight: viewport.height,
    });
    completedPages += 1;
    onProgress?.(completedPages, document.numPages);
  };
  const workers = Array.from(
    { length: Math.min(4, document.numPages) },
    async () => {
      while (nextPageNumber <= document.numPages) {
        const pageNumber = nextPageNumber;
        nextPageNumber += 1;
        await extractPage(pageNumber);
      }
    },
  );
  await Promise.all(workers);
  return normalizeDocumentBlocks(pageBlocks.flat());
}

const SOURCE_REFERENCE_PATTERN =
  /\b(Fig(?:ure)?\.?|Table|Algorithm|Listing|Code)\s*(\d+[a-z]?)\b/gi;
const TRANSLATED_REFERENCE_PATTERN =
  /(?:그림|표|알고리즘|목록|코드)\s*(\d+[a-z]?)\b/gi;
const ANY_REFERENCE_PATTERN =
  /\b(Fig(?:ure)?\.?|Table|Algorithm|Listing|Code)\s*(\d+[a-z]?)\b|(?:그림|표|알고리즘|목록|코드)\s*(\d+[a-z]?)\b/gi;

type ReferenceDetectionOptions = {
  language?: "source" | "translation" | "any";
};

function referenceKind(label: string): DocumentReference["kind"] {
  const normalized = label.toLowerCase();
  if (normalized.startsWith("tab") || label.startsWith("표")) return "table";
  if (
    normalized.startsWith("algorithm") ||
    normalized.startsWith("listing") ||
    normalized.startsWith("code") ||
    label.startsWith("알고리즘") ||
    label.startsWith("목록") ||
    label.startsWith("코드")
  ) {
    return "code";
  }
  return "figure";
}

function referenceKey(
  kind: DocumentReference["kind"],
  number: string,
): string {
  return `${kind}:${number.toLowerCase()}`;
}

export function detectDocumentReferences(
  blocks: DocumentBlock[],
  options: ReferenceDetectionOptions = {},
): DocumentReference[] {
  const references: DocumentReference[] = [];
  const pattern =
    options.language === "source"
      ? SOURCE_REFERENCE_PATTERN
      : options.language === "translation"
        ? TRANSLATED_REFERENCE_PATTERN
        : ANY_REFERENCE_PATTERN;
  for (const block of blocks) {
    if (
      block.type === "figure-caption" ||
      block.type === "table-caption" ||
      block.type === "code-listing" ||
      (block.type === "equation" &&
        /^(?:Algorithm|Listing|Code)\s*\d+/i.test(block.text.trim()))
    ) {
      continue;
    }
    for (const match of block.text.matchAll(pattern)) {
      const label = match[0];
      const number = match[2] ?? match[3] ?? match[1];
      if (!number) continue;
      const sourceStart = match.index;
      references.push({
        id: `${block.id}-ref-${references.length}`,
        sourceBlockId: block.id,
        label,
        kind: referenceKind(label),
        number,
        sourcePageNumber: block.pageNumber,
        sourceStart,
        sourceEnd: sourceStart + label.length,
      });
    }
  }
  return references;
}

export function resolveDocumentReferences(
  blocks: DocumentBlock[],
  references = detectDocumentReferences(blocks),
): DocumentReference[] {
  const targets = new Map<
    string,
    Pick<DocumentBlock, "id" | "pageNumber" | "bbox">
  >();
  for (const block of blocks) {
    const kind: DocumentReference["kind"] | null =
      block.type === "figure-caption"
        ? "figure"
        : block.type === "table-caption"
          ? "table"
          : block.type === "code-listing" ||
              (block.type === "equation" &&
                /^(?:Algorithm|Listing|Code)\s*\d+/i.test(
                  block.text.trim(),
                ))
            ? "code"
          : null;
    if (!kind) continue;
    const match = block.text.match(
      kind === "figure"
        ? /^(?:Fig(?:ure)?\.?|그림)\s*(\d+[a-z]?)\b/i
        : kind === "table"
          ? /^(?:Table|표)\s*(\d+[a-z]?)\b/i
          : /^(?:Algorithm|Listing|Code|알고리즘|목록|코드)\s*(\d+[a-z]?)\b/i,
    );
    if (match) targets.set(referenceKey(kind, match[1]), block);
  }

  return references.map((reference) => {
    const target = targets.get(referenceKey(reference.kind, reference.number));
    return target
      ? {
          ...reference,
          targetBlockId: target.id,
          targetPageNumber: target.pageNumber,
          targetBbox: target.bbox,
        }
      : reference;
  });
}
