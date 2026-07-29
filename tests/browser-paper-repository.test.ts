import { describe, expect, it } from "vitest";
import { createBrowserPaperRepository } from "../src/lib/browser-paper-repository";
import { DEFAULT_VIEW_STATE } from "../src/lib/reader-state";
import type {
  ReaderDocument,
  TranslationRecord,
} from "../src/types";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("browser paper repository", () => {
  it("reconnects renamed documents by content identity", async () => {
    const repository = createBrowserPaperRepository(memoryStorage());
    const document: ReaderDocument = {
      id: "document",
      filePath: "browser://old-name.pdf",
      title: "Paper",
      pageCount: 3,
      lastOpenedAt: "2026-07-29T00:00:00.000Z",
      viewState: DEFAULT_VIEW_STATE,
      splitMode: "side-by-side",
      syncEnabled: false,
      fileHash: "same-content",
      tags: [],
      translationProgress: 0,
    };

    await repository.saveDocument(document);

    expect(
      await repository.findDocumentByIdentity(
        "same-content",
        "different-id",
      ),
    ).toMatchObject(document);
  });

  it("upserts translations without discarding other checkpoints", async () => {
    const repository = createBrowserPaperRepository(memoryStorage());
    const record = (
      id: string,
      translatedText: string,
    ): TranslationRecord => ({
      id,
      documentId: "paper",
      blockId: id,
      targetLanguage: "ko",
      sourceText: id,
      translatedText,
      status: "translated",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });

    await repository.saveTranslations([
      record("first", "첫 번째"),
      record("second", "두 번째"),
    ]);
    await repository.saveTranslations([record("first", "수정됨")]);

    expect(
      await repository.listTranslations("paper", "ko"),
    ).toEqual([
      record("first", "수정됨"),
      record("second", "두 번째"),
    ]);
  });
});
