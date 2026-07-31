import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  referencePreviewDisplaySize,
  referencePreviewMediaMaxHeight,
  referencePreviewPosition,
} from "../lib/reference-preview";
import { sourceRegisteredAssetRect } from "../lib/source-registered-assets";
import type {
  DocumentReference,
  ReferenceAnchor,
} from "../types";

type FigurePreviewProps = {
  document: PDFDocumentProxy;
  reference: DocumentReference;
  anchor: ReferenceAnchor;
  caption?: string;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  onGoToPage: (pageNumber: number) => void;
};

export function FigurePreview({
  document,
  reference,
  anchor,
  caption,
  pinned,
  onEnter,
  onLeave,
  onClose,
  onGoToPage,
}: FigurePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [captionHeight, setCaptionHeight] = useState(0);
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const displaySize = useMemo(
    () =>
      sourceSize
        ? referencePreviewDisplaySize(
            sourceSize,
            {
              width: window.innerWidth,
              height: window.innerHeight,
            },
            captionHeight,
          )
        : null,
    [captionHeight, sourceSize],
  );
  const position = useMemo(
    () =>
      referencePreviewPosition(
        anchor,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        displaySize
          ? {
              ...displaySize,
              captionHeight,
            }
          : undefined,
      ),
    [anchor, captionHeight, displaySize],
  );
  const mediaMaxHeight = referencePreviewMediaMaxHeight(
    position.maxHeight,
    captionHeight,
    displaySize?.height,
  );

  useLayoutEffect(() => {
    const element = captionRef.current;
    if (!element || !caption) {
      setCaptionHeight(0);
      return;
    }
    const updateHeight = () => {
      setCaptionHeight(element.getBoundingClientRect().height);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [caption, position.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pageNumber = reference.targetPageNumber;
    const targetBbox = reference.targetBbox;
    if (!canvas || !pageNumber || !targetBbox) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    setError(null);
    setSourceSize(null);
    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const unitViewport = page.getViewport({ scale: 1 });
        const bbox = sourceRegisteredAssetRect(
          targetBbox,
          reference.kind,
          unitViewport.width,
          unitViewport.height,
          reference.targetCropBottomLimit,
        );
        const sourceWidth = Math.max(1, bbox.width * unitViewport.width);
        const sourceHeight = Math.max(1, bbox.height * unitViewport.height);
        setSourceSize({ width: sourceWidth, height: sourceHeight });
        const scale = Math.min(
          4,
          Math.max(2.2, (window.devicePixelRatio || 1) * 2),
        );
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
    reference.kind,
    reference.targetBbox,
    reference.targetCropBottomLimit,
    reference.targetPageNumber,
  ]);

  return (
    <aside
      className="reference-preview-card"
      role={pinned ? "dialog" : "tooltip"}
      aria-label={`${reference.label} 미리보기`}
      style={position}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {pinned && (
        <button
          type="button"
          className="reference-preview-close"
          aria-label="미리보기 닫기"
          onClick={onClose}
        >
          ×
        </button>
      )}
      <div
        className="reference-preview-media"
        style={{ maxHeight: mediaMaxHeight }}
      >
        {error ? (
          <p className="tool-error">{error}</p>
        ) : (
          <canvas
            ref={canvasRef}
            style={{
              width: displaySize?.width,
              height: displaySize?.height,
            }}
          />
        )}
      </div>
      {caption && (
        <p ref={captionRef} className="reference-preview-caption">
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
