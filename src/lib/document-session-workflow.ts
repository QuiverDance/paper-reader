import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  ChatSession,
  DocumentBlock,
  Highlight,
  Note,
  ReaderDocument,
  RetypesetProject,
  TranslationRecord,
} from "../types";

export type DocumentSessionDependencies = {
  hashBytes: (bytes: Uint8Array) => Promise<string>;
  stableId: (filePath: string) => string;
  idFromHash: (fileHash: string) => string;
  loadPdf: (bytes: Uint8Array) => Promise<PDFDocumentProxy>;
  findByIdentity: (
    fileHash: string,
    legacyId: string,
  ) => Promise<ReaderDocument | null>;
  extractTitle: (
    document: PDFDocumentProxy,
    fallback: string,
  ) => Promise<string>;
  makeDocument: (
    id: string,
    filePath: string,
    title: string,
    pageCount: number,
    fileHash: string,
    previous: ReaderDocument | null,
  ) => ReaderDocument;
  listBlocks: (documentId: string) => Promise<DocumentBlock[]>;
  listTranslations: (
    documentId: string,
    targetLanguage: string,
  ) => Promise<TranslationRecord[]>;
  listHighlights: (documentId: string) => Promise<Highlight[]>;
  listNotes: (documentId: string) => Promise<Note[]>;
  listSessions: (documentId: string) => Promise<ChatSession[]>;
  loadProject: (documentId: string) => Promise<RetypesetProject | null>;
  extractBlocks: (
    document: PDFDocumentProxy,
    documentId: string,
    onProgress?: (pageNumber: number, pageCount: number) => void,
  ) => Promise<DocumentBlock[]>;
  saveBlocks: (
    documentId: string,
    blocks: DocumentBlock[],
  ) => Promise<void>;
};

export type PreparedDocumentSession = {
  inputBytes: Uint8Array;
  sourceBytes: Uint8Array;
  pdf: PDFDocumentProxy;
  document: ReaderDocument;
  previous: ReaderDocument | null;
};

export type DocumentSessionBundle = {
  documentId: string;
  blocks: DocumentBlock[];
  translations: TranslationRecord[];
  highlights: Highlight[];
  notes: Note[];
  sessions: ChatSession[];
  project: RetypesetProject | null;
};

function fileNameFromPath(filePath: string): string {
  return (
    filePath.split(/[\\/]/).filter(Boolean).at(-1) ??
    "document.pdf"
  );
}

export async function prepareDocumentSession(
  inputBytes: Uint8Array,
  filePath: string,
  dependencies: DocumentSessionDependencies,
): Promise<PreparedDocumentSession> {
  const sourceBytes = new Uint8Array(inputBytes);
  const fileHash = await dependencies.hashBytes(sourceBytes);
  const legacyId = dependencies.stableId(filePath);
  const [pdf, previous] = await Promise.all([
    dependencies.loadPdf(sourceBytes.slice()),
    dependencies.findByIdentity(fileHash, legacyId),
  ]);
  const id = previous?.id ?? dependencies.idFromHash(fileHash);
  const title = await dependencies.extractTitle(
    pdf,
    fileNameFromPath(filePath),
  );
  return {
    inputBytes,
    sourceBytes,
    pdf,
    previous,
    document: dependencies.makeDocument(
      id,
      filePath,
      title,
      pdf.numPages,
      fileHash,
      previous,
    ),
  };
}

export async function loadDocumentSessionBundle(
  documentId: string,
  dependencies: DocumentSessionDependencies,
  isCurrent: () => boolean,
): Promise<DocumentSessionBundle | null> {
  const [
    blocks,
    translations,
    highlights,
    notes,
    sessions,
    project,
  ] = await Promise.all([
    dependencies.listBlocks(documentId),
    dependencies.listTranslations(documentId, "ko"),
    dependencies.listHighlights(documentId),
    dependencies.listNotes(documentId),
    dependencies.listSessions(documentId),
    dependencies.loadProject(documentId),
  ]);
  if (!isCurrent()) return null;
  return {
    documentId,
    blocks,
    translations,
    highlights,
    notes,
    sessions,
    project,
  };
}

export function needsDocumentAnalysis(blocks: DocumentBlock[]): boolean {
  return (
    !blocks.length ||
    blocks.some((block) => !block.id.includes("-v10-b"))
  );
}

export async function analyzeDocumentSession(
  document: PDFDocumentProxy,
  documentId: string,
  dependencies: DocumentSessionDependencies,
  isCurrent: () => boolean,
  onProgress?: (progress: number) => void,
): Promise<DocumentBlock[] | null> {
  const extracted = await dependencies.extractBlocks(
    document,
    documentId,
    (pageNumber, pageCount) => {
      if (isCurrent()) onProgress?.(pageNumber / pageCount);
    },
  );
  await dependencies.saveBlocks(documentId, extracted);
  return isCurrent() ? extracted : null;
}
