import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DocumentBlock,
  PaperSection,
  SemanticPaper,
} from "../src/types";

const llmProbe = vi.hoisted(() => ({
  active: 0,
  maxActive: 0,
  sections: [] as Array<{
    id: string;
    blocks: Array<{ id: string; type: string; text: string }>;
    logicalParagraphs?: Array<{
      id: string;
      blockIds: string[];
      text: string;
    }>;
  }>,
}));

vi.mock("../src/lib/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/llm")>();
  return {
    ...actual,
    completeChatWithUsage: vi.fn(async (_settings, messages) => {
      const user = messages.find(
        (message: { role: string }) => message.role === "user",
      );
      const payload = JSON.parse(user?.content ?? "{}") as {
        section?: (typeof llmProbe.sections)[number];
      };
      if (!payload.section) {
        return {
          content: '{"brief":"stable brief"}',
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            estimated: false,
          },
        };
      }

      llmProbe.sections.push(payload.section);
      llmProbe.active += 1;
      llmProbe.maxActive = Math.max(llmProbe.maxActive, llmProbe.active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      llmProbe.active -= 1;
      return {
        content: JSON.stringify({
        blocks: payload.section.blocks.map((block) => ({
          id: block.id,
          translation: `번역:${block.text}`,
        })),
        }),
        usage: {
          inputTokens: 20,
          outputTokens: 8,
          totalTokens: 28,
          estimated: false,
        },
      };
    }),
  };
});

import { DEFAULT_LLM_SETTINGS } from "../src/lib/llm";
import { createRetypesetProject } from "../src/lib/semantic-paper";
import { translatePaperSections } from "../src/lib/section-translator";

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
    documentId: "strata",
    pageNumber,
    type: "paragraph",
    text,
    bbox: { x, y, width: 0.39, height: 0.08 },
    fontSize: 9,
    readingOrder,
    translatable: true,
  };
}

function section(
  id: string,
  blockIds: string[],
): PaperSection {
  return {
    id,
    title: id,
    level: 1,
    blockIds,
    childIds: [],
    topLevelId: id,
  };
}

function paperFor(
  blocks: DocumentBlock[],
  sections: PaperSection[],
): SemanticPaper {
  return {
    documentId: "strata",
    contentStartPage: 1,
    sections,
    assets: [],
    blockSectionIds: Object.fromEntries(
      sections.flatMap((item) =>
        item.blockIds.map((blockId) => [blockId, item.id]),
      ),
    ),
    translatableBlockIds: blocks.map((block) => block.id),
    preservedBlockIds: [],
    columnCount: 2,
    bodyFontStyle: "serif",
  };
}

async function translate(
  blocks: DocumentBlock[],
  sections: PaperSection[],
) {
  const project = {
    ...createRetypesetProject("strata", "ko", "default"),
    translationBrief: "stable brief",
  };
  return translatePaperSections({
    title: "Strata",
    paper: paperFor(blocks, sections),
    blocks,
    settings: DEFAULT_LLM_SETTINGS,
    project,
    existingTranslations: [],
  });
}

describe("logical paragraph translation", () => {
  beforeEach(() => {
    llmProbe.active = 0;
    llmProbe.maxActive = 0;
    llmProbe.sections = [];
  });

  it("sends Qwen and its cross-column continuation as one translation block", async () => {
    const qwen = paragraph(
      "qwen-left",
      2,
      0,
      "Leading models include Gemini, Claude 4, and the Qwen",
      0.08,
      0.8,
    );
    const series = paragraph(
      "qwen-right",
      2,
      1,
      "series [46], which support long context windows.",
      0.53,
      0.08,
    );

    const result = await translate(
      [qwen, series],
      [section("introduction", [qwen.id, series.id])],
    );

    expect(llmProbe.sections[0].blocks).toEqual([
      {
        id: "qwen-left",
        type: "paragraph",
        text:
          "Leading models include Gemini, Claude 4, and the Qwen series ⟦qwen_left_CITATION_1⟧, which support long context windows.",
      },
    ]);
    expect(result.translations.map((record) => record.blockId)).toEqual([
      "qwen-left",
    ]);
  });

  it("translates independent sections concurrently", async () => {
    const first = paragraph(
      "first",
      2,
      0,
      "The first section is complete.",
      0.08,
      0.1,
    );
    const second = paragraph(
      "second",
      3,
      0,
      "The second section is complete.",
      0.08,
      0.1,
    );

    await translate(
      [first, second],
      [
        section("first-section", [first.id]),
        section("second-section", [second.id]),
      ],
    );

    expect(llmProbe.maxActive).toBeGreaterThanOrEqual(2);
  });
});
