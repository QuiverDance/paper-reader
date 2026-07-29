import {
  extractDocumentBlocks,
  resolveDocumentReferences,
} from "./document-blocks";
import {
  DOCUMENT_STRUCTURE_VERSION,
  reconstructDocumentStructure,
} from "./document-structure";
import {
  activeModelProfile,
  completeChatWithUsage,
  modelConnectionSignature,
} from "./llm";
import type {
  KoreanPaperRunDependencies,
} from "./korean-paper-workflow";
import { loadPdfDocument } from "./pdf";
import {
  analyzeSemanticPaper,
  createRetypesetProject,
  validateRetypesetProject,
} from "./semantic-paper";
import { translatePaperSections } from "./section-translator";
import {
  loadRetypesetProject,
  saveLlmSettings,
  saveRetypesetProject,
  saveTranslations,
} from "./storage";
import {
  getTypesettingPackageStatus,
  installTypesettingPackage,
  loadTypesettingFonts,
} from "./typesetting-package";
import { usageByPhase } from "./token-usage";
import type {
  DocumentBlock,
  LlmSettings,
  RetypesetProject,
} from "../types";

type RuntimeOptions = {
  settings: LlmSettings;
  onSettingsChange: (settings: LlmSettings) => void;
  accept: KoreanPaperRunDependencies["accept"];
};

export function safeKoreanPdfName(title: string): string {
  const safe = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${safe || "paper"}-ko-unofficial.pdf`;
}

async function requestTransmissionConsent(
  settings: LlmSettings,
  onSettingsChange: (settings: LlmSettings) => void,
): Promise<boolean> {
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
}

export async function prepareKoreanTypesettingFonts(
  onProgress: (completed: number, total: number) => void,
  isCurrent: () => boolean,
) {
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
}

export const renderKoreanPaper: KoreanPaperRunDependencies["render"] =
  async (options) => {
    const { createRetypesetPdf } = await import("./retypeset-pdf");
    return createRetypesetPdf(options);
  };

export const reconstructKoreanPaper: KoreanPaperRunDependencies["reconstruct"] =
  async (options) => {
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
      const cachedReferences = resolveDocumentReferences(cached.blocks);
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

    const sourceDocument = await loadPdfDocument(options.sourceBytes.slice());
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
    const structuredReferences = resolveDocumentReferences(
      reconstructed.blocks,
    );
    const analyzedAt = new Date().toISOString();
    const nextProject: RetypesetProject = {
      ...options.project,
      documentStructure: {
        version: DOCUMENT_STRUCTURE_VERSION,
        signature,
        analyzedAt,
        blocks: reconstructed.blocks,
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
  };

export function createKoreanPaperDependencies({
  settings,
  onSettingsChange,
  accept,
}: RuntimeOptions): KoreanPaperRunDependencies {
  return {
    now: () => new Date().toISOString(),
    requestTransmissionConsent: () =>
      requestTransmissionConsent(settings, onSettingsChange),
    prepareFonts: prepareKoreanTypesettingFonts,
    loadProject: loadRetypesetProject,
    createProject: createRetypesetProject,
    saveProject: saveRetypesetProject,
    saveTranslations,
    reconstruct: reconstructKoreanPaper,
    translate: translatePaperSections,
    validate: validateRetypesetProject,
    render: renderKoreanPaper,
    accept,
  };
}

export function koreanPaperCandidateDependencies(
  accept: KoreanPaperRunDependencies["accept"],
): Pick<KoreanPaperRunDependencies, "now" | "validate" | "render" | "accept"> {
  return {
    now: () => new Date().toISOString(),
    validate: validateRetypesetProject,
    render: renderKoreanPaper,
    accept,
  };
}
