import { invoke } from "@tauri-apps/api/core";
import type {
  AskEvidence,
  DictionaryEntry,
  LlmSettings,
  LlmTokenUsage,
  ModelConnectionProfile,
  TranslationRecord,
} from "../types";
import { runningInTauri } from "./platform";
import { estimatedTokenUsage } from "./token-usage";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCompletionResult = {
  content: string;
  usage: LlmTokenUsage;
};

type RawLlmCompletionResult = {
  content: string;
  usage?: Partial<LlmTokenUsage> & {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
};

function completionInput(messages: LlmMessage[]): string {
  return messages
    .map((message) => `${message.role}\n${message.content}`)
    .join("\n");
}

function exactTokenUsage(
  usage: RawLlmCompletionResult["usage"],
): LlmTokenUsage | undefined {
  const inputTokens =
    usage?.inputTokens ?? usage?.input_tokens ?? usage?.prompt_tokens;
  const outputTokens =
    usage?.outputTokens ??
    usage?.output_tokens ??
    usage?.completion_tokens;
  const totalTokens =
    usage?.totalTokens ??
    usage?.total_tokens ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    typeof totalTokens !== "number"
  ) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimated: usage?.estimated === true,
  };
}

function normalizeCompletion(
  result: RawLlmCompletionResult,
  messages: LlmMessage[],
): LlmCompletionResult {
  const content = result.content.trim();
  if (!content) throw new Error("LLM 응답 내용이 비어 있습니다.");
  return {
    content,
    usage:
      exactTokenUsage(result.usage) ??
      estimatedTokenUsage(completionInput(messages), content),
  };
}

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

export type CodexModelOption = {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: ModelConnectionProfile["effort"];
  supportedReasoningEfforts: ModelConnectionProfile["effort"][];
};

const REASONING_EFFORTS = new Set<ModelConnectionProfile["effort"]>([
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function reasoningEffort(
  value: unknown,
  fallback: ModelConnectionProfile["effort"] = "default",
): ModelConnectionProfile["effort"] {
  return typeof value === "string" &&
    REASONING_EFFORTS.has(value as ModelConnectionProfile["effort"])
    ? (value as ModelConnectionProfile["effort"])
    : fallback;
}

export function normalizeCodexModelCatalog(
  payload: unknown,
): CodexModelOption[] {
  const data =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as Record<string, unknown>;
    const id =
      typeof model.model === "string" && model.model.trim()
        ? model.model.trim()
        : typeof model.id === "string"
          ? model.id.trim()
          : "";
    if (!id || model.hidden === true) return [];
    const effortEntries = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
      : [];
    const supportedReasoningEfforts = effortEntries.flatMap((item) => {
      const value =
        item && typeof item === "object"
          ? (item as { reasoningEffort?: unknown }).reasoningEffort
          : item;
      const normalized = reasoningEffort(value, "default");
      return normalized === "default" && value !== "default"
        ? []
        : [normalized];
    });
    return [
      {
        id,
        displayName:
          typeof model.displayName === "string" && model.displayName.trim()
            ? model.displayName.trim()
            : id,
        isDefault: model.isDefault === true,
        defaultReasoningEffort: reasoningEffort(
          model.defaultReasoningEffort,
        ),
        supportedReasoningEfforts,
      },
    ];
  });
}

type CodexCompletionRequest = {
  messages: LlmMessage[];
  model?: string;
  effort?: LlmSettings["effort"];
};

type NativePdfUploadRequest = {
  endpoint: string;
  apiKey: string;
  bytes: number[];
  fileName: string;
};

type NativePdfQuestionRequest = {
  endpoint: string;
  apiKey: string;
  model: string;
  effort: LlmSettings["effort"];
  fileId: string;
  messages: LlmMessage[];
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

export function apiBaseUrl(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses)$/i, "");
}

export function supportsNativePdf(settings: LlmSettings): boolean {
  const profile = activeModelProfile(settings);
  return (
    profile.connectionMode === "api" &&
    profile.capabilities.includes("pdf-input")
  );
}

export function supportsRemoteFileDelete(settings: LlmSettings): boolean {
  return activeModelProfile(settings).capabilities.includes(
    "remote-file-delete",
  );
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

export async function listCodexModels(): Promise<CodexModelOption[]> {
  const payload = runningInTauri()
    ? await invoke<unknown>("codex_models")
    : await readJsonResponse<unknown>(
        await fetch("/__paperloom/codex/models"),
      );
  return normalizeCodexModelCatalog(payload);
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
  return (await completeChatWithUsage(settings, messages, signal)).content;
}

export async function completeChatWithUsage(
  settings: LlmSettings,
  messages: LlmMessage[],
  signal?: AbortSignal,
): Promise<LlmCompletionResult> {
  if (settings.connectionMode === "codex") {
    const content = await completeWithCodex(
      {
        messages,
        model: settings.codexModel.trim() || undefined,
        effort: settings.effort,
      },
      signal,
    );
    return normalizeCompletion({ content }, messages);
  }

  if (!settings.endpoint.trim() || !settings.model.trim()) {
    throw new Error("API endpoint와 모델명을 설정해 주세요.");
  }

  if (runningInTauri()) {
    const result = await invoke<RawLlmCompletionResult>("llm_chat", {
      request: {
        endpoint: chatCompletionsUrl(settings.endpoint),
        apiKey: settings.apiKey,
        model: settings.model,
        effort: settings.effort,
        messages,
      },
    });
    return normalizeCompletion(result, messages);
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
  const payload = await readJsonResponse<RawLlmCompletionResult>(response);
  if (!payload.content.trim()) throw new Error("LLM 응답 내용이 비어 있습니다.");
  return normalizeCompletion(payload, messages);
}

export async function uploadQuestionPdf(
  settings: LlmSettings,
  bytes: Uint8Array,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!supportsNativePdf(settings)) {
    throw new Error("현재 모델 프로필은 PDF 파일 입력을 지원하지 않습니다.");
  }
  const request: NativePdfUploadRequest = {
    endpoint: apiBaseUrl(settings.endpoint),
    apiKey: settings.apiKey,
    bytes: Array.from(bytes),
    fileName,
  };
  if (runningInTauri()) {
    return invoke<string>("llm_upload_pdf", { request });
  }
  const response = await fetch("/__paperloom/llm/upload-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const payload = await readJsonResponse<{ fileId: string }>(response);
  if (!payload.fileId.trim()) throw new Error("업로드된 PDF 식별자가 없습니다.");
  return payload.fileId;
}

export async function completeQuestionWithPdf(
  settings: LlmSettings,
  fileId: string,
  messages: LlmMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const request: NativePdfQuestionRequest = {
    endpoint: apiBaseUrl(settings.endpoint),
    apiKey: settings.apiKey,
    model: settings.model,
    effort: settings.effort,
    fileId,
    messages,
  };
  if (runningInTauri()) {
    return invoke<string>("llm_question_pdf", { request });
  }
  const response = await fetch("/__paperloom/llm/question-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const payload = await readJsonResponse<{ content: string }>(response);
  if (!payload.content.trim()) throw new Error("LLM 응답 내용이 비어 있습니다.");
  return payload.content;
}

export async function deleteQuestionPdf(
  settings: LlmSettings,
  fileId: string,
): Promise<void> {
  if (!supportsRemoteFileDelete(settings)) return;
  const request = {
    endpoint: apiBaseUrl(settings.endpoint),
    apiKey: settings.apiKey,
    fileId,
  };
  if (runningInTauri()) {
    await invoke("llm_delete_file", { request });
    return;
  }
  const response = await fetch("/__paperloom/llm/delete-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  await readJsonResponse<Record<string, never>>(response);
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
    logicalParagraphs?: Array<{
      id: string;
      blockIds: string[];
      text: string;
      sourceStyle?: {
        fontWeight?: "normal" | "bold";
        fontStyle?: "normal" | "italic";
        paragraphStart?: boolean;
        boldLead?: boolean;
      };
    }>;
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
        "Preserve every bracketed protection token exactly once and in its original position.",
        "When sourceStyle.boldLead is true, translate that lead as the first short sentence so it can retain bold emphasis.",
        "Render Figure N and Fig. N references as 그림 N, and Table N as 표 N, without changing N.",
        "Do not summarize or omit input blocks.",
        "Each input block is one complete logical paragraph assembled from the physical PDF fragments listed in logicalParagraphs. Return one translation for each input block id only.",
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
  selectedFocus = "",
): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        `Answer in ${language}.`,
        "Use the supplied paper as the complete background context.",
        "Do not use proceedings cover text, affiliations, author contact details, or bibliography entries as answer evidence.",
        "Citations that occur inside body prose may be discussed.",
        "Return only JSON as {answer:string,evidence:[{pageNumber:number,sectionTitle?:string,quote?:string}]}.",
        "Evidence must point to a page and section actually supplied. If a location cannot be verified, omit it.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        sourceText ? `Paper context:\n${sourceText}` : "The paper is attached as a PDF.",
        selectedFocus ? `Selected focus:\n${selectedFocus}` : "",
        `Question:\n${question}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export function digestSectionMessages(
  title: string,
  text: string,
): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "Summarize one academic-paper section for later question answering. Preserve claims, methods, assumptions, equations in words, named systems, results, limitations, and page markers. Do not add outside knowledge. Return plain text.",
    },
    {
      role: "user",
      content: `Section: ${title}\n\n${text}`,
    },
  ];
}

export function parseQuestionResponse(
  value: string,
  pageCount: number,
  knownSections: string[],
): { answer: string; evidence: AskEvidence[] } {
  let payload: Record<string, unknown>;
  try {
    payload = parseJsonObject(value);
  } catch {
    return { answer: stripCodeFence(value).trim(), evidence: [] };
  }
  const answer =
    typeof payload.answer === "string" && payload.answer.trim()
      ? payload.answer.trim()
      : stripCodeFence(value).trim();
  const sectionSet = new Set(knownSections.map((section) => section.trim()));
  const evidence = Array.isArray(payload.evidence)
    ? payload.evidence.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const item = candidate as Record<string, unknown>;
        if (
          typeof item.pageNumber !== "number" ||
          !Number.isInteger(item.pageNumber) ||
          item.pageNumber < 1 ||
          item.pageNumber > pageCount
        ) {
          return [];
        }
        const sectionTitle =
          typeof item.sectionTitle === "string" &&
          sectionSet.has(item.sectionTitle.trim())
            ? item.sectionTitle.trim()
            : undefined;
        const quote =
          typeof item.quote === "string" && item.quote.trim()
            ? item.quote.trim().slice(0, 320)
            : undefined;
        return [{ pageNumber: item.pageNumber, sectionTitle, quote }];
      })
    : [];
  const unique = new Map(
    evidence.map((item) => [
      `${item.pageNumber}:${item.sectionTitle ?? ""}:${item.quote ?? ""}`,
      item,
    ]),
  );
  return { answer, evidence: [...unique.values()].slice(0, 8) };
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
