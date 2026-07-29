import {
  BookOpenText,
  CheckCircle2,
  Clock3,
  FileText,
  Library,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReaderDocument } from "../types";

type SidebarProps = {
  documents: ReaderDocument[];
  activeDocumentId?: string;
  onOpenDocument: (document: ReaderDocument) => void;
};

function formatRecentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "미확인";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function Sidebar({
  documents,
  activeDocumentId,
  onOpenDocument,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const visibleDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [...documents]
      .sort((left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt),
      )
      .filter((document) =>
        normalized
          ? document.title.toLocaleLowerCase().includes(normalized)
          : true,
      )
      .slice(0, 40);
  }, [documents, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>LIBRARY</span>
        <Library size={15} />
      </div>

      <label className="sidebar-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="논문 제목 검색"
          aria-label="최근 논문 제목 검색"
        />
      </label>

      <div className="sidebar-section-title">
        {query ? <FileText size={13} /> : <Clock3 size={13} />}
        {query ? "검색 결과" : "최근 논문"}
      </div>

      <div className="recent-list">
        {visibleDocuments.length === 0 ? (
          <div className="recent-empty">
            <BookOpenText size={24} />
            <p>{query ? "일치하는 논문이 없습니다." : "아직 논문이 없습니다."}</p>
          </div>
        ) : (
          visibleDocuments.map((document) => (
            <button
              type="button"
              key={document.id}
              className={`recent-item ${
                document.id === activeDocumentId ? "recent-item--active" : ""
              }`}
              onClick={() => onOpenDocument(document)}
              title={document.filePath}
            >
              <span className="pdf-badge">PDF</span>
              <span className="recent-copy">
                <strong>{document.title}</strong>
                <small>
                  {formatRecentDate(document.lastOpenedAt)}
                  <span>·</span>
                  p. {document.viewState.pageNumber}
                </small>
                {(document.translationProgress ?? 0) >= 1 && (
                  <span className="recent-translation-ready">
                    <CheckCircle2 size={11} />
                    한국어 논문 있음
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="sidebar-foot">
        <span className="status-dot" />
        로컬 최근 논문 · {documents.length}
      </div>
    </aside>
  );
}
