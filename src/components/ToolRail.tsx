import {
  Bookmark,
  Check,
  Copy,
  FileText,
  LoaderCircle,
  MessageSquareText,
  PanelRightClose,
  ScanText,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { askContextLabel } from "../lib/paper-context";
import type {
  ChatSession,
  DictionaryEntry,
  DocumentReference,
  Highlight,
  Note,
  ReadingToolTab,
  TextSelection,
} from "../types";

type ToolRailProps = {
  activeTab: ReadingToolTab;
  hasDocument: boolean;
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
  onAsk: (question: string) => void;
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
  icon: typeof MessageSquareText;
}> = [
  { id: "ask", label: "Ask", icon: MessageSquareText },
  { id: "notes", label: "메모", icon: StickyNote },
  { id: "highlights", label: "표시", icon: Bookmark },
  { id: "references", label: "참조", icon: ScanText },
];

export function ToolRail({
  activeTab,
  hasDocument,
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
  const [noteDraft, setNoteDraft] = useState("");
  const activeSession = sessions[0];
  const latestAnswer = useMemo(
    () =>
      [...(activeSession?.messages ?? [])]
        .reverse()
        .find((message) => message.role === "assistant")?.content ?? "",
    [activeSession],
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
        {activeTab === "ask" && (
          <>
            <section className="paper-context-card">
              <FileText size={15} />
              <span>
                <strong>논문 전체 맥락</strong>
                <small>
                  PDF 지원 모델은 원본 파일, 그 외 모델은 전체 텍스트 또는
                  계층형 요약을 사용합니다.
                </small>
              </span>
            </section>

            {selection && (
              <blockquote className="selection-context">
                <span>선택 문장을 질문의 초점으로 자동 첨부</span>
                {selection.text.slice(0, 260)}
              </blockquote>
            )}

            <div className="chat-history">
              {(activeSession?.messages ?? []).map((message) => (
                <article className={`chat-message ${message.role}`} key={message.id}>
                  <span>{message.role === "user" ? "YOU" : "AI"}</span>
                  {message.role === "assistant" && message.contextMode && (
                    <small className="ask-context-mode">
                      {askContextLabel(message.contextMode)} 사용
                    </small>
                  )}
                  <p>{message.content}</p>
                  {message.role === "assistant" &&
                    (message.evidence?.length ?? 0) > 0 && (
                      <div className="ask-evidence-list">
                        {message.evidence!.map((evidence, index) => (
                          <button
                            type="button"
                            key={`${message.id}-evidence-${index}`}
                            onClick={() => onGoToPage(evidence.pageNumber)}
                            title={evidence.quote}
                          >
                            p.{evidence.pageNumber}
                            {evidence.sectionTitle
                              ? ` · ${evidence.sectionTitle}`
                              : ""}
                          </button>
                        ))}
                      </div>
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
                placeholder="논문 전체를 바탕으로 질문하세요"
              />
              <button
                type="button"
                disabled={asking || !hasDocument || !question.trim()}
                onClick={() => {
                  onAsk(question.trim());
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
                placeholder="논문 전체 메모"
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
                      논문 메모 {note.pageNumber ? `· p.${note.pageNumber}` : ""}
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
                    p. {highlight.pageNumber} ·{" "}
                    {highlight.source === "original" ? "원문" : "한국어"}
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
