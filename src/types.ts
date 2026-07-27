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
  | "equation"
  | "reference-entry"
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
  sectionId?: string;
  manuallyEdited?: boolean;
  locked?: boolean;
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

export type ModelConnectionProfile = {
  id: string;
  name: string;
  connectionMode: "api" | "codex";
  endpoint: string;
  apiKey: string;
  model: string;
  codexModel: string;
  maxContextSize: number;
  effort: "default" | "low" | "high" | "max";
  capabilities: string[];
  beta?: boolean;
};

export type LlmSettings = {
  profiles: ModelConnectionProfile[];
  activeProfileId: string;
  connectionMode: ModelConnectionProfile["connectionMode"];
  endpoint: string;
  apiKey: string;
  model: string;
  codexModel: string;
  maxContextSize: number;
  effort: ModelConnectionProfile["effort"];
  targetLanguage: string;
  instructions: string;
  transmissionConsentKey?: string;
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

export type PaperSection = {
  id: string;
  title: string;
  level: number;
  parentId?: string;
  headingBlockId?: string;
  blockIds: string[];
  childIds: string[];
  topLevelId: string;
};

export type PaperAsset = {
  id: string;
  kind: "figure" | "table";
  number: string;
  captionBlockId: string;
  pageNumber: number;
  bbox: NormalizedRect;
  sectionId: string;
  contentBlockIds: string[];
};

export type SemanticPaper = {
  documentId: string;
  sections: PaperSection[];
  assets: PaperAsset[];
  blockSectionIds: Record<string, string>;
  translatableBlockIds: string[];
  preservedBlockIds: string[];
  columnCount: 1 | 2;
  bodyFontStyle: "serif" | "sans";
  referenceHeadingBlockId?: string;
};

export type RetypesetWarningKind =
  | "missing-translation"
  | "damaged-asset"
  | "damaged-equation"
  | "broken-reference"
  | "layout-overflow"
  | "unsupported-source";

export type RetypesetWarning = {
  id: string;
  severity: "integrity" | "visual";
  kind: RetypesetWarningKind;
  message: string;
  blockId?: string;
  acknowledged?: boolean;
};

export type RetypesetProject = {
  id: string;
  documentId: string;
  targetLanguage: string;
  profileId: string;
  translationBrief: string;
  manuallyEditedBlockIds: string[];
  sourceFallbackBlockIds: string[];
  acknowledgedWarningIds: string[];
  createdAt: string;
  updatedAt: string;
  lastExportedAt?: string;
};

export type TypesettingPackageStatus = {
  installed: boolean;
  totalBytes: number;
  installedBytes: number;
  version: string;
};
