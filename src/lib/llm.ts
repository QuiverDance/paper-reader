import { invoke } from "@tauri-apps/api/core";
import type {
  DictionaryEntry,
  LlmSettings,
  TranslationRecord,
} from "../types";
import { runningInTauri } from "./platform";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type TranslationPayload = {
  blocks?: Array<{ id?: unknown; translation?: unknown }>;
};

type DictionaryPayload = {
  lemma?: unknown;
  partOfSpeech?: unknown;
  meaning?: unknown;
  contextMeaning?: unknown;
  explanation?: unknown;
};

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  targetLanguage: "ko",
  instructions: "",
};

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}
function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(stripCodeFence(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM 응답이 JSON 객체가 아닙니다.");
  }
  return parsed as Record<string, unknown>;
}

export function parseTranslationResponse(
  value: string,
  expectedBlockIds: string[],
): Array<{ blockId: string; text: string }> {
  const payload = parseJsonObject(value) as TranslationPayload;
  if (!Array.isArray(payload.blocks)) {
    throw new Error("번역 응답에 blocks 배열이 없습니다.");
  }
  const byId = new Map<string, string>();
  for (const block of payload.blocks) {
    if (
      typeof block.id === "string" &&
      typeof block.translation === "string"
    ) {
      byId.set(block.id, block.translation.trim());
    }
  }
  return expectedBlockIds.map((blockId) => {
    const text = byId.get(blockId);
    if (!text) throw new Error(`번역 응답에 ${blockId} 결과가 없습니다.`);
    return { blockId, text };
  });
}

export function parseDictionaryResponse(
  value: string,
): Pick<
  DictionaryEntry,
  | "lemma"
  | "partOfSpeech"
  | "meaning"
  | "contextMeaning"
  | "explanation"
> {
  const payload = parseJsonObject(value) as DictionaryPayload;
  const fields = [
    "lemma",
    "partOfSpeech",
    "meaning",
    "contextMeaning",
    "explanation",
  ] as const;
  for (const field of fields) {
    if (typeof payload[field] !== "string") {
      throw new Error(`단어 응답에 ${field} 값이 없습니다.`);
    }
  }
  return {
    lemma: payload.lemma as string,
    partOfSpeech: payload.partOfSpeech as string,
    meaning: payload.meaning as string,
    contextMeaning: payload.contextMeaning as string,
    explanation: payload.explanation as string,
  };
}

export function chatCompletionsUrl(endpoint: string): string {
  const normalized = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

export async function completeChat(
  settings: LlmSettings,
  messages: LlmMessage[],
  signal?: AbortSignal,
): Promise<string> {
  if (!settings.endpoint.trim() || !settings.model.trim()) {
    throw new Error("API endpoint와 모델명을 설정해 주세요.");
  }
  if (!settings.apiKey.trim()) {
    throw new Error("API key를 설정해 주세요.");
  }

  if (runningInTauri()) {
    return invoke<string>("llm_chat", {
      request: {
        endpoint: chatCompletionsUrl(settings.endpoint),
        apiKey: settings.apiKey,
        model: settings.model,
        messages,
      },
    });
  }

  const response = await fetch(chatCompletionsUrl(settings.endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model: settings.model, messages, stream: false }),
    signal,
  });
  const payload = (await response.json()) as CompletionResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || `LLM 요청 실패 (${response.status})`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 응답 내용이 비어 있습니다.");
  return content;
}

export function translationMessages(
  targetLanguage: string,
  blocks: Array<{ id: string; type: string; text: string }>,
  instructions = "",
): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "You translate academic writing faithfully. Preserve equations, citations, model names, dataset names, code identifiers, and Figure/Table numbers. Return only valid JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        targetLanguage,
        instructions,
        rules: [
          "Do not summarize.",
          "Return every input block id exactly once.",
          "Use {blocks:[{id,translation}]} as the response shape.",
        ],
        blocks,
      }),
    },
  ];
}

export function dictionaryMessages(
  word: string,
  context: string,
  language: string,
): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "Explain an English academic word in context. Return only valid JSON with lemma, partOfSpeech, meaning, contextMeaning, and explanation.",
    },
    {
      role: "user",
      content: JSON.stringify({ word, context, explanationLanguage: language }),
    },
  ];
}

export function questionMessages(
  question: string,
  sourceText: string,
  language: string,
): LlmMessage[] {
  return [
    {
      role: "system",
      content: `Answer in ${language}. Base the answer only on the supplied paper excerpt. State clearly when the excerpt is insufficient.`,
    },
    {
      role: "user",
      content: `Paper excerpt:\n${sourceText}\n\nQuestion:\n${question}`,
    },
  ];
}

export function makeTranslationRecord(
  documentId: string,
  blockId: string,
  sourceText: string,
  translatedText: string,
  targetLanguage: string,
): TranslationRecord {
  return {
    id: `${blockId}:${targetLanguage}`,
    documentId,
    blockId,
    targetLanguage,
    sourceText,
    translatedText,
    status: "translated",
    updatedAt: new Date().toISOString(),
  };
}
