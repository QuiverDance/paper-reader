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
  AnnotationSource,
  DocumentBlock,
  DocumentReference,
  Highlight,
  NormalizedRect,
  PaneId,
  ReferenceAnchor,
  TextSelection,
  ViewState,
} from "../types";
import {
  clamp,
  normalizeRotation,
  scaleBy,
  shouldApplyScrollAnchor,
} from "../lib/reader-state";
import { mergeReferenceRects } from "../lib/reference-preview";

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
    reference: DocumentReference,
    anchor: ReferenceAnchor,
    surface: AnnotationSource,
  ) => void;
  onReferenceLeave: () => void;
};

type ScaleChangingEvent = {
  scale: number;
  presetValue?: string | null;
};
type RotationChangingEvent = { pagesRotation: number };
type PageElement = {
  pageNumber: number;
  host: HTMLElement;
  revision: number;
};

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

function textLayerReferenceRects(
  pageElement: HTMLElement,
  label: string,
  sourceBlockRect: NormalizedRect,
  rotation: number,
): NormalizedRect[] {
  const textLayer = pageElement.querySelector<HTMLElement>(".textLayer");
  if (!textLayer) return [];
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let source = "";
  const walker = window.document.createTreeWalker(
    textLayer,
    NodeFilter.SHOW_TEXT,
  );
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    textNodes.push({
      node,
      start: source.length,
      end: source.length + node.data.length,
    });
    source += node.data;
    current = walker.nextNode();
  }
  if (!source) return [];

  const escapedParts = label
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escapedParts.join("\\s*"), "gi");
  const pageRect = pageElement.getBoundingClientRect();
  const expected = rotateRect(sourceBlockRect, rotation);
  const expectedCenter = {
    x: expected.x + expected.width / 2,
    y: expected.y + expected.height / 2,
  };
  const candidates: Array<{
    rects: NormalizedRect[];
    distance: number;
  }> = [];

  for (const match of source.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    const startNode = textNodes.find(
      (entry) => start >= entry.start && start < entry.end,
    );
    const endNode = textNodes.find(
      (entry) => end > entry.start && end <= entry.end,
    );
    if (!startNode || !endNode) continue;
    const range = window.document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: clamp((rect.left - pageRect.left) / pageRect.width, 0, 1),
        y: clamp((rect.top - pageRect.top) / pageRect.height, 0, 1),
        width: clamp(rect.width / pageRect.width, 0, 1),
        height: clamp(rect.height / pageRect.height, 0, 1),
      }));
    if (!rects.length) continue;
    const center = {
      x:
        rects.reduce(
          (sum, rect) => sum + rect.x + rect.width / 2,
          0,
        ) / rects.length,
      y:
        rects.reduce(
          (sum, rect) => sum + rect.y + rect.height / 2,
          0,
        ) / rects.length,
    };
    candidates.push({
      rects,
      distance:
        (center.x - expectedCenter.x) ** 2 +
        (center.y - expectedCenter.y) ** 2,
    });
  }
  candidates.sort((left, right) => left.distance - right.distance);
  return mergeReferenceRects(candidates[0]?.rects ?? []);
}

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
  const locallyReportedAnchorRef = useRef<ViewState | null>(null);
  const pageRevisionRef = useRef(0);
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
    pageRevisionRef.current += 1;
    const revision = pageRevisionRef.current;
    setPageElements(
      Array.from(viewerElement.querySelectorAll<HTMLElement>(".page")).flatMap(
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
          return [{ pageNumber, host, revision }];
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
      locallyReportedAnchorRef.current = {
        ...latestStateRef.current,
        pageNumber,
        relativeOffsetY,
      };
      onUpdate(paneId, { pageNumber, relativeOffsetY });
    };

    const onScroll = () => {
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = window.requestAnimationFrame(reportScrollAnchor);
      }
    };

    eventBus.on("pagesinit", onPagesInit);
    eventBus.on("scalechanging", onScaleChanging);
    eventBus.on("rotationchanging", onRotationChanging);
    eventBus.on("pagerendered", onPageRendered);
    eventBus.on("textlayerrendered", onPageRendered);
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
      eventBus.off("textlayerrendered", onPageRendered);
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

    const applyScrollAnchor = shouldApplyScrollAnchor(
      targetState,
      locallyReportedAnchorRef.current,
    );
    if (!applyScrollAnchor) {
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
                      ...rectStyle(rect, targetState.rotation),
                      background: highlight.color,
                    }}
                  />
                )),
              )}

            {references
                .filter(
                  (reference) => reference.sourcePageNumber === pageNumber,
                )
                .flatMap((reference) => {
                  const sourceBlock = blocks.find(
                    (block) => block.id === reference.sourceBlockId,
                  );
                  const pageElement = host.closest<HTMLElement>(".page");
                  if (!sourceBlock || !pageElement) return [];
                  return textLayerReferenceRects(
                    pageElement,
                    reference.label,
                    sourceBlock.bbox,
                    targetState.rotation,
                  ).map((rect, index) => (
                    <button
                      type="button"
                      className="reference-hotspot"
                      key={`${reference.id}-${index}`}
                      style={rectStyle(rect, 0)}
                      disabled={!reference.targetPageNumber}
                      onMouseEnter={(event) => {
                        const anchor =
                          event.currentTarget.getBoundingClientRect();
                        onReferenceEnter(
                          reference,
                          {
                            left: anchor.left,
                            top: anchor.top,
                            right: anchor.right,
                            bottom: anchor.bottom,
                            width: anchor.width,
                            height: anchor.height,
                          },
                          paneId === "original" ? "original" : "translation",
                        );
                      }}
                      onMouseLeave={onReferenceLeave}
                      onFocus={(event) => {
                        const anchor =
                          event.currentTarget.getBoundingClientRect();
                        onReferenceEnter(
                          reference,
                          {
                            left: anchor.left,
                            top: anchor.top,
                            right: anchor.right,
                            bottom: anchor.bottom,
                            width: anchor.width,
                            height: anchor.height,
                          },
                          paneId === "original" ? "original" : "translation",
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
