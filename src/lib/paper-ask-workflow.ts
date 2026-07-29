import type {
  ChatMessage,
  ChatSession,
  LlmSettings,
  ReaderDocument,
  RetypesetProject,
  SemanticPaper,
  DocumentBlock,
} from "../types";
import {
  activeModelProfile,
  digestSectionMessages,
  modelConnectionSignature,
  parseQuestionResponse,
  questionMessages,
  supportsNativePdf,
  type LlmMessage,
} from "./llm";
import {
  buildDigestSectionInputs,
  buildPaperQuestionContext,
  paperContextMode,
} from "./paper-context";
import { fileNameFromPath } from "./platform";

export type PaperAskInput = {
  document: ReaderDocument;
  settings: LlmSettings;
  pageCount: number;
  pdfBytes: Uint8Array;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  selectionText: string;
  sessions: ChatSession[];
  project: RetypesetProject | null;
  question: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
};

export type PaperAskDependencies = {
  now: () => string;
  createId: (prefix: string) => string;
  delay: (milliseconds: number) => Promise<void>;
  confirmNativePdfUpload: (settings: LlmSettings) => Promise<boolean>;
  createProject: (
    documentId: string,
    targetLanguage: string,
    profileId: string,
    previous: RetypesetProject | null,
  ) => RetypesetProject;
  saveProject: (project: RetypesetProject) => Promise<void>;
  saveSession: (session: ChatSession) => Promise<void>;
  uploadPdf: (
    settings: LlmSettings,
    bytes: Uint8Array,
    fileName: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  completeWithPdf: (
    settings: LlmSettings,
    fileId: string,
    messages: LlmMessage[],
    signal?: AbortSignal,
  ) => Promise<string>;
  completeText: (
    settings: LlmSettings,
    messages: LlmMessage[],
    signal?: AbortSignal,
  ) => Promise<string>;
};

export type PaperAskCallbacks = {
  onSession?: (session: ChatSession) => void;
  onStreaming?: (content: string) => void;
  onProject?: (project: RetypesetProject) => void;
};

export type PaperAskResult =
  | {
      status: "completed";
      session: ChatSession;
      project: RetypesetProject;
    }
  | {
      status: "cancelled";
    }
  | {
      status: "failed";
      error: string;
      session: ChatSession;
      project: RetypesetProject | null;
    };

class CancelledPaperQuestion extends Error {}

function assertCurrent(input: PaperAskInput): void {
  if (input.signal.aborted || !input.isCurrent()) {
    throw new CancelledPaperQuestion();
  }
}

function isCancellation(cause: unknown, input: PaperAskInput): boolean {
  return (
    cause instanceof CancelledPaperQuestion ||
    input.signal.aborted ||
    !input.isCurrent() ||
    (cause instanceof DOMException && cause.name === "AbortError")
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function prependSession(
  session: ChatSession,
  sessions: ChatSession[],
): ChatSession[] {
  return [
    session,
    ...sessions.filter((candidate) => candidate.id !== session.id),
  ];
}

async function ensureQuestionDigest(
  input: PaperAskInput,
  project: RetypesetProject,
  contextSignature: string,
  dependencies: PaperAskDependencies,
  callbacks: PaperAskCallbacks,
): Promise<RetypesetProject> {
  if (
    project.questionDigest &&
    project.questionDigestSignature === contextSignature
  ) {
    return project;
  }

  const inputs = buildDigestSectionInputs(input.blocks, input.paper);
  const summaries: string[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    assertCurrent(input);
    callbacks.onStreaming?.(
      `논문 전체 질문 요약을 만드는 중 · ${index + 1}/${inputs.length}`,
    );
    const section = inputs[index];
    const summary = await dependencies.completeText(
      input.settings,
      digestSectionMessages(section.title, section.text),
      input.signal,
    );
    summaries.push(`## ${section.title}\n${summary.trim()}`);
  }
  assertCurrent(input);

  const nextProject: RetypesetProject = {
    ...project,
    questionDigest: summaries.join("\n\n"),
    questionDigestSignature: contextSignature,
    updatedAt: dependencies.now(),
  };
  await dependencies.saveProject(nextProject);
  assertCurrent(input);
  callbacks.onProject?.(nextProject);
  return nextProject;
}

export async function runPaperQuestion(
  input: PaperAskInput,
  dependencies: PaperAskDependencies,
  callbacks: PaperAskCallbacks = {},
): Promise<PaperAskResult> {
  const timestamp = dependencies.now();
  const existing = input.sessions[0];
  const session: ChatSession =
    existing ?? {
      id: dependencies.createId("chat"),
      documentId: input.document.id,
      title: input.question.slice(0, 50),
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  const userMessage: ChatMessage = {
    id: dependencies.createId("message"),
    sessionId: session.id,
    role: "user",
    content: input.question,
    sourceText: input.selectionText || undefined,
    createdAt: timestamp,
  };
  const withQuestion: ChatSession = {
    ...session,
    messages: [...session.messages, userMessage],
    updatedAt: timestamp,
  };
  let latestProject = input.project;

  try {
    assertCurrent(input);
    await dependencies.saveSession(withQuestion);
    assertCurrent(input);
    callbacks.onSession?.(withQuestion);
    callbacks.onStreaming?.("");

    latestProject =
      input.project ??
      dependencies.createProject(
        input.document.id,
        "ko",
        input.settings.activeProfileId,
        null,
      );
    if (!input.project) {
      await dependencies.saveProject(latestProject);
      assertCurrent(input);
      callbacks.onProject?.(latestProject);
    }

    const paperContext = buildPaperQuestionContext(
      input.blocks,
      input.paper,
    );
    const previousConversation = session.messages
      .slice(-6)
      .map(
        (message) =>
          `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`,
      )
      .join("\n");
    const focusedQuestion = previousConversation
      ? `Previous conversation:\n${previousConversation}\n\nNew question:\n${input.question}`
      : input.question;

    let contextMode: "native-pdf" | "full-text" | "digest";
    let response: string;
    if (supportsNativePdf(input.settings)) {
      contextMode = "native-pdf";
      const signature = modelConnectionSignature(input.settings);
      let fileId = latestProject.nativePdfFileIds?.[signature];
      if (!fileId) {
        if (!(await dependencies.confirmNativePdfUpload(input.settings))) {
          throw new Error("원본 PDF 전송을 취소했습니다.");
        }
        assertCurrent(input);
        callbacks.onStreaming?.("원본 PDF를 모델에 업로드하는 중");
        fileId = await dependencies.uploadPdf(
          input.settings,
          input.pdfBytes,
          fileNameFromPath(input.document.filePath),
          input.signal,
        );
        assertCurrent(input);
        latestProject = {
          ...latestProject,
          nativePdfFileIds: {
            ...(latestProject.nativePdfFileIds ?? {}),
            [signature]: fileId,
          },
          updatedAt: dependencies.now(),
        };
        await dependencies.saveProject(latestProject);
        assertCurrent(input);
        callbacks.onProject?.(latestProject);
      }
      response = await dependencies.completeWithPdf(
        input.settings,
        fileId,
        questionMessages(
          focusedQuestion,
          "",
          "ko",
          input.selectionText,
        ),
        input.signal,
      );
    } else {
      const mode = paperContextMode(
        paperContext,
        activeModelProfile(input.settings).maxContextSize,
        Boolean(
          latestProject.questionDigest &&
            latestProject.questionDigestSignature === paperContext.signature,
        ),
      );
      let sourceText: string;
      if (mode === "digest-required") {
        latestProject = await ensureQuestionDigest(
          input,
          latestProject,
          paperContext.signature,
          dependencies,
          callbacks,
        );
        sourceText = latestProject.questionDigest ?? "";
        contextMode = "digest";
      } else if (mode === "digest") {
        sourceText = latestProject.questionDigest ?? "";
        contextMode = "digest";
      } else {
        sourceText = paperContext.text;
        contextMode = "full-text";
      }
      response = await dependencies.completeText(
        input.settings,
        questionMessages(
          focusedQuestion,
          sourceText,
          "ko",
          input.selectionText,
        ),
        input.signal,
      );
    }
    assertCurrent(input);

    const parsed = parseQuestionResponse(
      response,
      input.pageCount,
      paperContext.sectionTitles,
    );
    for (let length = 12; length < parsed.answer.length; length += 12) {
      assertCurrent(input);
      callbacks.onStreaming?.(parsed.answer.slice(0, length));
      await dependencies.delay(10);
    }
    assertCurrent(input);

    const assistantMessage: ChatMessage = {
      id: dependencies.createId("message"),
      sessionId: session.id,
      role: "assistant",
      content: parsed.answer,
      contextMode,
      evidence: parsed.evidence,
      createdAt: dependencies.now(),
    };
    const completed: ChatSession = {
      ...withQuestion,
      messages: [...withQuestion.messages, assistantMessage],
      updatedAt: assistantMessage.createdAt,
    };
    await dependencies.saveSession(completed);
    assertCurrent(input);
    callbacks.onSession?.(completed);
    callbacks.onStreaming?.("");
    return {
      status: "completed",
      session: completed,
      project: latestProject,
    };
  } catch (cause) {
    callbacks.onStreaming?.("");
    if (isCancellation(cause, input)) {
      return { status: "cancelled" };
    }
    return {
      status: "failed",
      error: errorMessage(cause),
      session: withQuestion,
      project: latestProject,
    };
  }
}

export function mergePaperAskSession(
  session: ChatSession,
  sessions: ChatSession[],
): ChatSession[] {
  return prependSession(session, sessions);
}
