import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "../lib/pdf";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { LoaderCircle } from "lucide-react";
import type { PaneId, ViewState } from "../types";
import { clamp } from "../lib/reader-state";

type PdfPaneProps = {
  document: PDFDocumentProxy;
  paneId: PaneId;
  label: string;
  detail: string;
  targetState: ViewState;
  active: boolean;
  onActivate: (paneId: PaneId) => void;
  onUpdate: (paneId: PaneId, update: Partial<ViewState>) => void;
};

type PageChangingEvent = { pageNumber: number };
type ScaleChangingEvent = {
  scale: number;
  presetValue?: string | null;
};
type RotationChangingEvent = { pagesRotation: number };

export function PdfPane({
  document,
  paneId,
  label,
  detail,
  targetState,
  active,
  onActivate,
  onUpdate,
}: PdfPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const readyRef = useRef(false);
  const applyingRef = useRef(false);
  const releaseTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const latestStateRef = useRef(targetState);
  const [ready, setReady] = useState(false);

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
      className={`pdf-pane ${active ? "pdf-pane--active" : ""}`}
      onPointerDown={() => onActivate(paneId)}
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
    </section>
  );
}
