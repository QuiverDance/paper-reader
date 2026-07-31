import { useCallback, useEffect, useRef, useState } from "react";
import {
  activeModelProfile,
  completeChat,
  completeQuestionWithPdf,
  supportsRemoteFileDelete,
  uploadQuestionPdf,
} from "../lib/llm";
import {
  mergePaperAskSession,
  runPaperQuestion,
  type PaperAskDependencies,
} from "../lib/paper-ask-workflow";
import { createRetypesetProject } from "../lib/semantic-paper";
import {
  saveChatSession,
  saveRetypesetProject,
} from "../lib/storage";
import type {
  ChatSession,
  DocumentBlock,
  LlmSettings,
  ReaderDocument,
  RetypesetProject,
  SemanticPaper,
  TextSelection,
} from "../types";

type UsePaperAskOptions = {
  document: ReaderDocument | null;
  settings: LlmSettings | null;
  pageCount: number;
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  selection: TextSelection | null;
  project: RetypesetProject | null;
  hydration: {
    documentId: string;
    sessions: ChatSession[];
  } | null;
  getPdfBytes: () => Uint8Array | null;
  getActiveDocumentId: () => string | null;
  onProjectChange: (project: RetypesetProject) => void;
  onError: (message: string | null) => void;
  onActivate: () => void;
};

function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function usePaperAsk({
  document,
  settings,
  pageCount,
  blocks,
  paper,
  selection,
  project,
  hydration,
  getPdfBytes,
  getActiveDocumentId,
  onProjectChange,
  onError,
  onActivate,
}: UsePaperAskOptions) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [asking, setAsking] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAsking(false);
    setStreamingAnswer("");
  }, []);

  const reset = useCallback(() => {
    cancel();
    setSessions([]);
  }, [cancel]);

  const restore = useCallback(
    (savedSessions: ChatSession[]) => {
      cancel();
      setSessions(savedSessions);
    },
    [cancel],
  );

  useEffect(() => {
    reset();
  }, [document?.id, reset]);

  useEffect(() => {
    if (!document || hydration?.documentId !== document.id) return;
    restore(hydration.sessions);
  }, [document?.id, hydration, restore]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const confirmNativePdfUpload = useCallback(
    async (nextSettings: LlmSettings) => {
      const deletion = supportsRemoteFileDelete(nextSettings)
        ? "프로필 연결 삭제 시 원격 삭제도 요청합니다."
        : "이 제공자는 원격 파일 삭제를 보장하지 않는 것으로 설정되어 있습니다.";
      return window.confirm(
        [
          `${activeModelProfile(nextSettings).name}에 원본 PDF 전체를 전송합니다.`,
          "",
          "본문, 표·그림·수식, 참고문헌이 파일 단위로 전송되지만 답변 근거에서는 참고문헌을 제외하도록 지시합니다.",
          deletion,
        ].join("\n"),
      );
    },
    [],
  );

  const ask = useCallback(
    async (question: string) => {
      const pdfBytes = getPdfBytes();
      if (
        !document ||
        !settings ||
        !pageCount ||
        !pdfBytes ||
        asking
      ) {
        return;
      }
      const documentId = document.id;
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      const isCurrent = () =>
        !controller.signal.aborted &&
        getActiveDocumentId() === documentId;
      const dependencies: PaperAskDependencies = {
        now: () => new Date().toISOString(),
        createId,
        delay,
        confirmNativePdfUpload,
        createProject: createRetypesetProject,
        saveProject: saveRetypesetProject,
        saveSession: saveChatSession,
        uploadPdf: uploadQuestionPdf,
        completeWithPdf: completeQuestionWithPdf,
        completeText: completeChat,
      };

      setAsking(true);
      setStreamingAnswer("");
      onError(null);
      onActivate();
      const result = await runPaperQuestion(
        {
          document,
          settings,
          pageCount,
          pdfBytes,
          blocks,
          paper,
          selectionText: selection?.text ?? "",
          sessions,
          project,
          question,
          signal: controller.signal,
          isCurrent,
        },
        dependencies,
        {
          onSession: (session) => {
            if (isCurrent()) {
              setSessions((current) =>
                mergePaperAskSession(session, current),
              );
            }
          },
          onStreaming: (content) => {
            if (isCurrent()) setStreamingAnswer(content);
          },
          onProject: (nextProject) => {
            if (isCurrent()) onProjectChange(nextProject);
          },
        },
      );
      if (isCurrent() && result.status === "failed") {
        onError(result.error);
      }
      if (isCurrent()) {
        setAsking(false);
        setStreamingAnswer("");
      }
      if (abortRef.current === controller) abortRef.current = null;
    },
    [
      asking,
      blocks,
      confirmNativePdfUpload,
      document,
      getActiveDocumentId,
      getPdfBytes,
      onActivate,
      onError,
      onProjectChange,
      pageCount,
      paper,
      project,
      selection,
      sessions,
      settings,
    ],
  );

  return {
    sessions,
    asking,
    streamingAnswer,
    ask,
    cancel,
    reset,
    restore,
  };
}
