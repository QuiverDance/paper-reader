import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractDocumentBlocks } from "../lib/document-blocks";
import { resolveDocumentReferences } from "../lib/document-references";
import {
  DOCUMENT_STRUCTURE_VERSION,
  reconstructDocumentStructure,
} from "../lib/document-structure";
import {
  activeModelProfile,
  completeChatWithUsage,
  modelConnectionSignature,
} from "../lib/llm";
import {
  applyKoreanPaperCandidate,
  applyKoreanTranslationEdits,
  IDLE_KOREAN_PAPER_BUILD,
  runKoreanPaperCreation,
  type KoreanPaperBuildState,
  type KoreanPaperRunDependencies,
  type KoreanTranslationEditInput,
} from "../lib/korean-paper-workflow";
import { loadPdfDocument } from "../lib/pdf";
import {
  readProjectPdf,
  saveGeneratedPdf,
  saveProjectPdf,
} from "../lib/platform";
import {
  analyzeSemanticPaper,
  createRetypesetProject,
  validateRetypesetProject,
} from "../lib/semantic-paper";
import { translatePaperSections } from "../lib/section-translator";
import {
  loadRetypesetProject,
  saveLlmSettings,
  saveRetypesetProject,
  saveTranslations,
} from "../lib/storage";
import {
  getTypesettingPackageStatus,
  installTypesettingPackage,
  loadTypesettingFonts,
} from "../lib/typesetting-package";
import { usageByPhase } from "../lib/token-usage";
import type {
  DocumentBlock,
  DocumentReference,
  LlmSettings,
  ReaderDocument,
  RetypesetProject,
  SemanticPaper,
  TranslationRecord,
} from "../types";

type UseKoreanPaperCreationOptions = {
  document: ReaderDocument | null;
  settings: LlmSettings | null;
  sourceBlocks: DocumentBlock[];
  paper: SemanticPaper;
  references: DocumentReference[];
  hydration: {
    documentId: string;
    translations: TranslationRecord[];
    project: RetypesetProject | null;
  } | null;
  getSourceBytes: () => Uint8Array | null;
  getActiveDocumentId: () => string | null;
  onSettingsChange: (settings: LlmSettings) => void;
  onDocumentChange: (document: ReaderDocument) => Promise<void>;
  onCompanionReady: (pageCount: number) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
};

function safeKoreanPdfName(title: string): string {
  const safe = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${safe || "paper"}-ko-unofficial.pdf`;
}

export function useKoreanPaperCreation({
  document,
  settings,
  sourceBlocks,
  paper,
  references,
  hydration,
  getSourceBytes,
  getActiveDocumentId,
  onSettingsChange,
  onDocumentChange,
  onCompanionReady,
  onError,
  onNotice,
}: UseKoreanPaperCreationOptions) {
  const [koreanDocument, setKoreanDocument] =
    useState<PDFDocumentProxy | null>(null);
  const [koreanBlocks, setKoreanBlocks] = useState<DocumentBlock[]>([]);
  const [translations, setTranslations] = useState<TranslationRecord[]>([]);
  const [project, setProject] = useState<RetypesetProject | null>(null);
  const [build, setBuild] = useState<KoreanPaperBuildState>(
    IDLE_KOREAN_PAPER_BUILD,
  );
  const [editing, setEditing] = useState(false);

  const koreanPdfRef = useRef<PDFDocumentProxy | null>(null);
  const koreanBytesRef = useRef<Uint8Array | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearAcceptedPaper = useCallback(() => {
    const previous = koreanPdfRef.current;
    koreanPdfRef.current = null;
    koreanBytesRef.current = null;
    setKoreanDocument(null);
    setKoreanBlocks([]);
    if (previous) void previous.cleanup();
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBuild(IDLE_KOREAN_PAPER_BUILD);
  }, []);

  const reset = useCallback(() => {
    cancel();
    clearAcceptedPaper();
    setTranslations([]);
    setProject(null);
    setEditing(false);
  }, [cancel, clearAcceptedPaper]);

  const restore = useCallback(
    async (
      documentId: string,
      savedTranslations: TranslationRecord[],
      savedProject: RetypesetProject | null,
    ) => {
      cancel();
      clearAcceptedPaper();
      setTranslations(savedTranslations);
      setProject(savedProject);
      setEditing(false);
      if (!savedProject?.acceptedAt) return;
      const bytes = await readProjectPdf(documentId);
      if (!bytes || getActiveDocumentId() !== documentId) return;
      const nextDocument = await loadPdfDocument(bytes.slice());
      if (getActiveDocumentId() !== documentId) {
        void nextDocument.cleanup();
        return;
      }
      koreanBytesRef.current = bytes;
      koreanPdfRef.current = nextDocument;
      setKoreanDocument(nextDocument);
      onCompanionReady(nextDocument.numPages);
    },
    [
      cancel,
      clearAcceptedPaper,
      getActiveDocumentId,
      onCompanionReady,
    ],
  );

  useEffect(() => {
    reset();
  }, [document?.id, reset]);

  useEffect(() => {
    if (!document || hydration?.documentId !== document.id) return;
    void restore(
      hydration.documentId,
      hydration.translations,
      hydration.project,
    );
  }, [document?.id, hydration, restore]);

  useEffect(() => {
    if (!koreanDocument || !document) {
      setKoreanBlocks([]);
      return;
    }
    let cancelled = false;
    void extractDocumentBlocks(koreanDocument, `${document.id}-ko`)
      .then((nextBlocks) => {
        if (!cancelled) setKoreanBlocks(nextBlocks);
      })
      .catch(() => {
        if (!cancelled) setKoreanBlocks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [document, koreanDocument]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      void koreanPdfRef.current?.cleanup();
    },
    [],
  );

  const requestTransmissionConsent = useCallback(async (): Promise<boolean> => {
    if (!settings) return false;
    const signature = modelConnectionSignature(settings);
    const consentKey = `translation:${signature}`;
    if (settings.transmissionConsentKey === consentKey) return true;
    const profile = activeModelProfile(settings);
    const destination =
      profile.connectionMode === "codex"
        ? "이 PC의 Codex 로그인"
        : `${profile.name} (${profile.endpoint})`;
    const accepted = window.confirm(
      [
        `한국어 논문 생성을 위해 번역 대상 본문과 캡션을 ${destination}에 전송합니다.`,
        "",
        "번역 과정에서는 PDF 파일, 그림·표 원본, 코드, 참고문헌을 전송하지 않습니다.",
      ].join("\n"),
    );
    if (!accepted) return false;
    const next = { ...settings, transmissionConsentKey: consentKey };
    await saveLlmSettings(next);
    onSettingsChange(next);
    return true;
  }, [onSettingsChange, settings]);

  const prepareFonts = useCallback(
    async (
      onProgress: (completed: number, total: number) => void,
      isCurrent: () => boolean,
    ) => {
      let status = await getTypesettingPackageStatus();
      if (!status.installed) {
        status = await installTypesettingPackage((completed, total) => {
          if (isCurrent()) onProgress(completed, total);
        });
      }
      if (!status.installed) {
        throw new Error("한국어 조판 패키지를 설치하지 못했습니다.");
      }
      if (!isCurrent()) {
        throw new DOMException("한국어 논문 생성을 취소했습니다.", "AbortError");
      }
      return loadTypesettingFonts();
    },
    [],
  );

  const accept = useCallback(
    async (bytes: Uint8Array, acceptedProject: RetypesetProject) => {
      if (
        !document ||
        getActiveDocumentId() !== acceptedProject.documentId
      ) {
        return;
      }
      await Promise.all([
        saveProjectPdf(document.id, bytes),
        saveRetypesetProject(acceptedProject),
      ]);
      const nextDocument = await loadPdfDocument(bytes.slice());
      if (getActiveDocumentId() !== acceptedProject.documentId) {
        void nextDocument.cleanup();
        return;
      }
      const previous = koreanPdfRef.current;
      koreanBytesRef.current = bytes.slice();
      koreanPdfRef.current = nextDocument;
      setKoreanDocument(nextDocument);
      onCompanionReady(nextDocument.numPages);
      if (previous) void previous.cleanup();

      const updatedDocument: ReaderDocument = {
        ...document,
        translationProgress: 1,
      };
      await onDocumentChange(updatedDocument);
      setProject(acceptedProject);
    },
    [
      document,
      getActiveDocumentId,
      onCompanionReady,
      onDocumentChange,
    ],
  );

  const render = useCallback<KoreanPaperRunDependencies["render"]>(
    async (options) => {
      const { createRetypesetPdf } = await import("../lib/retypeset-pdf");
      return createRetypesetPdf(options);
    },
    [],
  );

  const reconstruct = useCallback<
    KoreanPaperRunDependencies["reconstruct"]
  >(async (options) => {
    const signature = [
      options.document.fileHash ?? options.document.id,
      modelConnectionSignature(options.settings),
      DOCUMENT_STRUCTURE_VERSION,
    ].join("|");
    const cached = options.project.documentStructure;
    if (
      cached?.version === DOCUMENT_STRUCTURE_VERSION &&
      cached.signature === signature &&
      cached.blocks.length
    ) {
      const cachedReferences = resolveDocumentReferences(
        cached.blocks,
        cached.references,
      );
      return {
        blocks: cached.blocks,
        paper: analyzeSemanticPaper(cached.blocks, cachedReferences),
        references: cachedReferences,
        project: {
          ...options.project,
          tokenUsage: usageByPhase(
            cached.usage,
            options.project.tokenUsage?.translation,
          ),
        },
      };
    }

    const sourceDocument = await loadPdfDocument(
      options.sourceBytes.slice(),
    );
    let extracted: DocumentBlock[];
    try {
      extracted = await extractDocumentBlocks(
        sourceDocument,
        options.document.id,
      );
    } finally {
      await sourceDocument.cleanup();
    }
    if (options.signal.aborted) {
      throw new DOMException("문서 구조 복원을 취소했습니다.", "AbortError");
    }
    const reconstructed = await reconstructDocumentStructure({
      documentId: options.document.id,
      blocks: extracted,
      maxContextSize: options.settings.maxContextSize || 128000,
      complete: (messages, signal) =>
        completeChatWithUsage(options.settings, messages, signal),
      signal: options.signal,
    });
    const structuredReferences = reconstructed.references;
    const analyzedAt = new Date().toISOString();
    const nextProject: RetypesetProject = {
      ...options.project,
      documentStructure: {
        version: DOCUMENT_STRUCTURE_VERSION,
        signature,
        analyzedAt,
        blocks: reconstructed.blocks,
        references: structuredReferences,
        usage: reconstructed.usage,
      },
      tokenUsage: usageByPhase(
        reconstructed.usage,
        options.project.tokenUsage?.translation,
      ),
      updatedAt: analyzedAt,
    };
    return {
      blocks: reconstructed.blocks,
      paper: analyzeSemanticPaper(
        reconstructed.blocks,
        structuredReferences,
      ),
      references: structuredReferences,
      project: nextProject,
    };
  }, []);

  const buildPaper = useCallback(
    async (forceRetranslate = false) => {
      const sourceBytes = getSourceBytes();
      if (
        !document ||
        !settings ||
        !sourceBlocks.length ||
        !sourceBytes ||
        build.phase !== "idle"
      ) {
        if (!sourceBlocks.length) {
          onError(
            "텍스트 분석이 끝난 뒤 한국어 논문을 만들 수 있습니다.",
          );
        }
        return;
      }

      const documentId = document.id;
      const isCurrent = () => getActiveDocumentId() === documentId;
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      onError(null);
      setEditing(false);

      const dependencies: KoreanPaperRunDependencies = {
        now: () => new Date().toISOString(),
        requestTransmissionConsent,
        prepareFonts,
        loadProject: loadRetypesetProject,
        createProject: createRetypesetProject,
        saveProject: saveRetypesetProject,
        saveTranslations,
        reconstruct,
        translate: translatePaperSections,
        validate: validateRetypesetProject,
        render,
        accept,
      };
      const result = await runKoreanPaperCreation(
        {
          document,
          settings,
          blocks: sourceBlocks,
          paper,
          references,
          translations,
          project,
          sourceBytes,
          forceRetranslate,
          hasAcceptedPaper: Boolean(koreanDocument),
          signal: controller.signal,
          isCurrent,
        },
        dependencies,
        {
          onProgress: setBuild,
          onCheckpoint: (nextTranslations, nextProject) => {
            if (!isCurrent()) return;
            setTranslations(nextTranslations);
            setProject(nextProject);
          },
        },
      );

      if (isCurrent()) {
        if (result.status === "failed") {
          setTranslations(result.translations);
          setProject(result.project);
          onError(result.error);
        } else if (result.status === "completed") {
          setTranslations(result.translations);
          setProject(result.project);
          onNotice(
            result.visualWarningCount
              ? `한국어 논문을 적용했습니다. 배치 경고 ${result.visualWarningCount}개가 있습니다.`
              : "한국어 논문을 만들고 바로 적용했습니다.",
          );
        }
      }
      if (abortRef.current === controller) abortRef.current = null;
    },
    [
      accept,
      build.phase,
      document,
      getActiveDocumentId,
      getSourceBytes,
      koreanDocument,
      onError,
      onNotice,
      paper,
      prepareFonts,
      project,
      references,
      render,
      requestTransmissionConsent,
      reconstruct,
      settings,
      sourceBlocks,
      translations,
    ],
  );

  const applyEdits = useCallback(
    async (edits: KoreanTranslationEditInput[]) => {
      const sourceBytes = getSourceBytes();
      if (
        !document ||
        !settings ||
        !project ||
        !edits.length ||
        !sourceBytes ||
        build.phase !== "idle"
      ) {
        return;
      }
      const documentId = document.id;
      const isCurrent = () => getActiveDocumentId() === documentId;
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      const edited = applyKoreanTranslationEdits(
        translations,
        project,
        edits,
        new Date().toISOString(),
      );
      const editBlocks =
        edited.project.documentStructure?.blocks ?? sourceBlocks;
      const editReferences = resolveDocumentReferences(
        editBlocks,
        edited.project.documentStructure?.references,
      );
      const editPaper = analyzeSemanticPaper(
        editBlocks,
        editReferences,
      );
      onError(null);
      try {
        await Promise.all([
          saveTranslations(edited.changedTranslations),
          saveRetypesetProject(edited.project),
        ]);
        if (!isCurrent()) return;
        setTranslations(edited.translations);
        setProject(edited.project);
        setBuild({
          phase: "installing",
          completed: 0,
          total: 0,
          message: "한국어 조판을 준비하는 중",
        });
        const fonts = await prepareFonts(
          (completed, total) => {
            if (isCurrent()) {
              setBuild({
                phase: "installing",
                completed,
                total,
                message: "한국어 글꼴을 설치하는 중",
              });
            }
          },
          isCurrent,
        );
        const result = await applyKoreanPaperCandidate(
          {
            document,
            settings,
            blocks: editBlocks,
            paper: editPaper,
            references: editReferences,
            translations: edited.translations,
            project: edited.project,
            sourceBytes,
            fonts,
            signal: controller.signal,
            isCurrent,
          },
          {
            now: () => new Date().toISOString(),
            validate: validateRetypesetProject,
            render,
            accept,
          },
          { onProgress: setBuild },
        );
        if (!isCurrent()) return;
        if (result.status === "failed") {
          onError(result.error);
        } else if (result.status === "completed") {
          setProject(result.project);
          setEditing(false);
          onNotice(
            result.visualWarningCount
              ? `수정한 한국어 논문을 적용했습니다. 배치 경고 ${result.visualWarningCount}개가 있습니다.`
              : "수정한 한국어 논문을 적용했습니다.",
          );
        }
      } catch (cause) {
        if (
          isCurrent() &&
          !(cause instanceof DOMException && cause.name === "AbortError")
        ) {
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (isCurrent()) setBuild(IDLE_KOREAN_PAPER_BUILD);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [
      accept,
      build.phase,
      document,
      getActiveDocumentId,
      getSourceBytes,
      onError,
      onNotice,
      paper,
      prepareFonts,
      project,
      references,
      render,
      settings,
      sourceBlocks,
      translations,
    ],
  );

  const exportPaper = useCallback(async () => {
    if (!document) return;
    const bytes =
      koreanBytesRef.current ?? (await readProjectPdf(document.id));
    if (!bytes) {
      onError("내보낼 한국어 논문이 없습니다.");
      return;
    }
    const path = await saveGeneratedPdf(
      bytes,
      safeKoreanPdfName(document.title),
    );
    if (path && project) {
      const exportedAt = new Date().toISOString();
      const next = {
        ...project,
        lastExportedAt: exportedAt,
        updatedAt: exportedAt,
      };
      await saveRetypesetProject(next);
      setProject(next);
    }
  }, [document, onError, project]);

  return {
    document: koreanDocument,
    blocks: koreanBlocks,
    translations,
    project,
    build,
    editing,
    setEditing,
    replaceProject: setProject,
    reset,
    restore,
    cancel,
    buildPaper,
    applyEdits,
    exportPaper,
  };
}
