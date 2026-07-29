import { describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  analyzeDocumentSession,
  loadDocumentSessionBundle,
  needsDocumentAnalysis,
  prepareDocumentSession,
  type DocumentSessionDependencies,
} from "../src/lib/document-session-workflow";
import type { ReaderDocument } from "../src/types";

function reader(overrides: Partial<ReaderDocument> = {}): ReaderDocument {
  return {
    id: "legacy-id",
    filePath: "C:\\old.pdf",
    title: "Old",
    pageCount: 3,
    lastOpenedAt: "2026-07-27T00:00:00.000Z",
    viewState: {
      pageNumber: 2,
      relativeOffsetY: 0.4,
      scaleValue: "page-width",
      scale: 1,
      rotation: 0,
    },
    splitMode: "side-by-side",
    syncEnabled: false,
    fileHash: "hash",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<DocumentSessionDependencies> = {},
): DocumentSessionDependencies {
  const pdf = {
    numPages: 3,
    cleanup: vi.fn(async () => undefined),
  } as unknown as PDFDocumentProxy;
  return {
    hashBytes: vi.fn(async () => "hash"),
    stableId: vi.fn(() => "path-id"),
    idFromHash: vi.fn(() => "hash-id"),
    loadPdf: vi.fn(async () => pdf),
    findByIdentity: vi.fn(async () => null),
    extractTitle: vi.fn(async () => "Paper"),
    makeDocument: vi.fn(
      (id, filePath, title, pageCount, fileHash, previous) => ({
        ...reader(),
        id,
        filePath,
        title,
        pageCount,
        fileHash,
        viewState: previous?.viewState ?? reader().viewState,
      }),
    ),
    listBlocks: vi.fn(async () => []),
    listTranslations: vi.fn(async () => []),
    listHighlights: vi.fn(async () => []),
    listNotes: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    loadProject: vi.fn(async () => null),
    extractBlocks: vi.fn(async () => []),
    saveBlocks: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("document session workflow", () => {
  it("preserves the existing document identity found by content hash", async () => {
    const previous = reader();
    const deps = dependencies({
      findByIdentity: vi.fn(async () => previous),
    });

    const prepared = await prepareDocumentSession(
      new Uint8Array([1, 2, 3]),
      "C:\\renamed.pdf",
      deps,
    );

    expect(prepared.document.id).toBe("legacy-id");
    expect(prepared.document.filePath).toBe("C:\\renamed.pdf");
    expect(prepared.document.viewState).toEqual(previous.viewState);
    expect(prepared.sourceBytes).not.toBe(prepared.inputBytes);
  });

  it("discards hydrated records after the active document changes", async () => {
    let current = true;
    const deps = dependencies({
      listBlocks: vi.fn(async () => {
        current = false;
        return [];
      }),
    });

    const bundle = await loadDocumentSessionBundle(
      "paper",
      deps,
      () => current,
    );

    expect(bundle).toBeNull();
  });

  it("recognizes current extraction records and rejects legacy versions", () => {
    const block = {
      id: "paper-p1-v10-b1",
      documentId: "paper",
      pageNumber: 1,
      type: "paragraph" as const,
      text: "text",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      readingOrder: 1,
      translatable: true,
    };

    expect(needsDocumentAnalysis([block])).toBe(false);
    expect(
      needsDocumentAnalysis([{ ...block, id: "paper-p1-v9-b1" }]),
    ).toBe(true);
    expect(needsDocumentAnalysis([])).toBe(true);
  });

  it("persists a completed extraction but does not return it to a stale session", async () => {
    let current = true;
    const extracted = [
      {
        id: "paper-p1-v10-b1",
        documentId: "paper",
        pageNumber: 1,
        type: "paragraph" as const,
        text: "text",
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        readingOrder: 1,
        translatable: true,
      },
    ];
    const deps = dependencies({
      extractBlocks: vi.fn(async () => {
        current = false;
        return extracted;
      }),
    });

    const result = await analyzeDocumentSession(
      {} as PDFDocumentProxy,
      "paper",
      deps,
      () => current,
    );

    expect(deps.saveBlocks).toHaveBeenCalledWith("paper", extracted);
    expect(result).toBeNull();
  });
});
