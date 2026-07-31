import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Bookmark,
  Download,
  FileWarning,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  RefreshCw,
  StickyNote,
  X,
} from "lucide-react";
import { EmptyReader } from "./components/EmptyReader";
import { FigurePreview } from "./components/FigurePreview";
import { KoreanPaperEmpty } from "./components/KoreanPaperEmpty";
import { KoreanPaperEditor } from "./components/KoreanPaperEditor";
import { PdfPane } from "./components/PdfPane";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { ToolRail } from "./components/ToolRail";
import { TopBar } from "./components/TopBar";
import { useDictionaryLookup } from "./hooks/useDictionaryLookup";
import { useDocumentSession } from "./hooks/useDocumentSession";
import { useKoreanPaperCreation } from "./hooks/useKoreanPaperCreation";
import { useModelSettings } from "./hooks/useModelSettings";
import { usePaperAsk } from "./hooks/usePaperAsk";
import { resolveDocumentReferences } from "./lib/document-references";
import {
  attachReferencePreviewTargets,
  buildCompanionReferences,
  nextReferencePreviewHoverState,
  referencePreviewCaption,
  translatedReferenceCaption,
  type ReferencePreviewHoverEvent,
  type ReferencePreviewPane,
} from "./lib/reference-preview";
import { observeClearedTextSelection } from "./lib/selection-toolbar";
import { analyzeSemanticPaper } from "./lib/semantic-paper";
import type {
  DocumentReference,
  LlmSettings,
  LlmUsageByPhase,
  PaneId,
  ReferenceAnchor,
  ReadingToolTab,
  TextSelection,
} from "./types";

function tokenUsageLabel(usage: LlmUsageByPhase): string {
  const suffix = usage.total.estimated ? " · 추정" : "";
  return `구조 ${usage.structure.totalTokens.toLocaleString()} · 번역 ${usage.translation.totalTokens.toLocaleString()} · 합계 ${usage.total.totalTokens.toLocaleString()} 토큰${suffix}`;
}

function App() {
  const [activePane, setActivePane] = useState<PaneId>("original");
  const [expandedPane, setExpandedPane] = useState<PaneId | null>(null);
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [selectedReference, setSelectedReference] = useState<{
    reference: DocumentReference;
    anchor: ReferenceAnchor;
    pane: ReferencePreviewPane;
    pinned: boolean;
  } | null>(null);
  const [toolTab, setToolTab] = useState<ReadingToolTab>("ask");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const browserInputRef = useRef<HTMLInputElement>(null);
  const referenceCloseTimerRef = useRef<number | null>(null);
  const referenceHoverStateRef = useRef({
    token: false,
    card: false,
    pinned: false,
    open: false,
  });
  const requestBrowserFile = useCallback(
    () => browserInputRef.current?.click(),
    [],
  );
  const {
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
    openPdf,
    openBrowserFile,
    openLibraryDocument,
    prepareCompanion,
    updatePane,
    updateDocument,
    addHighlight: addSessionHighlight,
    addNote: addSessionNote,
    updateNote,
    removeNote,
    removeHighlight,
  } = useDocumentSession({
    settings,
    onSettingsChange: setSettings,
    requestBrowserFile,
    onError: setError,
    onNotice: setNotice,
  });
  const {
    entry: dictionaryEntry,
    loading: dictionaryLoading,
    lookup: lookupWord,
    close: closeDictionary,
  } = useDictionaryLookup({
    document: readerDocument,
    settings,
    getActiveDocumentId,
    onError: setError,
  });

  const resolvedReferences = useMemo(
    () => resolveDocumentReferences(blocks),
    [blocks],
  );
  const semanticPaper = useMemo(
    () => analyzeSemanticPaper(blocks, resolvedReferences),
    [blocks, resolvedReferences],
  );
  const references = useMemo(
    () =>
      attachReferencePreviewTargets(
        blocks,
        resolvedReferences,
        semanticPaper.assets,
      ),
    [blocks, resolvedReferences, semanticPaper.assets],
  );
  const {
    document: koreanDocument,
    blocks: koreanBlocks,
    translations,
    project: retypesetProject,
    build: koreanBuild,
    editing: editingKorean,
    setEditing: setEditingKorean,
    replaceProject: setRetypesetProject,
    buildPaper: buildKoreanPaper,
    applyEdits: applyKoreanEdits,
    exportPaper: exportKoreanPaper,
  } = useKoreanPaperCreation({
    document: readerDocument,
    settings,
    sourceBlocks: blocks,
    paper: semanticPaper,
    references,
    hydration,
    getSourceBytes,
    getActiveDocumentId,
    onSettingsChange: setSettings,
    onDocumentChange: updateDocument,
    onCompanionReady: prepareCompanion,
    onError: setError,
    onNotice: setNotice,
  });
  const {
    activeProfile,
    models: paperModels,
    activeModelId,
    effortOptions,
    open: settingsOpen,
    testing: settingsTesting,
    setOpen: setSettingsOpen,
    selectModel: selectPaperModel,
    selectEffort: selectReasoningEffort,
    save: saveSettings,
    test: testSettings,
  } = useModelSettings({
    settings,
    onSettingsChange: setSettings,
    document: readerDocument,
    onDocumentChange: updateDocument,
    project: retypesetProject,
    onProjectChange: setRetypesetProject,
    onError: setError,
    onNotice: setNotice,
  });
  const structuredBlocks =
    retypesetProject?.documentStructure?.blocks ?? [];
  const storedStructuredReferences =
    retypesetProject?.documentStructure?.references;
  const structuredResolvedReferences = useMemo(
    () =>
      structuredBlocks.length
        ? resolveDocumentReferences(
            structuredBlocks,
            storedStructuredReferences,
          )
        : resolvedReferences,
    [
      resolvedReferences,
      storedStructuredReferences,
      structuredBlocks,
    ],
  );
  const structuredPaper = useMemo(
    () =>
      structuredBlocks.length
        ? analyzeSemanticPaper(
            structuredBlocks,
            structuredResolvedReferences,
          )
        : semanticPaper,
    [semanticPaper, structuredBlocks, structuredResolvedReferences],
  );
  const structuredReferences = useMemo(
    () =>
      structuredBlocks.length
        ? attachReferencePreviewTargets(
            structuredBlocks,
            structuredResolvedReferences,
            structuredPaper.assets,
          )
        : references,
    [
      references,
      structuredBlocks,
      structuredPaper.assets,
      structuredResolvedReferences,
    ],
  );
  const sourcePreviewReferences = useMemo(
    () =>
      structuredBlocks.length
        ? structuredReferences
        : references,
    [references, structuredBlocks.length, structuredReferences],
  );
  const koreanReferences = useMemo(
    () =>
      buildCompanionReferences(
        koreanBlocks,
        structuredReferences,
      ),
    [koreanBlocks, structuredReferences],
  );
  const selectedPreviewCaption = useMemo(() => {
    if (!selectedReference) return undefined;
    const { pane, reference } = selectedReference;
    const previewBlocks =
      pane === "source" && !structuredBlocks.length
        ? blocks
        : structuredBlocks;
    const sourceCaption = previewBlocks.find(
      (block) => block.id === reference.targetBlockId,
    )?.text;
    const translatedCaption = translatedReferenceCaption(
      reference,
      structuredBlocks,
      translations,
      structuredPaper.translatableBlockIds,
    );
    return referencePreviewCaption(
      pane,
      sourceCaption,
      translatedCaption,
    );
  }, [
    blocks,
    selectedReference,
    structuredBlocks,
    structuredPaper.translatableBlockIds,
    translations,
  ]);
  const activateAsk = useCallback(() => setToolTab("ask"), []);
  const {
    sessions,
    asking,
    streamingAnswer,
    ask: askQuestion,
  } = usePaperAsk({
    document: readerDocument,
    settings,
    pageCount: pdfDocument?.numPages ?? 0,
    blocks,
    paper: semanticPaper,
    selection,
    project: retypesetProject,
    hydration,
    getPdfBytes: getSourceBytes,
    getActiveDocumentId,
    onProjectChange: setRetypesetProject,
    onError: setError,
    onActivate: activateAsk,
  });

  useEffect(() => {
    return () => {
      if (referenceCloseTimerRef.current !== null) {
        window.clearTimeout(referenceCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(
    () =>
      observeClearedTextSelection(
        document,
        () => window.getSelection(),
        () => setSelection(null),
      ),
    [],
  );

  useEffect(() => {
    setSelection(null);
    setSelectedReference(null);
    referenceHoverStateRef.current = {
      token: false,
      card: false,
      pinned: false,
      open: false,
    };
    setActivePane("original");
    setExpandedPane(null);
  }, [readerDocument?.id]);

  const addHighlightFromSelection = useCallback(
    async (color: string) => {
      if (!selection) return;
      await addSessionHighlight(selection, color);
      setToolTab("highlights");
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    },
    [addSessionHighlight, selection],
  );

  const addNote = useCallback(
    async (markdown: string) => {
      await addSessionNote(markdown, selection);
      setToolTab("notes");
    },
    [addSessionNote, selection],
  );

  const saveAnswerAsNote = useCallback(
    async (answer: string) => {
      await addNote(`## Ask 답변\n\n${answer}`);
    },
    [addNote],
  );

  const goToSourcePage = useCallback(
    (pageNumber: number) => {
      updatePane("original", { pageNumber, relativeOffsetY: 0 });
      setActivePane("original");
      if (expandedPane === "companion") setExpandedPane(null);
    },
    [expandedPane, updatePane],
  );

  const clearReferencePreviewCloseTimer = useCallback(() => {
    if (referenceCloseTimerRef.current !== null) {
      window.clearTimeout(referenceCloseTimerRef.current);
      referenceCloseTimerRef.current = null;
    }
  }, []);

  const updateReferenceHover = useCallback(
    (event: ReferencePreviewHoverEvent) => {
      referenceHoverStateRef.current =
        nextReferencePreviewHoverState(
          referenceHoverStateRef.current,
          event,
        );
      return referenceHoverStateRef.current;
    },
    [],
  );

  const openReferencePreview = useCallback(
    (
      paneId: PaneId,
      reference: DocumentReference,
      anchor: ReferenceAnchor,
    ) => {
      if (referenceHoverStateRef.current.pinned) return;
      clearReferencePreviewCloseTimer();
      referenceHoverStateRef.current = {
        token: false,
        card: false,
        pinned: false,
        open: false,
      };
      updateReferenceHover("token-enter");
      setSelectedReference({
        reference,
        anchor,
        pane: paneId === "original" ? "source" : "korean",
        pinned: false,
      });
    },
    [clearReferencePreviewCloseTimer, updateReferenceHover],
  );

  const pinReferencePreview = useCallback(
    (
      paneId: PaneId,
      reference: DocumentReference,
      anchor: ReferenceAnchor,
    ) => {
      clearReferencePreviewCloseTimer();
      referenceHoverStateRef.current = {
        token: true,
        card: false,
        pinned: false,
        open: true,
      };
      updateReferenceHover("pin");
      setSelectedReference({
        reference,
        anchor,
        pane: paneId === "original" ? "source" : "korean",
        pinned: true,
      });
    },
    [clearReferencePreviewCloseTimer, updateReferenceHover],
  );

  const closePinnedReferencePreview = useCallback(() => {
    clearReferencePreviewCloseTimer();
    referenceHoverStateRef.current = {
      token: false,
      card: false,
      pinned: false,
      open: false,
    };
    setSelectedReference(null);
  }, [clearReferencePreviewCloseTimer]);

  const scheduleReferencePreviewClose = useCallback(() => {
    clearReferencePreviewCloseTimer();
    referenceCloseTimerRef.current = window.setTimeout(() => {
      const next = updateReferenceHover("close-timeout");
      if (!next.open) setSelectedReference(null);
      referenceCloseTimerRef.current = null;
    }, 220);
  }, [clearReferencePreviewCloseTimer, updateReferenceHover]);

  const leaveReferenceToken = useCallback(() => {
    updateReferenceHover("token-leave");
    scheduleReferencePreviewClose();
  }, [scheduleReferencePreviewClose, updateReferenceHover]);

  const enterReferenceCard = useCallback(() => {
    clearReferencePreviewCloseTimer();
    updateReferenceHover("card-enter");
  }, [clearReferencePreviewCloseTimer, updateReferenceHover]);

  const leaveReferenceCard = useCallback(() => {
    updateReferenceHover("card-leave");
    scheduleReferencePreviewClose();
  }, [scheduleReferencePreviewClose, updateReferenceHover]);

  const statusText = readerDocument
    ? `원문·한국어 독립 보기 · ${
        koreanDocument ? "저장된 한국어 논문" : "한국어 논문 미생성"
      }`
    : "준비됨";

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
        models={paperModels}
        activeModelId={activeModelId}
        effortOptions={effortOptions}
        effort={settings?.effort ?? "default"}
        onOpen={() => void openPdf()}
        onModel={(modelId) => void selectPaperModel(modelId)}
        onEffort={(effort) => void selectReasoningEffort(effort)}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="workspace">
        <Sidebar
          documents={documents}
          activeDocumentId={readerDocument?.id}
          onOpenDocument={(document) => void openLibraryDocument(document)}
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
                  : `논문 구조 분석 중 · ${Math.round(analysisProgress * 100)}%`}
              </span>
            </div>
          )}

          {!pdfDocument ? (
            <EmptyReader onOpen={() => void openPdf()} />
          ) : (
            <main
              className={`reader-grid reader-grid--bilingual ${
                expandedPane ? `reader-grid--expanded-${expandedPane}` : ""
              }`}
            >
              <PdfPane
                document={pdfDocument}
                paneId="original"
                label="영어 원문"
                detail={readerDocument?.title ?? ""}
                targetState={paneStates.original}
                active={activePane === "original"}
                expanded={expandedPane === "original"}
                blocks={blocks}
                highlights={highlights}
                references={sourcePreviewReferences}
                onActivate={setActivePane}
                onUpdate={updatePane}
                onToggleExpand={(paneId) =>
                  setExpandedPane((current) =>
                    current === paneId ? null : paneId,
                  )
                }
                onSelection={setSelection}
                onWordLookup={(nextSelection) => void lookupWord(nextSelection)}
                onReferenceEnter={openReferencePreview}
                onReferencePin={pinReferencePreview}
                onReferenceLeave={leaveReferenceToken}
              />

              {koreanDocument ? (
                <div className="korean-pane-shell">
                  <div className="korean-pane-actions">
                    {retypesetProject?.tokenUsage && (
                      <small className="korean-token-usage">
                        {tokenUsageLabel(retypesetProject.tokenUsage)}
                      </small>
                    )}
                    <button
                      type="button"
                      disabled={koreanBuild.phase !== "idle"}
                      onClick={() => setEditingKorean(true)}
                    >
                      <Pencil size={14} />
                      내용 수정
                    </button>
                    <button
                      type="button"
                      disabled={koreanBuild.phase !== "idle"}
                      onClick={() => void exportKoreanPaper()}
                    >
                      <Download size={14} />
                      PDF 내보내기
                    </button>
                    <button
                      type="button"
                      disabled={koreanBuild.phase !== "idle"}
                      onClick={() => void buildKoreanPaper(true)}
                    >
                      <RefreshCw size={14} />
                      다시 만들기
                    </button>
                  </div>
                  {koreanBuild.phase !== "idle" && (
                    <div className="korean-build-banner" role="status">
                      <LoaderCircle className="spin" size={14} />
                      <span>{koreanBuild.message}</span>
                      {koreanBuild.total > 0 && (
                        <small>
                          {koreanBuild.completed} / {koreanBuild.total}
                        </small>
                      )}
                      {koreanBuild.tokenUsage && (
                        <small>
                          {tokenUsageLabel(koreanBuild.tokenUsage)}
                        </small>
                      )}
                    </div>
                  )}
                  <PdfPane
                    document={koreanDocument}
                    paneId="companion"
                    label="한국어 논문"
                    detail="자동 생성된 로컬 재조판본"
                    targetState={paneStates.companion}
                    active={activePane === "companion"}
                    expanded={expandedPane === "companion"}
                    blocks={koreanBlocks}
                    highlights={highlights}
                    references={koreanReferences}
                    onActivate={setActivePane}
                    onUpdate={updatePane}
                    onToggleExpand={(paneId) =>
                      setExpandedPane((current) =>
                        current === paneId ? null : paneId,
                      )
                    }
                    onSelection={setSelection}
                    onWordLookup={(nextSelection) =>
                      void lookupWord(nextSelection)
                    }
                    onReferenceEnter={openReferencePreview}
                    onReferencePin={pinReferencePreview}
                    onReferenceLeave={leaveReferenceToken}
                  />
                  {editingKorean && (
                    <KoreanPaperEditor
                      key={retypesetProject?.updatedAt ?? "editor"}
                      blocks={
                        retypesetProject?.documentStructure?.blocks ??
                        blocks
                      }
                      translations={translations}
                      saving={koreanBuild.phase !== "idle"}
                      onCancel={() => setEditingKorean(false)}
                      onSave={(edits) => void applyKoreanEdits(edits)}
                    />
                  )}
                </div>
              ) : (
                <KoreanPaperEmpty
                  analyzing={analyzing || !blocks.length}
                  working={koreanBuild.phase !== "idle"}
                  progressMessage={koreanBuild.message}
                  completed={koreanBuild.completed}
                  total={koreanBuild.total}
                  tokenUsage={
                    koreanBuild.tokenUsage ??
                    retypesetProject?.tokenUsage
                  }
                  modelName={activeProfile?.name ?? ""}
                  onCreate={() => void buildKoreanPaper(false)}
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
                ? `원문 p.${paneStates.original.pageNumber} · 한국어 ${
                    koreanDocument ? `p.${paneStates.companion.pageNumber}` : "—"
                  }`
                : "Paperloom 0.3.0"}
            </span>
          </footer>
        </div>

        <ToolRail
          activeTab={toolTab}
          hasDocument={Boolean(readerDocument)}
          selection={selection}
          highlights={highlights}
          notes={notes}
          sessions={sessions}
          references={sourcePreviewReferences}
          dictionaryEntry={dictionaryEntry}
          dictionaryLoading={dictionaryLoading}
          asking={asking}
          streamingAnswer={streamingAnswer}
          error={null}
          onTab={setToolTab}
          onAsk={(question) => void askQuestion(question)}
          onCopy={(text) => void navigator.clipboard.writeText(text)}
          onSaveAnswerAsNote={(text) => void saveAnswerAsNote(text)}
          onAddNote={(markdown) => void addNote(markdown)}
          onUpdateNote={(note, markdown) => void updateNote(note, markdown)}
          onDeleteNote={(id) => void removeNote(id)}
          onDeleteHighlight={(id) => void removeHighlight(id)}
          onGoToPage={goToSourcePage}
          onOpenReference={(reference) =>
            openReferencePreview(
              "original",
              reference,
              {
                left: window.innerWidth - 340,
                top: 104,
                right: window.innerWidth - 320,
                bottom: 120,
                width: 20,
                height: 16,
              },
            )
          }
          onCloseDictionary={closeDictionary}
        />
      </div>

      {selection && (
        <div
          className="selection-toolbar"
          onPointerDown={(event) => event.preventDefault()}
          style={{
            left: Math.min(selection.clientX, window.innerWidth - 230),
            top: Math.max(64, selection.clientY - 52),
          }}
        >
          <button
            type="button"
            title="하이라이트"
            onClick={() =>
              void addHighlightFromSelection("rgba(255, 214, 92, .42)")
            }
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
          <button type="button" title="질문 초점으로 사용" onClick={() => setToolTab("ask")}>
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
          reference={selectedReference.reference}
          anchor={selectedReference.anchor}
          caption={selectedPreviewCaption}
          pinned={selectedReference.pinned}
          onEnter={enterReferenceCard}
          onLeave={leaveReferenceCard}
          onClose={closePinnedReferencePreview}
          onGoToPage={(pageNumber) => {
            goToSourcePage(pageNumber);
            setSelectedReference(null);
          }}
        />
      )}

    </div>
  );
}

export default App;
