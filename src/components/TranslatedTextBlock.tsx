import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { DocumentBlock, TranslationRecord } from "../types";
import { translationFontBounds } from "../lib/translation-layout";

type TranslatedTextBlockProps = {
  block: DocumentBlock;
  translation: TranslationRecord;
  style: CSSProperties;
  expandedStyle: CSSProperties;
  scale: number;
  onEdit: (translation: TranslationRecord, text: string) => void;
};

function backgroundChannel(values: number[]): number {
  if (!values.length) return 255;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
}

function samplePageBackground(element: HTMLElement): string {
  const page = element.closest<HTMLElement>(".page");
  const canvas = page?.querySelector<HTMLCanvasElement>("canvas");
  if (!page || !canvas || !canvas.width || !canvas.height) return "rgb(255, 255, 255)";

  const canvasRect = canvas.getBoundingClientRect();
  const blockRect = element.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return "rgb(255, 255, 255)";

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "rgb(255, 255, 255)";

  const sampleOffset = Math.max(
    5,
    Math.min(10, Math.min(blockRect.width, blockRect.height) * 0.5),
  );
  const xPositions = [
    blockRect.left - sampleOffset,
    blockRect.left + blockRect.width * 0.25,
    blockRect.left + blockRect.width / 2,
    blockRect.left + blockRect.width * 0.75,
    blockRect.right + sampleOffset,
  ];
  const yPositions = [
    blockRect.top - sampleOffset,
    blockRect.bottom + sampleOffset,
  ];
  const sideYPositions = [
    blockRect.top,
    blockRect.top + blockRect.height * 0.25,
    blockRect.top + blockRect.height / 2,
    blockRect.top + blockRect.height * 0.75,
    blockRect.bottom,
  ];
  const displayPoints = [
    ...xPositions.map((x) => ({ x, y: yPositions[0] })),
    ...xPositions.map((x) => ({ x, y: yPositions[1] })),
    ...sideYPositions.map((y) => ({ x: xPositions[0], y })),
    ...sideYPositions.map((y) => ({ x: xPositions[4], y })),
  ];
  const colors: Array<[number, number, number]> = [];

  try {
    for (const point of displayPoints) {
      const x = Math.max(
        0,
        Math.min(
          canvas.width - 1,
          Math.round(
            ((point.x - canvasRect.left) / canvasRect.width) * canvas.width,
          ),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          canvas.height - 1,
          Math.round(
            ((point.y - canvasRect.top) / canvasRect.height) * canvas.height,
          ),
        ),
      );
      const pixel = context.getImageData(x, y, 1, 1).data;
      colors.push([pixel[0], pixel[1], pixel[2]]);
    }
  } catch {
    return "rgb(255, 255, 255)";
  }

  return `rgb(${backgroundChannel(colors.map((color) => color[0]))}, ${backgroundChannel(
    colors.map((color) => color[1]),
  )}, ${backgroundChannel(colors.map((color) => color[2]))})`;
}

export function TranslatedTextBlock({
  block,
  translation,
  style,
  expandedStyle,
  scale,
  onEdit,
}: TranslatedTextBlockProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(
    () => translationFontBounds(block, scale).max,
  );
  const [usesWhitespace, setUsesWhitespace] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [revealedHeight, setRevealedHeight] = useState<number | null>(null);
  const [background, setBackground] = useState("rgb(255, 255, 255)");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(translation.translatedText);

  useEffect(() => {
    setDraft(translation.translatedText);
    setUsesWhitespace(false);
    setOverflowing(false);
    setRevealed(false);
    setRevealedHeight(null);
  }, [translation.translatedText]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const text = textRef.current;
    if (!root || !text || editing) return;

    let frame = 0;
    const fit = () => {
      const bounds = translationFontBounds(block, scale);
      const availableHeight = Math.max(1, root.clientHeight);

      const fits = (size: number) => {
        text.style.fontSize = `${size}px`;
        return (
          text.scrollHeight <= availableHeight + 1 &&
          text.scrollWidth <= root.clientWidth + 1
        );
      };

      if (!fits(bounds.min)) {
        if (
          !usesWhitespace &&
          (expandedStyle.height !== style.height ||
            expandedStyle.width !== style.width)
        ) {
          setUsesWhitespace(true);
          return;
        }
        setFontSize(bounds.min);
        setOverflowing(true);
        setRevealedHeight(text.scrollHeight + 4);
        return;
      }

      let low = bounds.min;
      let high = bounds.max;
      for (let step = 0; step < 9; step += 1) {
        const middle = (low + high) / 2;
        if (fits(middle)) low = middle;
        else high = middle;
      }
      text.style.fontSize = `${low}px`;
      setFontSize(low);
      setOverflowing(false);
      setRevealed(false);
      setRevealedHeight(null);
    };

    const scheduleFit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(root);
    scheduleFit();
    void document.fonts?.ready.then(scheduleFit);
    setBackground(samplePageBackground(root));

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [
    block,
    editing,
    expandedStyle.height,
    expandedStyle.width,
    scale,
    style.height,
    translation.translatedText,
    usesWhitespace,
  ]);

  const saveEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== translation.translatedText) {
      onEdit(translation, next);
    } else {
      setDraft(translation.translatedText);
    }
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(translation.translatedText);
      setEditing(false);
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      saveEdit();
    }
  };

  const currentStyle = usesWhitespace ? expandedStyle : style;
  const currentHeight =
    revealed && revealedHeight ? `${revealedHeight}px` : currentStyle.height;

  return (
    <div
      ref={rootRef}
      className={`translation-reflow-block ${
        overflowing ? "translation-reflow-block--overflow" : ""
      } ${revealed ? "translation-reflow-block--revealed" : ""} ${
        editing ? "translation-reflow-block--editing" : ""
      }`}
      data-block-type={block.type}
      style={{
        ...currentStyle,
        height: currentHeight,
        background,
        boxShadow: `0 0 0 1px ${background}`,
        fontSize,
      }}
      title={
        overflowing
          ? "번역문이 원래 영역보다 깁니다. 클릭하면 전체 내용을 펼칩니다."
          : "더블클릭하면 번역문을 수정할 수 있습니다."
      }
      onClick={(event) => {
        if (
          overflowing &&
          !editing &&
          window.getSelection()?.isCollapsed !== false
        ) {
          event.stopPropagation();
          setRevealed((current) => !current);
        }
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {editing ? (
        <textarea
          value={draft}
          autoFocus
          aria-label="번역문 수정"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveEdit}
          onKeyDown={onEditorKeyDown}
        />
      ) : (
        <span ref={textRef}>{translation.translatedText}</span>
      )}
    </div>
  );
}
