import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileOutput,
  LoaderCircle,
  Lock,
  LockOpen,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRetypesetPdf } from "../lib/retypeset-pdf";
import {
  analyzeSemanticPaper,
  validateRetypesetProject,
} from "../lib/semantic-paper";
import { translatePaperSections } from "../lib/section-translator";
import {
  saveRetypesetProject,
  saveTranslations,
} from "../lib/storage";
import {
  getTypesettingPackageStatus,
  installTypesettingPackage,
  loadTypesettingFonts,
} from "../lib/typesetting-package";
import { loadPdfDocument } from "../lib/pdf";
import { saveGeneratedPdf } from "../lib/platform";
import type {
  DocumentBlock,
  DocumentReference,
  LlmSettings,
  ReaderDocument,
  RetypesetProject,
  RetypesetWarning,
  TranslationRecord,
  TypesettingPackageStatus,
} from "../types";

type RetypesetReviewDialogProps = {
  sourceDocument: PDFDocumentProxy;
  sourceBytes: Uint8Array;
  readerDocument: ReaderDocument;
  blocks: DocumentBlock[];
  references: DocumentReference[];
  translations: TranslationRecord[];
  settings: LlmSettings;
  project: RetypesetProject;
  onClose: () => void;
  onProject: (project: RetypesetProject) => void;
  onTranslations: (translations: TranslationRecord[]) => void;
  onRequestTransmissionConsent: () => Promise<boolean>;
};

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function safeFileName(title: string): string {
  const safe = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${safe || "paper"}-ko-unofficial.pdf`;
}

function PdfReviewPage({
  document,
  pageNumber,
  onPage,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  onPage: (pageNumber: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let renderTask: {
      cancel: () => void;
      promise: Promise<void>;
    } | null = null;
    void document.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = canvasRef.current;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      return renderTask.promise;
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  return (
    <div className="review-pdf-pane">
      <div className="review-page-controls">
        <button
          type="button"
          disabled={pageNumber <= 1}
          onClick={() => onPage(pageNumber - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <span>
          {pageNumber} / {document.numPages}
        </span>
        <button
          type="button"
          disabled={pageNumber >= document.numPages}
          onClick={() => onPage(pageNumber + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="review-canvas-scroll">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export function RetypesetReviewDialog({
  sourceDocument,
  sourceBytes,
  readerDocument,
  blocks,
  references,
  translations,
  settings,
  project,
  onClose,
  onProject,
  onTranslations,
  onRequestTransmissionConsent,
}: RetypesetReviewDialogProps) {
  const paper = useMemo(
    () => analyzeSemanticPaper(blocks, references),
    [blocks, references],
  );
  const [packageStatus, setPackageStatus] =
    useState<TypesettingPackageStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState({
    completed: 0,
    total: 0,
    sectionId: "",
  });
  const [generating, setGenerating] = useState(false);
  const [generatedBytes, setGeneratedBytes] = useState<Uint8Array | null>(null);
  const [generatedDocument, setGeneratedDocument] =
    useState<PDFDocumentProxy | null>(null);
  const [renderWarnings, setRenderWarnings] = useState<RetypesetWarning[]>([]);
  const [sourcePage, setSourcePage] = useState(1);
  const [translatedPage, setTranslatedPage] = useState(1);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const translationByBlock = useMemo(
    () =>
      new Map(
        translations
          .filter((item) => item.targetLanguage === project.targetLanguage)
          .map((item) => [item.blockId, item]),
      ),
    [project.targetLanguage, translations],
  );
  const validationWarnings = useMemo(
    () =>
      validateRetypesetProject(
        paper,
        blocks,
        translations,
        references,
        project,
      ),
    [blocks, paper, project, references, translations],
  );
  const warnings = useMemo(() => {
    const byId = new Map(
      [...validationWarnings, ...renderWarnings].map((warning) => [
        warning.id,
        warning,
      ]),
    );
    return [...byId.values()];
  }, [renderWarnings, validationWarnings]);
  const integrityBlockers = warnings.filter(
    (warning) => warning.severity === "integrity",
  );
  const translatableBlocks = useMemo(
    () =>
      paper.translatableBlockIds
        .map((id) => blocks.find((block) => block.id === id))
        .filter((block): block is DocumentBlock => Boolean(block)),
    [blocks, paper.translatableBlockIds],
  );

  useEffect(() => {
    void getTypesettingPackageStatus()
      .then(setPackageStatus)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const persistProject = useCallback(
    async (next: RetypesetProject) => {
      await saveRetypesetProject(next);
      onProject(next);
    },
    [onProject],
  );

  const generatePreview = useCallback(
    async (
      nextTranslations = translations,
      nextProject = project,
    ): Promise<Uint8Array | null> => {
      setGenerating(true);
      setError("");
      try {
        const status =
          packageStatus ?? (await getTypesettingPackageStatus());
        setPackageStatus(status);
        if (!status.installed) {
          throw new Error("한글 조판 패키지를 먼저 설치해 주세요.");
        }
        const fonts = await loadTypesettingFonts();
        const result = await createRetypesetPdf({
          sourceBytes,
          sourceTitle: readerDocument.title,
          blocks,
          paper,
          translations: nextTranslations,
          project: nextProject,
          serifFontBytes: fonts.serif,
          sansFontBytes: fonts.sans,
        });
        const nextDocument = await loadPdfDocument(new Uint8Array(result.bytes));
        const previous = generatedDocument;
        setGeneratedBytes(result.bytes);
        setGeneratedDocument(nextDocument);
        setRenderWarnings(result.warnings);
        setTranslatedPage((current) =>
          Math.min(current, nextDocument.numPages),
        );
        if (previous) void previous.cleanup();
        return result.bytes;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [
      blocks,
      generatedDocument,
      packageStatus,
      paper,
      project,
      readerDocument.title,
      sourceBytes,
      translations,
    ],
  );

  const installPackage = async () => {
    setInstalling(true);
    setError("");
    try {
      const status = await installTypesettingPackage((completed, total) => {
        setPackageStatus({
          installed: completed === total,
          installedBytes: completed,
          totalBytes: total,
          version: packageStatus?.version ?? "",
        });
      });
      setPackageStatus(status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  };

  const translateAllSections = async () => {
    if (!(await onRequestTransmissionConsent())) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setTranslating(true);
    setError("");
    try {
      const result = await translatePaperSections({
        title: readerDocument.title,
        paper,
        blocks,
        settings,
        project,
        existingTranslations: translations,
        signal: controller.signal,
        onCheckpoint: async (checkpoint) => {
          setTranslationProgress({
            completed: checkpoint.completed,
            total: checkpoint.total,
            sectionId: checkpoint.sectionId,
          });
          await Promise.all([
            saveTranslations(checkpoint.records),
            saveRetypesetProject(checkpoint.project),
          ]);
          onTranslations(checkpoint.records);
          onProject(checkpoint.project);
        },
      });
      await Promise.all([
        saveTranslations(result.translations),
        saveRetypesetProject(result.project),
      ]);
      onTranslations(result.translations);
      onProject(result.project);
      if (packageStatus?.installed) {
        await generatePreview(result.translations, result.project);
      }
      if (result.failedSectionIds.length) {
        setError(
          `${result.failedSectionIds.length}개 섹션 번역이 실패했습니다. 완료된 섹션은 저장했습니다.`,
        );
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      abortRef.current = null;
      setTranslating(false);
    }
  };

  const editTranslation = async (
    record: TranslationRecord,
    text: string,
  ) => {
    const nextRecord: TranslationRecord = {
      ...record,
      translatedText: text.trim(),
      status: "translated",
      error: undefined,
      manuallyEdited: true,
      locked: true,
      updatedAt: new Date().toISOString(),
    };
    const nextTranslations = translations.map((item) =>
      item.id === nextRecord.id ? nextRecord : item,
    );
    const nextProject: RetypesetProject = {
      ...project,
      manuallyEditedBlockIds: [
        ...new Set([...project.manuallyEditedBlockIds, record.blockId]),
      ],
      updatedAt: nextRecord.updatedAt,
    };
    await Promise.all([
      saveTranslations([nextRecord]),
      saveRetypesetProject(nextProject),
    ]);
    onTranslations(nextTranslations);
    onProject(nextProject);
    if (packageStatus?.installed) {
      await generatePreview(nextTranslations, nextProject);
    }
  };

  const toggleLock = async (record: TranslationRecord) => {
    const next = {
      ...record,
      locked: !record.locked,
      updatedAt: new Date().toISOString(),
    };
    await saveTranslations([next]);
    onTranslations(
      translations.map((item) => (item.id === next.id ? next : item)),
    );
  };

  const useSourceFallback = async (blockId: string) => {
    const next: RetypesetProject = {
      ...project,
      sourceFallbackBlockIds: [
        ...new Set([...project.sourceFallbackBlockIds, blockId]),
      ],
      updatedAt: new Date().toISOString(),
    };
    await persistProject(next);
    if (packageStatus?.installed) await generatePreview(translations, next);
  };

  const exportPdf = async () => {
    let bytes = generatedBytes;
    if (!bytes) bytes = await generatePreview();
    if (!bytes) return;
    const currentWarnings = validateRetypesetProject(
      paper,
      blocks,
      translations,
      references,
      project,
    );
    if (
      currentWarnings.some((warning) => warning.severity === "integrity") ||
      renderWarnings.some((warning) => warning.severity === "integrity")
    ) {
      setError("내용 무결성 오류를 해결한 뒤 내보낼 수 있습니다.");
      return;
    }
    const path = await saveGeneratedPdf(
      bytes,
      safeFileName(readerDocument.title),
    );
    if (path) {
      await persistProject({
        ...project,
        lastExportedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  };

  return (
    <div className="retypeset-backdrop" role="presentation">
      <section
        className="retypeset-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="한국어 논문 재조판 검수"
      >
        <header className="retypeset-header">
          <div>
            <span>SEMANTIC RE-TYPESET</span>
            <h2>한국어 논문 재조판 검수</h2>
            <p>
              {paper.columnCount}단 · 번역 대상 {translatableBlocks.length}개 ·
              원본은 변경되지 않습니다
            </p>
          </div>
          <div className="retypeset-header-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={translating}
              onClick={() => void translateAllSections()}
            >
              {translating ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              {translating
                ? `${translationProgress.completed}/${translationProgress.total} 섹션`
                : "섹션 전체 번역"}
            </button>
            <button
              type="button"
              className="secondary-action"
              disabled={generating || !packageStatus?.installed}
              onClick={() => void generatePreview()}
            >
              {generating ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <FileOutput size={15} />
              )}
              미리보기 생성
            </button>
            <button
              type="button"
              className="primary-action compact"
              disabled={
                generating ||
                translating ||
                integrityBlockers.length > 0 ||
                !generatedBytes
              }
              onClick={() => void exportPdf()}
            >
              <Download size={15} />
              PDF 내보내기
            </button>
            <button type="button" onClick={onClose} aria-label="검수 닫기">
              <X size={17} />
            </button>
          </div>
        </header>

        {!packageStatus?.installed && (
          <section className="typesetting-install-card">
            <div>
              <FileOutput size={22} />
              <span>
                <strong>한글 조판 패키지가 필요합니다</strong>
                <small>
                  나눔명조/나눔고딕 ·{" "}
                  {formatMegabytes(packageStatus?.totalBytes ?? 5_113_152)} ·
                  CPU 전용 · 한 번만 설치
                </small>
              </span>
            </div>
            <button
              type="button"
              className="primary-action compact"
              disabled={installing}
              onClick={() => void installPackage()}
            >
              {installing ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Download size={15} />
              )}
              {installing ? "설치 중…" : "설치"}
            </button>
          </section>
        )}

        {error && <p className="retypeset-error">{error}</p>}

        <div className="retypeset-body">
          <aside className="retypeset-review-rail">
            <section className="review-summary">
              <div>
                {integrityBlockers.length ? (
                  <ShieldAlert size={17} />
                ) : (
                  <CheckCircle2 size={17} />
                )}
                <span>
                  <strong>
                    {integrityBlockers.length
                      ? `내용 오류 ${integrityBlockers.length}개`
                      : "내용 무결성 통과"}
                  </strong>
                  <small>
                    외형 경고{" "}
                    {warnings.filter((item) => item.severity === "visual").length}
                    개
                  </small>
                </span>
              </div>
            </section>

            {warnings.length > 0 && (
              <section className="review-warning-list">
                {warnings.map((warning) => (
                  <article key={warning.id}>
                    <AlertTriangle size={14} />
                    <span>
                      <strong>
                        {warning.severity === "integrity"
                          ? "내보내기 차단"
                          : "외형 확인"}
                      </strong>
                      <small>{warning.message}</small>
                    </span>
                    {warning.blockId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBlockId(warning.blockId!);
                          const block = blocks.find(
                            (candidate) => candidate.id === warning.blockId,
                          );
                          if (block) setSourcePage(block.pageNumber);
                        }}
                      >
                        보기
                      </button>
                    )}
                    {(warning.kind === "missing-translation" ||
                      warning.kind === "broken-reference") &&
                      warning.blockId && (
                        <button
                          type="button"
                          onClick={() =>
                            void useSourceFallback(warning.blockId!)
                          }
                        >
                          {warning.kind === "broken-reference"
                            ? "링크 제외"
                            : "원문 유지"}
                        </button>
                      )}
                  </article>
                ))}
              </section>
            )}

            <section className="review-translation-list">
              <header>
                <span>번역 본문과 캡션</span>
                <small>수정 시 자동 잠금</small>
              </header>
              {translatableBlocks.map((block) => {
                const record = translationByBlock.get(block.id);
                return (
                  <article
                    key={block.id}
                    className={
                      selectedBlockId === block.id ? "selected" : ""
                    }
                    onClick={() => {
                      setSelectedBlockId(block.id);
                      setSourcePage(block.pageNumber);
                    }}
                  >
                    <div>
                      <span>
                        {block.type} · p.{block.pageNumber}
                      </span>
                      {record && (
                        <button
                          type="button"
                          title={record.locked ? "재번역 잠금 해제" : "재번역 잠금"}
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleLock(record);
                          }}
                        >
                          {record.locked ? (
                            <Lock size={12} />
                          ) : (
                            <LockOpen size={12} />
                          )}
                        </button>
                      )}
                    </div>
                    <small>{block.text}</small>
                    {record?.status === "translated" ? (
                      <textarea
                        defaultValue={record.translatedText}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          if (event.target.value !== record.translatedText) {
                            void editTranslation(record, event.target.value);
                          }
                        }}
                        aria-label="재조판 번역문 수정"
                      />
                    ) : (
                      <p>{record?.error ?? "아직 번역되지 않았습니다."}</p>
                    )}
                  </article>
                );
              })}
            </section>
          </aside>

          <main className="retypeset-compare">
            <section>
              <header>
                <span>원문</span>
                <small>{readerDocument.title}</small>
              </header>
              <PdfReviewPage
                document={sourceDocument}
                pageNumber={sourcePage}
                onPage={setSourcePage}
              />
            </section>
            <section>
              <header>
                <span>한국어 재조판본</span>
                <small>
                  {generatedDocument
                    ? `${generatedDocument.numPages}페이지`
                    : "미리보기를 생성해 주세요"}
                </small>
              </header>
              {generatedDocument ? (
                <PdfReviewPage
                  document={generatedDocument}
                  pageNumber={translatedPage}
                  onPage={setTranslatedPage}
                />
              ) : (
                <div className="review-empty-preview">
                  <FileOutput size={32} />
                  <strong>재조판 미리보기 없음</strong>
                  <span>
                    섹션 번역을 완료하고 미리보기를 생성하면 원문과 나란히
                    검수할 수 있습니다.
                  </span>
                </div>
              )}
            </section>
          </main>
        </div>
      </section>
    </div>
  );
}
