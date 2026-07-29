import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import { referencePreviewPosition } from "../lib/reference-preview";
import type {
  DocumentReference,
  ReferenceAnchor,
} from "../types";

type FigurePreviewProps = {
  document: PDFDocumentProxy;
  reference: DocumentReference;
  anchor: ReferenceAnchor;
  caption?: string;
  onEnter: () => void;
  onLeave: () => void;
  onGoToPage: (pageNumber: number) => void;
};

export function FigurePreview({
  document,
  reference,
  anchor,
  caption,
  onEnter,
  onLeave,
  onGoToPage,
}: FigurePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const position = useMemo(
    () =>
      referencePreviewPosition(anchor, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    [anchor],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const pageNumber = reference.targetPageNumber;
    const bbox = reference.targetBbox;
    if (!canvas || !pageNumber || !bbox) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    setError(null);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const unitViewport = page.getViewport({ scale: 1 });
        const sourceWidth = Math.max(1, bbox.width * unitViewport.width);
        const sourceHeight = Math.max(1, bbox.height * unitViewport.height);
        const scale = Math.min(2.2, 500 / sourceWidth, 330 / sourceHeight);
        const viewport = page.getViewport({ scale });
        const cropX = bbox.x * viewport.width;
        const cropY = bbox.y * viewport.height;
        const cropWidth = Math.max(1, bbox.width * viewport.width);
        const cropHeight = Math.max(1, bbox.height * viewport.height);
        canvas.width = Math.ceil(cropWidth);
        canvas.height = Math.ceil(cropHeight);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("미리보기 캔버스를 준비하지 못했습니다.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: [1, 0, 0, 1, -cropX, -cropY],
        });
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
  }, [
    document,
    reference.targetBbox,
    reference.targetPageNumber,
  ]);

  return (
    <aside
      className="reference-preview-card"
      role="tooltip"
      aria-label={`${reference.label} 미리보기`}
      style={position}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="reference-preview-media">
        {error ? (
          <p className="tool-error">{error}</p>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
      {caption && (
        <p className="reference-preview-caption">
          {caption}
        </p>
      )}
      <button
        type="button"
        className="reference-preview-page"
        onClick={() =>
          reference.targetPageNumber &&
          onGoToPage(reference.targetPageNumber)
        }
      >
        {reference.label} · 원문 p. {reference.targetPageNumber ?? "?"}
      </button>
    </aside>
  );
}
