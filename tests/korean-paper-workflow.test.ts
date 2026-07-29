import { describe, expect, it, vi } from "vitest";
import {
  applyKoreanTranslationEdits,
  runKoreanPaperCreation,
  type KoreanPaperRunDependencies,
  type KoreanPaperRunInput,
} from "../src/lib/korean-paper-workflow";
import type {
  DocumentBlock,
  DocumentReference,
  LlmSettings,
  ReaderDocument,
  RetypesetProject,
  SemanticPaper,
  TranslationRecord,
} from "../src/types";

const now = "2026-07-28T09:00:00.000Z";

function project(overrides: Partial<RetypesetProject> = {}): RetypesetProject {
  return {
    id: "paper:ko",
    documentId: "paper",
    targetLanguage: "ko",
    profileId: "profile",
    translationBrief: "brief",
    manuallyEditedBlockIds: [],
    sourceFallbackBlockIds: [],
    acknowledgedWarningIds: [],
    createdAt: "2026-07-27T09:00:00.000Z",
    updatedAt: "2026-07-27T09:00:00.000Z",
    ...overrides,
  };
}

function translation(
  blockId: string,
  translatedText = `translated ${blockId}`,
): TranslationRecord {
  return {
    id: `${blockId}:ko`,
    documentId: "paper",
    blockId,
    targetLanguage: "ko",
    sourceText: `source ${blockId}`,
    translatedText,
    status: "translated",
    sectionId: "section",
    manuallyEdited: false,
    locked: false,
    updatedAt: "2026-07-27T09:00:00.000Z",
  };
}

function input(
  overrides: Partial<KoreanPaperRunInput> = {},
): KoreanPaperRunInput {
  const readerDocument: ReaderDocument = {
    id: "paper",
    filePath: "C:\\paper.pdf",
    title: "Paper",
    pageCount: 1,
    lastOpenedAt: now,
    viewState: {
      pageNumber: 1,
      relativeOffsetY: 0,
      scaleValue: "page-width",
      scale: 1,
      rotation: 0,
    },
    splitMode: "side-by-side",
    syncEnabled: false,
  };
  const settings = {
    activeProfileId: "profile",
    effort: "high",
    targetLanguage: "ko",
  } as LlmSettings;
  const blocks = [
    {
      id: "block-1",
      documentId: "paper",
      pageNumber: 1,
      type: "paragraph",
      text: "Source",
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
      readingOrder: 1,
      translatable: true,
    },
  ] as DocumentBlock[];
  const paper = {
    documentId: "paper",
    contentStartPage: 1,
    sections: [],
    assets: [],
    blockSectionIds: {},
    translatableBlockIds: ["block-1"],
    preservedBlockIds: [],
    columnCount: 1,
    bodyFontStyle: "serif",
  } as SemanticPaper;

  return {
    document: readerDocument,
    settings,
    blocks,
    paper,
    references: [] as DocumentReference[],
    translations: [translation("block-1")],
    project: project({ acceptedAt: "2026-07-27T10:00:00.000Z" }),
    sourceBytes: new Uint8Array([1, 2, 3]),
    forceRetranslate: false,
    hasAcceptedPaper: true,
    signal: new AbortController().signal,
    isCurrent: () => true,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<KoreanPaperRunDependencies> = {},
): KoreanPaperRunDependencies {
  return {
    now: () => now,
    requestTransmissionConsent: vi.fn(async () => true),
    prepareFonts: vi.fn(async () => ({
      serif: new Uint8Array([4]),
      sans: new Uint8Array([5]),
    })),
    loadProject: vi.fn(async () => null),
    createProject: vi.fn((_documentId, _language, _profileId, previous) =>
      previous ?? project(),
    ),
    saveProject: vi.fn(async () => undefined),
    saveTranslations: vi.fn(async () => undefined),
    reconstruct: vi.fn(async (options) => ({
      blocks: options.fallbackBlocks,
      paper: options.fallbackPaper,
      references: options.fallbackReferences,
      project: options.project,
    })),
    translate: vi.fn(async (options) => ({
      project: options.project,
      translations: options.existingTranslations,
      failedSectionIds: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimated: false,
      },
    })),
    validate: vi.fn(() => []),
    render: vi.fn(async () => ({
      bytes: new Uint8Array([9, 8, 7]),
      warnings: [],
    })),
    accept: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Korean paper workflow", () => {
  it("does nothing when transmission consent is declined", async () => {
    const deps = dependencies({
      requestTransmissionConsent: vi.fn(async () => false),
    });

    const result = await runKoreanPaperCreation(input(), deps);

    expect(result.status).toBe("cancelled");
    expect(deps.prepareFonts).not.toHaveBeenCalled();
    expect(deps.translate).not.toHaveBeenCalled();
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("never replaces the accepted PDF when integrity validation fails", async () => {
    const deps = dependencies({
      validate: vi.fn(() => [
        {
          id: "integrity",
          severity: "integrity" as const,
          kind: "broken-reference" as const,
          message: "broken",
        },
      ]),
    });

    const result = await runKoreanPaperCreation(input(), deps);

    expect(result.status).toBe("failed");
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("persists checkpoints before atomically accepting a valid candidate", async () => {
    const events: string[] = [];
    const nextTranslations = [translation("block-1", "new")];
    const deps = dependencies({
      saveProject: vi.fn(async () => {
        events.push("save-project");
      }),
      saveTranslations: vi.fn(async () => {
        events.push("save-translations");
      }),
      translate: vi.fn(async (options) => {
        await options.onCheckpoint?.({
          sectionId: "section",
          completed: 1,
          total: 1,
          records: nextTranslations,
          project: options.project,
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            estimated: false,
          },
        });
        return {
          project: options.project,
          translations: nextTranslations,
          failedSectionIds: [],
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            estimated: false,
          },
        };
      }),
      accept: vi.fn(async (_bytes, acceptedProject) => {
        events.push("accept");
        expect(acceptedProject.acceptedAt).toBe(now);
        expect(acceptedProject.acceptedProfileId).toBe("profile");
        expect(acceptedProject.acceptedEffort).toBe("high");
      }),
    });

    const result = await runKoreanPaperCreation(input(), deps);

    expect(result.status).toBe("completed");
    expect(deps.reconstruct).toHaveBeenCalledOnce();
    expect(deps.translate).toHaveBeenCalledOnce();
    expect(
      vi.mocked(deps.reconstruct).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(deps.translate).mock.invocationCallOrder[0],
    );
    expect(events.at(-1)).toBe("accept");
    expect(events.slice(0, -1)).toContain("save-translations");
    expect(deps.accept).toHaveBeenCalledOnce();
  });

  it("discards a completed render after the active document changes", async () => {
    let current = true;
    const deps = dependencies({
      render: vi.fn(async () => {
        current = false;
        return { bytes: new Uint8Array([9]), warnings: [] };
      }),
    });

    const result = await runKoreanPaperCreation(
      input({ isCurrent: () => current }),
      deps,
    );

    expect(result.status).toBe("cancelled");
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("locks only edited translations and records their block ids", () => {
    const records = [translation("block-1"), translation("block-2")];

    const result = applyKoreanTranslationEdits(
      records,
      project(),
      [
        {
          record: records[0],
          translatedText: "manual correction",
        },
      ],
      now,
    );

    expect(result.translations[0]).toMatchObject({
      translatedText: "manual correction",
      manuallyEdited: true,
      locked: true,
      updatedAt: now,
    });
    expect(result.translations[1]).toEqual(records[1]);
    expect(result.project.manuallyEditedBlockIds).toEqual(["block-1"]);
  });
});
