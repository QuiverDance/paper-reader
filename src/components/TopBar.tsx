import {
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Maximize2,
  Minus,
  PanelTop,
  Plus,
  RotateCw,
  Search,
  Unlink2,
  ZoomIn,
} from "lucide-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import type { SplitMode, ViewState } from "../types";

type TopBarProps = {
  hasDocument: boolean;
  title: string;
  pageCount: number;
  viewState: ViewState;
  splitMode: SplitMode;
  syncEnabled: boolean;
  onOpen: () => void;
  onPage: (pageNumber: number) => void;
  onZoom: (direction: "in" | "out") => void;
  onFit: (mode: "page-width" | "page-fit") => void;
  onRotate: () => void;
  onSplitMode: (mode: SplitMode) => void;
  onToggleSync: () => void;
};

function IconButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "icon-button--active" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function TopBar({
  hasDocument,
  title,
  pageCount,
  viewState,
  splitMode,
  syncEnabled,
  onOpen,
  onPage,
  onZoom,
  onFit,
  onRotate,
  onSplitMode,
  onToggleSync,
}: TopBarProps) {
  const submitPage = (
    event: KeyboardEvent<HTMLInputElement> | ChangeEvent<HTMLInputElement>,
  ) => {
    if ("key" in event && event.key !== "Enter") return;
    const parsed = Number(event.currentTarget.value);
    if (Number.isFinite(parsed)) onPage(parsed);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <span>Paperloom</span>
      </div>

      <button type="button" className="open-button" onClick={onOpen}>
        <FilePlus2 size={16} />
        PDF 열기
      </button>

      <div className="document-chip" title={title}>
        <Search size={15} />
        <span>{hasDocument ? title : "논문을 열어 시작하세요"}</span>
      </div>

      <div className="toolbar-group">
        <IconButton
          label="이전 페이지"
          disabled={!hasDocument || viewState.pageNumber <= 1}
          onClick={() => onPage(viewState.pageNumber - 1)}
        >
          <ChevronLeft size={17} />
        </IconButton>
        <div className="page-control">
          <input
            key={viewState.pageNumber}
            defaultValue={viewState.pageNumber}
            inputMode="numeric"
            aria-label="현재 페이지"
            disabled={!hasDocument}
            onBlur={submitPage}
            onKeyDown={submitPage}
          />
          <span>/ {pageCount || "—"}</span>
        </div>
        <IconButton
          label="다음 페이지"
          disabled={!hasDocument || viewState.pageNumber >= pageCount}
          onClick={() => onPage(viewState.pageNumber + 1)}
        >
          <ChevronRight size={17} />
        </IconButton>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <IconButton
          label="축소"
          disabled={!hasDocument}
          onClick={() => onZoom("out")}
        >
          <Minus size={17} />
        </IconButton>
        <span className="zoom-value">
          {hasDocument ? `${Math.round(viewState.scale * 100)}%` : "—"}
        </span>
        <IconButton
          label="확대"
          disabled={!hasDocument}
          onClick={() => onZoom("in")}
        >
          <Plus size={17} />
        </IconButton>
        <IconButton
          label="너비 맞춤"
          active={viewState.scaleValue === "page-width"}
          disabled={!hasDocument}
          onClick={() => onFit("page-width")}
        >
          <ZoomIn size={17} />
        </IconButton>
        <IconButton
          label="페이지 맞춤"
          active={viewState.scaleValue === "page-fit"}
          disabled={!hasDocument}
          onClick={() => onFit("page-fit")}
        >
          <Maximize2 size={16} />
        </IconButton>
        <IconButton label="회전" disabled={!hasDocument} onClick={onRotate}>
          <RotateCw size={16} />
        </IconButton>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group view-controls">
        <IconButton
          label="원문만"
          active={splitMode === "single"}
          disabled={!hasDocument}
          onClick={() => onSplitMode("single")}
        >
          <PanelTop size={17} />
        </IconButton>
        <IconButton
          label="좌우 분할"
          active={splitMode === "side-by-side"}
          disabled={!hasDocument}
          onClick={() => onSplitMode("side-by-side")}
        >
          <AlignHorizontalSpaceAround size={17} />
        </IconButton>
        <IconButton
          label="상하 분할"
          active={splitMode === "stacked"}
          disabled={!hasDocument}
          onClick={() => onSplitMode("stacked")}
        >
          <AlignVerticalSpaceAround size={17} />
        </IconButton>
        <button
          type="button"
          className={`sync-button ${syncEnabled ? "sync-button--active" : ""}`}
          disabled={!hasDocument || splitMode === "single"}
          onClick={onToggleSync}
          title={syncEnabled ? "동기화 끄기" : "동기화 켜기"}
        >
          {syncEnabled ? <span className="sync-glyph">↔</span> : <Unlink2 size={15} />}
          {syncEnabled ? "동기화" : "독립 보기"}
        </button>
      </div>
    </header>
  );
}

