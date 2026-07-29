import type {
  DocumentBlock,
  DocumentReference,
  LlmSettings,
  LlmTokenUsage,
  LlmUsageByPhase,
  ReaderDocument,
  RetypesetProject,
  RetypesetWarning,
  SemanticPaper,
  TranslationRecord,
} from "../types";

export type KoreanPaperBuildPhase =
  | "idle"
  | "installing"
  | "structuring"
  | "translating"
  | "typesetting"
  | "applying";

export type KoreanPaperBuildState = {
  phase: KoreanPaperBuildPhase;
  completed: number;
  total: number;
  message: string;
  tokenUsage?: LlmUsageByPhase;
};

export const IDLE_KOREAN_PAPER_BUILD: KoreanPaperBuildState = {
  phase: "idle",
  completed: 0,
  total: 0,
  message: "",
};

export type KoreanPaperTranslationCheckpoint = {
  sectionId: string;
  completed: number;
  total: number;
  records: TranslationRecord[];
  project: RetypesetProject;
  usage: LlmTokenUsage;
};

type StructureOptions = {
  document: ReaderDocument;
  settings: LlmSettings;
  sourceBytes: Uint8Array;
  fallbackBlocks: DocumentBlock[];
  fallbackPaper: SemanticPaper;
  fallbackReferences: DocumentReference[];
  project: RetypesetProject;
  signal: AbortSignal;
};

type StructuredPaper = {
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  references: DocumentReference[];
  project: RetypesetProject;
};

export type KoreanPaperRunInput = {
  document: ReaderDocument;
  settings: LlmSettings;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  references: DocumentReference[];
  translations: TranslationRecord[];
  project: RetypesetProject | null;
  sourceBytes: Uint8Array;
  forceRetranslate: boolean;
  hasAcceptedPaper: boolean;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type TranslationOptions = {
  title: string;
  paper: SemanticPaper;
  blocks: DocumentBlock[];
  settings: LlmSettings;
  project: RetypesetProject;
  existingTranslations: TranslationRecord[];
  forceRetranslate: boolean;
  signal: AbortSignal;
  onCheckpoint?: (
    checkpoint: KoreanPaperTranslationCheckpoint,
  ) => void | Promise<void>;
};

type RenderOptions = {
  sourceBytes: Uint8Array;
  sourceTitle: string;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  translations: TranslationRecord[];
  project: RetypesetProject;
  serifFontBytes: Uint8Array;
  serifBoldFontBytes?: Uint8Array;
  sansFontBytes: Uint8Array;
  sansBoldFontBytes?: Uint8Array;
  mathFontBytes?: Uint8Array;
};

export type KoreanPaperRunDependencies = {
  now: () => string;
  requestTransmissionConsent: () => Promise<boolean>;
  prepareFonts: (
    onProgress: (completed: number, total: number) => void,
    isCurrent: () => boolean,
  ) => Promise<{
    serif: Uint8Array;
    serifBold?: Uint8Array;
    sans: Uint8Array;
    sansBold?: Uint8Array;
    math?: Uint8Array;
  }>;
  loadProject: (documentId: string) => Promise<RetypesetProject | null>;
  createProject: (
    documentId: string,
    targetLanguage: string,
    profileId: string,
    previous: RetypesetProject | null,
  ) => RetypesetProject;
  saveProject: (project: RetypesetProject) => Promise<void>;
  saveTranslations: (records: TranslationRecord[]) => Promise<void>;
  reconstruct: (options: StructureOptions) => Promise<StructuredPaper>;
  translate: (options: TranslationOptions) => Promise<{
    project: RetypesetProject;
    translations: TranslationRecord[];
    failedSectionIds: string[];
    usage: LlmTokenUsage;
  }>;
  validate: (
    paper: SemanticPaper,
    blocks: DocumentBlock[],
    translations: TranslationRecord[],
    references: DocumentReference[],
    project: RetypesetProject,
  ) => RetypesetWarning[];
  render: (options: RenderOptions) => Promise<{
    bytes: Uint8Array;
    warnings: RetypesetWarning[];
  }>;
  accept: (bytes: Uint8Array, project: RetypesetProject) => Promise<void>;
};

export type KoreanPaperRunCallbacks = {
  onProgress?: (state: KoreanPaperBuildState) => void;
  onCheckpoint?: (
    translations: TranslationRecord[],
    project: RetypesetProject,
  ) => void;
};

export type KoreanPaperRunResult =
  | {
      status: "completed";
      translations: TranslationRecord[];
      project: RetypesetProject;
      visualWarningCount: number;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "failed";
      error: string;
      translations: TranslationRecord[];
      project: RetypesetProject | null;
    };

export type KoreanPaperCandidateInput = {
  document: ReaderDocument;
  settings: LlmSettings;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  references: DocumentReference[];
  translations: TranslationRecord[];
  project: RetypesetProject;
  sourceBytes: Uint8Array;
  fonts: {
    serif: Uint8Array;
    serifBold?: Uint8Array;
    sans: Uint8Array;
    sansBold?: Uint8Array;
    math?: Uint8Array;
  };
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export type KoreanTranslationEditInput = {
  record: TranslationRecord;
  translatedText: string;
};

class CancelledKoreanPaperRun extends Error {}

function cancellationRequested(input: KoreanPaperRunInput): boolean {
  return input.signal.aborted || !input.isCurrent();
}

function assertCurrent(input: KoreanPaperRunInput): void {
  if (cancellationRequested(input)) {
    throw new CancelledKoreanPaperRun();
  }
}

function progress(
  callbacks: KoreanPaperRunCallbacks,
  phase: KoreanPaperBuildPhase,
  message: string,
  completed = 0,
  total = 0,
  tokenUsage?: LlmUsageByPhase,
): void {
  callbacks.onProgress?.({
    phase,
    completed,
    total,
    message,
    ...(tokenUsage ? { tokenUsage } : {}),
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isCancellation(cause: unknown, input: KoreanPaperRunInput): boolean {
  return (
    cause instanceof CancelledKoreanPaperRun ||
    cancellationRequested(input) ||
    (cause instanceof DOMException && cause.name === "AbortError")
  );
}

export function applyKoreanTranslationEdits(
  translations: TranslationRecord[],
  project: RetypesetProject,
  edits: KoreanTranslationEditInput[],
  now: string,
): {
  translations: TranslationRecord[];
  project: RetypesetProject;
  changedTranslations: TranslationRecord[];
} {
  const editsById = new Map(edits.map((edit) => [edit.record.id, edit]));
  const nextTranslations = translations.map((record) => {
    const edit = editsById.get(record.id);
    return edit
      ? {
          ...record,
          translatedText: edit.translatedText,
          status: "translated" as const,
          error: undefined,
          manuallyEdited: true,
          locked: true,
          updatedAt: now,
        }
      : record;
  });
  const nextProject: RetypesetProject = {
    ...project,
    manuallyEditedBlockIds: [
      ...new Set([
        ...project.manuallyEditedBlockIds,
        ...edits.map((edit) => edit.record.blockId),
      ]),
    ],
    updatedAt: now,
  };
  return {
    translations: nextTranslations,
    project: nextProject,
    changedTranslations: nextTranslations.filter((record) =>
      editsById.has(record.id),
    ),
  };
}

export async function applyKoreanPaperCandidate(
  input: KoreanPaperCandidateInput,
  dependencies: Pick<
    KoreanPaperRunDependencies,
    "now" | "validate" | "render" | "accept"
  >,
  callbacks: KoreanPaperRunCallbacks = {},
): Promise<KoreanPaperRunResult> {
  const runInput = {
    ...input,
    forceRetranslate: false,
    hasAcceptedPaper: Boolean(input.project.acceptedAt),
  };
  try {
    assertCurrent(runInput);
    const validationWarnings = dependencies.validate(
      input.paper,
      input.blocks,
      input.translations,
      input.references,
      input.project,
    );
    const validationBlockers = validationWarnings.filter(
      (warning) => warning.severity === "integrity",
    );
    if (validationBlockers.length) {
      throw new Error(
        `자동 무결성 검사에서 ${validationBlockers.length}개 오류를 발견했습니다. 기존 한국어 논문은 유지됩니다.`,
      );
    }

    progress(
      callbacks,
      "typesetting",
      "그림·표·코드를 배치하고 PDF를 만드는 중",
    );
    const rendered = await dependencies.render({
      sourceBytes: input.sourceBytes,
      sourceTitle: input.document.title,
      blocks: input.blocks,
      paper: input.paper,
      translations: input.translations,
      project: input.project,
      serifFontBytes: input.fonts.serif,
      serifBoldFontBytes: input.fonts.serifBold,
      sansFontBytes: input.fonts.sans,
      sansBoldFontBytes: input.fonts.sansBold,
      mathFontBytes: input.fonts.math,
    });
    assertCurrent(runInput);
    const renderBlockers = rendered.warnings.filter(
      (warning) => warning.severity === "integrity",
    );
    if (renderBlockers.length) {
      throw new Error(
        `PDF 생성 검사에서 ${renderBlockers.length}개 오류를 발견했습니다. 기존 한국어 논문은 유지됩니다.`,
      );
    }

    const acceptedAt = dependencies.now();
    const accepted: RetypesetProject = {
      ...input.project,
      profileId: input.settings.activeProfileId,
      acceptedAt,
      acceptedProfileId: input.settings.activeProfileId,
      acceptedEffort: input.settings.effort,
      updatedAt: acceptedAt,
    };
    progress(
      callbacks,
      "applying",
      "새 한국어 논문을 적용하는 중",
    );
    await dependencies.accept(rendered.bytes, accepted);
    assertCurrent(runInput);

    const visualWarningCount = [
      ...validationWarnings,
      ...rendered.warnings,
    ].filter((warning) => warning.severity === "visual").length;
    return {
      status: "completed",
      translations: input.translations,
      project: accepted,
      visualWarningCount,
    };
  } catch (cause) {
    if (isCancellation(cause, runInput)) {
      return { status: "cancelled" };
    }
    return {
      status: "failed",
      error: errorMessage(cause),
      translations: input.translations,
      project: input.project,
    };
  }
}

export async function runKoreanPaperCreation(
  input: KoreanPaperRunInput,
  dependencies: KoreanPaperRunDependencies,
  callbacks: KoreanPaperRunCallbacks = {},
): Promise<KoreanPaperRunResult> {
  let previousProject = input.project;
  let latestTranslations = input.translations;
  let latestProject = input.project;

  try {
    if (!(await dependencies.requestTransmissionConsent())) {
      return { status: "cancelled" };
    }
    assertCurrent(input);

    previousProject =
      input.project ?? (await dependencies.loadProject(input.document.id));
    let candidate = dependencies.createProject(
      input.document.id,
      "ko",
      input.settings.activeProfileId,
      previousProject,
    );
    if (input.forceRetranslate) {
      candidate = {
        ...candidate,
        profileId: input.settings.activeProfileId,
        translationBrief: "",
        tokenUsage: candidate.tokenUsage
          ? {
              ...candidate.tokenUsage,
              translation: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                estimated: false,
              },
              total: candidate.tokenUsage.structure,
            }
          : undefined,
        updatedAt: dependencies.now(),
      };
    }
    await dependencies.saveProject(candidate);
    assertCurrent(input);
    latestProject = candidate;
    callbacks.onCheckpoint?.(latestTranslations, candidate);

    const fontsPromise = dependencies
      .prepareFonts(() => undefined, input.isCurrent)
      .then(
        (fonts) => ({ fonts }),
        (error: unknown) => ({ error }),
      );
    progress(
      callbacks,
      "structuring",
      "원문의 문단과 섹션 구조를 복원하는 중",
      0,
      0,
      candidate.tokenUsage,
    );
    const structured = await dependencies.reconstruct({
      document: input.document,
      settings: input.settings,
      sourceBytes: input.sourceBytes,
      fallbackBlocks: input.blocks,
      fallbackPaper: input.paper,
      fallbackReferences: input.references,
      project: candidate,
      signal: input.signal,
    });
    assertCurrent(input);
    candidate = structured.project;
    latestProject = candidate;
    await dependencies.saveProject(candidate);
    callbacks.onCheckpoint?.(latestTranslations, candidate);

    progress(
      callbacks,
      "installing",
      "한국어 글꼴을 준비하는 중",
      0,
      0,
      candidate.tokenUsage,
    );
    const preparedFonts = await fontsPromise;
    if ("error" in preparedFonts) throw preparedFonts.error;
    const fonts = preparedFonts.fonts;
    assertCurrent(input);

    progress(
      callbacks,
      "translating",
      "논문 전체 맥락으로 번역하는 중",
      0,
      0,
      candidate.tokenUsage,
    );
    const translated = await dependencies.translate({
      title: input.document.title,
      paper: structured.paper,
      blocks: structured.blocks,
      settings: input.settings,
      project: candidate,
      existingTranslations: input.translations,
      forceRetranslate: input.forceRetranslate,
      signal: input.signal,
      onCheckpoint: async (checkpoint) => {
        if (cancellationRequested(input)) return;
        progress(
          callbacks,
          "translating",
          "논문 전체 맥락으로 번역하는 중",
          checkpoint.completed,
          checkpoint.total,
          checkpoint.project.tokenUsage,
        );
        await Promise.all([
          dependencies.saveTranslations(checkpoint.records),
          dependencies.saveProject(checkpoint.project),
        ]);
        if (cancellationRequested(input)) return;
        latestTranslations = checkpoint.records;
        latestProject = checkpoint.project;
        callbacks.onCheckpoint?.(
          checkpoint.records,
          checkpoint.project,
        );
      },
    });
    assertCurrent(input);
    if (translated.failedSectionIds.length) {
      throw new Error(
        `${translated.failedSectionIds.length}개 섹션 번역에 실패했습니다. 기존 한국어 논문은 유지됩니다.`,
      );
    }

    await Promise.all([
      dependencies.saveTranslations(translated.translations),
      dependencies.saveProject(translated.project),
    ]);
    assertCurrent(input);
    latestTranslations = translated.translations;
    latestProject = translated.project;
    callbacks.onCheckpoint?.(latestTranslations, latestProject);

    const applied = await applyKoreanPaperCandidate(
      {
        document: input.document,
        settings: input.settings,
        blocks: structured.blocks,
        paper: structured.paper,
        references: structured.references,
        translations: latestTranslations,
        project: latestProject,
        sourceBytes: input.sourceBytes,
        fonts,
        signal: input.signal,
        isCurrent: input.isCurrent,
      },
      dependencies,
      callbacks,
    );
    if (applied.status === "failed") throw new Error(applied.error);
    if (applied.status === "cancelled") return applied;
    latestProject = applied.project;
    return applied;
  } catch (cause) {
    if (isCancellation(cause, input)) {
      return { status: "cancelled" };
    }

    if (
      input.forceRetranslate &&
      input.hasAcceptedPaper &&
      previousProject
    ) {
      await Promise.all([
        dependencies.saveTranslations(input.translations),
        dependencies.saveProject(previousProject),
      ]);
      latestTranslations = input.translations;
      latestProject = previousProject;
      callbacks.onCheckpoint?.(latestTranslations, latestProject);
    }
    return {
      status: "failed",
      error: errorMessage(cause),
      translations: latestTranslations,
      project: latestProject,
    };
  } finally {
    callbacks.onProgress?.(IDLE_KOREAN_PAPER_BUILD);
  }
}
