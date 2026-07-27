import {
  BookOpenText,
  Clock3,
  FileText,
  FolderClosed,
  FolderPlus,
  Library,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { LibraryFolder, ReaderDocument } from "../types";

type LibraryView = "recent" | "folders" | "tags";

type SidebarProps = {
  documents: ReaderDocument[];
  folders: LibraryFolder[];
  activeDocumentId?: string;
  scanning: boolean;
  onOpenDocument: (document: ReaderDocument) => void;
  onAddFolder: () => void;
  onRescanFolder: (folder: LibraryFolder) => void;
  onSetTags: (documentId: string, tags: string[]) => void;
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
  folders,
  activeDocumentId,
  scanning,
  onOpenDocument,
  onAddFolder,
  onRescanFolder,
  onSetTags,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LibraryView>("recent");
  const [tagDraft, setTagDraft] = useState("");

  const activeDocument = documents.find(
    (document) => document.id === activeDocumentId,
  );
  const allTags = useMemo(
    () =>
      [...new Set(documents.flatMap((document) => document.tags ?? []))].sort(
        (left, right) => left.localeCompare(right),
      ),
    [documents],
  );
  const visibleDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    let result = [...documents];
    if (view === "recent") {
      result = result
        .sort((left, right) =>
          right.lastOpenedAt.localeCompare(left.lastOpenedAt),
        )
        .slice(0, 30);
    }
    if (normalized) {
      result = result.filter((document) =>
        `${document.title} ${document.filePath} ${(document.tags ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(normalized),
      );
    }
    return result;
  }, [documents, query, view]);

  const addTag = () => {
    if (!activeDocument || !tagDraft.trim()) return;
    onSetTags(activeDocument.id, [
      ...(activeDocument.tags ?? []),
      tagDraft.trim(),
    ]);
    setTagDraft("");
  };

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
          placeholder="제목 · 경로 · 태그 검색"
          aria-label="논문 검색"
        />
      </label>

      <nav className="sidebar-nav" aria-label="논문 라이브러리">
        <button
          type="button"
          className={`nav-item ${view === "recent" ? "nav-item--active" : ""}`}
          onClick={() => setView("recent")}
        >
          <Clock3 size={15} />
          최근 논문
          <span>{documents.length}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${view === "folders" ? "nav-item--active" : ""}`}
          onClick={() => setView("folders")}
        >
          <FolderClosed size={15} />
          논문 폴더
          <span>{folders.length}</span>
        </button>
        <button
          type="button"
          className={`nav-item ${view === "tags" ? "nav-item--active" : ""}`}
          onClick={() => setView("tags")}
        >
          <Tag size={15} />
          태그
          <span>{allTags.length}</span>
        </button>
      </nav>

      {view === "folders" && (
        <section className="folder-manager">
          <button
            type="button"
            className="folder-add"
            onClick={onAddFolder}
            disabled={scanning}
          >
            <FolderPlus size={15} />
            {scanning ? "폴더 스캔 중…" : "논문 폴더 추가"}
          </button>
          {folders.map((folder) => (
            <div className="folder-row" key={folder.id} title={folder.path}>
              <span>
                <strong>{folder.name}</strong>
                <small>{formatRecentDate(folder.lastScannedAt)}</small>
              </span>
              <button
                type="button"
                onClick={() => onRescanFolder(folder)}
                disabled={scanning}
                aria-label={`${folder.name} 다시 스캔`}
              >
                <RefreshCw size={14} />
              </button>
            </div>
          ))}
        </section>
      )}

      {view === "tags" && (
        <section className="tag-manager">
          {activeDocument ? (
            <>
              <span className="sidebar-section-title">현재 논문 태그</span>
              <div className="tag-list">
                {(activeDocument.tags ?? []).map((tag) => (
                  <span className="tag-chip" key={tag}>
                    {tag}
                    <button
                      type="button"
                      aria-label={`${tag} 태그 삭제`}
                      onClick={() =>
                        onSetTags(
                          activeDocument.id,
                          (activeDocument.tags ?? []).filter(
                            (candidate) => candidate !== tag,
                          ),
                        )
                      }
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="tag-input">
                <input
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addTag();
                  }}
                  placeholder="태그 추가"
                />
                <button type="button" onClick={addTag}>
                  추가
                </button>
              </div>
            </>
          ) : (
            <p className="sidebar-hint">논문을 열면 태그를 편집할 수 있습니다.</p>
          )}
          <div className="tag-cloud">
            {allTags.map((tag) => (
              <button type="button" key={tag} onClick={() => setQuery(tag)}>
                #{tag}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="sidebar-section-title">
        <FileText size={13} />
        {query ? "검색 결과" : view === "recent" ? "최근 열어본 파일" : "논문"}
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
              } ${document.missing ? "recent-item--missing" : ""}`}
              onClick={() => onOpenDocument(document)}
              title={document.filePath}
              disabled={document.missing}
            >
              <span className="pdf-badge">PDF</span>
              <span className="recent-copy">
                <strong>{document.title}</strong>
                <small>
                  {document.missing ? "파일 없음" : `p. ${document.viewState.pageNumber}`}
                  <span>·</span>
                  {Math.round((document.translationProgress ?? 0) * 100)}% 번역
                </small>
                {(document.tags ?? []).length > 0 && (
                  <span className="recent-tags">
                    {(document.tags ?? []).slice(0, 3).map((tag) => `#${tag}`).join(" ")}
                  </span>
                )}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="sidebar-foot">
        <span className="status-dot" />
        로컬 라이브러리 · {documents.filter((document) => !document.missing).length}
      </div>
    </aside>
  );
}

