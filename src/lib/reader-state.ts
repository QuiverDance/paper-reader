import type { ScrollAnchor, ViewState } from "../types";

export const DEFAULT_VIEW_STATE: ViewState = {
  pageNumber: 1,
  relativeOffsetY: 0,
  scaleValue: "page-width",
  scale: 1,
  rotation: 0,
};

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
export const SCALE_STEP = 1.1;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeAnchor(
  anchor: ScrollAnchor,
  pageCount: number,
): ScrollAnchor {
  return {
    pageNumber: Math.round(clamp(anchor.pageNumber, 1, Math.max(pageCount, 1))),
    relativeOffsetY: clamp(anchor.relativeOffsetY, 0, 1),
  };
}

export function normalizeRotation(rotation: number): number {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

export function scaleBy(currentScale: number, direction: "in" | "out"): number {
  const factor = direction === "in" ? SCALE_STEP : 1 / SCALE_STEP;
  return clamp(currentScale * factor, MIN_SCALE, MAX_SCALE);
}

export function mergeViewState(
  current: ViewState,
  update: Partial<ViewState>,
  pageCount: number,
): ViewState {
  const anchor = normalizeAnchor(
    {
      pageNumber: update.pageNumber ?? current.pageNumber,
      relativeOffsetY: update.relativeOffsetY ?? current.relativeOffsetY,
    },
    pageCount,
  );

  return {
    ...current,
    ...update,
    ...anchor,
    scale: clamp(update.scale ?? current.scale, MIN_SCALE, MAX_SCALE),
    rotation: normalizeRotation(update.rotation ?? current.rotation),
  };
}

export function viewStateIsClose(
  left: ViewState,
  right: ViewState,
): boolean {
  return (
    left.pageNumber === right.pageNumber &&
    Math.abs(left.relativeOffsetY - right.relativeOffsetY) < 0.002 &&
    Math.abs(left.scale - right.scale) < 0.002 &&
    left.scaleValue === right.scaleValue &&
    left.rotation === right.rotation
  );
}

