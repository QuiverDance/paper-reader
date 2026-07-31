import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractDocumentBlocks } from "../lib/document-blocks";
import {
  analyzeDocumentSession,
  loadDocumentSessionBundle,
  needsDocumentAnalysis,
  prepareDocumentSession,
  type DocumentSessionBundle,
  type DocumentSessionDependencies,
} from "../lib/document-session-workflow";
import { applyModelProfile } from "../lib/llm";
import { extractPdfTitle, loadPdfDocument } from "../lib/pdf";
import {
  documentIdFromHash,
  hashPdfBytes,
  readPdfFromPath,
  runningInTauri,
  selectPdfPath,
  stableDocumentId,
} from "../lib/platform";
import {
  DEFAULT_VIEW_STATE,
  mergeViewState,
} from "../lib/reader-state";
import {
  deleteHighlight,
  deleteNote,
  findDocumentByIdentity,
  listChatSessions,
  listDocumentBlocks,
  listHighlights,
  listNotes,
  listRecentDocuments,
  listTranslations,
  loadRetypesetProject,
  makeReaderDocument,
  saveDocument,
  saveDocumentBlocks,
  saveHighlight,
  saveLlmSettings,
  saveNote,
  updateReadingState,
} from "../lib/storage";
import type {
  Highlight,
  LlmSettings,
  Note,
  PaneId,
  ReaderDocument,
  TextSelection,
  ViewState,
} from "../types";

type PaneStates = Record<PaneId, ViewState>;

const INITIAL_PANE_STATES: PaneStates = {
  original: DEFAULT_VIEW_STATE,
  companion: DEFAULT_VIEW_STATE,
};

const dependencies: DocumentSessionDependencies = {
  hashBytes: hashPdfBytes,
  stableId: stableDocumentId,
  idFromHash: documentIdFromHash,
  loadPdf: loadPdfDocument,
  findByIdentity: findDocumentByIdentity,
  extractTitle: extractPdfTitle,
  makeDocument: makeReaderDocument,
  listBlocks: listDocumentBlocks,
  listTranslations,
  listHighlights,
  listNotes,
  listSessions: listChatSessions,
  loadProject: loadRetypesetProject,
  extractBlocks: extractDocumentBlocks,
  saveBlocks: saveDocumentBlocks,
};

type UseDocumentSessionOptions = {
  settings: LlmSettings | null;
  onSettingsChange: (settings: LlmSettings) => void;
  requestBrowserFile: () => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
};

function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function useDocumentSession({
  settings,
  onSettingsChange,
  requestBrowserFile,
  onError,
  onNotice,
}: UseDocumentSessionOptions) {
  const [pdfDocument, setPdfDocument] =
    useState<PDFDocumentProxy | null>(null);
  const [readerDocument, setReaderDocument] =
    useState<ReaderDocument | null>(null);
  const [documents, setDocuments] = useState<ReaderDocument[]>([]);
  const [blocks, setBlocks] = useState<DocumentSessionBundle["blocks"]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [hydration, setHydration] =
    useState<DocumentSessionBundle | null>(null);
  const [paneStates, setPaneStates] =
    useState<PaneStates>(INITIAL_PANE_STATES);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  const currentPdfRef = useRef<PDFDocumentProxy | null>(null);
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  const activeDocumentIdRef = useRef<string | null>(null);
  const companionPageCountRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const installRunRef = useRef(0);

  const getActiveDocumentId = useCallback(
    () => activeDocumentIdRef.current,
    [],
  );
  const getSourceBytes = useCallback(
    () => sourceBytesRef.current,
    [],
  );

  const refreshLibrary = useCallback(async () => {
    try {
      setDocuments(await listRecentDocuments());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onError]);

  useEffect(() => {
    void refreshLibrary();
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
      void currentPdfRef.current?.cleanup();
    };
  }, [refreshLibrary]);

  useEffect(() => {
    if (!readerDocument) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void updateReadingState(
        readerDocument.id,
        paneStates.original,
        "side-by-side",
        false,
      ).then(refreshLibrary);
    }, 450);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [paneStates.original, readerDocument, refreshLibrary]);

  const runAnalysis = useCallback(
    async (pdf: PDFDocumentProxy, documentId: string) => {
      const isCurrent = () =>
        activeDocumentIdRef.current === documentId;
      setAnalyzing(true);
      setAnalysisProgress(0);
      try {
        const extracted = await analyzeDocumentSession(
          pdf,
          documentId,
          dependencies,
          isCurrent,
          setAnalysisProgress,
        );
        if (extracted) {
          setBlocks(extracted);
          if (!extracted.length) {
            onNotice(
              "텍스트를 찾지 못했습니다. 원문 열람과 PDF 기반 Ask는 가능하지만 한국어 재조판은 지원되지 않습니다.",
            );
          }
        }
      } catch (cause) {
        if (isCurrent()) {
          onError(
            cause instanceof Error
              ? cause.message
              : "텍스트 블록을 분석하지 못했습니다.",
          );
        }
      } finally {
        if (isCurrent()) setAnalyzing(false);
      }
    },
    [onError, onNotice],
  );

  const install = useCallback(
    async (bytes: Uint8Array, filePath: string) => {
      const runId = installRunRef.current + 1;
      installRunRef.current = runId;
      const isLatestRun = () => installRunRef.current === runId;
      activeDocumentIdRef.current = null;
      setLoading(true);
      onError(null);
      onNotice(null);
      setHydration(null);
      companionPageCountRef.current = 0;
      try {
        const prepared = await prepareDocumentSession(
          bytes,
          filePath,
          dependencies,
        );
        if (!isLatestRun()) {
          void prepared.pdf.cleanup();
          return;
        }
        const documentId = prepared.document.id;
        activeDocumentIdRef.current = documentId;
        setAnalyzing(false);
        setAnalysisProgress(0);

        const previousPdf = currentPdfRef.current;
        currentPdfRef.current = prepared.pdf;
        sourceBytesRef.current = prepared.sourceBytes;
        setPdfDocument(prepared.pdf);
        setReaderDocument(prepared.document);
        setPaneStates({
          original: mergeViewState(
            DEFAULT_VIEW_STATE,
            prepared.previous?.viewState ?? DEFAULT_VIEW_STATE,
            prepared.pdf.numPages,
          ),
          companion: DEFAULT_VIEW_STATE,
        });
        setBlocks([]);
        setHighlights([]);
        setNotes([]);

        if (settings && prepared.previous?.activeProfileId) {
          const profile = settings.profiles.find(
            (candidate) =>
              candidate.id === prepared.previous?.activeProfileId,
          );
          if (profile) {
            const restoredProfile = {
              ...profile,
              effort:
                prepared.previous.reasoningEffort ?? profile.effort,
            };
            const nextSettings = applyModelProfile(
              {
                ...settings,
                profiles: settings.profiles.map((candidate) =>
                  candidate.id === restoredProfile.id
                    ? restoredProfile
                    : candidate,
                ),
              },
              restoredProfile,
            );
            onSettingsChange(nextSettings);
            await saveLlmSettings(nextSettings);
          }
        }

        await saveDocument(prepared.document);
        const bundle = await loadDocumentSessionBundle(
          documentId,
          dependencies,
          () =>
            isLatestRun() &&
            activeDocumentIdRef.current === documentId,
        );
        if (!bundle) return;
        setBlocks(bundle.blocks);
        setHighlights(bundle.highlights);
        setNotes(bundle.notes);
        setHydration(bundle);
        if (needsDocumentAnalysis(bundle.blocks)) {
          void runAnalysis(prepared.pdf, documentId);
        }
        await refreshLibrary();
        if (previousPdf) void previousPdf.cleanup();
      } catch (cause) {
        if (!isLatestRun()) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        onError(message || "PDF를 열지 못했습니다.");
      } finally {
        if (isLatestRun()) setLoading(false);
      }
    },
    [
      onError,
      onNotice,
      onSettingsChange,
      refreshLibrary,
      runAnalysis,
      settings,
    ],
  );

  const openPdf = useCallback(async () => {
    onError(null);
    if (!runningInTauri()) {
      requestBrowserFile();
      return;
    }
    try {
      const path = await selectPdfPath();
      if (!path) return;
      await install(await readPdfFromPath(path), path);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [install, onError, requestBrowserFile]);

  const openBrowserFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        onError("PDF 파일만 열 수 있습니다.");
        return;
      }
      await install(
        new Uint8Array(await file.arrayBuffer()),
        `browser://${file.name}`,
      );
    },
    [install, onError],
  );

  const openLibraryDocument = useCallback(
    async (nextDocument: ReaderDocument) => {
      if (nextDocument.filePath.startsWith("browser://")) {
        onNotice(
          "브라우저에서 연 논문은 다시 선택하면 내용 해시로 저장된 한국어 논문과 연결됩니다.",
        );
        requestBrowserFile();
        return;
      }
      try {
        await install(
          await readPdfFromPath(nextDocument.filePath),
          nextDocument.filePath,
        );
      } catch {
        onNotice(
          "원문 파일을 다시 선택해 주세요. 이동하거나 이름이 바뀌어도 내용이 같으면 기존 한국어 논문을 복원합니다.",
        );
        await openPdf();
      }
    },
    [install, onNotice, openPdf, requestBrowserFile],
  );

  const prepareCompanion = useCallback((pageCount: number) => {
    companionPageCountRef.current = pageCount;
    setPaneStates((current) => ({
      ...current,
      companion: mergeViewState(
        DEFAULT_VIEW_STATE,
        current.companion,
        pageCount,
      ),
    }));
  }, []);

  const updatePane = useCallback(
    (paneId: PaneId, update: Partial<ViewState>) => {
      const pageCount =
        paneId === "original"
          ? currentPdfRef.current?.numPages ?? 0
          : companionPageCountRef.current;
      if (!pageCount) return;
      setPaneStates((current) => ({
        ...current,
        [paneId]: mergeViewState(
          current[paneId],
          update,
          pageCount,
        ),
      }));
    },
    [],
  );

  const updateDocument = useCallback(
    async (nextDocument: ReaderDocument) => {
      if (activeDocumentIdRef.current !== nextDocument.id) return;
      setReaderDocument(nextDocument);
      setDocuments((current) =>
        current.map((candidate) =>
          candidate.id === nextDocument.id ? nextDocument : candidate,
        ),
      );
      await saveDocument(nextDocument);
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  const addHighlight = useCallback(
    async (selection: TextSelection, color: string) => {
      if (!readerDocument) return null;
      const highlight: Highlight = {
        id: createId("highlight"),
        documentId: readerDocument.id,
        pageNumber: selection.pageNumber,
        source: selection.source,
        selectedText: selection.text,
        rects: selection.rects,
        color,
        createdAt: new Date().toISOString(),
      };
      await saveHighlight(highlight);
      setHighlights((current) => [highlight, ...current]);
      return highlight;
    },
    [readerDocument],
  );

  const addNote = useCallback(
    async (
      markdown: string,
      selection: TextSelection | null,
    ) => {
      if (!readerDocument) return null;
      const timestamp = new Date().toISOString();
      const note: Note = {
        id: createId("note"),
        documentId: readerDocument.id,
        scope: selection ? "selection" : "document",
        pageNumber: selection?.pageNumber,
        source: selection?.source,
        selectedText: selection?.text,
        rects: selection?.rects,
        markdown,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await saveNote(note);
      setNotes((current) => [note, ...current]);
      return note;
    },
    [readerDocument],
  );

  const updateNote = useCallback(async (note: Note, markdown: string) => {
    const next = {
      ...note,
      markdown,
      updatedAt: new Date().toISOString(),
    };
    await saveNote(next);
    setNotes((current) =>
      current.map((candidate) =>
        candidate.id === next.id ? next : candidate,
      ),
    );
  }, []);

  const removeNote = useCallback(async (id: string) => {
    await deleteNote(id);
    setNotes((current) => current.filter((note) => note.id !== id));
  }, []);

  const removeHighlight = useCallback(async (id: string) => {
    await deleteHighlight(id);
    setHighlights((current) =>
      current.filter((highlight) => highlight.id !== id),
    );
  }, []);

  return {
    pdfDocument,
    readerDocument,
    documents,
    blocks,
    highlights,
    notes,
    hydration,
    paneStates,
    loading,
    analyzing,
    analysisProgress,
    getActiveDocumentId,
    getSourceBytes,
    refreshLibrary,
    openPdf,
    openBrowserFile,
    openLibraryDocument,
    prepareCompanion,
    updatePane,
    updateDocument,
    addHighlight,
    addNote,
    updateNote,
    removeNote,
    removeHighlight,
  };
}
