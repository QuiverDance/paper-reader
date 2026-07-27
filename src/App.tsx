import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertCircle,
  Bookmark,
  FileWarning,
  Languages,
  LoaderCircle,
  MessageSquareText,
  StickyNote,
  X,
} from "lucide-react";
import { EmptyReader } from "./components/EmptyReader";
import { FigurePreview } from "./components/FigurePreview";
import { PdfPane } from "./components/PdfPane";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import {
  ToolRail,
  type TranslationScopeRequest,
} from "./components/ToolRail";
import { TopBar } from "./components/TopBar";
import {
  extractDocumentBlocks,
  resolveDocumentReferences,
} from "./lib/document-blocks";
import {
  completeChat,
  dictionaryMessages,
  makeTranslationRecord,
  parseDictionaryResponse,
  parseTranslationResponse,
  questionMessages,
  translationMessages,
} from "./lib/llm";
import { extractPdfTitle, loadPdfDocument } from "./lib/pdf";
import {
  fileNameFromPath,
  folderNameFromPath,
  readPdfFromPath,
  runningInTauri,
  scanLibraryFolder,
  selectLibraryPath,
  selectPdfPath,
  stableDocumentId,
} from "./lib/platform";
import {
  DEFAULT_VIEW_STATE,
  mergeViewState,
  normalizeAnchor,
  normalizeRotation,
  scaleBy,
} from "./lib/reader-state";
import {
  deleteHighlight,
  deleteNote,
  findDictionaryEntry,
  findDocument,
  listChatSessions,
  listDocumentBlocks,
  listHighlights,
  listLibraryDocuments,
  listLibraryFolders,
  listNotes,
  listTranslations,
  loadLlmSettings,
  makeReaderDocument,
  saveChatSession,
  saveDictionaryEntry,
  saveDocument,
  saveDocumentBlocks,
  saveHighlight,
  saveLibraryScan,
  saveLlmSettings,
  saveNote,
  saveTranslationJob,
  saveTranslations,
  setDocumentTags,
  updateReadingState,
} from "./lib/storage";
import type {
  ChatMessage,
  ChatSession,
  DictionaryEntry,
  DocumentBlock,
  DocumentReference,
  Highlight,
  LibraryFolder,
  LlmSettings,
  NormalizedRect,
  Note,
  PaneId,
  ReaderDocument,
  ReadingToolTab,
  SplitMode,
  TextSelection,
  TranslationJob,
  TranslationRecord,
  ViewState,
} from "./types";

type PaneStates = Record<PaneId, ViewState>;

const INITIAL_PANE_STATES: PaneStates = {
  original: DEFAULT_VIEW_STATE,
  companion: DEFAULT_VIEW_STATE,
};

function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function unionRects(rects: NormalizedRect[]): NormalizedRect {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function App() {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [readerDocument, setReaderDocument] = useState<ReaderDocument | null>(
    null,
  );
  const [paneStates, setPaneStates] =
    useState<PaneStates>(INITIAL_PANE_STATES);
  const [activePane, setActivePane] = useState<PaneId>("original");
  const [splitMode, setSplitMode] =
    useState<SplitMode>("side-by-side");
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [documents, setDocuments] = useState<ReaderDocument[]>([]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [blocks, setBlocks] = useState<DocumentBlock[]>([]);
  const [translations, setTranslations] = useState<TranslationRecord[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [translationJob, setTranslationJob] =
    useState<TranslationJob | null>(null);
  const [dictionaryEntry, setDictionaryEntry] =
    useState<DictionaryEntry | null>(null);
  const [selectedReference, setSelectedReference] =
    useState<DocumentReference | null>(null);
  const [toolTab, setToolTab] = useState<ReadingToolTab>("translation");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [translationOverlay] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const browserInputRef = useRef<HTMLInputElement>(null);
  const currentPdfRef = useRef<PDFDocumentProxy | null>(null);
  const currentDocumentIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const cancelTranslationRef = useRef(false);
  const translationRunRef = useRef(0);
  const dictionaryRunRef = useRef(0);
  const questionRunRef = useRef(0);

  const activeState = paneStates[activePane];
  const pageCount = pdfDocument?.numPages ?? 0;
  const references = useMemo(
    () => resolveDocumentReferences(blocks),
    [blocks],
  );

  const refreshLibrary = useCallback(async () => {
    try {
      const [nextDocuments, nextFolders] = await Promise.all([
        listLibraryDocuments(),
        listLibraryFolders(),
      ]);
      setDocuments(nextDocuments);
      setFolders(nextFolders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const hydrateDocumentData = useCallback(async (documentId: string) => {
    const [
      savedBlocks,
      savedTranslations,
      savedHighlights,
      savedNotes,
      savedSessions,
    ] = await Promise.all([
      listDocumentBlocks(documentId),
      listTranslations(documentId),
      listHighlights(documentId),
      listNotes(documentId),
      listChatSessions(documentId),
    ]);
    if (currentDocumentIdRef.current !== documentId) return [];
    setBlocks(savedBlocks);
    setTranslations(savedTranslations);
    setHighlights(savedHighlights);
    setNotes(savedNotes);
    setSessions(savedSessions);
    return savedBlocks;
  }, []);

  const analyzeDocument = useCallback(
    async (document: PDFDocumentProxy, documentId: string) => {
      setAnalyzing(true);
      setAnalysisProgress(0);
      try {
        const extracted = await extractDocumentBlocks(
          document,
          documentId,
          (pageNumber, count) => {
            if (currentDocumentIdRef.current === documentId) {
              setAnalysisProgress(pageNumber / count);
            }
          },
        );
        await saveDocumentBlocks(documentId, extracted);
        if (currentDocumentIdRef.current === documentId) {
          setBlocks(extracted);
          if (!extracted.length) {
            setNotice(
              "텍스트를 찾지 못했습니다. 스캔 PDF에서는 번역과 선택 도구를 사용할 수 없습니다.",
            );
          }
        }
      } catch (cause) {
        if (currentDocumentIdRef.current === documentId) {
          setError(
            cause instanceof Error
              ? cause.message
              : "텍스트 블록을 분석하지 못했습니다.",
          );
        }
      } finally {
        if (currentDocumentIdRef.current === documentId) setAnalyzing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshLibrary();
    void loadLlmSettings()
      .then(setSettings)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
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
        splitMode,
        syncEnabled,
      ).then(refreshLibrary);
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
    refreshLibrary,
    splitMode,
    syncEnabled,
  ]);

  const installDocument = useCallback(
    async (bytes: Uint8Array, filePath: string) => {
      setLoading(true);
      setError(null);
      setNotice(null);
      setSelection(null);
      setDictionaryEntry(null);
      cancelTranslationRef.current = true;
      translationRunRef.current += 1;
      dictionaryRunRef.current += 1;
      questionRunRef.current += 1;
      try {
        const id = stableDocumentId(filePath);
        const [document, previous] = await Promise.all([
          loadPdfDocument(bytes),
          findDocument(id),
        ]);
        currentDocumentIdRef.current = id;
        setAnalyzing(false);
        setAnalysisProgress(0);
        setTranslationJob(null);
        setDictionaryLoading(false);
        setAsking(false);
        setStreamingAnswer("");
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
        setBlocks([]);
        setTranslations([]);
        setHighlights([]);
        setNotes([]);
        setSessions([]);
        await saveDocument(nextReaderDocument);
        const savedBlocks = await hydrateDocumentData(id);
        await refreshLibrary();
        if (!savedBlocks.length) void analyzeDocument(document, id);
        if (oldDocument) void oldDocument.cleanup();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message || "PDF를 열지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [analyzeDocument, hydrateDocumentData, refreshLibrary],
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
      await installDocument(await readPdfFromPath(path), path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [installDocument]);

  const openBrowserFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        setError("PDF 파일만 열 수 있습니다.");
        return;
      }
      await installDocument(
        new Uint8Array(await file.arrayBuffer()),
        `browser://${file.name}`,
      );
    },
    [installDocument],
  );

  const openLibraryDocument = useCallback(
    async (document: ReaderDocument) => {
      if (document.missing) {
        setError("파일이 이동되거나 삭제되었습니다. 폴더를 다시 스캔해 주세요.");
        return;
      }
      if (document.filePath.startsWith("browser://")) {
        setError("브라우저에서 연 파일은 다시 선택해 주세요.");
        browserInputRef.current?.click();
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await installDocument(
          await readPdfFromPath(document.filePath),
          document.filePath,
        );
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

  const rescanFolder = useCallback(
    async (folder: LibraryFolder) => {
      setScanning(true);
      setError(null);
      try {
        const files = await scanLibraryFolder(folder.path);
        const nextFolder = {
          ...folder,
          lastScannedAt: new Date().toISOString(),
        };
        await saveLibraryScan(nextFolder, files);
        await refreshLibrary();
        setNotice(`${folder.name}에서 PDF ${files.length}개를 찾았습니다.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setScanning(false);
      }
    },
    [refreshLibrary],
  );

  const addLibraryFolder = useCallback(async () => {
    if (!runningInTauri()) {
      setError("폴더 라이브러리는 데스크톱 앱에서 사용할 수 있습니다.");
      return;
    }
    const path = await selectLibraryPath();
    if (!path) return;
    const folder: LibraryFolder = {
      id: stableDocumentId(`folder:${path}`),
      path,
      name: folderNameFromPath(path),
      lastScannedAt: new Date().toISOString(),
    };
    await rescanFolder(folder);
  }, [rescanFolder]);

  const updateTags = useCallback(
    async (documentId: string, tags: string[]) => {
      await setDocumentTags(documentId, tags);
      setDocuments((current) =>
        current.map((document) =>
          document.id === documentId ? { ...document, tags } : document,
        ),
      );
      setReaderDocument((current) =>
        current?.id === documentId ? { ...current, tags } : current,
      );
    },
    [],
  );

  const updatePane = useCallback(
    (paneId: PaneId, update: Partial<ViewState>) => {
      if (!pageCount) return;
      setPaneStates((current) => {
        const next = mergeViewState(current[paneId], update, pageCount);
        if (syncEnabled) return { original: next, companion: next };
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
      const anchor = normalizeAnchor(
        { pageNumber, relativeOffsetY: 0 },
        pageCount,
      );
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

  const rotate = useCallback(() => {
    updateFromToolbar({
      rotation: normalizeRotation(activeState.rotation + 90),
    });
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

  const startTranslation = useCallback(
    async (scope: TranslationScopeRequest) => {
      if (!readerDocument || !settings) return;
      if (!blocks.length) {
        setError("텍스트 분석이 끝난 뒤 번역할 수 있습니다.");
        return;
      }
      const documentId = readerDocument.id;
      const runId = translationRunRef.current + 1;
      translationRunRef.current = runId;
      cancelTranslationRef.current = false;
      const ownsActiveDocument = () =>
        translationRunRef.current === runId &&
        currentDocumentIdRef.current === documentId;
      setError(null);
      setToolTab("translation");
      let availableBlocks = blocks.filter((block) => block.translatable);
      if (scope.kind === "page") {
        availableBlocks = availableBlocks.filter(
          (block) => block.pageNumber === scope.pageNumber,
        );
      } else if (scope.kind === "range") {
        const start = Math.max(1, Math.min(scope.startPage, scope.endPage));
        const end = Math.min(pageCount, Math.max(scope.startPage, scope.endPage));
        availableBlocks = availableBlocks.filter(
          (block) => block.pageNumber >= start && block.pageNumber <= end,
        );
      } else if (scope.kind === "selection") {
        if (!selection) {
          setError("먼저 번역할 텍스트를 선택해 주세요.");
          return;
        }
        const selectionBlock: DocumentBlock = {
          id: `${readerDocument.id}-selection-${stableDocumentId(selection.text)}`,
          documentId: readerDocument.id,
          pageNumber: selection.pageNumber,
          type: "paragraph",
          text: selection.text,
          bbox: unionRects(selection.rects),
          readingOrder: 100000,
          translatable: true,
        };
        availableBlocks = [selectionBlock];
        if (!blocks.some((block) => block.id === selectionBlock.id)) {
          const nextBlocks = [...blocks, selectionBlock];
          setBlocks(nextBlocks);
          await saveDocumentBlocks(readerDocument.id, nextBlocks);
          if (!ownsActiveDocument()) return;
        }
      } else if (scope.kind === "failed") {
        const failedIds = new Set(
          translations
            .filter((translation) => translation.status === "failed")
            .map((translation) => translation.blockId),
        );
        availableBlocks = availableBlocks.filter((block) =>
          failedIds.has(block.id),
        );
      }

      const cached = new Map(
        translations
          .filter(
            (translation) =>
              translation.targetLanguage === settings.targetLanguage &&
              translation.status === "translated",
          )
          .map((translation) => [translation.blockId, translation]),
      );
      const targetBlocks =
        scope.kind === "failed"
          ? availableBlocks
          : availableBlocks.filter(
              (block) =>
                cached.get(block.id)?.sourceText !== block.text,
            );
      if (!targetBlocks.length) {
        setNotice("선택한 범위는 이미 번역되어 있습니다.");
        return;
      }

      const now = new Date().toISOString();
      let job: TranslationJob = {
        id: createId("translation"),
        documentId: readerDocument.id,
        status: "running",
        totalBlocks: targetBlocks.length,
        completedBlocks: 0,
        failedBlockIds: [],
        startedAt: now,
        updatedAt: now,
      };
      setTranslationJob(job);
      await saveTranslationJob(job);
      const collected = new Map(translations.map((item) => [item.id, item]));

      for (let index = 0; index < targetBlocks.length; index += 6) {
        if (cancelTranslationRef.current || !ownsActiveDocument()) break;
        const batch = targetBlocks.slice(index, index + 6);
        try {
          const response = await completeChat(
            settings,
            translationMessages(
              settings.targetLanguage,
              batch.map((block) => ({
                id: block.id,
                type: block.type,
                text: block.text,
              })),
              settings.instructions,
            ),
          );
          const parsed = parseTranslationResponse(
            response,
            batch.map((block) => block.id),
          );
          const records = parsed.map((result) => {
            const block = batch.find(
              (candidate) => candidate.id === result.blockId,
            )!;
            return makeTranslationRecord(
              readerDocument.id,
              block.id,
              block.text,
              result.text,
              settings.targetLanguage,
            );
          });
          await saveTranslations(records);
          for (const record of records) collected.set(record.id, record);
          job = {
            ...job,
            completedBlocks: job.completedBlocks + batch.length,
            updatedAt: new Date().toISOString(),
          };
        } catch (cause) {
          const message =
            cause instanceof Error ? cause.message : "번역 요청 실패";
          const failed = batch.map<TranslationRecord>((block) => ({
            id: `${block.id}:${settings.targetLanguage}`,
            documentId: readerDocument.id,
            blockId: block.id,
            targetLanguage: settings.targetLanguage,
            sourceText: block.text,
            translatedText: "",
            status: "failed",
            error: message,
            updatedAt: new Date().toISOString(),
          }));
          await saveTranslations(failed);
          for (const record of failed) collected.set(record.id, record);
          job = {
            ...job,
            completedBlocks: job.completedBlocks + batch.length,
            failedBlockIds: [
              ...job.failedBlockIds,
              ...batch.map((block) => block.id),
            ],
            updatedAt: new Date().toISOString(),
          };
        }
        if (ownsActiveDocument()) {
          setTranslations([...collected.values()]);
          setTranslationJob(job);
        }
        await saveTranslationJob(job);
      }

      const interrupted =
        cancelTranslationRef.current || !ownsActiveDocument();
      const finalJob: TranslationJob = {
        ...job,
        status: interrupted
          ? "cancelled"
          : job.failedBlockIds.length === job.totalBlocks
            ? "failed"
            : "completed",
        updatedAt: new Date().toISOString(),
      };
      await saveTranslationJob(finalJob);
      if (!ownsActiveDocument()) return;
      setTranslationJob(finalJob);
      const translatedIds = new Set(
        [...collected.values()]
          .filter((item) => item.status === "translated")
          .map((item) => item.blockId),
      );
      const translatableCount = Math.max(
        1,
        blocks.filter((block) => block.translatable).length,
      );
      const nextDocument = {
        ...readerDocument,
        translationProgress: Math.min(
          1,
          translatedIds.size / translatableCount,
        ),
      };
      setReaderDocument(nextDocument);
      await saveDocument(nextDocument);
      await refreshLibrary();
    },
    [
      blocks,
      pageCount,
      readerDocument,
      refreshLibrary,
      selection,
      settings,
      translations,
    ],
  );

  const editTranslation = useCallback(
    async (translation: TranslationRecord, text: string) => {
      const next = {
        ...translation,
        translatedText: text.trim(),
        status: "translated" as const,
        error: undefined,
        updatedAt: new Date().toISOString(),
      };
      setTranslations((current) =>
        current.map((candidate) =>
          candidate.id === next.id ? next : candidate,
        ),
      );
      await saveTranslations([next]);
    },
    [],
  );

  const lookupWord = useCallback(
    async (nextSelection: TextSelection) => {
      if (!readerDocument || !settings) return;
      const word = nextSelection.text.trim();
      if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return;
      const documentId = readerDocument.id;
      const runId = dictionaryRunRef.current + 1;
      dictionaryRunRef.current = runId;
      const ownsActiveDocument = () =>
        dictionaryRunRef.current === runId &&
        currentDocumentIdRef.current === documentId;
      setSelection(nextSelection);
      setDictionaryLoading(true);
      setDictionaryEntry(null);
      setError(null);
      try {
        const cached = await findDictionaryEntry(
          readerDocument.id,
          word,
          nextSelection.context,
        );
        if (cached) {
          if (ownsActiveDocument()) setDictionaryEntry(cached);
          return;
        }
        const response = await completeChat(
          settings,
          dictionaryMessages(
            word,
            nextSelection.context,
            settings.targetLanguage,
          ),
        );
        const parsed = parseDictionaryResponse(response);
        const entry: DictionaryEntry = {
          id: createId("dictionary"),
          documentId: readerDocument.id,
          word,
          context: nextSelection.context,
          ...parsed,
          createdAt: new Date().toISOString(),
        };
        await saveDictionaryEntry(entry);
        if (ownsActiveDocument()) setDictionaryEntry(entry);
      } catch (cause) {
        if (ownsActiveDocument()) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (ownsActiveDocument()) setDictionaryLoading(false);
      }
    },
    [readerDocument, settings],
  );

  const addHighlightFromSelection = useCallback(
    async (color: string) => {
      if (!readerDocument || !selection) return;
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
      setToolTab("highlights");
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    },
    [readerDocument, selection],
  );

  const addNote = useCallback(
    async (markdown: string) => {
      if (!readerDocument) return;
      const now = new Date().toISOString();
      const note: Note = {
        id: createId("note"),
        documentId: readerDocument.id,
        scope: selection ? "selection" : "page",
        pageNumber: selection?.pageNumber ?? paneStates.original.pageNumber,
        source: selection?.source,
        selectedText: selection?.text,
        rects: selection?.rects,
        markdown,
        createdAt: now,
        updatedAt: now,
      };
      await saveNote(note);
      setNotes((current) => [note, ...current]);
      setToolTab("notes");
    },
    [paneStates.original.pageNumber, readerDocument, selection],
  );

  const updateNote = useCallback(async (note: Note, markdown: string) => {
    const next = {
      ...note,
      markdown,
      updatedAt: new Date().toISOString(),
    };
    await saveNote(next);
    setNotes((current) =>
      current.map((candidate) => (candidate.id === next.id ? next : candidate)),
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

  const askQuestion = useCallback(
    async (
      question: string,
      scope: "selection" | "page" | "blocks",
      blockIds: string[],
    ) => {
      if (!readerDocument || !settings) return;
      const documentId = readerDocument.id;
      const runId = questionRunRef.current + 1;
      questionRunRef.current = runId;
      const ownsActiveDocument = () =>
        questionRunRef.current === runId &&
        currentDocumentIdRef.current === documentId;
      const sourceText =
        scope === "selection" && selection
          ? selection.text
          : scope === "blocks"
            ? blocks
                .filter((block) => blockIds.includes(block.id))
                .map((block) => block.text)
                .join("\n")
          : blocks
              .filter(
                (block) => block.pageNumber === paneStates.original.pageNumber,
              )
              .map((block) => block.text)
              .join("\n");
      if (!sourceText.trim()) {
        setError("질문에 사용할 원문을 찾지 못했습니다.");
        return;
      }
      setAsking(true);
      setError(null);
      setToolTab("ask");
      const now = new Date().toISOString();
      const existing = sessions[0];
      const session: ChatSession =
        existing ??
        {
          id: createId("chat"),
          documentId: readerDocument.id,
          title: question.slice(0, 50),
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
      const userMessage: ChatMessage = {
        id: createId("message"),
        sessionId: session.id,
        role: "user",
        content: question,
        sourceText,
        createdAt: now,
      };
      const withQuestion = {
        ...session,
        messages: [...session.messages, userMessage],
        updatedAt: now,
      };
      setSessions((current) => [
        withQuestion,
        ...current.filter((candidate) => candidate.id !== session.id),
      ]);
      await saveChatSession(withQuestion);
      if (!ownsActiveDocument()) return;

      try {
        const answer = await completeChat(
          settings,
          questionMessages(question, sourceText, settings.targetLanguage),
        );
        for (let length = 12; length < answer.length; length += 12) {
          if (!ownsActiveDocument()) return;
          setStreamingAnswer(answer.slice(0, length));
          await wait(12);
        }
        if (!ownsActiveDocument()) return;
        setStreamingAnswer(answer);
        const assistantMessage: ChatMessage = {
          id: createId("message"),
          sessionId: session.id,
          role: "assistant",
          content: answer,
          sourceText,
          createdAt: new Date().toISOString(),
        };
        const completed = {
          ...withQuestion,
          messages: [...withQuestion.messages, assistantMessage],
          updatedAt: assistantMessage.createdAt,
        };
        await saveChatSession(completed);
        if (!ownsActiveDocument()) return;
        setSessions((current) => [
          completed,
          ...current.filter((candidate) => candidate.id !== session.id),
        ]);
        setStreamingAnswer("");
      } catch (cause) {
        if (ownsActiveDocument()) {
          setStreamingAnswer("");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (ownsActiveDocument()) setAsking(false);
      }
    },
    [
      blocks,
      paneStates.original.pageNumber,
      readerDocument,
      selection,
      sessions,
      settings,
    ],
  );

  const saveAnswerAsNote = useCallback(
    async (answer: string) => {
      await addNote(`## LLM 답변\n\n${answer}`);
    },
    [addNote],
  );

  const saveSettings = useCallback(async (next: LlmSettings) => {
    await saveLlmSettings(next);
    setSettings(next);
    setSettingsOpen(false);
    setNotice("LLM 설정을 저장했습니다.");
  }, []);

  const testSettings = useCallback(async (draft: LlmSettings) => {
    setSettingsTesting(true);
    setError(null);
    try {
      await completeChat(draft, [
        {
          role: "user",
          content: "Reply with exactly OK.",
        },
      ]);
      setNotice("LLM 연결에 성공했습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsTesting(false);
    }
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
        translationRunning={translationJob?.status === "running"}
        onOpen={() => void openPdf()}
        onPage={setPage}
        onZoom={setZoom}
        onFit={(scaleValue) => updateFromToolbar({ scaleValue })}
        onRotate={rotate}
        onSplitMode={changeSplitMode}
        onToggleSync={toggleSync}
        onTranslatePage={() =>
          void startTranslation({
            kind: "page",
            pageNumber: paneStates.original.pageNumber,
          })
        }
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="workspace">
        <Sidebar
          documents={documents}
          folders={folders}
          activeDocumentId={readerDocument?.id}
          scanning={scanning}
          onOpenDocument={(document) => void openLibraryDocument(document)}
          onAddFolder={() => void addLibraryFolder()}
          onRescanFolder={(folder) => void rescanFolder(folder)}
          onSetTags={(documentId, tags) => void updateTags(documentId, tags)}
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
          {notice && (
            <div className="notice-banner" role="status">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="닫기">
                <X size={15} />
              </button>
            </div>
          )}

          {(loading || analyzing) && (
            <div className="global-loading">
              <LoaderCircle className="spin" size={22} />
              <span>
                {loading
                  ? "논문을 여는 중"
                  : `텍스트 분석 중 · ${Math.round(analysisProgress * 100)}%`}
              </span>
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
                blocks={blocks}
                translations={translations}
                highlights={highlights}
                references={references}
                translationOverlay={false}
                onActivate={setActivePane}
                onUpdate={updatePane}
                onSelection={setSelection}
                onWordLookup={(nextSelection) => void lookupWord(nextSelection)}
                onReference={setSelectedReference}
                onEditTranslation={(translation, text) =>
                  void editTranslation(translation, text)
                }
              />
              {splitMode !== "single" && (
                <PdfPane
                  document={pdfDocument}
                  paneId="companion"
                  label="번역 뷰"
                  detail={`${settings?.targetLanguage ?? "ko"} · HTML overlay`}
                  targetState={paneStates.companion}
                  active={activePane === "companion"}
                  blocks={blocks}
                  translations={translations}
                  highlights={highlights}
                  references={references}
                  translationOverlay={translationOverlay}
                  onActivate={setActivePane}
                  onUpdate={updatePane}
                  onSelection={setSelection}
                  onWordLookup={(nextSelection) => void lookupWord(nextSelection)}
                  onReference={setSelectedReference}
                  onEditTranslation={(translation, text) =>
                    void editTranslation(translation, text)
                  }
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
            <span>
              {readerDocument?.filePath ?? "원본 파일은 수정되지 않습니다"}
            </span>
            <span>
              {readerDocument
                ? `p. ${paneStates.original.pageNumber} · ${Math.round(
                    paneStates.original.scale * 100,
                  )}% · ${paneStates.original.rotation}° · 번역 ${Math.round(
                    (readerDocument.translationProgress ?? 0) * 100,
                  )}%`
                : "Paperloom 0.2.0"}
            </span>
          </footer>
        </div>

        <ToolRail
          activeTab={toolTab}
          hasDocument={Boolean(readerDocument)}
          pageNumber={paneStates.original.pageNumber}
          pageCount={pageCount}
          blocks={blocks}
          translations={translations}
          translationJob={translationJob}
          selection={selection}
          highlights={highlights}
          notes={notes}
          sessions={sessions}
          references={references}
          dictionaryEntry={dictionaryEntry}
          dictionaryLoading={dictionaryLoading}
          asking={asking}
          streamingAnswer={streamingAnswer}
          error={null}
          onTab={setToolTab}
          onTranslate={(scope) => void startTranslation(scope)}
          onCancelTranslation={() => {
            cancelTranslationRef.current = true;
          }}
          onEditTranslation={(translation, text) =>
            void editTranslation(translation, text)
          }
          onAsk={(question, scope, blockIds) =>
            void askQuestion(question, scope, blockIds)
          }
          onCopy={(text) => void navigator.clipboard.writeText(text)}
          onSaveAnswerAsNote={(text) => void saveAnswerAsNote(text)}
          onAddNote={(markdown) => void addNote(markdown)}
          onUpdateNote={(note, markdown) => void updateNote(note, markdown)}
          onDeleteNote={(id) => void removeNote(id)}
          onDeleteHighlight={(id) => void removeHighlight(id)}
          onGoToPage={setPage}
          onOpenReference={setSelectedReference}
          onCloseDictionary={() => setDictionaryEntry(null)}
        />
      </div>

      {selection && (
        <div
          className="selection-toolbar"
          style={{
            left: Math.min(selection.clientX, window.innerWidth - 280),
            top: Math.max(64, selection.clientY - 52),
          }}
        >
          <button
            type="button"
            title="하이라이트"
            onClick={() => void addHighlightFromSelection("rgba(255, 214, 92, .42)")}
          >
            <Bookmark size={14} />
          </button>
          <button
            type="button"
            title="메모"
            onClick={() => setToolTab("notes")}
          >
            <StickyNote size={14} />
          </button>
          <button
            type="button"
            title="선택 영역 번역"
            onClick={() => void startTranslation({ kind: "selection" })}
          >
            <Languages size={14} />
          </button>
          <button type="button" title="질문" onClick={() => setToolTab("ask")}>
            <MessageSquareText size={14} />
          </button>
          <button
            type="button"
            title="선택 메뉴 닫기"
            onClick={() => setSelection(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          testing={settingsTesting}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => void saveSettings(next)}
          onTest={(draft) => void testSettings(draft)}
        />
      )}

      {selectedReference && pdfDocument && (
        <FigurePreview
          document={pdfDocument}
          reference={selectedReference}
          onClose={() => setSelectedReference(null)}
          onGoToPage={(pageNumber) => {
            setPage(pageNumber);
            setSelectedReference(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
