import {
  BookOpenText,
  Clock3,
  FileText,
  FolderClosed,
  Library,
  Search,
  Tag,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReaderDocument } from "../types";

type SidebarProps = {
  recentDocuments: ReaderDocument[];
  activeDocumentId?: string;
  onOpenRecent: (document: ReaderDocument) => void;
};

function formatRecentDate(value: string): string {
  const date = new Date(value);
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
  recentDocuments,
  activeDocumentId,
  onOpenRecent,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return recentDocuments;
    return recentDocuments.filter((document) =>
      `${document.title} ${document.filePath}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query, recentDocuments]);

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
          placeholder="파일명 검색"
          aria-label="최근 논문 검색"
        />
      </label>

      <nav className="sidebar-nav" aria-label="논문 라이브러리">
        <button type="button" className="nav-item nav-item--active">
          <Clock3 size={15} />
          최근 논문
          <span>{recentDocuments.length}</span>
        </button>
        <button type="button" className="nav-item" disabled>
          <FolderClosed size={15} />
          논문 폴더
          <span className="soon">NEXT</span>
        </button>
        <button type="button" className="nav-item" disabled>
          <Tag size={15} />
          태그
          <span className="soon">NEXT</span>
        </button>
      </nav>

      <div className="sidebar-section-title">
        <FileText size={13} />
        최근 열어본 파일
      </div>

      <div className="recent-list">
        {filtered.length === 0 ? (
          <div className="recent-empty">
            <BookOpenText size={24} />
            <p>{query ? "일치하는 논문이 없습니다." : "아직 연 논문이 없습니다."}</p>
          </div>
        ) : (
          filtered.map((document) => (
            <button
              type="button"
              key={document.id}
              className={`recent-item ${
                document.id === activeDocumentId ? "recent-item--active" : ""
              }`}
              onClick={() => onOpenRecent(document)}
              title={document.filePath}
            >
              <span className="pdf-badge">PDF</span>
              <span className="recent-copy">
                <strong>{document.title}</strong>
                <small>
                  p. {document.viewState.pageNumber}
                  <span>·</span>
                  {formatRecentDate(document.lastOpenedAt)}
                </small>
              </span>
            </button>
          ))
        )}
      </div>

      <div className="sidebar-foot">
        <span className="status-dot" />
        로컬 라이브러리
      </div>
    </aside>
  );
}

