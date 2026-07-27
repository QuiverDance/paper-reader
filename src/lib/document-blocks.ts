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
    /^(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][^\n]{2,100}$/.test(normalized) &&
    (fontSize >= medianFontSize * 1.18 ||
      /^\d+(?:\.\d+)*\.?\s+/.test(normalized))
  ) {
    return "heading";
  }
  if (bbox.y > 0.88 && fontSize < medianFontSize * 0.9) return "footnote";
  return normalized.length > 1 ? "paragraph" : "unknown";
}

function isTranslatable(type: DocumentBlockType, text: string): boolean {
  if (type === "unknown") return false;
  if (/^(references|bibliography)$/i.test(text.trim())) return false;
  if (/^(?:https?:\/\/|www\.|doi:)/i.test(text.trim())) return false;
  const letters = (text.match(/[A-Za-z가-힣]/g) ?? []).length;
  return letters >= Math.max(2, text.length * 0.2);
}

function shouldMergeLines(
  previous: TextLine,
  next: TextLine,
  pageWidth: number,
): boolean {
  const verticalGap = previous.minY - next.maxY;
  const fontDelta = Math.abs(previous.fontSize - next.fontSize);
  const indentationDelta = Math.abs(previous.minX - next.minX);
  const previousEndsSentence = /[.!?:]$/.test(previous.text);
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
    /^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(previous.text) ||
    /^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(next.text);

  return (
    !specialLine &&
    !structuralLine &&
    verticalGap <= Math.max(previous.fontSize, next.fontSize) * 0.9 &&
    verticalGap >= -Math.max(previous.fontSize, next.fontSize) * 0.25 &&
    fontDelta <= Math.max(previous.fontSize, next.fontSize) * 0.2 &&
    indentationDelta <= pageWidth * 0.08 &&
    (!previousEndsSentence || next.text.length < 80)
  );
}

export function groupPageTextItems(
  items: RawTextItem[],
  context: PageContext,
): DocumentBlock[] {
  const lines = makeLines(items, context.pageWidth);
  if (!lines.length) return [];
  const medianFontSize = median(lines.map((line) => line.fontSize)) || 12;
  const groups: TextLine[][] = [];

  for (const line of lines) {
    const candidate = groups
      .filter((group) =>
        shouldMergeLines(group.at(-1)!, line, context.pageWidth),
      )
      .sort((left, right) => {
        const leftLast = left.at(-1)!;
        const rightLast = right.at(-1)!;
        const leftGap =
          Math.max(0, leftLast.minY - line.maxY) * 3 +
          Math.abs(leftLast.minX - line.minX);
        const rightGap =
          Math.max(0, rightLast.minY - line.maxY) * 3 +
          Math.abs(rightLast.minX - line.minX);
        return leftGap - rightGap;
      })[0];
    if (candidate) {
      candidate.push(line);
    } else {
      groups.push([line]);
    }
  }

  return groups.map((group, readingOrder) => {
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

    return {
      id: `${context.documentId}-p${context.pageNumber}-v5-b${readingOrder}`,
      documentId: context.documentId,
      pageNumber: context.pageNumber,
      type,
      text,
      bbox,
      fontSize: round(fontSize),
      readingOrder,
      translatable: isTranslatable(type, text),
    };
  });
}

export async function extractDocumentBlocks(
  document: PDFDocumentProxy,
  documentId: string,
  onProgress?: (pageNumber: number, pageCount: number) => void,
): Promise<DocumentBlock[]> {
  const blocks: DocumentBlock[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
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
        },
      ];
    });
    blocks.push(
      ...groupPageTextItems(items, {
        documentId,
        pageNumber,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      }),
    );
    onProgress?.(pageNumber, document.numPages);
  }
  return blocks;
}

const REFERENCE_PATTERN = /\b(Fig(?:ure)?\.?|Table)\s*(\d+[a-z]?)\b/gi;

function referenceKey(kind: "figure" | "table", number: string): string {
  return `${kind}:${number.toLowerCase()}`;
}

export function detectDocumentReferences(
  blocks: DocumentBlock[],
): DocumentReference[] {
  const references: DocumentReference[] = [];
  for (const block of blocks) {
    if (block.type === "figure-caption" || block.type === "table-caption") {
      continue;
    }
    for (const match of block.text.matchAll(REFERENCE_PATTERN)) {
      const kind = match[1].toLowerCase().startsWith("tab")
        ? "table"
        : "figure";
      references.push({
        id: `${block.id}-ref-${references.length}`,
        sourceBlockId: block.id,
        label: match[0],
        kind,
        number: match[2],
        sourcePageNumber: block.pageNumber,
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
    const kind =
      block.type === "figure-caption"
        ? "figure"
        : block.type === "table-caption"
          ? "table"
          : null;
    if (!kind) continue;
    const match = block.text.match(
      kind === "figure"
        ? /^(?:Fig(?:ure)?\.?)\s*(\d+[a-z]?)\b/i
        : /^Table\s*(\d+[a-z]?)\b/i,
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
