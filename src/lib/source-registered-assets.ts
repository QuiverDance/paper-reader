import type {
  NormalizedRect,
  PaperAsset,
} from "../types";

export type RegisteredAssetSlot = {
  assetId: string;
  pageNumber: number;
  mediaRect: NormalizedRect;
  captionRect: NormalizedRect;
  exclusionRect: NormalizedRect;
  anchor: PaperAsset["anchor"];
};

export type SourceAssetCrop = {
  left: number;
  bottom: number;
  right: number;
  top: number;
};

export type SourceAssetPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type RegisteredAssetSlotOptions = {
  pageTop: number;
  pageWidth: number;
  pageHeight: number;
};

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function unionRects(
  left: NormalizedRect,
  right: NormalizedRect,
): NormalizedRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(
    left.x + left.width,
    right.x + right.width,
  );
  const bottom = Math.max(
    left.y + left.height,
    right.y + right.height,
  );
  return {
    x: rounded(x),
    y: rounded(y),
    width: rounded(rightEdge - x),
    height: rounded(bottom - y),
  };
}

export function createRegisteredAssetSlot(
  asset: PaperAsset,
  captionRect: NormalizedRect,
  options: RegisteredAssetSlotOptions,
): RegisteredAssetSlot {
  const mediaRect = sourceRegisteredAssetRect(
    asset.bbox,
    asset.kind,
    options.pageWidth,
    options.pageHeight,
    asset.cropBottomLimit,
  );
  const occupied = unionRects(mediaRect, captionRect);
  const exclusionTop =
    asset.anchor === "inline"
      ? occupied.y
      : Math.min(options.pageTop, occupied.y);
  const occupiedBottom = occupied.y + occupied.height;

  return {
    assetId: asset.id,
    pageNumber: asset.pageNumber,
    mediaRect,
    captionRect: { ...captionRect },
    exclusionRect: {
      x: occupied.x,
      y: rounded(exclusionTop),
      width: occupied.width,
      height: rounded(occupiedBottom - exclusionTop),
    },
    anchor: asset.anchor,
  };
}

function sourceAssetPadding(
  kind: PaperAsset["kind"],
): SourceAssetPadding {
  return kind === "code"
    ? { top: 0, right: 4, bottom: 14, left: 4 }
    : { top: 4, right: 4, bottom: 4, left: 4 };
}

export function sourceRegisteredAssetRect(
  rect: NormalizedRect,
  kind: PaperAsset["kind"],
  pageWidth: number,
  pageHeight: number,
  cropBottomLimit = 1,
): NormalizedRect {
  const padding = sourceAssetPadding(kind);
  const left = Math.max(0, rect.x - padding.left / pageWidth);
  const top = Math.max(0, rect.y - padding.top / pageHeight);
  const right = Math.min(
    1,
    rect.x + rect.width + padding.right / pageWidth,
  );
  const bottom = Math.min(
    1,
    cropBottomLimit,
    rect.y + rect.height + padding.bottom / pageHeight,
  );
  return {
    x: rounded(left),
    y: rounded(top),
    width: rounded(right - left),
    height: rounded(bottom - top),
  };
}

export function sourceRegisteredAssetCrop(
  rect: NormalizedRect,
  pageWidth: number,
  pageHeight: number,
  kind: PaperAsset["kind"],
  cropBottomLimit = 1,
): SourceAssetCrop {
  const padding = sourceAssetPadding(kind);
  const bottomEdge = Math.min(
    cropBottomLimit,
    rect.y + rect.height + padding.bottom / pageHeight,
  );
  return {
    left: rounded(Math.max(0, rect.x * pageWidth - padding.left)),
    bottom: rounded(
      Math.max(
        0,
        (1 - bottomEdge) * pageHeight,
      ),
    ),
    right: rounded(
      Math.min(
        pageWidth,
        (rect.x + rect.width) * pageWidth + padding.right,
      ),
    ),
    top: rounded(
      Math.min(
        pageHeight,
        (1 - rect.y) * pageHeight + padding.top,
      ),
    ),
  };
}
