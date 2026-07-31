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
        <h1>원문과 한국어 논문을<br />한 화면에서 나란히 읽으세요.</h1>
        <p>
          로컬 PDF를 열면 원문이 먼저 표시됩니다. 한국어 논문은 원할 때
          만들 수 있고, 두 화면의 페이지와 확대 배율은 각각 조절됩니다.
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
