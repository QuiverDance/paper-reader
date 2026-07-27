import { describe, expect, it } from "vitest";
import {
  parseDictionaryResponse,
  parseTranslationResponse,
} from "../src/lib/llm";

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
});
