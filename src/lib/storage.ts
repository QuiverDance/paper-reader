import Database from "@tauri-apps/plugin-sql";
import type { ReaderDocument, SplitMode, ViewState } from "../types";
import { DEFAULT_VIEW_STATE } from "./reader-state";
import { runningInTauri } from "./platform";

const DATABASE_URL = "sqlite:paperloom.db";
const BROWSER_STORAGE_KEY = "paperloom.recent-documents";

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
  };
}

async function getDatabase(): Promise<Database> {
  if (!databasePromise) {
    databasePromise = Database.load(DATABASE_URL);
  }
  return databasePromise;
}

function readBrowserDocuments(): ReaderDocument[] {
  try {
    const value = localStorage.getItem(BROWSER_STORAGE_KEY);
    return value ? (JSON.parse(value) as ReaderDocument[]) : [];
  } catch {
    return [];
  }
}

function writeBrowserDocuments(documents: ReaderDocument[]): void {
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(documents.slice(0, 20)));
}

export async function listRecentDocuments(): Promise<ReaderDocument[]> {
  if (!runningInTauri()) return readBrowserDocuments();
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `SELECT id, file_path, title, page_count, last_opened_at,
            page_number, relative_offset_y, scale_value, scale, rotation,
            split_mode, sync_enabled
       FROM documents
      ORDER BY last_opened_at DESC
      LIMIT 20`,
  );
  return rows.map(rowToDocument);
}

export async function findDocument(
  id: string,
): Promise<ReaderDocument | null> {
  if (!runningInTauri()) {
    return readBrowserDocuments().find((document) => document.id === id) ?? null;
  }
  const db = await getDatabase();
  const rows = await db.select<DocumentRow[]>(
    `SELECT id, file_path, title, page_count, last_opened_at,
            page_number, relative_offset_y, scale_value, scale, rotation,
            split_mode, sync_enabled
       FROM documents
      WHERE id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToDocument(rows[0]) : null;
}

export async function saveDocument(document: ReaderDocument): Promise<void> {
  if (!runningInTauri()) {
    const documents = readBrowserDocuments().filter(
      (candidate) => candidate.id !== document.id,
    );
    writeBrowserDocuments([document, ...documents]);
    return;
  }

  const db = await getDatabase();
  await db.execute(
    `INSERT INTO documents (
       id, file_path, title, page_count, last_opened_at,
       page_number, relative_offset_y, scale_value, scale, rotation,
       split_mode, sync_enabled, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
       updated_at = excluded.updated_at`,
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
    ],
  );
}

export async function updateReadingState(
  id: string,
  viewState: ViewState,
  splitMode: SplitMode,
  syncEnabled: boolean,
): Promise<void> {
  if (!runningInTauri()) {
    const documents = readBrowserDocuments();
    const next = documents.map((document) =>
      document.id === id
        ? {
            ...document,
            viewState,
            splitMode,
            syncEnabled,
            lastOpenedAt: new Date().toISOString(),
          }
        : document,
    );
    writeBrowserDocuments(next);
    return;
  }

  const db = await getDatabase();
  await db.execute(
    `UPDATE documents
        SET page_number = $1,
            relative_offset_y = $2,
            scale_value = $3,
            scale = $4,
            rotation = $5,
            split_mode = $6,
            sync_enabled = $7,
            last_opened_at = $8,
            updated_at = $8
      WHERE id = $9`,
    [
      viewState.pageNumber,
      viewState.relativeOffsetY,
      viewState.scaleValue,
      viewState.scale,
      viewState.rotation,
      splitMode,
      syncEnabled ? 1 : 0,
      new Date().toISOString(),
      id,
    ],
  );
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
  };
}

