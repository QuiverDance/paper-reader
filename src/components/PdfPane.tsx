import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "../lib/pdf";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { Languages, LoaderCircle, ScanSearch } from "lucide-react";
import type {
  DocumentBlock,
  DocumentReference,
  Highlight,
  NormalizedRect,
  PaneId,
  TextSelection,
  TranslationRecord,
  ViewState,
} from "../types";
import { clamp } from "../lib/reader-state";

type PdfPaneProps = {
  document: PDFDocumentProxy;
  paneId: PaneId;
  label: string;
  detail: string;
  targetState: ViewState;
  active: boolean;
  blocks: DocumentBlock[];
  translations: TranslationRecord[];
  highlights: Highlight[];
  references: DocumentReference[];
  translationOverlay: boolean;
  onActivate: (paneId: PaneId) => void;
  onUpdate: (paneId: PaneId, update: Partial<ViewState>) => void;
  onSelection: (selection: TextSelection) => void;
  onWordLookup: (selection: TextSelection) => void;
  onReference: (reference: DocumentReference) => void;
  onEditTranslation: (translation: TranslationRecord, text: string) => void;
};

type PageChangingEvent = { pageNumber: number };
type ScaleChangingEvent = {
  scale: number;
  presetValue?: string | null;
};
type RotationChangingEvent = { pagesRotation: number };
type PageElement = { pageNumber: number; element: HTMLElement };

function rotateRect(rect: NormalizedRect, rotation: number): NormalizedRect {
  if (rotation === 90) {
    return {
      x: 1 - rect.y - rect.height,
      y: rect.x,
      width: rect.height,
      height: rect.width,
    };
  }
  if (rotation === 180) {
    return {
      x: 1 - rect.x - rect.width,
      y: 1 - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    };
  }
  if (rotation === 270) {
    return {
      x: rect.y,
      y: 1 - rect.x - rect.width,
      width: rect.height,
      height: rect.width,
    };
  }
  return rect;
}
function rectStyle(rect: NormalizedRect, rotation: number) {
  const rotated = rotateRect(rect, rotation);
  return {
    left: `${rotated.x * 100}%`,
    top: `${rotated.y * 100}%`,
    width: `${rotated.width * 100}%`,
    height: `${rotated.height * 100}%`,
  };
}

export function PdfPane({
  document,
  paneId,
  label,
  detail,
  targetState,
  active,
  blocks,
  translations,
  highlights,
  references,
  translationOverlay,
  onActivate,
  onUpdate,
  onSelection,
  onWordLookup,
  onReference,
  onEditTranslation,
}: PdfPaneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const readyRef = useRef(false);
  const applyingRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const latestStateRef = useRef(targetState);
  const [ready, setReady] = useState(false);
  const [pageElements, setPageElements] = useState<PageElement[]>([]);

  latestStateRef.current = targetState;

  const releaseApplying = () => {
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
    }
    releaseTimerRef.current = window.setTimeout(() => {
      applyingRef.current = false;
      releaseTimerRef.current = null;
    }, 80);
  };

  const collectPageElements = () => {
    const viewerElement = viewerElementRef.current;
    if (!viewerElement) return;
    setPageElements(
      Array.from(viewerElement.querySelectorAll<HTMLElement>(".page")).flatMap(
        (element) => {
          const pageNumber = Number(element.dataset.pageNumber);
          return Number.isFinite(pageNumber) ? [{ pageNumber, element }] : [];
        },
      ),
    );
  };

  const applyAnchor = (state: ViewState) => {
    const container = containerRef.current;
    const viewer = pdfViewerRef.current;
    if (!container || !viewer || !readyRef.current) return;

    const pageView = viewer.getPageView(state.pageNumber - 1);
    if (!pageView?.div) return;
    const pageHeight = Math.max(pageView.div.clientHeight, 1);
    const nextTop =
      pageView.div.offsetTop + clamp(state.relativeOffsetY, 0, 1) * pageHeight;
    if (Math.abs(container.scrollTop - nextTop) > 3) {
      container.scrollTop = nextTop;
    }
  };

  const captureSelection = (
    clientX: number,
    clientY: number,
  ): TextSelection | null => {
    const section = sectionRef.current;
    const selection = window.getSelection();
    if (!section || !selection || selection.isCollapsed || !selection.rangeCount) {
      return null;
    }
    const text = selection.toString().trim();
    if (!text) return null;
    const range = selection.getRangeAt(0);
    const common =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    const page = common?.closest<HTMLElement>(".page");
    if (!page || !section.contains(page)) return null;
    const pageNumber = Number(page.dataset.pageNumber);
    const pageRect = page.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom >= pageRect.top &&
          rect.top <= pageRect.bottom,
      )
      .map((rect) => ({
        x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
        width: clamp(rect.width / pageRect.width, 0, 1),
        height: clamp(rect.height / pageRect.height, 0, 1),
      }));
    if (!rects.length || !Number.isFinite(pageNumber)) return null;
    const pageText = blocks
      .filter((block) => block.pageNumber === pageNumber)
      .map((block) => block.text)
      .join(" ");
    const selectedIndex = pageText.indexOf(text);
    const context =
      selectedIndex >= 0
        ? pageText.slice(
            Math.max(0, selectedIndex - 180),
            selectedIndex + text.length + 180,
          )
        : pageText.slice(0, 600);
    return {
      text,
      pageNumber,
      source: paneId === "original" ? "original" : "translation",
      rects,
      context,
      clientX,
      clientY,
    };
  };

  useEffect(() => {
    const container = containerRef.current;
    const viewerElement = viewerElementRef.current;
    if (!container || !viewerElement) return;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      textLayerMode: 1,
      removePageBorders: false,
    });
    linkService.setViewer(viewer);
    linkService.setDocument(document);
    viewer.setDocument(document);
    pdfViewerRef.current = viewer;

    const onPagesInit = () => {
      const state = latestStateRef.current;
      applyingRef.current = true;
      viewer.pagesRotation = state.rotation;
      viewer.currentScaleValue = state.scaleValue;
      viewer.currentPageNumber = state.pageNumber;
      readyRef.current = true;
      setReady(true);
      window.requestAnimationFrame(() => {
        collectPageElements();
        applyAnchor(state);
        releaseApplying();
      });
    };

    const onPageChanging = (event: PageChangingEvent) => {
      if (!applyingRef.current) {
        onUpdate(paneId, { pageNumber: event.pageNumber });
      }
    };

    const onScaleChanging = (event: ScaleChangingEvent) => {
      if (!applyingRef.current) {
        onUpdate(paneId, {
          scale: event.scale,
          scaleValue: event.presetValue || String(event.scale),
        });
      }
    };

    const onRotationChanging = (event: RotationChangingEvent) => {
      if (!applyingRef.current) {
        onUpdate(paneId, { rotation: event.pagesRotation });
      }
    };

    const reportScrollAnchor = () => {
      scrollFrameRef.current = null;
      if (applyingRef.current || !readyRef.current) return;
      const pageNumber = viewer.currentPageNumber;
      const pageView = viewer.getPageView(pageNumber - 1);
      if (!pageView?.div) return;
      const relativeOffsetY = clamp(
        (container.scrollTop - pageView.div.offsetTop) /
          Math.max(pageView.div.clientHeight, 1),
        0,
        1,
      );
      onUpdate(paneId, { pageNumber, relativeOffsetY });
    };

    const onScroll = () => {
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = window.requestAnimationFrame(reportScrollAnchor);
      }
    };

    eventBus.on("pagesinit", onPagesInit);
    eventBus.on("pagechanging", onPageChanging);
    eventBus.on("scalechanging", onScaleChanging);
    eventBus.on("rotationchanging", onRotationChanging);
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      readyRef.current = false;
      setReady(false);
      setPageElements([]);
      container.removeEventListener("scroll", onScroll);
      eventBus.off("pagesinit", onPagesInit);
      eventBus.off("pagechanging", onPageChanging);
      eventBus.off("scalechanging", onScaleChanging);
      eventBus.off("rotationchanging", onRotationChanging);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
      }
      linkService.setDocument(null!);
      viewer.setDocument(null!);
      viewer.cleanup();
      pdfViewerRef.current = null;
      viewerElement.replaceChildren();
    };
  }, [document, onUpdate, paneId]);

  useEffect(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer || !readyRef.current) return;

    applyingRef.current = true;
    if (viewer.pagesRotation !== targetState.rotation) {
      viewer.pagesRotation = targetState.rotation;
    }
    if (viewer.currentScaleValue !== targetState.scaleValue) {
      viewer.currentScaleValue = targetState.scaleValue;
    }
    if (viewer.currentPageNumber !== targetState.pageNumber) {
      viewer.currentPageNumber = targetState.pageNumber;
    }
    window.requestAnimationFrame(() => {
      collectPageElements();
      applyAnchor(targetState);
      releaseApplying();
    });
  }, [
    targetState.pageNumber,
    targetState.relativeOffsetY,
    targetState.rotation,
    targetState.scaleValue,
  ]);

  return (
    <section
      ref={sectionRef}
      className={`pdf-pane ${active ? "pdf-pane--active" : ""}`}
      onPointerDown={() => onActivate(paneId)}
      onMouseUp={(event) => {
        const captured = captureSelection(event.clientX, event.clientY);
        if (captured) onSelection(captured);
      }}
      onDoubleClick={(event) => {
        window.requestAnimationFrame(() => {
          const captured = captureSelection(event.clientX, event.clientY);
          if (captured && /^[A-Za-z][A-Za-z'-]*$/.test(captured.text)) {
            onWordLookup(captured);
          }
        });
      }}
      aria-label={`${label} PDF viewer`}
    >
      <header className="pane-header">
        <div className="pane-title">
          <span className={`pane-dot pane-dot--${paneId}`} />
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        <span className="pane-page">
          {targetState.pageNumber} / {document.numPages}
        </span>
      </header>
      <div className="pdf-scroll" ref={containerRef}>
        <div className="pdfViewer" ref={viewerElementRef} />
        {!ready && (
          <div className="pane-loading">
            <LoaderCircle size={20} className="spin" />
            <span>페이지를 준비하는 중</span>
          </div>
        )}
      </div>

      {pageElements.map(({ pageNumber, element }) =>
        createPortal(
          <div className="paper-overlay-root" aria-hidden={false}>
            {highlights
              .filter(
                (highlight) =>
                  highlight.pageNumber === pageNumber &&
                  highlight.source ===
                    (paneId === "original" ? "original" : "translation"),
              )
              .flatMap((highlight) =>
                highlight.rects.map((rect, index) => (
                  <span
                    className="highlight-overlay"
                    key={`${highlight.id}-${index}`}
                    style={{
                      ...rectStyle(rect, targetState.rotation),
                      background: highlight.color,
                    }}
                  />
                )),
              )}

            {translationOverlay &&
              paneId === "companion" &&
              blocks
                .filter((block) => block.pageNumber === pageNumber)
                .map((block) => {
                  const translation = translations.find(
                    (candidate) =>
                      candidate.blockId === block.id &&
                      candidate.status === "translated",
                  );
                  if (!translation) return null;
                  return (
                    <div
                      className="translation-overlay-block"
                      key={translation.id}
                      style={rectStyle(block.bbox, targetState.rotation)}
                      title="번역문을 클릭해 직접 수정할 수 있습니다."
                    >
                      <Languages size={10} />
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(event) =>
                          onEditTranslation(
                            translation,
                            event.currentTarget.textContent ?? "",
                          )
                        }
                      >
                        {translation.translatedText}
                      </span>
                    </div>
                  );
                })}

            {paneId === "original" &&
              references
                .filter(
                  (reference) => reference.sourcePageNumber === pageNumber,
                )
                .map((reference) => {
                  const sourceBlock = blocks.find(
                    (block) => block.id === reference.sourceBlockId,
                  );
                  if (!sourceBlock) return null;
                  return (
                    <button
                      type="button"
                      className="reference-hotspot"
                      key={reference.id}
                      style={rectStyle(sourceBlock.bbox, targetState.rotation)}
                      disabled={!reference.targetPageNumber}
                      onClick={(event) => {
                        event.stopPropagation();
                        onReference(reference);
                      }}
                      title={`${reference.label} 미리보기`}
                    >
                      <ScanSearch size={12} />
                      {reference.label}
                    </button>
                  );
                })}
          </div>,
          element,
          `${paneId}-${pageNumber}`,
        ),
      )}
    </section>
  );
}
