import { Check, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { DocumentBlock, TranslationRecord } from "../types";

export type KoreanTranslationEdit = {
  record: TranslationRecord;
  translatedText: string;
};

type KoreanPaperEditorProps = {
  blocks: DocumentBlock[];
  translations: TranslationRecord[];
  saving: boolean;
  onCancel: () => void;
  onSave: (edits: KoreanTranslationEdit[]) => void;
};

export function KoreanPaperEditor({
  blocks,
  translations,
  saving,
  onCancel,
  onSave,
}: KoreanPaperEditorProps) {
  const ordered = useMemo(() => {
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    return translations
      .filter(
        (record) =>
          record.status === "translated" &&
          record.translatedText.trim() &&
          blockById.has(record.blockId),
      )
      .sort((left, right) => {
        const leftBlock = blockById.get(left.blockId)!;
        const rightBlock = blockById.get(right.blockId)!;
        return (
          leftBlock.pageNumber - rightBlock.pageNumber ||
          leftBlock.readingOrder - rightBlock.readingOrder
        );
      })
      .map((record) => ({ record, block: blockById.get(record.blockId)! }));
  }, [blocks, translations]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ordered.map(({ record }) => [record.id, record.translatedText]),
    ),
  );
  const edits = ordered.flatMap(({ record }) => {
    const translatedText = drafts[record.id]?.trim() ?? "";
    return translatedText && translatedText !== record.translatedText
      ? [{ record, translatedText }]
      : [];
  });

  return (
    <section className="korean-inline-editor" aria-label="한국어 논문 내용 수정">
      <header>
        <div>
          <strong>한국어 내용 수정</strong>
          <span>수정한 문장은 다시 생성해도 보호됩니다.</span>
        </div>
        <div>
          <button
            type="button"
            className="primary-action compact"
            disabled={!edits.length || saving}
            onClick={() => onSave(edits)}
          >
            {saving ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Check size={14} />
            )}
            수정본 적용
          </button>
          <button type="button" onClick={onCancel} aria-label="내용 수정 닫기">
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="korean-inline-editor-list">
        {ordered.map(({ record, block }) => (
          <article key={record.id}>
            <div>
              <span>
                p.{block.pageNumber} · {block.type}
              </span>
              {record.locked && <small>보호됨</small>}
            </div>
            <p>{block.text}</p>
            <textarea
              value={drafts[record.id] ?? record.translatedText}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [record.id]: event.target.value,
                }))
              }
              aria-label={`p.${block.pageNumber} 한국어 내용`}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
