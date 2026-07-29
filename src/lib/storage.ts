import Database from "@tauri-apps/plugin-sql";
import type {
  ChatMessage,
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
import { DEFAULT_LLM_SETTINGS, normalizeLlmSettings } from "./llm";
import { browserPaperRepository } from "./browser-paper-repository";
import {
  readProviderSecret,
  runningInTauri,
  storeProviderSecret,
} from "./platform";
import { DEFAULT_VIEW_STATE } from "./reader-state";

const DATABASE_URL = "sqlite:paperloom.db";

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
  active_profile_id?: string | null;
  reasoning_effort?: ReaderDocument["reasoningEffort"] | null;
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
    activeProfileId: row.active_profile_id ?? undefined,
    reasoningEffort: row.reasoning_effort ?? undefined,
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
         d.translation_progress, d.active_profile_id, d.reasoning_effort,
         COALESCE((
           SELECT GROUP_CONCAT(tag, char(31))
             FROM document_tags
            WHERE document_id = d.id
         ), '') AS tags
    FROM documents d`;

export async function listRecentDocuments(): Promise<ReaderDocument[]> {
  if (!runningInTauri()) {
    return browserPaperRepository().listRecentDocuments();
  }
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `${DOCUMENT_SELECT} ORDER BY d.last_opened_at DESC LIMIT 20`,
  );
  return rows.map(rowToDocument);
}

export async function findDocumentByIdentity(
  fileHash: string,
  legacyId?: string,
): Promise<ReaderDocument | null> {
  if (!runningInTauri()) {
    return browserPaperRepository().findDocumentByIdentity(fileHash, legacyId);
  }
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `${DOCUMENT_SELECT}
      WHERE d.file_hash = $1 OR ($2 IS NOT NULL AND d.id = $2)
      ORDER BY CASE WHEN d.file_hash = $1 THEN 0 ELSE 1 END
      LIMIT 1`,
    [fileHash, legacyId ?? null],
  );
  return rows[0] ? rowToDocument(rows[0]) : null;
}

export async function saveDocument(document: ReaderDocument): Promise<void> {
  if (!runningInTauri()) {
    return browserPaperRepository().saveDocument(document);
  }

  const db = await getDatabase();
  await db.execute(
    `DELETE FROM documents WHERE file_path = $1 AND id <> $2`,
    [document.filePath, document.id],
  );
  await db.execute(
    `INSERT INTO documents (
       id, file_path, title, page_count, last_opened_at,
       page_number, relative_offset_y, scale_value, scale, rotation,
       split_mode, sync_enabled, updated_at, file_hash, folder_id, missing,
       translation_progress, active_profile_id, reasoning_effort
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16, $17, $18
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
       translation_progress = excluded.translation_progress,
       active_profile_id = excluded.active_profile_id,
       reasoning_effort = excluded.reasoning_effort`,
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
      document.activeProfileId ?? null,
      document.reasoningEffort ?? null,
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
    return browserPaperRepository().updateReadingState(
      id,
      viewState,
      splitMode,
      syncEnabled,
    );
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

export function makeReaderDocument(
  id: string,
  filePath: string,
  title: string,
  pageCount: number,
  fileHash: string,
  previous?: ReaderDocument | null,
): ReaderDocument {
  return {
    id,
    filePath,
    title,
    pageCount,
    lastOpenedAt: new Date().toISOString(),
    viewState: previous?.viewState ?? DEFAULT_VIEW_STATE,
    splitMode: "side-by-side",
    syncEnabled: false,
    fileHash,
    folderId: previous?.folderId,
    missing: false,
    tags: previous?.tags ?? [],
    translationProgress: previous?.translationProgress ?? 0,
    activeProfileId: previous?.activeProfileId,
    reasoningEffort: previous?.reasoningEffort,
  };
}

export async function saveDocumentBlocks(
  documentId: string,
  blocks: DocumentBlock[],
): Promise<void> {
  if (!runningInTauri()) {
    return browserPaperRepository().saveDocumentBlocks(documentId, blocks);
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
    return browserPaperRepository().listDocumentBlocks(documentId);
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
    return browserPaperRepository().listTranslations(
      documentId,
      targetLanguage,
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
    return browserPaperRepository().saveTranslations(translations);
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

export async function listHighlights(
  documentId: string,
): Promise<Highlight[]> {
  if (!runningInTauri()) {
    return browserPaperRepository().listHighlights(documentId);
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
    return browserPaperRepository().saveHighlight(highlight);
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
    return browserPaperRepository().deleteHighlight(id);
  }
  const db = await getDatabase();
  await db.execute(`DELETE FROM highlights WHERE id = $1`, [id]);
}

export async function listNotes(documentId: string): Promise<Note[]> {
  if (!runningInTauri()) {
    return browserPaperRepository().listNotes(documentId);
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
    return browserPaperRepository().saveNote(note);
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
    return browserPaperRepository().deleteNote(id);
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
    return browserPaperRepository().findDictionaryEntry(
      documentId,
      word,
      context,
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
    return browserPaperRepository().saveDictionaryEntry(entry);
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
    return browserPaperRepository().listChatSessions(documentId);
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
        context_mode: ChatMessage["contextMode"] | null;
        evidence_json: string | null;
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
        contextMode: message.context_mode ?? undefined,
        evidence: message.evidence_json
          ? (JSON.parse(message.evidence_json) as ChatMessage["evidence"])
          : undefined,
        createdAt: message.created_at,
      })),
    });
  }
  return result;
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  if (!runningInTauri()) {
    return browserPaperRepository().saveChatSession(session);
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
         id, session_id, role, content, source_text, context_mode,
         evidence_json, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        message.id,
        session.id,
        message.role,
        message.content,
        message.sourceText ?? null,
        message.contextMode ?? null,
        message.evidence ? JSON.stringify(message.evidence) : null,
        message.createdAt,
      ],
    );
  }
}

export async function loadLlmSettings(): Promise<LlmSettings> {
  if (!runningInTauri()) {
    return browserPaperRepository().loadLlmSettings();
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
    return browserPaperRepository().saveLlmSettings(settings);
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
    return browserPaperRepository().loadRetypesetProject(documentId);
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
    return browserPaperRepository().saveRetypesetProject(project);
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
