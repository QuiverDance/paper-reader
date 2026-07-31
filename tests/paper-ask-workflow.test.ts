import { describe, expect, it, vi } from "vitest";
import {
  runPaperQuestion,
  type PaperAskDependencies,
  type PaperAskInput,
} from "../src/lib/paper-ask-workflow";
import { modelConnectionSignature } from "../src/lib/llm";
import type {
  DocumentBlock,
  LlmSettings,
  ReaderDocument,
  RetypesetProject,
  SemanticPaper,
} from "../src/types";

const timestamp = "2026-07-28T10:00:00.000Z";

function settings(capabilities: string[] = []): LlmSettings {
  return {
    profiles: [
      {
        id: "profile",
        name: "Model",
        connectionMode: "api",
        endpoint: "https://example.test/v1",
        apiKey: "secret",
        model: "model",
        codexModel: "",
        maxContextSize: 128_000,
        effort: "high",
        capabilities,
      },
    ],
    activeProfileId: "profile",
    connectionMode: "api",
    endpoint: "https://example.test/v1",
    apiKey: "secret",
    model: "model",
    codexModel: "",
    maxContextSize: 128_000,
    effort: "high",
    targetLanguage: "ko",
    instructions: "",
  };
}

function readerDocument(): ReaderDocument {
  return {
    id: "paper",
    filePath: "C:\\paper.pdf",
    title: "Paper",
    pageCount: 2,
    lastOpenedAt: timestamp,
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
}

function blocks(): DocumentBlock[] {
  return [
    {
      id: "block",
      documentId: "paper",
      pageNumber: 1,
      type: "paragraph",
      text: "A source paragraph.",
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
      readingOrder: 1,
      translatable: true,
    },
  ];
}

function paper(): SemanticPaper {
  return {
    documentId: "paper",
    contentStartPage: 1,
    sections: [
      {
        id: "section",
        title: "Introduction",
        level: 1,
        blockIds: ["block"],
        childIds: [],
        topLevelId: "section",
      },
    ],
    assets: [],
    blockSectionIds: { block: "section" },
    translatableBlockIds: ["block"],
    preservedBlockIds: [],
    columnCount: 1,
    bodyFontStyle: "serif",
  };
}

function project(
  overrides: Partial<RetypesetProject> = {},
): RetypesetProject {
  return {
    id: "paper:ko",
    documentId: "paper",
    targetLanguage: "ko",
    profileId: "profile",
    translationBrief: "",
    manuallyEditedBlockIds: [],
    sourceFallbackBlockIds: [],
    acknowledgedWarningIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function input(overrides: Partial<PaperAskInput> = {}): PaperAskInput {
  return {
    document: readerDocument(),
    settings: settings(),
    pageCount: 2,
    pdfBytes: new Uint8Array([1, 2, 3]),
    blocks: blocks(),
    paper: paper(),
    selectionText: "",
    sessions: [],
    project: null,
    question: "What is the contribution?",
    signal: new AbortController().signal,
    isCurrent: () => true,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<PaperAskDependencies> = {},
): PaperAskDependencies {
  let id = 0;
  return {
    now: () => timestamp,
    createId: (prefix) => `${prefix}-${++id}`,
    delay: vi.fn(async () => undefined),
    confirmNativePdfUpload: vi.fn(async () => true),
    createProject: vi.fn((_documentId, _language, _profileId, previous) =>
      previous ?? project(),
    ),
    saveProject: vi.fn(async () => undefined),
    saveSession: vi.fn(async () => undefined),
    uploadPdf: vi.fn(async () => "file-new"),
    completeWithPdf: vi.fn(async () =>
      JSON.stringify({ answer: "Native answer", evidence: [] }),
    ),
    completeText: vi.fn(async () =>
      JSON.stringify({ answer: "Text answer", evidence: [] }),
    ),
    ...overrides,
  };
}

describe("paper Ask workflow", () => {
  it("persists the user question before the answer and then completes the session", async () => {
    const savedMessageCounts: number[] = [];
    const deps = dependencies({
      saveSession: vi.fn(async (session) => {
        savedMessageCounts.push(session.messages.length);
      }),
    });

    const result = await runPaperQuestion(input(), deps);

    expect(result.status).toBe("completed");
    expect(savedMessageCounts).toEqual([1, 2]);
    if (result.status === "completed") {
      expect(result.session.messages[1]).toMatchObject({
        role: "assistant",
        content: "Text answer",
        contextMode: "full-text",
      });
    }
  });

  it("reuses a profile-specific native PDF id without another upload prompt", async () => {
    const nativeSettings = settings(["pdf-input"]);
    const signature = modelConnectionSignature(nativeSettings);
    const existingProject = project({
      nativePdfFileIds: { [signature]: "file-existing" },
    });
    const deps = dependencies();

    const result = await runPaperQuestion(
      input({
        settings: nativeSettings,
        project: existingProject,
      }),
      deps,
    );

    expect(result.status).toBe("completed");
    expect(deps.confirmNativePdfUpload).not.toHaveBeenCalled();
    expect(deps.uploadPdf).not.toHaveBeenCalled();
    expect(deps.completeWithPdf).toHaveBeenCalledWith(
      nativeSettings,
      "file-existing",
      expect.any(Array),
      expect.any(AbortSignal),
    );
  });

  it("discards a late model response after the active document changes", async () => {
    let current = true;
    const deps = dependencies({
      completeText: vi.fn(async () => {
        current = false;
        return JSON.stringify({ answer: "Late answer", evidence: [] });
      }),
    });

    const result = await runPaperQuestion(
      input({ isCurrent: () => current }),
      deps,
    );

    expect(result.status).toBe("cancelled");
    expect(deps.saveSession).toHaveBeenCalledOnce();
  });
});
