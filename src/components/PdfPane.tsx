import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "../lib/pdf";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCw,
} from "lucide-react";
import type {
  DocumentBlock,
  DocumentReference,
  Highlight,
  PaneId,
  ReferenceAnchor,
  TextSelection,
  ViewState,
} from "../types";
import {
  locateReferenceTokenRects,
  reconcileOverlayPages,
  referenceRectStyle,
} from "../lib/pdf-pane-overlay";
import type { OverlayPage } from "../lib/pdf-pane-overlay";
import {
  clamp,
  normalizeRotation,
  scaleBy,
  shouldApplyScrollAnchor,
} from "../lib/reader-state";
import { referenceRectsForPane } from "../lib/reference-preview";

type PdfPaneProps = {
  document: PDFDocumentProxy;
  paneId: PaneId;
  label: string;
  detail: string;
  targetState: ViewState;
  active: boolean;
  blocks: DocumentBlock[];
  highlights: Highlight[];
  references: DocumentReference[];
  expanded: boolean;
  onActivate: (paneId: PaneId) => void;
  onUpdate: (paneId: PaneId, update: Partial<ViewState>) => void;
  onToggleExpand: (paneId: PaneId) => void;
  onSelection: (selection: TextSelection) => void;
  onWordLookup: (selection: TextSelection) => void;
  onReferenceEnter: (
    paneId: PaneId,
    reference: DocumentReference,
    anchor: ReferenceAnchor,
  ) => void;
  onReferencePin: (
    paneId: PaneId,
    reference: DocumentReference,
    anchor: ReferenceAnchor,
  ) => void;
  onReferenceLeave: () => void;
};

type ScaleChangingEvent = {
  scale: number;
  presetValue?: string | null;
};
type RotationChangingEvent = { pagesRotation: number };
type PageRenderedEvent = { pageNumber: number };
type PageElement = OverlayPage<HTMLElement>;

const REFERENCE_TOKEN_PADDING = 4;
const SCROLL_COMMIT_DELAY = 120;

export function PdfPane({
  document,
  paneId,
  label,
  detail,
  targetState,
  active,
  blocks,
  highlights,
  references,
  expanded,
  onActivate,
  onUpdate,
  onToggleExpand,
  onSelection,
  onWordLookup,
  onReferenceEnter,
  onReferencePin,
  onReferenceLeave,
}: PdfPaneProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const readyRef = useRef(false);
  const applyingRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const scrollingRef = useRef(false);
  const locallyReportedAnchorRef = useRef<ViewState | null>(null);
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

  const collectPageElements = (revisedPageNumber?: number) => {
    const viewerElement = viewerElementRef.current;
    if (!viewerElement) return;
    const discovered = Array.from(
      viewerElement.querySelectorAll<HTMLElement>(".page"),
    ).flatMap(
        (element) => {
          const pageNumber = Number(element.dataset.pageNumber);
          if (!Number.isFinite(pageNumber)) return [];
          let host = element.querySelector<HTMLElement>(
            ".paper-overlay-host",
          );
          if (!host) {
            host = window.document.createElement("div");
            host.className = "paper-overlay-host";
            element.append(host);
          }
          return [{ pageNumber, host }];
        },
      );
    setPageElements((current) =>
      reconcileOverlayPages(current, discovered, revisedPageNumber),
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

    const onPageRendered = () => {
      window.requestAnimationFrame(() => {
        if (pdfViewerRef.current === viewer) collectPageElements();
      });
    };

    const onTextLayerRendered = (event: PageRenderedEvent) => {
      window.requestAnimationFrame(() => {
        if (pdfViewerRef.current === viewer) {
          collectPageElements(event.pageNumber);
        }
      });
    };

    const readScrollAnchor = (): ViewState | null => {
      if (applyingRef.current || !readyRef.current) return null;
      const pageNumber = viewer.currentPageNumber;
      const pageView = viewer.getPageView(pageNumber - 1);
      if (!pageView?.div) return null;
      return {
        ...latestStateRef.current,
        pageNumber,
        relativeOffsetY: clamp(
          (container.scrollTop - pageView.div.offsetTop) /
            Math.max(pageView.div.clientHeight, 1),
          0,
          1,
        ),
      };
    };

    const captureScrollAnchor = () => {
      scrollFrameRef.current = null;
      const anchor = readScrollAnchor();
      if (anchor) locallyReportedAnchorRef.current = anchor;
    };

    const commitScrollAnchor = () => {
      scrollIdleTimerRef.current = null;
      const anchor = readScrollAnchor();
      scrollingRef.current = false;
      if (!anchor) return;
      locallyReportedAnchorRef.current = anchor;
      onUpdate(paneId, {
        pageNumber: anchor.pageNumber,
        relativeOffsetY: anchor.relativeOffsetY,
      });
    };

    const onScroll = () => {
      if (applyingRef.current || !readyRef.current) return;
      scrollingRef.current = true;
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current =
          window.requestAnimationFrame(captureScrollAnchor);
      }
      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = window.setTimeout(
        commitScrollAnchor,
        SCROLL_COMMIT_DELAY,
      );
    };

    eventBus.on("pagesinit", onPagesInit);
    eventBus.on("scalechanging", onScaleChanging);
    eventBus.on("rotationchanging", onRotationChanging);
    eventBus.on("pagerendered", onPageRendered);
    eventBus.on("textlayerrendered", onTextLayerRendered);
    eventBus.on("annotationlayerrendered", onTextLayerRendered);
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      readyRef.current = false;
      setReady(false);
      setPageElements([]);
      container.removeEventListener("scroll", onScroll);
      eventBus.off("pagesinit", onPagesInit);
      eventBus.off("scalechanging", onScaleChanging);
      eventBus.off("rotationchanging", onRotationChanging);
      eventBus.off("pagerendered", onPageRendered);
      eventBus.off("textlayerrendered", onTextLayerRendered);
      eventBus.off("annotationlayerrendered", onTextLayerRendered);
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      if (scrollIdleTimerRef.current !== null) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      scrollingRef.current = false;
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

    const applyScrollAnchor = shouldApplyScrollAnchor(
      targetState,
      locallyReportedAnchorRef.current,
      scrollingRef.current,
    );
    if (!applyScrollAnchor && !scrollingRef.current) {
      locallyReportedAnchorRef.current = null;
    }
    const rotationChanged = viewer.pagesRotation !== targetState.rotation;
    const scaleChanged = viewer.currentScaleValue !== targetState.scaleValue;
    if (!applyScrollAnchor && !rotationChanged && !scaleChanged) return;

    applyingRef.current = true;
    if (rotationChanged) {
      viewer.pagesRotation = targetState.rotation;
    }
    if (scaleChanged) {
      viewer.currentScaleValue = targetState.scaleValue;
    }
    if (
      applyScrollAnchor &&
      viewer.currentPageNumber !== targetState.pageNumber
    ) {
      viewer.currentPageNumber = targetState.pageNumber;
    }
    window.requestAnimationFrame(() => {
      collectPageElements();
      if (applyScrollAnchor) applyAnchor(targetState);
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
        <div className="pane-controls">
          <button
            type="button"
            disabled={targetState.pageNumber <= 1}
            title="이전 페이지"
            onClick={() =>
              onUpdate(paneId, {
                pageNumber: targetState.pageNumber - 1,
                relativeOffsetY: 0,
              })
            }
          >
            <ChevronLeft size={14} />
          </button>
          <span className="pane-page">
            {targetState.pageNumber} / {document.numPages}
          </span>
          <button
            type="button"
            disabled={targetState.pageNumber >= document.numPages}
            title="다음 페이지"
            onClick={() =>
              onUpdate(paneId, {
                pageNumber: targetState.pageNumber + 1,
                relativeOffsetY: 0,
              })
            }
          >
            <ChevronRight size={14} />
          </button>
          <button
            type="button"
            title="축소"
            onClick={() => {
              const scale = scaleBy(targetState.scale, "out");
              onUpdate(paneId, { scale, scaleValue: String(scale) });
            }}
          >
            <Minus size={13} />
          </button>
          <span className="pane-zoom">
            {Math.round(targetState.scale * 100)}%
          </span>
          <button
            type="button"
            title="확대"
            onClick={() => {
              const scale = scaleBy(targetState.scale, "in");
              onUpdate(paneId, { scale, scaleValue: String(scale) });
            }}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            title="너비 맞춤"
            onClick={() => onUpdate(paneId, { scaleValue: "page-width" })}
          >
            너비
          </button>
          <button
            type="button"
            title="페이지 맞춤"
            onClick={() => onUpdate(paneId, { scaleValue: "page-fit" })}
          >
            맞춤
          </button>
          <button
            type="button"
            title="회전"
            onClick={() =>
              onUpdate(paneId, {
                rotation: normalizeRotation(targetState.rotation + 90),
              })
            }
          >
            <RotateCw size={13} />
          </button>
          <button
            type="button"
            title={expanded ? "두 논문 보기" : `${label} 크게 보기`}
            onClick={() => onToggleExpand(paneId)}
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
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

      {pageElements.map(({ pageNumber, host, revision }) =>
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
                      ...referenceRectStyle(rect, targetState.rotation),
                      background: highlight.color,
                    }}
                  />
                )),
              )}

            {references
                .filter(
                  (reference) =>
                    reference.sourcePageNumber === pageNumber &&
                    Boolean(
                      reference.targetPageNumber &&
                        reference.targetBbox,
                    ),
                )
                .flatMap((reference) => {
                  const sourceBlock = blocks.find(
                    (block) => block.id === reference.sourceBlockId,
                  );
                  const pageElement = host.closest<HTMLElement>(".page");
                  const sourceBbox =
                    reference.sourceBbox ?? sourceBlock?.bbox;
                  if (!sourceBbox || !pageElement) return [];
                  const locatedRects = locateReferenceTokenRects(
                    pageElement,
                    reference.label,
                    sourceBbox,
                    targetState.rotation,
                  );
                  const rects = referenceRectsForPane(
                    paneId === "original" ? "source" : "korean",
                    paneId === "original" ? locatedRects : [],
                    paneId === "companion" ? locatedRects : [],
                  );
                  return rects.map((rect, index) => (
                    <button
                      type="button"
                      className="reference-hotspot"
                      key={`${reference.id}-${index}`}
                      style={referenceRectStyle(rect, 0, {
                        padding: REFERENCE_TOKEN_PADDING,
                      })}
                      onMouseEnter={(event) => {
                        const anchor =
                          event.currentTarget.getBoundingClientRect();
                        onReferenceEnter(
                          paneId,
                          reference,
                          {
                            left: anchor.left,
                            top: anchor.top,
                            right: anchor.right,
                            bottom: anchor.bottom,
                            width: anchor.width,
                            height: anchor.height,
                          },
                        );
                      }}
                      onMouseLeave={onReferenceLeave}
                      onClick={(event) => {
                        const anchor =
                          event.currentTarget.getBoundingClientRect();
                        onReferencePin(
                          paneId,
                          reference,
                          {
                            left: anchor.left,
                            top: anchor.top,
                            right: anchor.right,
                            bottom: anchor.bottom,
                            width: anchor.width,
                            height: anchor.height,
                          },
                        );
                      }}
                      onFocus={(event) => {
                        const anchor =
                          event.currentTarget.getBoundingClientRect();
                        onReferenceEnter(
                          paneId,
                          reference,
                          {
                            left: anchor.left,
                            top: anchor.top,
                            right: anchor.right,
                            bottom: anchor.bottom,
                            width: anchor.width,
                            height: anchor.height,
                          },
                        );
                      }}
                      onBlur={onReferenceLeave}
                      aria-label={`${reference.label} 미리보기`}
                    />
                  ));
                })}
          </div>,
          host,
          `${paneId}-${pageNumber}-${revision}`,
        ),
      )}
    </section>
  );
}
