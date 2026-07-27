import {
  Bookmark,
  Languages,
  MessageSquareText,
  PanelRightClose,
  ScanText,
  StickyNote,
} from "lucide-react";

export function ToolRail() {
  return (
    <aside className="tool-rail">
      <div className="tool-rail-header">
        <div>
          <span>READING TOOLS</span>
          <strong>도구</strong>
        </div>
        <PanelRightClose size={16} />
      </div>

      <section className="tool-card tool-card--accent">
        <div className="tool-card-title">
          <Languages size={16} />
          <span>번역 레이어</span>
          <small>NEXT</small>
        </div>
        <p>분할 뷰가 안정화되면 문단 좌표 기반 번역이 이 패널에 연결됩니다.</p>
        <div className="translation-skeleton">
          <span />
          <span />
          <span />
        </div>
      </section>

      <div className="tool-list">
        <button type="button" disabled>
          <MessageSquareText size={16} />
          <span>
            <strong>Ask</strong>
            선택 문단에 질문
          </span>
        </button>
        <button type="button" disabled>
          <StickyNote size={16} />
          <span>
            <strong>Notes</strong>
            페이지와 메모 연결
          </span>
        </button>
        <button type="button" disabled>
          <Bookmark size={16} />
          <span>
            <strong>Highlights</strong>
            중요한 문장 표시
          </span>
        </button>
        <button type="button" disabled>
          <ScanText size={16} />
          <span>
            <strong>References</strong>
            Figure · Table 미리보기
          </span>
        </button>
      </div>

      <div className="scope-note">
        <span>이번 구현 범위</span>
        <strong>PDF reader · Split view · Sync · SQLite</strong>
      </div>
    </aside>
  );
}

