export type SplitMode = "single" | "side-by-side" | "stacked";

export type ScrollAnchor = {
  pageNumber: number;
  relativeOffsetY: number;
};

export type ViewState = ScrollAnchor & {
  scaleValue: string;
  scale: number;
  rotation: number;
};

export type ReaderDocument = {
  id: string;
  filePath: string;
  title: string;
  pageCount: number;
  lastOpenedAt: string;
  viewState: ViewState;
  splitMode: SplitMode;
  syncEnabled: boolean;
};

export type PaneId = "original" | "companion";

export type PaneUpdate = {
  source: PaneId;
  viewState: Partial<ViewState>;
};

