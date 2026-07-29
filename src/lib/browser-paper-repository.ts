import type {
  ChatSession,
  DictionaryEntry,
  DocumentBlock,
  Highlight,
  LlmSettings,
  Note,
  ReaderDocument,
  RetypesetProject,
  SplitMode,
  TranslationRecord,
  ViewState,
} from "../types";
import { normalizeLlmSettings } from "./llm";

const STORAGE_PREFIX = "paperloom.";

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export type BrowserPaperRepository = {
  listRecentDocuments: () => Promise<ReaderDocument[]>;
  findDocumentByIdentity: (
    fileHash: string,
    legacyId?: string,
  ) => Promise<ReaderDocument | null>;
  saveDocument: (document: ReaderDocument) => Promise<void>;
  updateReadingState: (
    id: string,
    viewState: ViewState,
    splitMode: SplitMode,
    syncEnabled: boolean,
  ) => Promise<void>;
  saveDocumentBlocks: (
    documentId: string,
    blocks: DocumentBlock[],
  ) => Promise<void>;
  listDocumentBlocks: (documentId: string) => Promise<DocumentBlock[]>;
  listTranslations: (
    documentId: string,
    targetLanguage?: string,
  ) => Promise<TranslationRecord[]>;
  saveTranslations: (translations: TranslationRecord[]) => Promise<void>;
  listHighlights: (documentId: string) => Promise<Highlight[]>;
  saveHighlight: (highlight: Highlight) => Promise<void>;
  deleteHighlight: (id: string) => Promise<void>;
  listNotes: (documentId: string) => Promise<Note[]>;
  saveNote: (note: Note) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  findDictionaryEntry: (
    documentId: string,
    word: string,
    context: string,
  ) => Promise<DictionaryEntry | null>;
  saveDictionaryEntry: (entry: DictionaryEntry) => Promise<void>;
  listChatSessions: (documentId: string) => Promise<ChatSession[]>;
  saveChatSession: (session: ChatSession) => Promise<void>;
  loadLlmSettings: () => Promise<LlmSettings>;
  saveLlmSettings: (settings: LlmSettings) => Promise<void>;
  loadRetypesetProject: (
    documentId: string,
  ) => Promise<RetypesetProject | null>;
  saveRetypesetProject: (project: RetypesetProject) => Promise<void>;
};

export function createBrowserPaperRepository(
  storage: BrowserStorage,
): BrowserPaperRepository {
  const read = <T>(key: string, fallback: T): T => {
    try {
      const value = storage.getItem(`${STORAGE_PREFIX}${key}`);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = <T>(key: string, value: T): void => {
    storage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  };
  const documents = () => read<ReaderDocument[]>("documents", []);
  const writeDocuments = (items: ReaderDocument[]) =>
    write("documents", items.slice(0, 1000));
  const upsert = <T extends { id: string }>(key: string, item: T) => {
    const items = read<T[]>(key, []);
    write(key, [item, ...items.filter((candidate) => candidate.id !== item.id)]);
  };
  const remove = <T extends { id: string }>(key: string, id: string) => {
    write(
      key,
      read<T[]>(key, []).filter((item) => item.id !== id),
    );
  };

  return {
    async listRecentDocuments() {
      return documents()
        .sort((left, right) =>
          right.lastOpenedAt.localeCompare(left.lastOpenedAt),
        )
        .slice(0, 20);
    },
    async findDocumentByIdentity(fileHash, legacyId) {
      const items = documents();
      return (
        items.find((document) => document.fileHash === fileHash) ??
        (legacyId
          ? items.find((document) => document.id === legacyId)
          : undefined) ??
        null
      );
    },
    async saveDocument(document) {
      const items = documents().filter(
        (candidate) =>
          candidate.id !== document.id &&
          candidate.filePath !== document.filePath,
      );
      writeDocuments([{ ...document, missing: false }, ...items]);
    },
    async updateReadingState(id, viewState, splitMode, syncEnabled) {
      const now = new Date().toISOString();
      writeDocuments(
        documents().map((document) =>
          document.id === id
            ? {
                ...document,
                viewState,
                splitMode,
                syncEnabled,
                lastOpenedAt: now,
              }
            : document,
        ),
      );
    },
    async saveDocumentBlocks(documentId, blocks) {
      const all = read<Record<string, DocumentBlock[]>>("blocks", {});
      all[documentId] = blocks;
      write("blocks", all);
    },
    async listDocumentBlocks(documentId) {
      return read<Record<string, DocumentBlock[]>>("blocks", {})[documentId] ?? [];
    },
    async listTranslations(documentId, targetLanguage) {
      return read<TranslationRecord[]>("translations", []).filter(
        (translation) =>
          translation.documentId === documentId &&
          (!targetLanguage || translation.targetLanguage === targetLanguage),
      );
    },
    async saveTranslations(translations) {
      const byId = new Map(
        read<TranslationRecord[]>("translations", []).map((item) => [
          item.id,
          item,
        ]),
      );
      for (const translation of translations) {
        byId.set(translation.id, translation);
      }
      write("translations", [...byId.values()]);
    },
    async listHighlights(documentId) {
      return read<Highlight[]>("highlights", []).filter(
        (highlight) => highlight.documentId === documentId,
      );
    },
    async saveHighlight(highlight) {
      upsert("highlights", highlight);
    },
    async deleteHighlight(id) {
      remove<Highlight>("highlights", id);
    },
    async listNotes(documentId) {
      return read<Note[]>("notes", []).filter(
        (note) => note.documentId === documentId,
      );
    },
    async saveNote(note) {
      upsert("notes", note);
    },
    async deleteNote(id) {
      remove<Note>("notes", id);
    },
    async findDictionaryEntry(documentId, word, context) {
      return (
        read<DictionaryEntry[]>("dictionary", []).find(
          (entry) =>
            entry.documentId === documentId &&
            entry.word.toLocaleLowerCase() === word.toLocaleLowerCase() &&
            entry.context === context,
        ) ?? null
      );
    },
    async saveDictionaryEntry(entry) {
      upsert("dictionary", entry);
    },
    async listChatSessions(documentId) {
      return read<ChatSession[]>("chat-sessions", []).filter(
        (session) => session.documentId === documentId,
      );
    },
    async saveChatSession(session) {
      upsert("chat-sessions", session);
    },
    async loadLlmSettings() {
      return normalizeLlmSettings(
        read<Partial<LlmSettings>>("llm-settings", {}),
      );
    },
    async saveLlmSettings(settings) {
      write("llm-settings", settings);
    },
    async loadRetypesetProject(documentId) {
      return (
        read<Record<string, RetypesetProject>>("retypeset-projects", {})[
          documentId
        ] ?? null
      );
    },
    async saveRetypesetProject(project) {
      const projects = read<Record<string, RetypesetProject>>(
        "retypeset-projects",
        {},
      );
      projects[project.documentId] = project;
      write("retypeset-projects", projects);
    },
  };
}

let repository: BrowserPaperRepository | null = null;

export function browserPaperRepository(): BrowserPaperRepository {
  repository ??= createBrowserPaperRepository(localStorage);
  return repository;
}
