import { extractDocumentBlocks } from "./document-blocks";
import type { DocumentSessionDependencies } from "./document-session-workflow";
import { extractPdfTitle, loadPdfDocument } from "./pdf";
import {
  documentIdFromHash,
  hashPdfBytes,
  stableDocumentId,
} from "./platform";
import {
  findDocumentByIdentity,
  listChatSessions,
  listDocumentBlocks,
  listHighlights,
  listNotes,
  listTranslations,
  loadRetypesetProject,
  makeReaderDocument,
  saveDocumentBlocks,
} from "./storage";

export const documentSessionDependencies: DocumentSessionDependencies = {
  hashBytes: hashPdfBytes,
  stableId: stableDocumentId,
  idFromHash: documentIdFromHash,
  loadPdf: loadPdfDocument,
  findByIdentity: findDocumentByIdentity,
  extractTitle: extractPdfTitle,
  makeDocument: makeReaderDocument,
  listBlocks: listDocumentBlocks,
  listTranslations,
  listHighlights,
  listNotes,
  listSessions: listChatSessions,
  loadProject: loadRetypesetProject,
  extractBlocks: extractDocumentBlocks,
  saveBlocks: saveDocumentBlocks,
};
