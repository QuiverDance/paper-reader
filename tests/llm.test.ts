import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiBaseUrl,
  completeChatWithUsage,
  parseQuestionResponse,
  parseDictionaryResponse,
  parseTranslationResponse,
  normalizeCodexModelCatalog,
  sectionTranslationMessages,
  supportsNativePdf,
} from "../src/lib/llm";
import { DEFAULT_LLM_SETTINGS } from "../src/lib/llm";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLM response parsing", () => {
  it("accepts fenced translation JSON and keeps requested block ids", () => {
    const parsed = parseTranslationResponse(
      '```json\n{"blocks":[{"id":"b2","translation":"둘"},{"id":"b1","translation":"하나"}]}\n```',
      ["b1", "b2"],
    );

    expect(parsed).toEqual([
      { blockId: "b1", text: "하나" },
      { blockId: "b2", text: "둘" },
    ]);
  });

  it("rejects translation responses with missing block ids", () => {
    expect(() =>
      parseTranslationResponse(
        '{"blocks":[{"id":"b1","translation":"하나"}]}',
        ["b1", "b2"],
      ),
    ).toThrow(/b2/);
  });

  it("tells the translator which PDF fragments form one logical paragraph", () => {
    const messages = sectionTranslationMessages(
      "ko",
      {
        id: "methods",
        title: "2 Methods",
        subsections: [],
        blocks: [
          { id: "tail", type: "paragraph", text: "The method" },
          { id: "head", type: "paragraph", text: "continues here." },
        ],
        logicalParagraphs: [
          {
            id: "tail",
            blockIds: ["tail", "head"],
            text: "The method continues here.",
          },
        ],
      },
      "Use consistent terminology.",
    );

    expect(messages[0].content).toContain(
      "one complete logical paragraph assembled from the physical PDF fragments",
    );
    expect(JSON.parse(messages[1].content).section.logicalParagraphs).toEqual([
      {
        id: "tail",
        blockIds: ["tail", "head"],
        text: "The method continues here.",
      },
    ]);
  });

  it("normalizes a dictionary response", () => {
    expect(
      parseDictionaryResponse(
        '{"lemma":"derive","partOfSpeech":"verb","meaning":"도출하다","contextMeaning":"결과를 얻다","explanation":"근거에서 결론을 얻는다는 뜻"}',
      ),
    ).toEqual({
      lemma: "derive",
      partOfSpeech: "verb",
      meaning: "도출하다",
      contextMeaning: "결과를 얻다",
      explanation: "근거에서 결론을 얻는다는 뜻",
    });
  });

  it("keeps only verifiable Ask evidence", () => {
    expect(
      parseQuestionResponse(
        JSON.stringify({
          answer: "핵심 답변",
          evidence: [
            { pageNumber: 3, sectionTitle: "Evaluation", quote: "measured" },
            { pageNumber: 99, sectionTitle: "Evaluation" },
            { pageNumber: 4, sectionTitle: "Invented" },
          ],
        }),
        12,
        ["Introduction", "Evaluation"],
      ),
    ).toEqual({
      answer: "핵심 답변",
      evidence: [
        { pageNumber: 3, sectionTitle: "Evaluation", quote: "measured" },
        { pageNumber: 4, sectionTitle: undefined, quote: undefined },
      ],
    });
  });

  it("uses native PDF only when the active API profile declares it", () => {
    expect(supportsNativePdf(DEFAULT_LLM_SETTINGS)).toBe(false);
    expect(
      supportsNativePdf({
        ...DEFAULT_LLM_SETTINGS,
        profiles: DEFAULT_LLM_SETTINGS.profiles.map((profile) => ({
          ...profile,
          capabilities: ["pdf-input"],
        })),
      }),
    ).toBe(true);
    expect(apiBaseUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("normalizes the signed-in Codex model catalog and its effort choices", () => {
    expect(
      normalizeCodexModelCatalog({
        data: [
          {
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6 Sol",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Faster" },
              { reasoningEffort: "medium", description: "Balanced" },
              { reasoningEffort: "high", description: "Deeper" },
            ],
          },
          {
            id: "hidden",
            model: "hidden",
            displayName: "Hidden",
            hidden: true,
            supportedReasoningEfforts: [],
          },
        ],
      }),
    ).toEqual([
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        isDefault: true,
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium", "high"],
      },
    ]);
  });

  it("uses exact API token counts when the provider returns usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: "done",
            usage: {
              inputTokens: 123,
              outputTokens: 17,
              totalTokens: 140,
              estimated: false,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    await expect(
      completeChatWithUsage(DEFAULT_LLM_SETTINGS, [
        { role: "user", content: "hello" },
      ]),
    ).resolves.toEqual({
      content: "done",
      usage: {
        inputTokens: 123,
        outputTokens: 17,
        totalTokens: 140,
        estimated: false,
      },
    });
  });

  it("marks token counts as estimated when a backend omits usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ content: "done" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await completeChatWithUsage(DEFAULT_LLM_SETTINGS, [
      { role: "user", content: "hello" },
    ]);
    expect(result.usage.estimated).toBe(true);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });
});
