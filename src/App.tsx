import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { AlertCircle, FileWarning, LoaderCircle, X } from "lucide-react";
import { EmptyReader } from "./components/EmptyReader";
import { PdfPane } from "./components/PdfPane";
import { Sidebar } from "./components/Sidebar";
import { ToolRail } from "./components/ToolRail";
import { TopBar } from "./components/TopBar";
import { extractPdfTitle, loadPdfDocument } from "./lib/pdf";
import {
  DEFAULT_VIEW_STATE,
  mergeViewState,
  normalizeAnchor,
  normalizeRotation,
  scaleBy,
} from "./lib/reader-state";
import {
  fileNameFromPath,
  readPdfFromPath,
  runningInTauri,
  selectPdfPath,
  stableDocumentId,
} from "./lib/platform";
import {
  findDocument,
  listRecentDocuments,
  makeReaderDocument,
  saveDocument,
  updateReadingState,
} from "./lib/storage";
import type {
  PaneId,
  ReaderDocument,
  SplitMode,
  ViewState,
} from "./types";

type PaneStates = Record<PaneId, ViewState>;

const INITIAL_PANE_STATES: PaneStates = {
  original: DEFAULT_VIEW_STATE,
  companion: DEFAULT_VIEW_STATE,
};

function App() {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [readerDocument, setReaderDocument] = useState<ReaderDocument | null>(null);
  const [paneStates, setPaneStates] = useState<PaneStates>(INITIAL_PANE_STATES);
  const [activePane, setActivePane] = useState<PaneId>("original");
  const [splitMode, setSplitMode] = useState<SplitMode>("side-by-side");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [recentDocuments, setRecentDocuments] = useState<ReaderDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browserInputRef = useRef<HTMLInputElement>(null);
  const currentPdfRef = useRef<PDFDocumentProxy | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const activeState = paneStates[activePane];
  const pageCount = pdfDocument?.numPages ?? 0;

  const refreshRecent = useCallback(async () => {
    try {
      setRecentDocuments(await listRecentDocuments());
    } catch {
      // The reader remains usable if persistence is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      void currentPdfRef.current?.cleanup();
    };
  }, [refreshRecent]);

  useEffect(() => {
    if (!readerDocument) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void updateReadingState(
        readerDocument.id,
        paneStates.original,
        splitMode,
        syncEnabled,
      ).then(refreshRecent);
    }, 450);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [
    paneStates.original,
    readerDocument,
    refreshRecent,
    splitMode,
    syncEnabled,
  ]);

  const installDocument = useCallback(
    async (bytes: Uint8Array, filePath: string) => {
      setLoading(true);
      setError(null);
      try {
        const id = stableDocumentId(filePath);
        const [document, previous] = await Promise.all([
          loadPdfDocument(bytes),
          findDocument(id),
        ]);
        const fallback = fileNameFromPath(filePath);
        const title = await extractPdfTitle(document, fallback);
        const nextReaderDocument = makeReaderDocument(
          id,
          filePath,
          title,
          document.numPages,
          previous,
        );
        const restored = mergeViewState(
          DEFAULT_VIEW_STATE,
          previous?.viewState ?? DEFAULT_VIEW_STATE,
          document.numPages,
        );

        const oldDocument = currentPdfRef.current;
        currentPdfRef.current = document;
        setPdfDocument(document);
        setReaderDocument(nextReaderDocument);
        setPaneStates({ original: restored, companion: restored });
        setSplitMode(nextReaderDocument.splitMode);
        setSyncEnabled(nextReaderDocument.syncEnabled);
        setActivePane("original");
        await saveDocument(nextReaderDocument);
        await refreshRecent();
        if (oldDocument) void oldDocument.cleanup();
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : String(cause);
        setError(message || "PDF를 열지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [refreshRecent],
  );

  const openPdf = useCallback(async () => {
    setError(null);
    if (!runningInTauri()) {
      browserInputRef.current?.click();
      return;
    }
    try {
      const path = await selectPdfPath();
      if (!path) return;
      const bytes = await readPdfFromPath(path);
      await installDocument(bytes, path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [installDocument]);

  const openBrowserFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError("PDF 파일만 열 수 있습니다.");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await installDocument(bytes, `browser://${file.name}`);
    },
    [installDocument],
  );

  const openRecent = useCallback(
    async (document: ReaderDocument) => {
      if (document.filePath.startsWith("browser://")) {
        setError("브라우저에서 연 파일은 다시 선택해 주세요.");
        browserInputRef.current?.click();
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const bytes = await readPdfFromPath(document.filePath);
        await installDocument(bytes, document.filePath);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "파일을 다시 열지 못했습니다.",
        );
        setLoading(false);
      }
    },
    [installDocument],
  );

  const updatePane = useCallback(
    (paneId: PaneId, update: Partial<ViewState>) => {
      if (!pageCount) return;
      setPaneStates((current) => {
        const next = mergeViewState(current[paneId], update, pageCount);
        if (syncEnabled) {
          return { original: next, companion: next };
        }
        return { ...current, [paneId]: next };
      });
    },
    [pageCount, syncEnabled],
  );

  const updateFromToolbar = useCallback(
    (update: Partial<ViewState>) => {
      if (!pageCount) return;
      setPaneStates((current) => {
        const next = mergeViewState(current[activePane], update, pageCount);
        if (syncEnabled) return { original: next, companion: next };
        return { ...current, [activePane]: next };
      });
    },
    [activePane, pageCount, syncEnabled],
  );

  const setPage = useCallback(
    (pageNumber: number) => {
      const anchor = normalizeAnchor({ pageNumber, relativeOffsetY: 0 }, pageCount);
      updateFromToolbar(anchor);
    },
    [pageCount, updateFromToolbar],
  );

  const setZoom = useCallback(
    (direction: "in" | "out") => {
      const scale = scaleBy(activeState.scale, direction);
      updateFromToolbar({ scale, scaleValue: String(scale) });
    },
    [activeState.scale, updateFromToolbar],
  );

  const setFit = useCallback(
    (scaleValue: "page-width" | "page-fit") => {
      updateFromToolbar({ scaleValue });
    },
    [updateFromToolbar],
  );

  const rotate = useCallback(() => {
    updateFromToolbar({ rotation: normalizeRotation(activeState.rotation + 90) });
  }, [activeState.rotation, updateFromToolbar]);

  const toggleSync = useCallback(() => {
    setSyncEnabled((enabled) => {
      if (!enabled) {
        setPaneStates((current) => ({
          original: current[activePane],
          companion: current[activePane],
        }));
      }
      return !enabled;
    });
  }, [activePane]);

  const changeSplitMode = useCallback((mode: SplitMode) => {
    setSplitMode(mode);
    if (mode === "single") setActivePane("original");
  }, []);

  const statusText = useMemo(() => {
    if (!readerDocument) return "준비됨";
    const viewLabel =
      splitMode === "single"
        ? "원문"
        : splitMode === "side-by-side"
          ? "좌우 분할"
          : "상하 분할";
    return `${viewLabel} · ${syncEnabled ? "동기화됨" : "독립 보기"}`;
  }, [readerDocument, splitMode, syncEnabled]);

  return (
    <div className="app-shell">
      <input
        ref={browserInputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          void openBrowserFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      <TopBar
        hasDocument={Boolean(pdfDocument)}
        title={readerDocument?.title ?? ""}
        pageCount={pageCount}
        viewState={activeState}
        splitMode={splitMode}
        syncEnabled={syncEnabled}
        onOpen={() => void openPdf()}
        onPage={setPage}
        onZoom={setZoom}
        onFit={setFit}
        onRotate={rotate}
        onSplitMode={changeSplitMode}
        onToggleSync={toggleSync}
      />

      <div className="workspace">
        <Sidebar
          recentDocuments={recentDocuments}
          activeDocumentId={readerDocument?.id}
          onOpenRecent={(document) => void openRecent(document)}
        />

        <div className="reader-region">
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="닫기">
                <X size={15} />
              </button>
            </div>
          )}

          {loading && (
            <div className="global-loading">
              <LoaderCircle className="spin" size={22} />
              <span>논문을 여는 중</span>
            </div>
          )}

          {!pdfDocument ? (
            <EmptyReader onOpen={() => void openPdf()} />
          ) : (
            <main className={`reader-grid reader-grid--${splitMode}`}>
              <PdfPane
                document={pdfDocument}
                paneId="original"
                label="원문"
                detail={readerDocument?.title ?? ""}
                targetState={paneStates.original}
                active={activePane === "original"}
                onActivate={setActivePane}
                onUpdate={updatePane}
              />
              {splitMode !== "single" && (
                <PdfPane
                  document={pdfDocument}
                  paneId="companion"
                  label="번역 뷰"
                  detail="원문 미러 · 번역 레이어 준비"
                  targetState={paneStates.companion}
                  active={activePane === "companion"}
                  onActivate={setActivePane}
                  onUpdate={updatePane}
                />
              )}
            </main>
          )}

          <footer className="statusbar">
            <span>
              {readerDocument ? (
                <>
                  <span className="status-dot" />
                  {statusText}
                </>
              ) : (
                <>
                  <FileWarning size={13} />
                  PDF 없음
                </>
              )}
            </span>
            <span>{readerDocument?.filePath ?? "원본 파일은 수정되지 않습니다"}</span>
            <span>
              {readerDocument
                ? `p. ${paneStates.original.pageNumber} · ${Math.round(
                    paneStates.original.scale * 100,
                  )}% · ${paneStates.original.rotation}°`
                : "Paperloom 0.1.0"}
            </span>
          </footer>
        </div>

        <ToolRail />
      </div>
    </div>
  );
}

export default App;
