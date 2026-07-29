import type { CSSProperties } from "react";
import type { NormalizedRect } from "../types";
import { clamp } from "./reader-state";
import { mergeReferenceRects } from "./reference-preview";

export function rotateNormalizedRect(
  rect: NormalizedRect,
  rotation: number,
): NormalizedRect {
  if (rotation === 90) {
    return {
      x: 1 - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }
  if (rotation === 180) {
    return {
      x: 1 - rect.x - rect.width,
      y: 1 - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    };
  }
  if (rotation === 270) {
    return {
      x: rect.y,
      y: 1 - rect.x - rect.width,
      width: rect.height,
      height: rect.width,
    };
  }
  return rect;
}

export function referenceRectStyle(
  rect: NormalizedRect,
  rotation: number,
): CSSProperties {
  const rotated = rotateNormalizedRect(rect, rotation);
  return {
    left: `${rotated.x * 100}%`,
    top: `${rotated.y * 100}%`,
    width: `${rotated.width * 100}%`,
    height: `${rotated.height * 100}%`,
  };
}

export function locateReferenceTokenRects(
  pageElement: HTMLElement,
  label: string,
  sourceBlockRect: NormalizedRect,
  rotation: number,
): NormalizedRect[] {
  const textLayer = pageElement.querySelector<HTMLElement>(".textLayer");
  if (!textLayer) return [];
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let source = "";
  const walker = window.document.createTreeWalker(
    textLayer,
    NodeFilter.SHOW_TEXT,
  );
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    textNodes.push({
      node,
      start: source.length,
      end: source.length + node.data.length,
    });
    source += node.data;
    current = walker.nextNode();
  }
  if (!source) return [];

  const escapedParts = label
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escapedParts.join("\\s*"), "gi");
  const pageRect = pageElement.getBoundingClientRect();
  const expected = rotateNormalizedRect(sourceBlockRect, rotation);
  const expectedCenter = {
    x: expected.x + expected.width / 2,
    y: expected.y + expected.height / 2,
  };
  const candidates: Array<{
    rects: NormalizedRect[];
    distance: number;
  }> = [];

  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    const startNode = textNodes.find(
      (entry) => start >= entry.start && start < entry.end,
    );
    const endNode = textNodes.find(
      (entry) => end > entry.start && end <= entry.end,
    );
    if (!startNode || !endNode) continue;
    const range = window.document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
        width: clamp(rect.width / pageRect.width, 0, 1),
        height: clamp(rect.height / pageRect.height, 0, 1),
      }));
    if (!rects.length) continue;
    const center = {
      x:
        rects.reduce(
          (sum, rect) => sum + rect.x + rect.width / 2,
          0,
        ) / rects.length,
      y:
        rects.reduce(
          (sum, rect) => sum + rect.y + rect.height / 2,
          0,
        ) / rects.length,
    };
    candidates.push({
      rects,
      distance:
        (center.x - expectedCenter.x) ** 2 +
        (center.y - expectedCenter.y) ** 2,
    });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return mergeReferenceRects(candidates[0]?.rects ?? []);
}
