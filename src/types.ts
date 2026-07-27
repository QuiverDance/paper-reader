export type SplitMode = "single" | "side-by-side" | "stacked";

export type ScrollAnchor = {
  pageNumber: number;
  relativeOffsetY: number;
};

export type ViewState = ScrollAnchor & {
  scaleValue: string;
  scale: number;
  rotation: number;
};

export type ReaderDocument = {
  id: string;
  filePath: string;
  title: string;
  pageCount: number;
  lastOpenedAt: string;
  viewState: ViewState;
  splitMode: SplitMode;
  syncEnabled: boolean;
  fileHash?: string;
  folderId?: string;
  missing?: boolean;
  tags?: string[];
  translationProgress?: number;
};

export type PaneId = "original" | "companion";

export type PaneUpdate = {
  source: PaneId;
  viewState: Partial<ViewState>;
};

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocumentBlockType =
  | "title"
  | "authors"
  | "abstract"
  | "heading"
  | "paragraph"
  | "figure-caption"
  | "table-caption"
  | "footnote"
  | "unknown";

export type DocumentBlock = {
  id: string;
  documentId: string;
  pageNumber: number;
  type: DocumentBlockType;
  text: string;
  bbox: NormalizedRect;
  fontSize?: number;
  readingOrder: number;
  translatable: boolean;
};

export type TranslationStatus = "pending" | "translated" | "failed";

export type TranslationRecord = {
  id: string;
  documentId: string;
  blockId: string;
  targetLanguage: string;
  sourceText: string;
  translatedText: string;
  status: TranslationStatus;
  error?: string;
  updatedAt: string;
};

export type TranslationJobStatus =
  | "idle"
  | "running"
  | "cancelled"
  | "completed"
  | "failed";

export type TranslationJob = {
  id: string;
  documentId: string;
  status: TranslationJobStatus;
  totalBlocks: number;
  completedBlocks: number;
  failedBlockIds: string[];
  startedAt: string;
  updatedAt: string;
};

export type AnnotationSource = "original" | "translation";

export type Highlight = {
  id: string;
  documentId: string;
  pageNumber: number;
  source: AnnotationSource;
  selectedText: string;
  rects: NormalizedRect[];
  color: string;
  createdAt: string;
};

export type NoteScope = "document" | "page" | "selection" | "highlight";

export type Note = {
  id: string;
  documentId: string;
  scope: NoteScope;
  pageNumber?: number;
  source?: AnnotationSource;
  selectedText?: string;
  rects?: NormalizedRect[];
  highlightId?: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
};

export type DictionaryEntry = {
  id: string;
  documentId: string;
  word: string;
  context: string;
  lemma: string;
  partOfSpeech: string;
  meaning: string;
  contextMeaning: string;
  explanation: string;
  createdAt: string;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  sourceText?: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  documentId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type LibraryFolder = {
  id: string;
  path: string;
  name: string;
  lastScannedAt: string;
};

export type ScannedPdfFile = {
  path: string;
  fileName: string;
  modifiedAt: string;
  size: number;
  fileHash: string;
};

export type LlmSettings = {
  connectionMode: "api" | "codex";
  endpoint: string;
  apiKey: string;
  model: string;
  codexModel: string;
  targetLanguage: string;
  instructions: string;
};

export type TextSelection = {
  text: string;
  pageNumber: number;
  source: AnnotationSource;
  rects: NormalizedRect[];
  context: string;
  clientX: number;
  clientY: number;
};

export type DocumentReference = {
  id: string;
  sourceBlockId: string;
  label: string;
  kind: "figure" | "table";
  number: string;
  sourcePageNumber: number;
  targetBlockId?: string;
  targetPageNumber?: number;
  targetBbox?: NormalizedRect;
};

export type ReadingToolTab =
  | "translation"
  | "ask"
  | "notes"
  | "highlights"
  | "references";
