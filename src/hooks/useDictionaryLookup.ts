import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeChat,
  dictionaryMessages,
  parseDictionaryResponse,
} from "../lib/llm";
import {
  findDictionaryEntry,
  saveDictionaryEntry,
} from "../lib/storage";
import type {
  DictionaryEntry,
  LlmSettings,
  ReaderDocument,
  TextSelection,
} from "../types";

type UseDictionaryLookupOptions = {
  document: ReaderDocument | null;
  settings: LlmSettings | null;
  getActiveDocumentId: () => string | null;
  onError: (message: string | null) => void;
};

function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function useDictionaryLookup({
  document,
  settings,
  getActiveDocumentId,
  onError,
}: UseDictionaryLookupOptions) {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const runRef = useRef(0);

  const reset = useCallback(() => {
    runRef.current += 1;
    setEntry(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reset();
  }, [document?.id, reset]);

  const lookup = useCallback(
    async (selection: TextSelection) => {
      if (!document || !settings) return;
      const word = selection.text.trim();
      if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) return;
      const documentId = document.id;
      const runId = runRef.current + 1;
      runRef.current = runId;
      const isCurrent = () =>
        runRef.current === runId &&
        getActiveDocumentId() === documentId;
      setLoading(true);
      setEntry(null);
      try {
        const cached = await findDictionaryEntry(
          documentId,
          word,
          selection.context,
        );
        if (!isCurrent()) return;
        if (cached) {
          setEntry(cached);
          return;
        }
        const response = await completeChat(
          settings,
          dictionaryMessages(word, selection.context, "ko"),
        );
        if (!isCurrent()) return;
        const parsed = parseDictionaryResponse(response);
        const nextEntry: DictionaryEntry = {
          id: createId("word"),
          documentId,
          word,
          context: selection.context,
          ...parsed,
          createdAt: new Date().toISOString(),
        };
        await saveDictionaryEntry(nextEntry);
        if (isCurrent()) setEntry(nextEntry);
      } catch (cause) {
        if (isCurrent()) {
          onError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [document, getActiveDocumentId, onError, settings],
  );

  return {
    entry,
    loading,
    lookup,
    close: () => setEntry(null),
  };
}
