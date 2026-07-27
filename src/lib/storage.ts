import Database from "@tauri-apps/plugin-sql";
import type {
  ChatMessage,
  ChatSession,
  DictionaryEntry,
  DocumentBlock,
  Highlight,
  LibraryFolder,
  LlmSettings,
  Note,
  ReaderDocument,
  RetypesetProject,
  ScannedPdfFile,
  SplitMode,
  TranslationJob,
  TranslationRecord,
  ViewState,
} from "../types";
import { DEFAULT_LLM_SETTINGS, normalizeLlmSettings } from "./llm";
import {
  readProviderSecret,
  runningInTauri,
  stableDocumentId,
  storeProviderSecret,
} from "./platform";
import { DEFAULT_VIEW_STATE } from "./reader-state";

const DATABASE_URL = "sqlite:paperloom.db";
const STORAGE_PREFIX = "paperloom.";

type DocumentRow = {
  id: string;
  file_path: string;
  title: string;
  page_count: number;
  last_opened_at: string;
  page_number: number;
  relative_offset_y: number;
  scale_value: string;
  scale: number;
  rotation: number;
  split_mode: SplitMode;
  sync_enabled: number;
  file_hash?: string | null;
  folder_id?: string | null;
  missing?: number | null;
  translation_progress?: number | null;
  tags?: string | null;
};

type TranslationRow = {
  id: string;
  document_id: string;
  block_id: string;
  target_language: string;
  source_text: string;
  translated_text: string;
  status: TranslationRecord["status"];
  error: string | null;
  section_id?: string | null;
  manually_edited?: number | null;
  locked?: number | null;
  updated_at: string;
};

let databasePromise: Promise<Database> | null = null;

function readBrowserValue<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeBrowserValue<T>(key: string, value: T): void {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
}

function rowToDocument(row: DocumentRow): ReaderDocument {
  return {
    id: row.id,
    filePath: row.file_path,
    title: row.title,
    pageCount: row.page_count,
    lastOpenedAt: row.last_opened_at,
    viewState: {
      pageNumber: row.page_number,
      relativeOffsetY: row.relative_offset_y,
      scaleValue: row.scale_value,
      scale: row.scale,
      rotation: row.rotation,
    },
    splitMode: row.split_mode,
    syncEnabled: Boolean(row.sync_enabled),
    fileHash: row.file_hash || undefined,
    folderId: row.folder_id || undefined,
    missing: Boolean(row.missing),
    tags: row.tags ? row.tags.split("\u001f").filter(Boolean) : [],
    translationProgress: row.translation_progress ?? 0,
  };
}

async function getDatabase(): Promise<Database> {
  if (!databasePromise) databasePromise = Database.load(DATABASE_URL);
  return databasePromise;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.file_path, d.title, d.page_count, d.last_opened_at,
         d.page_number, d.relative_offset_y, d.scale_value, d.scale, d.rotation,
         d.split_mode, d.sync_enabled, d.file_hash, d.folder_id, d.missing,
         d.translation_progress,
         COALESCE((
           SELECT GROUP_CONCAT(tag, char(31))
             FROM document_tags
            WHERE document_id = d.id
         ), '') AS tags
    FROM documents d`;

function browserDocuments(): ReaderDocument[] {
  return readBrowserValue<ReaderDocument[]>("documents", []);
}

function writeBrowserDocuments(documents: ReaderDocument[]): void {
  writeBrowserValue("documents", documents.slice(0, 1000));
}

export async function listRecentDocuments(): Promise<ReaderDocument[]> {
  if (!runningInTauri()) {
    return browserDocuments()
      .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
      .slice(0, 20);
  }
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `${DOCUMENT_SELECT} ORDER BY d.last_opened_at DESC LIMIT 20`,
  );
  return rows.map(rowToDocument);
}

export async function listLibraryDocuments(): Promise<ReaderDocument[]> {
  if (!runningInTauri()) return browserDocuments();
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `${DOCUMENT_SELECT} ORDER BY d.title COLLATE NOCASE`,
  );
  return rows.map(rowToDocument);
}

export async function findDocument(
  id: string,
): Promise<ReaderDocument | null> {
  if (!runningInTauri()) {
    return browserDocuments().find((document) => document.id === id) ?? null;
  }
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `${DOCUMENT_SELECT} WHERE d.id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToDocument(rows[0]) : null;
}

export async function saveDocument(document: ReaderDocument): Promise<void> {
  if (!runningInTauri()) {
    const documents = browserDocuments().filter(
      (candidate) => candidate.id !== document.id,
    );
    writeBrowserDocuments([{ ...document, missing: false }, ...documents]);
    return;
  }

  const db = await getDatabase();
  await db.execute(
    `INSERT INTO documents (
       id, file_path, title, page_count, last_opened_at,
       page_number, relative_offset_y, scale_value, scale, rotation,
       split_mode, sync_enabled, updated_at, file_hash, folder_id, missing,
       translation_progress
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16
     )
     ON CONFLICT(id) DO UPDATE SET
       file_path = excluded.file_path,
       title = excluded.title,
       page_count = excluded.page_count,
       last_opened_at = excluded.last_opened_at,
       page_number = excluded.page_number,
       relative_offset_y = excluded.relative_offset_y,
       scale_value = excluded.scale_value,
       scale = excluded.scale,
       rotation = excluded.rotation,
       split_mode = excluded.split_mode,
       sync_enabled = excluded.sync_enabled,
       updated_at = excluded.updated_at,
       file_hash = COALESCE(excluded.file_hash, documents.file_hash),
       folder_id = COALESCE(excluded.folder_id, documents.folder_id),
       missing = 0,
       translation_progress = excluded.translation_progress`,
    [
      document.id,
      document.filePath,
      document.title,
      document.pageCount,
      document.lastOpenedAt,
      document.viewState.pageNumber,
      document.viewState.relativeOffsetY,
      document.viewState.scaleValue,
      document.viewState.scale,
      document.viewState.rotation,
      document.splitMode,
      document.syncEnabled ? 1 : 0,
      new Date().toISOString(),
      document.fileHash ?? null,
      document.folderId ?? null,
      document.translationProgress ?? 0,
    ],
  );
}

export async function updateReadingState(
  id: string,
  viewState: ViewState,
  splitMode: SplitMode,
  syncEnabled: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  if (!runningInTauri()) {
    writeBrowserDocuments(
      browserDocuments().map((document) =>
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
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `UPDATE documents
        SET page_number = $1, relative_offset_y = $2, scale_value = $3,
            scale = $4, rotation = $5, split_mode = $6, sync_enabled = $7,
            last_opened_at = $8, updated_at = $8
      WHERE id = $9`,
    [
      viewState.pageNumber,
      viewState.relativeOffsetY,
      viewState.scaleValue,
      viewState.scale,
      viewState.rotation,
      splitMode,
      syncEnabled ? 1 : 0,
      now,
      id,
    ],
  );
}

export async function saveLibraryScan(
  folder: LibraryFolder,
  files: ScannedPdfFile[],
): Promise<void> {
  await saveLibraryFolder(folder);
  if (!runningInTauri()) {
    const byId = new Map(browserDocuments().map((document) => [document.id, document]));
    for (const document of byId.values()) {
      if (document.folderId === folder.id) document.missing = true;
    }
    for (const file of files) {
      const id = stableDocumentId(file.path);
      const previous = byId.get(id);
      byId.set(id, {
        id,
        filePath: file.path,
        title: previous?.title || file.fileName.replace(/\.pdf$/i, ""),
        pageCount: previous?.pageCount ?? 0,
        lastOpenedAt: previous?.lastOpenedAt ?? file.modifiedAt,
        viewState: previous?.viewState ?? DEFAULT_VIEW_STATE,
        splitMode: previous?.splitMode ?? "side-by-side",
        syncEnabled: previous?.syncEnabled ?? true,
        fileHash: file.fileHash,
        folderId: folder.id,
        missing: false,
        tags: previous?.tags ?? [],
        translationProgress: previous?.translationProgress ?? 0,
      });
    }
    writeBrowserDocuments([...byId.values()]);
    return;
  }

  const db = await getDatabase();
  await db.execute(`UPDATE documents SET missing = 1 WHERE folder_id = $1`, [
    folder.id,
  ]);
  for (const file of files) {
    const id = stableDocumentId(file.path);
    await db.execute(
      `INSERT INTO documents (
         id, file_path, title, page_count, last_opened_at, page_number,
         relative_offset_y, scale_value, scale, rotation, split_mode,
         sync_enabled, updated_at, file_hash, folder_id, missing,
         translation_progress
       ) VALUES (
         $1, $2, $3, 0, $4, 1, 0, 'page-width', 1, 0, 'side-by-side',
         1, $4, $5, $6, 0, 0
       )
       ON CONFLICT(id) DO UPDATE SET
         file_path = excluded.file_path,
         file_hash = excluded.file_hash,
         folder_id = excluded.folder_id,
         missing = 0,
         updated_at = excluded.updated_at`,
      [id, file.path, file.fileName.replace(/\.pdf$/i, ""), file.modifiedAt, file.fileHash, folder.id],
    );
  }
}

export async function setDocumentTags(
  documentId: string,
  tags: string[],
): Promise<void> {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (!runningInTauri()) {
    writeBrowserDocuments(
      browserDocuments().map((document) =>
        document.id === documentId ? { ...document, tags: normalized } : document,
      ),
    );
    return;
  }
  const db = await getDatabase();
  await db.execute(`DELETE FROM document_tags WHERE document_id = $1`, [
    documentId,
  ]);
  for (const tag of normalized) {
    await db.execute(
      `INSERT INTO document_tags (document_id, tag) VALUES ($1, $2)`,
      [documentId, tag],
    );
  }
}

export function makeReaderDocument(
  id: string,
  filePath: string,
  title: string,
  pageCount: number,
  previous?: ReaderDocument | null,
): ReaderDocument {
  return {
    id,
    filePath,
    title,
    pageCount,
    lastOpenedAt: new Date().toISOString(),
    viewState: previous?.viewState ?? DEFAULT_VIEW_STATE,
    splitMode: previous?.splitMode ?? "side-by-side",
    syncEnabled: previous?.syncEnabled ?? true,
    fileHash: previous?.fileHash,
    folderId: previous?.folderId,
    missing: false,
    tags: previous?.tags ?? [],
    translationProgress: previous?.translationProgress ?? 0,
  };
}

export async function saveDocumentBlocks(
  documentId: string,
  blocks: DocumentBlock[],
): Promise<void> {
  if (!runningInTauri()) {
    const all = readBrowserValue<Record<string, DocumentBlock[]>>("blocks", {});
    all[documentId] = blocks;
    writeBrowserValue("blocks", all);
    return;
  }
  const db = await getDatabase();
  await db.execute(`DELETE FROM document_blocks WHERE document_id = $1`, [
    documentId,
  ]);
  for (const block of blocks) {
    await db.execute(
      `INSERT INTO document_blocks (
         id, document_id, page_number, block_type, text, bbox_json,
         font_size, reading_order, translatable
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        block.id,
        documentId,
        block.pageNumber,
        block.type,
        block.text,
        JSON.stringify(block.bbox),
        block.fontSize ?? null,
        block.readingOrder,
        block.translatable ? 1 : 0,
      ],
    );
  }
}

export async function listDocumentBlocks(
  documentId: string,
): Promise<DocumentBlock[]> {
  if (!runningInTauri()) {
    return readBrowserValue<Record<string, DocumentBlock[]>>("blocks", {})[
      documentId
    ] ?? [];
  }
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: string;
      document_id: string;
      page_number: number;
      block_type: DocumentBlock["type"];
      text: string;
      bbox_json: string;
      font_size: number | null;
      reading_order: number;
      translatable: number;
    }>
  >(
    `SELECT * FROM document_blocks
      WHERE document_id = $1
      ORDER BY page_number, reading_order`,
    [documentId],
  );
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    pageNumber: row.page_number,
    type: row.block_type,
    text: row.text,
    bbox: JSON.parse(row.bbox_json) as DocumentBlock["bbox"],
    fontSize: row.font_size ?? undefined,
    readingOrder: row.reading_order,
    translatable: Boolean(row.translatable),
  }));
}

function rowToTranslation(row: TranslationRow): TranslationRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    blockId: row.block_id,
    targetLanguage: row.target_language,
    sourceText: row.source_text,
    translatedText: row.translated_text,
    status: row.status,
    error: row.error ?? undefined,
    sectionId: row.section_id ?? undefined,
    manuallyEdited: Boolean(row.manually_edited),
    locked: Boolean(row.locked),
    updatedAt: row.updated_at,
  };
}

export async function listTranslations(
  documentId: string,
  targetLanguage?: string,
): Promise<TranslationRecord[]> {
  if (!runningInTauri()) {
    return readBrowserValue<TranslationRecord[]>("translations", []).filter(
      (translation) =>
        translation.documentId === documentId &&
        (!targetLanguage || translation.targetLanguage === targetLanguage),
    );
  }
  const db = await getDatabase();
  const rows = await db.select<TranslationRow[]>(
    `SELECT * FROM translations
      WHERE document_id = $1
        AND ($2 IS NULL OR target_language = $2)
      ORDER BY updated_at`,
    [documentId, targetLanguage ?? null],
  );
  return rows.map(rowToTranslation);
}

export async function saveTranslations(
  translations: TranslationRecord[],
): Promise<void> {
  if (!translations.length) return;
  if (!runningInTauri()) {
    const byId = new Map(
      readBrowserValue<TranslationRecord[]>("translations", []).map((item) => [
        item.id,
        item,
      ]),
    );
    for (const translation of translations) byId.set(translation.id, translation);
    writeBrowserValue("translations", [...byId.values()]);
    return;
  }
  const db = await getDatabase();
  for (const translation of translations) {
    await db.execute(
      `INSERT INTO translations (
         id, document_id, block_id, target_language, source_text,
         translated_text, status, error, updated_at
         , section_id, manually_edited, locked
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT(id) DO UPDATE SET
         source_text = excluded.source_text,
         translated_text = excluded.translated_text,
         status = excluded.status,
         error = excluded.error,
         section_id = excluded.section_id,
         manually_edited = excluded.manually_edited,
         locked = excluded.locked,
         updated_at = excluded.updated_at`,
      [
        translation.id,
        translation.documentId,
        translation.blockId,
        translation.targetLanguage,
        translation.sourceText,
        translation.translatedText,
        translation.status,
        translation.error ?? null,
        translation.updatedAt,
        translation.sectionId ?? null,
        translation.manuallyEdited ? 1 : 0,
        translation.locked ? 1 : 0,
      ],
    );
  }
}

export async function saveTranslationJob(job: TranslationJob): Promise<void> {
  if (!runningInTauri()) {
    const jobs = readBrowserValue<TranslationJob[]>("translation-jobs", []);
    writeBrowserValue("translation-jobs", [
      job,
      ...jobs.filter((candidate) => candidate.id !== job.id),
    ].slice(0, 100));
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO translation_jobs (
       id, document_id, status, total_blocks, completed_blocks,
       failed_block_ids_json, started_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       completed_blocks = excluded.completed_blocks,
       failed_block_ids_json = excluded.failed_block_ids_json,
       updated_at = excluded.updated_at`,
    [
      job.id,
      job.documentId,
      job.status,
      job.totalBlocks,
      job.completedBlocks,
      JSON.stringify(job.failedBlockIds),
      job.startedAt,
      job.updatedAt,
    ],
  );
}

export async function listHighlights(
  documentId: string,
): Promise<Highlight[]> {
  if (!runningInTauri()) {
    return readBrowserValue<Highlight[]>("highlights", []).filter(
      (highlight) => highlight.documentId === documentId,
    );
  }
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: string;
      document_id: string;
      page_number: number;
      source: Highlight["source"];
      selected_text: string;
      rects_json: string;
      color: string;
      created_at: string;
    }>
  >(`SELECT * FROM highlights WHERE document_id = $1 ORDER BY created_at DESC`, [
    documentId,
  ]);
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    pageNumber: row.page_number,
    source: row.source,
    selectedText: row.selected_text,
    rects: JSON.parse(row.rects_json) as Highlight["rects"],
    color: row.color,
    createdAt: row.created_at,
  }));
}

export async function saveHighlight(highlight: Highlight): Promise<void> {
  if (!runningInTauri()) {
    const highlights = readBrowserValue<Highlight[]>("highlights", []);
    writeBrowserValue("highlights", [
      highlight,
      ...highlights.filter((candidate) => candidate.id !== highlight.id),
    ]);
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO highlights (
       id, document_id, page_number, source, selected_text, rects_json,
       color, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      highlight.id,
      highlight.documentId,
      highlight.pageNumber,
      highlight.source,
      highlight.selectedText,
      JSON.stringify(highlight.rects),
      highlight.color,
      highlight.createdAt,
    ],
  );
}

export async function deleteHighlight(id: string): Promise<void> {
  if (!runningInTauri()) {
    writeBrowserValue(
      "highlights",
      readBrowserValue<Highlight[]>("highlights", []).filter(
        (highlight) => highlight.id !== id,
      ),
    );
    return;
  }
  const db = await getDatabase();
  await db.execute(`DELETE FROM highlights WHERE id = $1`, [id]);
}

export async function listNotes(documentId: string): Promise<Note[]> {
  if (!runningInTauri()) {
    return readBrowserValue<Note[]>("notes", []).filter(
      (note) => note.documentId === documentId,
    );
  }
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: string;
      document_id: string;
      scope: Note["scope"];
      page_number: number | null;
      source: Note["source"] | null;
      selected_text: string | null;
      rects_json: string | null;
      highlight_id: string | null;
      markdown: string;
      created_at: string;
      updated_at: string;
    }>
  >(`SELECT * FROM notes WHERE document_id = $1 ORDER BY updated_at DESC`, [
    documentId,
  ]);
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    scope: row.scope,
    pageNumber: row.page_number ?? undefined,
    source: row.source ?? undefined,
    selectedText: row.selected_text ?? undefined,
    rects: row.rects_json
      ? (JSON.parse(row.rects_json) as Note["rects"])
      : undefined,
    highlightId: row.highlight_id ?? undefined,
    markdown: row.markdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveNote(note: Note): Promise<void> {
  if (!runningInTauri()) {
    const notes = readBrowserValue<Note[]>("notes", []);
    writeBrowserValue("notes", [
      note,
      ...notes.filter((candidate) => candidate.id !== note.id),
    ]);
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO notes (
       id, document_id, scope, page_number, source, selected_text,
       rects_json, highlight_id, markdown, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      note.id,
      note.documentId,
      note.scope,
      note.pageNumber ?? null,
      note.source ?? null,
      note.selectedText ?? null,
      note.rects ? JSON.stringify(note.rects) : null,
      note.highlightId ?? null,
      note.markdown,
      note.createdAt,
      note.updatedAt,
    ],
  );
}

export async function deleteNote(id: string): Promise<void> {
  if (!runningInTauri()) {
    writeBrowserValue(
      "notes",
      readBrowserValue<Note[]>("notes", []).filter((note) => note.id !== id),
    );
    return;
  }
  const db = await getDatabase();
  await db.execute(`DELETE FROM notes WHERE id = $1`, [id]);
}

export async function findDictionaryEntry(
  documentId: string,
  word: string,
  context: string,
): Promise<DictionaryEntry | null> {
  if (!runningInTauri()) {
    return (
      readBrowserValue<DictionaryEntry[]>("dictionary", []).find(
        (entry) =>
          entry.documentId === documentId &&
          entry.word.toLocaleLowerCase() === word.toLocaleLowerCase() &&
          entry.context === context,
      ) ?? null
    );
  }
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: string;
      document_id: string;
      word: string;
      context: string;
      lemma: string;
      part_of_speech: string;
      meaning: string;
      context_meaning: string;
      explanation: string;
      created_at: string;
    }>
  >(
    `SELECT * FROM dictionary_cache
      WHERE document_id = $1 AND lower(word) = lower($2) AND context = $3
      LIMIT 1`,
    [documentId, word, context],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        documentId: row.document_id,
        word: row.word,
        context: row.context,
        lemma: row.lemma,
        partOfSpeech: row.part_of_speech,
        meaning: row.meaning,
        contextMeaning: row.context_meaning,
        explanation: row.explanation,
        createdAt: row.created_at,
      }
    : null;
}

export async function saveDictionaryEntry(
  entry: DictionaryEntry,
): Promise<void> {
  if (!runningInTauri()) {
    const entries = readBrowserValue<DictionaryEntry[]>("dictionary", []);
    writeBrowserValue("dictionary", [
      entry,
      ...entries.filter((candidate) => candidate.id !== entry.id),
    ]);
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO dictionary_cache (
       id, document_id, word, context, lemma, part_of_speech, meaning,
       context_meaning, explanation, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.id,
      entry.documentId,
      entry.word,
      entry.context,
      entry.lemma,
      entry.partOfSpeech,
      entry.meaning,
      entry.contextMeaning,
      entry.explanation,
      entry.createdAt,
    ],
  );
}

export async function listChatSessions(
  documentId: string,
): Promise<ChatSession[]> {
  if (!runningInTauri()) {
    return readBrowserValue<ChatSession[]>("chat-sessions", []).filter(
      (session) => session.documentId === documentId,
    );
  }
  const db = await getDatabase();
  const sessions = await db.select<
    Array<{
      id: string;
      document_id: string;
      title: string;
      created_at: string;
      updated_at: string;
    }>
  >(`SELECT * FROM chat_sessions WHERE document_id = $1 ORDER BY updated_at DESC`, [
    documentId,
  ]);
  const result: ChatSession[] = [];
  for (const session of sessions) {
    const messages = await db.select<
      Array<{
        id: string;
        session_id: string;
        role: ChatMessage["role"];
        content: string;
        source_text: string | null;
        created_at: string;
      }>
    >(`SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at`, [
      session.id,
    ]);
    result.push({
      id: session.id,
      documentId: session.document_id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messages: messages.map((message) => ({
        id: message.id,
        sessionId: message.session_id,
        role: message.role,
        content: message.content,
        sourceText: message.source_text ?? undefined,
        createdAt: message.created_at,
      })),
    });
  }
  return result;
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  if (!runningInTauri()) {
    const sessions = readBrowserValue<ChatSession[]>("chat-sessions", []);
    writeBrowserValue("chat-sessions", [
      session,
      ...sessions.filter((candidate) => candidate.id !== session.id),
    ]);
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO chat_sessions (
       id, document_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      session.id,
      session.documentId,
      session.title,
      session.createdAt,
      session.updatedAt,
    ],
  );
  for (const message of session.messages) {
    await db.execute(
      `INSERT OR REPLACE INTO chat_messages (
         id, session_id, role, content, source_text, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        message.id,
        session.id,
        message.role,
        message.content,
        message.sourceText ?? null,
        message.createdAt,
      ],
    );
  }
}

export async function listLibraryFolders(): Promise<LibraryFolder[]> {
  if (!runningInTauri()) {
    return readBrowserValue<LibraryFolder[]>("library-folders", []);
  }
  const db = await getDatabase();
  const rows = await db.select<
    Array<{
      id: string;
      path: string;
      name: string;
      last_scanned_at: string;
    }>
  >(`SELECT * FROM library_folders ORDER BY name COLLATE NOCASE`);
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    lastScannedAt: row.last_scanned_at,
  }));
}

export async function saveLibraryFolder(folder: LibraryFolder): Promise<void> {
  if (!runningInTauri()) {
    const folders = readBrowserValue<LibraryFolder[]>("library-folders", []);
    writeBrowserValue("library-folders", [
      folder,
      ...folders.filter((candidate) => candidate.id !== folder.id),
    ]);
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT OR REPLACE INTO library_folders (
       id, path, name, last_scanned_at
     ) VALUES ($1, $2, $3, $4)`,
    [folder.id, folder.path, folder.name, folder.lastScannedAt],
  );
}

export async function loadLlmSettings(): Promise<LlmSettings> {
  if (!runningInTauri()) {
    return normalizeLlmSettings(
      readBrowserValue<Partial<LlmSettings>>("llm-settings", {}),
    );
  }
  const db = await getDatabase();
  const rows = await db.select<Array<{ value: string }>>(
    `SELECT value FROM settings WHERE key = 'llm' LIMIT 1`,
  );
  if (!rows[0]) return normalizeLlmSettings(DEFAULT_LLM_SETTINGS);
  try {
    const parsed = normalizeLlmSettings(
      JSON.parse(rows[0].value) as Partial<LlmSettings>,
    );
    let migratedPlaintextSecret = false;
    const profiles = await Promise.all(
      parsed.profiles.map(async (profile) => {
        const secured = await readProviderSecret(profile.id);
        if (!secured && profile.apiKey) {
          await storeProviderSecret(profile.id, profile.apiKey);
          migratedPlaintextSecret = true;
        }
        return {
          ...profile,
          apiKey: secured || profile.apiKey || "",
        };
      }),
    );
    const hydrated = normalizeLlmSettings({ ...parsed, profiles });
    if (migratedPlaintextSecret) {
      const sanitized = normalizeLlmSettings({
        ...hydrated,
        apiKey: "",
        profiles: hydrated.profiles.map((profile) => ({
          ...profile,
          apiKey: "",
        })),
      });
      await db.execute(
        `UPDATE settings SET value = $1, updated_at = $2 WHERE key = 'llm'`,
        [JSON.stringify(sanitized), new Date().toISOString()],
      );
    }
    return hydrated;
  } catch {
    return normalizeLlmSettings(DEFAULT_LLM_SETTINGS);
  }
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  if (!runningInTauri()) {
    writeBrowserValue("llm-settings", settings);
    return;
  }
  const normalized = normalizeLlmSettings(settings);
  await Promise.all(
    normalized.profiles.map((profile) =>
      storeProviderSecret(profile.id, profile.apiKey),
    ),
  );
  const sanitized = normalizeLlmSettings({
    ...normalized,
    apiKey: "",
    profiles: normalized.profiles.map((profile) => ({
      ...profile,
      apiKey: "",
    })),
  });
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('llm', $1, $2)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [JSON.stringify(sanitized), new Date().toISOString()],
  );
}

export async function loadRetypesetProject(
  documentId: string,
): Promise<RetypesetProject | null> {
  if (!runningInTauri()) {
    return (
      readBrowserValue<Record<string, RetypesetProject>>(
        "retypeset-projects",
        {},
      )[documentId] ?? null
    );
  }
  const db = await getDatabase();
  const rows = await db.select<Array<{ value: string }>>(
    `SELECT value FROM settings WHERE key = $1 LIMIT 1`,
    [`retypeset:${documentId}`],
  );
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].value) as RetypesetProject;
  } catch {
    return null;
  }
}

export async function saveRetypesetProject(
  project: RetypesetProject,
): Promise<void> {
  if (!runningInTauri()) {
    const projects = readBrowserValue<Record<string, RetypesetProject>>(
      "retypeset-projects",
      {},
    );
    projects[project.documentId] = project;
    writeBrowserValue("retypeset-projects", projects);
    return;
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [
      `retypeset:${project.documentId}`,
      JSON.stringify(project),
      project.updatedAt,
    ],
  );
}
