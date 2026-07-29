import { describe, expect, it } from "vitest";
import {
  groupTranslationParagraphs,
  protectCitations,
  restoreProtectedText,
  translationNeedsRefresh,
} from "../src/lib/section-translator";
import type { DocumentBlock, TranslationRecord } from "../src/types";

function paragraph(
  id: string,
  pageNumber: number,
  readingOrder: number,
  text: string,
  x: number,
  y: number,
): DocumentBlock {
  return {
    id,
    documentId: "paper",
    pageNumber,
    type: "paragraph",
    text,
    bbox: { x, y, width: 0.39, height: 0.08 },
    fontSize: 9,
    readingOrder,
    translatable: true,
  };
}

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

  it("round-trips inline equations exactly", () => {
    const source =
      "Little's Law gives C = λ · L, X = λ · S, and X = C · S / L.";
    const protectedText = protectCitations(source);
    const mathMarkers = protectedText.markers.filter(({ token }) =>
      token.includes("MATH"),
    );

    expect(mathMarkers).toHaveLength(3);
    expect(
      restoreProtectedText(
        `리틀의 법칙은 ${mathMarkers[0].token}, ${mathMarkers[1].token}, ${mathMarkers[2].token}로 표현된다.`,
        mathMarkers,
      ),
    ).toContain("X = C · S / L");
  });

  it("rejects a missing citation marker", () => {
    const protectedText = protectCitations("Result [7].");
    expect(() =>
      restoreProtectedText("결과.", protectedText.markers),
    ).toThrow("보존 표식");
  });

  it("uses distinct citation markers for adjacent PDF fragments", () => {
    const left = protectCitations("Prior work [7] agrees.", "left_");
    const right = protectCitations("Later work [8] extends it.", "right_");

    expect(left.markers[0].token).not.toBe(right.markers[0].token);
  });

  it("regenerates ordinary translations but preserves locked corrections", () => {
    const record: TranslationRecord = {
      id: "translation",
      documentId: "paper",
      blockId: "block",
      targetLanguage: "ko",
      sourceText: "Source",
      translatedText: "번역",
      status: "translated",
      sectionId: "section",
      manuallyEdited: false,
      locked: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(translationNeedsRefresh(record, "section", false)).toBe(false);
    expect(translationNeedsRefresh(record, "section", true)).toBe(true);
    expect(
      translationNeedsRefresh(
        { ...record, manuallyEdited: true, locked: true },
        "section",
        true,
      ),
    ).toBe(false);
  });

  it("keeps an unfinished paragraph continuous across a column boundary", () => {
    const groups = groupTranslationParagraphs([
      paragraph(
        "left-bottom",
        2,
        0,
        "The cache remains effective even when the active context",
        0.08,
        0.8,
      ),
      paragraph(
        "right-top",
        2,
        1,
        "moves into the next storage tier.",
        0.53,
        0.08,
      ),
    ]);

    expect(groups).toEqual([
      {
        id: "left-bottom",
        blockIds: ["left-bottom", "right-top"],
        text:
          "The cache remains effective even when the active context moves into the next storage tier.",
      },
    ]);
  });

  it("keeps an unfinished paragraph continuous across a page boundary", () => {
    const groups = groupTranslationParagraphs([
      paragraph(
        "page-one-tail",
        1,
        4,
        "This scheduling policy reduces transfer overhead by",
        0.53,
        0.82,
      ),
      paragraph(
        "page-two-head",
        2,
        0,
        "reusing the prefix already present in host memory.",
        0.08,
        0.07,
      ),
    ]);

    expect(groups[0]).toMatchObject({
      blockIds: ["page-one-tail", "page-two-head"],
      text:
        "This scheduling policy reduces transfer overhead by reusing the prefix already present in host memory.",
    });
  });

  it("keeps a page-spanning paragraph continuous across an intervening caption", () => {
    const tail = paragraph(
      "page-tail",
      3,
      8,
      "The cache is partitioned into",
      0.53,
      0.86,
    );
    const caption = {
      ...paragraph(
        "figure-caption",
        4,
        3,
        "Figure 2. Cache hit rate by page size.",
        0.08,
        0.24,
      ),
      type: "figure-caption" as const,
    };
    const continuation = {
      ...paragraph(
        "page-continuation",
        4,
        6,
        "small fixed-size pages that preserve sequence order.",
        0.08,
        0.31,
      ),
      sourceStyle: { paragraphStart: false },
    };

    const groups = groupTranslationParagraphs([
      tail,
      caption,
      continuation,
    ]);

    expect(groups).toEqual([
      {
        id: "page-tail",
        blockIds: ["page-tail", "page-continuation"],
        text:
          "The cache is partitioned into small fixed-size pages that preserve sequence order.",
      },
      {
        id: "figure-caption",
        blockIds: ["figure-caption"],
        text: "Figure 2. Cache hit rate by page size.",
      },
    ]);
  });

  it("joins an uppercase sentence at the next page top when layout marks a continuation", () => {
    const tail = paragraph(
      "uppercase-tail",
      6,
      8,
      "The first sentence ends at the page boundary.",
      0.53,
      0.86,
    );
    const continuation = {
      ...paragraph(
        "uppercase-continuation",
        7,
        0,
        "This sentence still belongs to the same source paragraph.",
        0.08,
        0.08,
      ),
      sourceStyle: { paragraphStart: false },
    };

    expect(
      groupTranslationParagraphs([tail, continuation])[0],
    ).toMatchObject({
      blockIds: ["uppercase-tail", "uppercase-continuation"],
      text:
        "The first sentence ends at the page boundary. This sentence still belongs to the same source paragraph.",
    });
  });

  it("does not join completed paragraphs at a page boundary", () => {
    const groups = groupTranslationParagraphs([
      paragraph(
        "completed",
        1,
        4,
        "The first experiment ends here.",
        0.53,
        0.82,
      ),
      paragraph(
        "new-paragraph",
        2,
        0,
        "the next experiment uses a larger batch.",
        0.08,
        0.07,
      ),
    ]);

    expect(groups.map((group) => group.blockIds)).toEqual([
      ["completed"],
      ["new-paragraph"],
    ]);
  });

  it("does not merge across a manually locked translation", () => {
    const blocks = [
      paragraph(
        "left-bottom",
        2,
        0,
        "The cache remains effective even when the active context",
        0.08,
        0.8,
      ),
      paragraph(
        "right-top",
        2,
        1,
        "moves into the next storage tier.",
        0.53,
        0.08,
      ),
    ];

    expect(
      groupTranslationParagraphs(
        blocks,
        new Set(["right-top"]),
      ).map((group) => group.blockIds),
    ).toEqual([["left-bottom"], ["right-top"]]);
  });

  it("does not join prose across an omitted physical block", () => {
    const before = paragraph(
      "before-asset",
      3,
      4,
      "The scheduler reserves resources for",
      0.08,
      0.4,
    );
    const after = paragraph(
      "after-asset",
      3,
      6,
      "the next batch when capacity becomes available.",
      0.08,
      0.5,
    );

    expect(
      groupTranslationParagraphs([before, after]).map(
        (group) => group.blockIds,
      ),
    ).toEqual([["before-asset"], ["after-asset"]]);
  });
});
