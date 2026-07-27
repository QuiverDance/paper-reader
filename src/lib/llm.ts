import { invoke } from "@tauri-apps/api/core";
import type {
  DictionaryEntry,
  LlmSettings,
  ModelConnectionProfile,
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

export type CodexAuthStatus = {
  available: boolean;
  authenticated: boolean;
  message: string;
};

type CodexCompletionRequest = {
  messages: LlmMessage[];
  model?: string;
  effort?: LlmSettings["effort"];
};

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  profiles: [
    {
      id: "openai-default",
      name: "OpenAI API",
      connectionMode: "api",
      endpoint: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1-mini",
      codexModel: "",
      maxContextSize: 128000,
      effort: "default",
      capabilities: [],
    },
  ],
  activeProfileId: "openai-default",
  connectionMode: "api",
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4.1-mini",
  codexModel: "",
  maxContextSize: 128000,
  effort: "default",
  targetLanguage: "ko",
  instructions: "",
};

export function activeModelProfile(
  settings: LlmSettings,
): ModelConnectionProfile {
  return (
    settings.profiles.find(
      (profile) => profile.id === settings.activeProfileId,
    ) ?? {
      id: settings.activeProfileId || "legacy-default",
      name:
        settings.connectionMode === "codex" ? "Codex 로그인" : "API 연결",
      connectionMode: settings.connectionMode,
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      codexModel: settings.codexModel,
      maxContextSize: settings.maxContextSize || 128000,
      effort: settings.effort || "default",
      capabilities: [],
      beta: settings.connectionMode === "codex",
    }
  );
}

export function applyModelProfile(
  settings: LlmSettings,
  profile: ModelConnectionProfile,
): LlmSettings {
  return {
    ...settings,
    activeProfileId: profile.id,
    connectionMode: profile.connectionMode,
    endpoint: profile.endpoint,
    apiKey: profile.apiKey,
    model: profile.model,
    codexModel: profile.codexModel,
    maxContextSize: profile.maxContextSize,
    effort: profile.effort,
  };
}

export function modelConnectionSignature(settings: LlmSettings): string {
  const profile = activeModelProfile(settings);
  return [
    profile.id,
    profile.connectionMode,
    profile.endpoint.trim(),
    profile.model.trim(),
    profile.codexModel.trim(),
  ].join("|");
}

export function normalizeLlmSettings(
  value: Partial<LlmSettings> = {},
): LlmSettings {
  const merged: LlmSettings = {
    ...DEFAULT_LLM_SETTINGS,
    ...value,
    profiles: value.profiles?.length
      ? value.profiles.map((profile) => ({
          ...profile,
          maxContextSize: profile.maxContextSize || 128000,
          effort: profile.effort || "default",
          capabilities: profile.capabilities ?? [],
        }))
      : [],
  };
  if (!merged.profiles.length) {
    merged.profiles = [
      {
        id: merged.connectionMode === "codex" ? "codex-default" : "api-default",
        name: merged.connectionMode === "codex" ? "Codex 로그인" : "API 연결",
        connectionMode: merged.connectionMode,
        endpoint: merged.endpoint,
        apiKey: merged.apiKey,
        model: merged.model,
        codexModel: merged.codexModel,
        maxContextSize: merged.maxContextSize || 128000,
        effort: merged.effort || "default",
        capabilities: [],
        beta: merged.connectionMode === "codex",
      },
    ];
  }
  const active =
    merged.profiles.find(
      (profile) => profile.id === merged.activeProfileId,
    ) ?? merged.profiles[0];
  return applyModelProfile(
    {
      ...merged,
      activeProfileId: active.id,
    },
    active,
  );
}

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

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error || `로컬 LLM 연결 실패 (${response.status})`);
  }
  if (!payload) throw new Error("로컬 LLM 응답을 읽지 못했습니다.");
  return payload;
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatus> {
  try {
    if (runningInTauri()) {
      return await invoke<CodexAuthStatus>("codex_auth_status");
    }
    const response = await fetch("/__paperloom/codex/status");
    return readJsonResponse<CodexAuthStatus>(response);
  } catch (cause) {
    return {
      available: false,
      authenticated: false,
      message:
        cause instanceof Error
          ? cause.message
          : "Paperloom 실행기를 통해 열어 주세요.",
    };
  }
}

export async function startCodexLogin(): Promise<CodexAuthStatus> {
  if (runningInTauri()) {
    return invoke<CodexAuthStatus>("codex_login");
  }
  const response = await fetch("/__paperloom/codex/login", { method: "POST" });
  return readJsonResponse<CodexAuthStatus>(response);
}

async function completeWithCodex(
  request: CodexCompletionRequest,
  signal?: AbortSignal,
): Promise<string> {
  if (runningInTauri()) {
    return invoke<string>("codex_complete", { request });
  }

  const response = await fetch("/__paperloom/codex/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const payload = await readJsonResponse<{ content: string }>(response);
  if (!payload.content.trim()) throw new Error("Codex 응답 내용이 비어 있습니다.");
  return payload.content;
}

export async function completeChat(
  settings: LlmSettings,
  messages: LlmMessage[],
  signal?: AbortSignal,
): Promise<string> {
  if (settings.connectionMode === "codex") {
    return completeWithCodex(
      {
        messages,
        model: settings.codexModel.trim() || undefined,
        effort: settings.effort,
      },
      signal,
    );
  }

  if (!settings.endpoint.trim() || !settings.model.trim()) {
    throw new Error("API endpoint와 모델명을 설정해 주세요.");
  }

  if (runningInTauri()) {
    return invoke<string>("llm_chat", {
      request: {
        endpoint: chatCompletionsUrl(settings.endpoint),
        apiKey: settings.apiKey,
        model: settings.model,
        effort: settings.effort,
        messages,
      },
    });
  }

  const response = await fetch("/__paperloom/llm/complete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      endpoint: chatCompletionsUrl(settings.endpoint),
      apiKey: settings.apiKey,
      model: settings.model,
      effort: settings.effort,
      messages,
    }),
    signal,
  });
  const payload = await readJsonResponse<{ content: string }>(response);
  if (!payload.content.trim()) throw new Error("LLM 응답 내용이 비어 있습니다.");
  return payload.content;
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

export function translationBriefMessages(
  targetLanguage: string,
  title: string,
  sections: Array<{ title: string; text: string }>,
  instructions = "",
): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "Create a compact translation brief for an academic paper. Identify domain, preferred terminology, voice, abbreviations, model and dataset names that must remain stable. Do not translate section headings. Return only valid JSON as {brief:string}.",
    },
    {
      role: "user",
      content: JSON.stringify({
        targetLanguage,
        title,
        instructions,
        sections,
      }),
    },
  ];
}

export function parseTranslationBriefResponse(value: string): string {
  const payload = parseJsonObject(value);
  if (typeof payload.brief !== "string" || !payload.brief.trim()) {
    throw new Error("논문 번역 기준 응답에 brief 값이 없습니다.");
  }
  return payload.brief.trim();
}

export function sectionTranslationMessages(
  targetLanguage: string,
  section: {
    id: string;
    title: string;
    subsections: string[];
    blocks: Array<{ id: string; type: string; text: string }>;
  },
  brief: string,
  instructions = "",
): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "Translate academic prose faithfully and naturally as a Korean academic paper.",
        "Translate body prose, explanatory footnotes, and captions only.",
        "Do not translate section headings.",
        "Preserve equations and citation markers exactly.",
        "Render Figure N and Fig. N references as 그림 N, and Table N as 표 N, without changing N.",
        "Do not summarize, omit, merge, or split input blocks.",
        "Return only valid JSON as {blocks:[{id,translation}]}.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        targetLanguage,
        translationBrief: brief,
        instructions,
        section,
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
  sectionId?: string,
): TranslationRecord {
  return {
    id: `${blockId}:${targetLanguage}`,
    documentId,
    blockId,
    targetLanguage,
    sourceText,
    translatedText,
    status: "translated",
    sectionId,
    manuallyEdited: false,
    locked: false,
    updatedAt: new Date().toISOString(),
  };
}
