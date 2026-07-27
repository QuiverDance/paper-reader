import {
  Bookmark,
  Check,
  Copy,
  Languages,
  LoaderCircle,
  MessageSquareText,
  PanelRightClose,
  Pause,
  Play,
  RotateCcw,
  ScanText,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ChatSession,
  DictionaryEntry,
  DocumentBlock,
  DocumentReference,
  Highlight,
  Note,
  ReadingToolTab,
  TextSelection,
  TranslationJob,
  TranslationRecord,
} from "../types";

export type TranslationScopeRequest =
  | { kind: "page"; pageNumber: number }
  | { kind: "range"; startPage: number; endPage: number }
  | { kind: "document" }
  | { kind: "selection" }
  | { kind: "failed" };

type ToolRailProps = {
  activeTab: ReadingToolTab;
  hasDocument: boolean;
  pageNumber: number;
  pageCount: number;
  blocks: DocumentBlock[];
  translations: TranslationRecord[];
  translationJob: TranslationJob | null;
  selection: TextSelection | null;
  highlights: Highlight[];
  notes: Note[];
  sessions: ChatSession[];
  references: DocumentReference[];
  dictionaryEntry: DictionaryEntry | null;
  dictionaryLoading: boolean;
  asking: boolean;
  streamingAnswer: string;
  error: string | null;
  onTab: (tab: ReadingToolTab) => void;
  onTranslate: (scope: TranslationScopeRequest) => void;
  onCancelTranslation: () => void;
  onEditTranslation: (translation: TranslationRecord, text: string) => void;
  onAsk: (
    question: string,
    scope: "selection" | "page" | "blocks",
    blockIds: string[],
  ) => void;
  onCopy: (text: string) => void;
  onSaveAnswerAsNote: (text: string) => void;
  onAddNote: (markdown: string) => void;
  onUpdateNote: (note: Note, markdown: string) => void;
  onDeleteNote: (id: string) => void;
  onDeleteHighlight: (id: string) => void;
  onGoToPage: (pageNumber: number) => void;
  onOpenReference: (reference: DocumentReference) => void;
  onCloseDictionary: () => void;
};

const TABS: Array<{
  id: ReadingToolTab;
  label: string;
  icon: typeof Languages;
}> = [
  { id: "translation", label: "번역", icon: Languages },
  { id: "ask", label: "Ask", icon: MessageSquareText },
  { id: "notes", label: "메모", icon: StickyNote },
  { id: "highlights", label: "표시", icon: Bookmark },
  { id: "references", label: "참조", icon: ScanText },
];

export function ToolRail({
  activeTab,
  hasDocument,
  pageNumber,
  pageCount,
  blocks,
  translations,
  translationJob,
  selection,
  highlights,
  notes,
  sessions,
  references,
  dictionaryEntry,
  dictionaryLoading,
  asking,
  streamingAnswer,
  error,
  onTab,
  onTranslate,
  onCancelTranslation,
  onEditTranslation,
  onAsk,
  onCopy,
  onSaveAnswerAsNote,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  onDeleteHighlight,
  onGoToPage,
  onOpenReference,
  onCloseDictionary,
}: ToolRailProps) {
  const [question, setQuestion] = useState("");
  const [questionScope, setQuestionScope] = useState<
    "selection" | "page" | "blocks"
  >("selection");
  const [questionBlockIds, setQuestionBlockIds] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(1);

  const activeSession = sessions[0];
  const latestAnswer = useMemo(
    () =>
      [...(activeSession?.messages ?? [])]
        .reverse()
        .find((message) => message.role === "assistant")?.content ?? "",
    [activeSession],
  );
  const progress = translationJob
    ? translationJob.totalBlocks
      ? translationJob.completedBlocks / translationJob.totalBlocks
      : 0
    : 0;
  const currentBlockIds = useMemo(
    () => new Set(blocks.map((block) => block.id)),
    [blocks],
  );
  const currentTranslations = useMemo(
    () =>
      translations.filter((translation) =>
        currentBlockIds.has(translation.blockId),
      ),
    [currentBlockIds, translations],
  );
  const failedCount = currentTranslations.filter(
    (translation) => translation.status === "failed",
  ).length;
  const pageQuestionBlocks = useMemo(
    () =>
      blocks.filter(
        (block) => block.pageNumber === pageNumber && block.translatable,
      ),
    [blocks, pageNumber],
  );
  const activeQuestionBlockIds = questionBlockIds.filter((blockId) =>
    pageQuestionBlocks.some((block) => block.id === blockId),
  );

  return (
    <aside className="tool-rail">
      <div className="tool-rail-header">
        <div>
          <span>READING TOOLS</span>
          <strong>{TABS.find((tab) => tab.id === activeTab)?.label}</strong>
        </div>
        <PanelRightClose size={16} />
      </div>

      <nav className="tool-tabs" aria-label="읽기 도구">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => onTab(tab.id)}
              title={tab.label}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </nav>

      {(dictionaryEntry || dictionaryLoading) && (
        <section className="dictionary-card">
          <header>
            <span>WORD IN CONTEXT</span>
            <button
              type="button"
              onClick={onCloseDictionary}
              aria-label="단어 뜻 닫기"
            >
              <X size={14} />
            </button>
          </header>
          {dictionaryLoading ? (
            <p className="tool-loading">
              <LoaderCircle className="spin" size={16} /> 뜻을 찾는 중…
            </p>
          ) : dictionaryEntry ? (
            <>
              <h3>
                {dictionaryEntry.lemma}
                <small>{dictionaryEntry.partOfSpeech}</small>
              </h3>
              <strong>{dictionaryEntry.meaning}</strong>
              <p>{dictionaryEntry.contextMeaning}</p>
              <small>{dictionaryEntry.explanation}</small>
              <button
                type="button"
                className="text-action"
                onClick={() =>
                  onCopy(
                    `${dictionaryEntry.lemma}: ${dictionaryEntry.meaning}\n${dictionaryEntry.contextMeaning}`,
                  )
                }
              >
                <Copy size={13} /> 복사
              </button>
            </>
          ) : null}
        </section>
      )}

      {error && <p className="tool-error">{error}</p>}

      <div className="tool-content">
        {activeTab === "translation" && (
          <>
            <section className="tool-card tool-card--accent">
              <div className="tool-card-title">
                <Languages size={16} />
                <span>문단 좌표 번역</span>
                <small>
                  {blocks.length
                    ? `${currentTranslations.filter((item) => item.status === "translated").length}/${blocks.filter((block) => block.translatable).length}`
                    : "분석 중"}
                </small>
              </div>
              {translationJob?.status === "running" ? (
                <>
                  <div className="progress-track">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p>
                    {translationJob.completedBlocks} / {translationJob.totalBlocks}
                    개 블록
                  </p>
                  <button
                    type="button"
                    className="secondary-action wide"
                    onClick={onCancelTranslation}
                  >
                    <Pause size={14} /> 번역 중단
                  </button>
                </>
              ) : (
                <div className="translation-actions">
                  <button
                    type="button"
                    disabled={!hasDocument}
                    onClick={() => onTranslate({ kind: "page", pageNumber })}
                  >
                    <Play size={14} /> 현재 페이지
                  </button>
                  <button
                    type="button"
                    disabled={!selection}
                    onClick={() => onTranslate({ kind: "selection" })}
                  >
                    선택 영역
                  </button>
                  <button
                    type="button"
                    disabled={!hasDocument}
                    onClick={() => onTranslate({ kind: "document" })}
                  >
                    전체 논문
                  </button>
                </div>
              )}
            </section>

            <section className="range-translation">
              <span>페이지 범위</span>
              <div>
                <input
                  type="number"
                  min={1}
                  max={pageCount || 1}
                  value={rangeStart}
                  onChange={(event) => setRangeStart(Number(event.target.value))}
                />
                <span>–</span>
                <input
                  type="number"
                  min={1}
                  max={pageCount || 1}
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(Number(event.target.value))}
                />
                <button
                  type="button"
                  disabled={!hasDocument}
                  onClick={() =>
                    onTranslate({
                      kind: "range",
                      startPage: rangeStart,
                      endPage: rangeEnd,
                    })
                  }
                >
                  실행
                </button>
              </div>
            </section>

            {failedCount > 0 && (
              <button
                type="button"
                className="retry-action"
                onClick={() => onTranslate({ kind: "failed" })}
              >
                <RotateCcw size={14} /> 실패한 {failedCount}개 다시 번역
              </button>
            )}

            <div className="translation-list">
              {currentTranslations
                .filter((translation) => {
                  const block = blocks.find(
                    (candidate) => candidate.id === translation.blockId,
                  );
                  return block?.pageNumber === pageNumber;
                })
                .map((translation) => (
                  <article
                    key={translation.id}
                    className={`translation-item translation-item--${translation.status}`}
                  >
                    <small>{translation.sourceText}</small>
                    {translation.status === "failed" ? (
                      <p>{translation.error}</p>
                    ) : (
                      <textarea
                        defaultValue={translation.translatedText}
                        onBlur={(event) =>
                          onEditTranslation(translation, event.target.value)
                        }
                        aria-label="번역문 수정"
                      />
                    )}
                  </article>
                ))}
            </div>
          </>
        )}

        {activeTab === "ask" && (
          <>
            <div className="ask-scope">
              <button
                type="button"
                className={questionScope === "selection" ? "active" : ""}
                disabled={!selection}
                onClick={() => setQuestionScope("selection")}
              >
                선택 문단
              </button>
              <button
                type="button"
                className={questionScope === "page" ? "active" : ""}
                onClick={() => setQuestionScope("page")}
              >
                현재 페이지
              </button>
              <button
                type="button"
                className={questionScope === "blocks" ? "active" : ""}
                disabled={!pageQuestionBlocks.length}
                onClick={() => setQuestionScope("blocks")}
              >
                문단 선택
              </button>
            </div>
            {questionScope === "selection" && selection && (
              <blockquote className="selection-context">
                {selection.text.slice(0, 220)}
              </blockquote>
            )}
            {questionScope === "blocks" && (
              <div className="question-block-picker">
                {pageQuestionBlocks.map((block) => (
                  <label key={block.id}>
                    <input
                      type="checkbox"
                      checked={activeQuestionBlockIds.includes(block.id)}
                      onChange={(event) =>
                        setQuestionBlockIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, block.id])]
                            : current.filter((blockId) => blockId !== block.id),
                        )
                      }
                    />
                    <span>
                      <small>{block.type}</small>
                      {block.text}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="chat-history">
              {(activeSession?.messages ?? []).map((message) => (
                <article className={`chat-message ${message.role}`} key={message.id}>
                  <span>{message.role === "user" ? "YOU" : "AI"}</span>
                  <p>{message.content}</p>
                  {message.role === "assistant" && message.sourceText && (
                    <details className="message-source">
                      <summary>근거 보기</summary>
                      <blockquote>{message.sourceText.slice(0, 900)}</blockquote>
                    </details>
                  )}
                  {message.role === "assistant" && (
                    <button
                      type="button"
                      onClick={() => onCopy(message.content)}
                      aria-label="답변 복사"
                    >
                      <Copy size={12} />
                    </button>
                  )}
                </article>
              ))}
              {streamingAnswer && (
                <article className="chat-message assistant streaming">
                  <span>AI</span>
                  <p>{streamingAnswer}</p>
                </article>
              )}
            </div>
            <div className="ask-compose">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="이 문단에서 저자가 주장하는 핵심은?"
              />
              <button
                type="button"
                disabled={
                  asking ||
                  !question.trim() ||
                  (questionScope === "selection" && !selection) ||
                  (questionScope === "blocks" &&
                    activeQuestionBlockIds.length === 0)
                }
                onClick={() => {
                  onAsk(
                    question.trim(),
                    questionScope,
                    activeQuestionBlockIds,
                  );
                  setQuestion("");
                }}
              >
                {asking ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Send size={15} />
                )}
              </button>
            </div>
            {latestAnswer && (
              <button
                type="button"
                className="secondary-action wide"
                onClick={() => onSaveAnswerAsNote(latestAnswer)}
              >
                <StickyNote size={14} /> 마지막 답변을 메모로 저장
              </button>
            )}
          </>
        )}

        {activeTab === "notes" && (
          <>
            <div className="note-compose">
              {selection && <small>선택: {selection.text.slice(0, 100)}</small>}
              <textarea
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder="Markdown 메모"
              />
              <button
                type="button"
                disabled={!hasDocument || !noteDraft.trim()}
                onClick={() => {
                  onAddNote(noteDraft.trim());
                  setNoteDraft("");
                }}
              >
                <Check size={14} /> 메모 저장
              </button>
            </div>
            <div className="annotation-list">
              {notes.map((note) => (
                <article key={note.id}>
                  <header>
                    <button
                      type="button"
                      onClick={() => note.pageNumber && onGoToPage(note.pageNumber)}
                    >
                      {note.scope} {note.pageNumber ? `· p.${note.pageNumber}` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteNote(note.id)}
                      aria-label="메모 삭제"
                    >
                      <Trash2 size={13} />
                    </button>
                  </header>
                  <textarea
                    defaultValue={note.markdown}
                    onBlur={(event) => onUpdateNote(note, event.target.value)}
                    aria-label="메모 수정"
                  />
                  {note.selectedText && <small>{note.selectedText}</small>}
                </article>
              ))}
            </div>
          </>
        )}

        {activeTab === "highlights" && (
          <div className="annotation-list">
            {highlights.length === 0 && (
              <p className="tool-empty">텍스트를 선택해 하이라이트하세요.</p>
            )}
            {highlights.map((highlight) => (
              <article key={highlight.id}>
                <header>
                  <button
                    type="button"
                    onClick={() => onGoToPage(highlight.pageNumber)}
                  >
                    <span
                      className="highlight-swatch"
                      style={{ background: highlight.color }}
                    />
                    p. {highlight.pageNumber} · {highlight.source}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteHighlight(highlight.id)}
                    aria-label="하이라이트 삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                </header>
                <p>{highlight.selectedText}</p>
              </article>
            ))}
          </div>
        )}

        {activeTab === "references" && (
          <div className="reference-list">
            {references.length === 0 && (
              <p className="tool-empty">탐지된 Figure/Table 참조가 없습니다.</p>
            )}
            {references.map((reference) => (
              <button
                type="button"
                key={reference.id}
                disabled={!reference.targetPageNumber}
                onClick={() => onOpenReference(reference)}
              >
                <ScanText size={15} />
                <span>
                  <strong>{reference.label}</strong>
                  <small>
                    p. {reference.sourcePageNumber}
                    {reference.targetPageNumber
                      ? ` → p. ${reference.targetPageNumber}`
                      : " · 캡션 없음"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
