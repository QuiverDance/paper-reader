import { ExternalLink, X } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import type { DocumentReference } from "../types";

type FigurePreviewProps = {
  document: PDFDocumentProxy;
  reference: DocumentReference;
  translatedCaption?: string;
  onClose: () => void;
  onGoToPage: (pageNumber: number) => void;
};

export function FigurePreview({
  document,
  reference,
  translatedCaption,
  onClose,
  onGoToPage,
}: FigurePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pageNumber = reference.targetPageNumber;
    if (!canvas || !pageNumber) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.35 });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas를 준비하지 못했습니다.");
        task = page.render({ canvas, canvasContext: context, viewport });
        return task.promise;
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, reference.targetPageNumber]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="figure-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`${reference.label} 미리보기`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{reference.kind === "figure" ? "FIGURE" : "TABLE"}</span>
            <h2>{reference.label}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="미리보기 닫기">
            <X size={17} />
          </button>
        </header>
        <div className="figure-canvas-wrap">
          {error ? <p className="tool-error">{error}</p> : <canvas ref={canvasRef} />}
          {reference.targetBbox && (
            <span
              className="figure-target-box"
              style={{
                left: `${reference.targetBbox.x * 100}%`,
                top: `${reference.targetBbox.y * 100}%`,
                width: `${reference.targetBbox.width * 100}%`,
                height: `${reference.targetBbox.height * 100}%`,
              }}
            />
          )}
        </div>
        {translatedCaption && (
          <p className="figure-translated-caption">{translatedCaption}</p>
        )}
        <footer>
          <span>p. {reference.targetPageNumber ?? "?"}</span>
          {reference.targetPageNumber && (
            <button
              type="button"
              className="secondary-action"
              onClick={() => onGoToPage(reference.targetPageNumber!)}
            >
              <ExternalLink size={15} />
              원본 페이지로 이동
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
