import { FileText, FolderOpen, Rows3, ShieldCheck } from "lucide-react";

export function EmptyReader({ onOpen }: { onOpen: () => void }) {
  return (
    <main className="empty-reader">
      <div className="empty-visual" aria-hidden="true">
        <div className="paper-sheet paper-sheet--back" />
        <div className="paper-sheet paper-sheet--front">
          <span className="fake-title" />
          <span className="fake-line fake-line--wide" />
          <span className="fake-line" />
          <span className="fake-line fake-line--short" />
          <div className="fake-figure" />
          <span className="fake-line fake-line--wide" />
          <span className="fake-line" />
        </div>
        <div className="split-hint">
          <Rows3 size={17} />
        </div>
      </div>

      <div className="empty-copy">
        <span className="eyebrow">LOCAL-FIRST PAPER READER</span>
        <h1>논문의 구조를 그대로,<br />두 화면에서 나란히 읽으세요.</h1>
        <p>
          먼저 로컬 PDF를 열어 기본 리더와 동기화된 분할 뷰를 시작합니다.
          원본 파일은 변경하지 않습니다.
        </p>
        <button type="button" className="primary-action" onClick={onOpen}>
          <FolderOpen size={18} />
          PDF 선택
        </button>
        <div className="empty-meta">
          <span><FileText size={14} /> 디지털 PDF</span>
          <span><ShieldCheck size={14} /> 로컬 처리</span>
        </div>
      </div>
    </main>
  );
}

