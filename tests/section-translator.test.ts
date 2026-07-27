import { describe, expect, it } from "vitest";
import {
  protectCitations,
  restoreProtectedText,
} from "../src/lib/section-translator";

describe("section translation protection", () => {
  it("round-trips numeric and author-year citations exactly", () => {
    const source = "Prior work [12, 14] agrees (Smith et al., 2024).";
    const protectedText = protectCitations(source);
    expect(protectedText.text).not.toContain("[12, 14]");
    expect(
      restoreProtectedText(
        `선행 연구 ${protectedText.markers[0].token}는 동의한다 ${protectedText.markers[1].token}.`,
        protectedText.markers,
      ),
    ).toContain("[12, 14]");
  });

  it("rejects a missing citation marker", () => {
    const protectedText = protectCitations("Result [7].");
    expect(() =>
      restoreProtectedText("결과.", protectedText.markers),
    ).toThrow("보존 표식");
  });
});
