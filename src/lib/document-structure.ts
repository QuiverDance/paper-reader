import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentSourceLine,
  LlmTokenUsage,
} from "../types";
import type { LlmMessage } from "./llm";
import {
  isEquationLike,
  looksLikeNaturalProse,
} from "./semantic-paper";
import {
  addTokenUsage,
  EMPTY_TOKEN_USAGE,
  estimateTextTokens,
} from "./token-usage";

export const DOCUMENT_STRUCTURE_VERSION = "llm-structure-v3";

const STRUCTURE_KINDS = new Set<DocumentBlockType>([
  "title",
  "authors",
  "abstract",
  "heading",
  "paragraph",
  "figure-caption",
  "table-caption",
  "footnote",
  "equation",
  "reference-entry",
  "running-header",
  "running-footer",
  "code-listing",
  "unknown",
]);

const PROSE_KINDS = new Set<DocumentBlockType>([
  "abstract",
  "paragraph",
  "footnote",
]);

const PROSE_TRANSPARENT_KINDS = new Set<DocumentBlockType>([
  "figure-caption",
  "table-caption",
  "equation",
  "code-listing",
  "running-header",
  "running-footer",
  "unknown",
]);

export type SequencedStructureLine = {
  sequence: number;
  source: DocumentSourceLine;
  hint: DocumentBlockType;
  sourceBlockId: string;
};

export type DocumentStructureWindow = {
  contextStart: number;
  targetStart: number;
  targetEnd: number;
  contextEnd: number;
  lines: SequencedStructureLine[];
};

export type DocumentStructureDecision = {
  kind: DocumentBlockType;
  level?: number;
  ranges: Array<[number, number]>;
  start: number;
  end: number;
};

export type StructureCompletion = {
  content: string;
  usage: LlmTokenUsage;
};

export type DocumentStructureResult = {
  blocks: DocumentBlock[];
  usage: LlmTokenUsage;
  requestCount: number;
};

type CompleteStructure = (
  messages: LlmMessage[],
  signal?: AbortSignal,
) => Promise<StructureCompletion>;

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function sourceLineTokenCost(line: SequencedStructureLine): number {
  return estimateTextTokens(
    JSON.stringify([
      line.sequence,
      line.source.pageNumber,
      line.source.column,
      Math.round(line.source.bbox.x * 1000),
      Math.round(line.source.bbox.y * 1000),
      Math.round(line.source.fontSize * 10),
      line.source.fontWeight === "bold" ? 1 : 0,
      line.hint,
      line.source.text,
    ]),
  );
}

function preferredWindowEnd(
  lines: SequencedStructureLine[],
  startIndex: number,
  tentativeEnd: number,
): number {
  const minimum = Math.min(
    tentativeEnd,
    startIndex + Math.max(1, Math.floor((tentativeEnd - startIndex) * 0.72)),
  );
  for (let index = tentativeEnd - 1; index >= minimum; index -= 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (!next) return index + 1;
    if (
      current.source.pageNumber !== next.source.pageNumber &&
      /[.!?]["')\]]*$/.test(current.source.text.trim())
    ) {
      return index + 1;
    }
    if (
      /[.!?]["')\]]*$/.test(current.source.text.trim()) &&
      (next.hint === "heading" ||
        next.hint === "figure-caption" ||
        next.hint === "table-caption")
    ) {
      return index + 1;
    }
  }
  return tentativeEnd;
}

export function planDocumentStructureWindows(
  lines: SequencedStructureLine[],
  maxInputTokens: number,
): DocumentStructureWindow[] {
  if (!lines.length) return [];
  const budget = Math.max(300, maxInputTokens);
  const windows: DocumentStructureWindow[] = [];
  let targetStartIndex = 0;

  while (targetStartIndex < lines.length) {
    let targetEndIndex = targetStartIndex;
    let tokens = 280;
    while (targetEndIndex < lines.length) {
      const nextCost = sourceLineTokenCost(lines[targetEndIndex]);
      if (
        targetEndIndex > targetStartIndex &&
        tokens + nextCost > budget
      ) {
        break;
      }
      tokens += nextCost;
      targetEndIndex += 1;
    }
    if (targetEndIndex < lines.length) {
      targetEndIndex = preferredWindowEnd(
        lines,
        targetStartIndex,
        targetEndIndex,
      );
    }
    targetEndIndex = Math.max(targetStartIndex + 1, targetEndIndex);

    const firstPage = lines[targetStartIndex].source.pageNumber;
    const lastPage = lines[targetEndIndex - 1].source.pageNumber;
    let contextStartIndex = targetStartIndex;
    while (
      contextStartIndex > 0 &&
      lines[contextStartIndex - 1].source.pageNumber >= firstPage - 1
    ) {
      contextStartIndex -= 1;
    }
    let contextEndIndex = targetEndIndex;
    while (
      contextEndIndex < lines.length &&
      lines[contextEndIndex].source.pageNumber <= lastPage + 1
    ) {
      contextEndIndex += 1;
    }

    windows.push({
      contextStart: lines[contextStartIndex].sequence,
      targetStart: lines[targetStartIndex].sequence,
      targetEnd: lines[targetEndIndex - 1].sequence,
      contextEnd: lines[contextEndIndex - 1].sequence,
      lines: lines.slice(contextStartIndex, contextEndIndex),
    });
    targetStartIndex = targetEndIndex;
  }

  return windows;
}

export function parseDocumentStructureResponse(
  value: string,
  target: { start: number; end: number },
): DocumentStructureDecision[] {
  const payload = JSON.parse(stripCodeFence(value)) as {
    blocks?: Array<{
      kind?: unknown;
      level?: unknown;
      ranges?: unknown;
    }>;
  };
  if (!Array.isArray(payload.blocks) || !payload.blocks.length) {
    throw new Error("문서 구조 응답에 blocks 배열이 없습니다.");
  }

  const covered = new Map<number, number>();
  const decisions = payload.blocks.map((block, blockIndex) => {
    if (
      typeof block.kind !== "string" ||
      !STRUCTURE_KINDS.has(block.kind as DocumentBlockType)
    ) {
      throw new Error(`문서 구조 블록 ${blockIndex + 1}의 kind가 올바르지 않습니다.`);
    }
    if (!Array.isArray(block.ranges) || !block.ranges.length) {
      throw new Error(`문서 구조 블록 ${blockIndex + 1}의 ranges가 없습니다.`);
    }
    const ids: number[] = [];
    const ranges: Array<[number, number]> = [];
    for (const range of block.ranges) {
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !Number.isInteger(range[0]) ||
        !Number.isInteger(range[1]) ||
        range[0] > range[1]
      ) {
        throw new Error(`문서 구조 블록 ${blockIndex + 1}의 범위가 올바르지 않습니다.`);
      }
      ranges.push([range[0], range[1]]);
      for (let id = range[0]; id <= range[1]; id += 1) {
        if (id < target.start || id > target.end) {
          throw new Error(`문서 구조 블록이 대상 범위 밖의 줄 ${id}을 포함합니다.`);
        }
        ids.push(id);
        covered.set(id, (covered.get(id) ?? 0) + 1);
      }
    }
    ids.sort((left, right) => left - right);
    ranges.sort((left, right) => left[0] - right[0]);
    const level =
      block.kind === "heading" &&
      Number.isInteger(block.level) &&
      Number(block.level) >= 1 &&
      Number(block.level) <= 6
        ? Number(block.level)
        : undefined;
    return {
      kind: block.kind as DocumentBlockType,
      ...(level ? { level } : {}),
      ranges,
      start: ids[0],
      end: ids.at(-1)!,
    };
  });

  const missing: number[] = [];
  const duplicate: number[] = [];
  for (let id = target.start; id <= target.end; id += 1) {
    const count = covered.get(id) ?? 0;
    if (count === 0) missing.push(id);
    if (count > 1) duplicate.push(id);
  }
  if (missing.length) {
    throw new Error(`문서 구조 응답에서 원문 줄이 누락되었습니다: ${missing.slice(0, 8).join(", ")}`);
  }
  if (duplicate.length) {
    throw new Error(`문서 구조 응답에서 원문 줄이 중복되었습니다: ${duplicate.slice(0, 8).join(", ")}`);
  }

  return decisions.sort((left, right) => left.start - right.start);
}

function structureMessages(window: DocumentStructureWindow): LlmMessage[] {
  const compactLines = window.lines.map((line) => ({
    id: line.sequence,
    p: line.source.pageNumber,
    c: line.source.column,
    i: Math.round(line.source.bbox.x * 1000),
    y: Math.round(line.source.bbox.y * 1000),
    s: Math.round(line.source.fontSize * 10) / 10,
    w: line.source.fontWeight === "bold" ? "b" : "n",
    hint: line.hint,
    target:
      line.sequence >= window.targetStart &&
      line.sequence <= window.targetEnd,
    text: line.source.text,
  }));
  return [
    {
      role: "system",
      content: [
        "Reconstruct the semantic structure of an academic PDF from physical text lines.",
        "Do not translate, summarize, rewrite, or echo source text.",
        "Use meaning, sentence continuity, page/column transitions, indentation, font size, and weight together.",
        "Chart labels and axis values inside a figure are not body paragraphs; classify them as code-listing or unknown so they do not break prose continuity.",
        "A line beginning with a number is not a heading when that number completes the preceding prose, for example 'as few as' followed by '1. This ...'.",
        "Join hyphenated line wraps and paragraphs that cross columns or pages.",
        "A single logical paragraph may use multiple non-contiguous ranges when a page header, footer, figure, table, equation, or code listing is physically inserted between its fragments.",
        "Classify title, authors, abstract, heading, paragraph, figure-caption, table-caption, footnote, equation, reference-entry, running-header, running-footer, code-listing, or unknown.",
        "Return every target line id exactly once, in source order. Context-only lines are for reasoning and must not appear in ranges.",
        "Return only JSON as {blocks:[{kind,level?,ranges:[[startId,endId],...]}]}.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        targetLineRange: [window.targetStart, window.targetEnd],
        contextLineRange: [window.contextStart, window.contextEnd],
        lines: compactLines,
      }),
    },
  ];
}

function sequencedLines(blocks: DocumentBlock[]): SequencedStructureLine[] {
  const ordered = [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
  const seen = new Set<string>();
  const lines: Array<Omit<SequencedStructureLine, "sequence">> = [];
  for (const block of ordered) {
    const sourceLines =
      block.sourceLines?.length
        ? block.sourceLines
        : [
            {
              id: `${block.id}-line`,
              pageNumber: block.pageNumber,
              column:
                block.bbox.width >= 0.58
                  ? 0 as const
                  : block.bbox.x + block.bbox.width / 2 < 0.5
                    ? 1 as const
                    : 2 as const,
              text: block.text,
              bbox: block.bbox,
              fontSize: block.fontSize ?? 10,
              fontWeight: block.sourceStyle?.fontWeight ?? "normal",
              fontStyle: block.sourceStyle?.fontStyle ?? "normal",
            },
          ];
    for (const source of sourceLines) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      lines.push({
        source,
        hint: block.type,
        sourceBlockId: block.id,
      });
    }
  }
  return lines.map((line, index) => ({ ...line, sequence: index + 1 }));
}

function joinSourceLines(lines: SequencedStructureLine[]): string {
  return lines.reduce((text, line) => {
    const right = line.source.text.trim();
    if (!text) return right;
    if (/-\s*$/.test(text) && /^[a-z]/.test(right)) {
      return `${text.replace(/-\s*$/, "")}${right}`;
    }
    return `${text.trim()} ${right}`.trim();
  }, "");
}

function rectForLines(lines: SequencedStructureLine[]) {
  const pageNumber = lines[0].source.pageNumber;
  const onPage = lines.filter(
    (line) => line.source.pageNumber === pageNumber,
  );
  const left = Math.min(...onPage.map((line) => line.source.bbox.x));
  const top = Math.min(...onPage.map((line) => line.source.bbox.y));
  const right = Math.max(
    ...onPage.map((line) => line.source.bbox.x + line.source.bbox.width),
  );
  const bottom = Math.max(
    ...onPage.map((line) => line.source.bbox.y + line.source.bbox.height),
  );
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function blockIsTranslatable(type: DocumentBlockType): boolean {
  return (
    type === "abstract" ||
    type === "paragraph" ||
    type === "figure-caption" ||
    type === "table-caption" ||
    type === "footnote"
  );
}

function blocksFromDecisions(
  documentId: string,
  lines: SequencedStructureLine[],
  decisions: DocumentStructureDecision[],
): DocumentBlock[] {
  const bySequence = new Map(lines.map((line) => [line.sequence, line]));
  const result: DocumentBlock[] = [];

  for (const decision of decisions) {
    const logicalLines = decision.ranges.flatMap(([start, end]) =>
      Array.from(
        { length: end - start + 1 },
        (_, index) => bySequence.get(start + index)!,
      ),
    );
    const logicalText = joinSourceLines(logicalLines);
    const semanticKind =
      (decision.kind === "equation" && !isEquationLike(logicalText)) ||
      (decision.kind === "code-listing" &&
        looksLikeNaturalProse(logicalText))
        ? "paragraph"
        : decision.kind;
    const logicalBlockId = `${documentId}-structure-${decision.start}-${decision.end}`;
    const groups: SequencedStructureLine[][] = [];
    if (PROSE_KINDS.has(semanticKind)) {
      for (const line of logicalLines) {
        const current = groups.at(-1);
        if (
          current &&
          current.at(-1)!.sourceBlockId === line.sourceBlockId
        ) {
          current.push(line);
        } else {
          groups.push([line]);
        }
      }
    } else {
      groups.push(logicalLines);
    }

    groups.forEach((group, fragmentIndex) => {
      const mostlyBold =
        group.filter((line) => line.source.fontWeight === "bold").length >=
        Math.ceil(group.length * 0.65);
      const fontSize =
        group.reduce((total, line) => total + line.source.fontSize, 0) /
        group.length;
      result.push({
        id:
          groups.length === 1
            ? logicalBlockId
            : `${logicalBlockId}-f${fragmentIndex + 1}`,
        logicalBlockId,
        documentId,
        pageNumber: group[0].source.pageNumber,
        type: semanticKind,
        text: joinSourceLines(group),
        bbox: rectForLines(group),
        fontSize,
        sourceStyle: {
          fontWeight: mostlyBold ? "bold" : "normal",
          fontStyle: group.some(
            (line) => line.source.fontStyle === "italic",
          )
            ? "italic"
            : "normal",
          textAlign: "left",
          ...(PROSE_KINDS.has(semanticKind)
            ? { paragraphStart: fragmentIndex === 0 }
            : {}),
          boldLead: false,
        },
        sourceLines: group.map((line) => line.source),
        readingOrder: group[0].sequence,
        translatable: blockIsTranslatable(semanticKind),
      });
    });
  }
  return result.sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
}

function shouldJoinWindowDecisions(
  left: DocumentStructureDecision,
  right: DocumentStructureDecision,
  bySequence: ReadonlyMap<number, SequencedStructureLine>,
): boolean {
  if (
    left.end + 1 !== right.start ||
    left.kind !== right.kind ||
    !PROSE_KINDS.has(left.kind)
  ) {
    return false;
  }
  const leftText = bySequence.get(left.end)?.source.text.trim() ?? "";
  const rightText = bySequence.get(right.start)?.source.text.trim() ?? "";
  return (
    !/[.!?]["')\]]*$/.test(leftText) ||
    /^[a-z0-9[(]/.test(rightText) ||
    /^(?:and|but|for|or|that|the|this|to|when|which|with)\b/i.test(rightText)
  );
}

function crossesReadingBoundary(
  left: SequencedStructureLine,
  right: SequencedStructureLine,
): boolean {
  const crossesPage =
    right.source.pageNumber === left.source.pageNumber + 1 &&
    left.source.bbox.y + left.source.bbox.height >= 0.68 &&
    right.source.bbox.y <= 0.58;
  const crossesColumn =
    right.source.pageNumber === left.source.pageNumber &&
    left.source.column === 1 &&
    right.source.column === 2 &&
    left.source.bbox.y + left.source.bbox.height >= 0.68 &&
    right.source.bbox.y <= 0.45;
  return crossesPage || crossesColumn;
}

function repairInterruptedProseContinuations(
  decisions: DocumentStructureDecision[],
  bySequence: ReadonlyMap<number, SequencedStructureLine>,
): DocumentStructureDecision[] {
  const repaired = decisions.map((decision) => ({
    ...decision,
    ranges: [...decision.ranges],
  }));

  for (let leftIndex = 0; leftIndex < repaired.length; leftIndex += 1) {
    const left = repaired[leftIndex];
    if (!PROSE_KINDS.has(left.kind)) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < repaired.length;
      rightIndex += 1
    ) {
      const candidate = repaired[rightIndex];
      if (!PROSE_KINDS.has(candidate.kind)) {
        if (PROSE_TRANSPARENT_KINDS.has(candidate.kind)) continue;
        break;
      }
      if (candidate.kind !== left.kind) break;

      const leftLine = bySequence.get(left.end);
      const rightLine = bySequence.get(candidate.start);
      if (!leftLine || !rightLine) break;
      const leftText = leftLine.source.text.trim();
      const rightText = rightLine.source.text.trim();
      const continuationCue =
        !/[.!?]["')\]]*$/.test(leftText) ||
        /^[a-z0-9[(]/.test(rightText) ||
        /-\s*$/.test(leftText);
      if (
        !continuationCue ||
        !crossesReadingBoundary(leftLine, rightLine)
      ) {
        break;
      }

      left.ranges.push(...candidate.ranges);
      left.ranges.sort((a, b) => a[0] - b[0]);
      left.end = candidate.end;
      repaired.splice(rightIndex, 1);
      rightIndex -= 1;
    }
  }

  return repaired;
}

export async function reconstructDocumentStructure({
  documentId,
  blocks,
  maxContextSize,
  complete,
  signal,
}: {
  documentId: string;
  blocks: DocumentBlock[];
  maxContextSize: number;
  complete: CompleteStructure;
  signal?: AbortSignal;
}): Promise<DocumentStructureResult> {
  const lines = sequencedLines(blocks);
  if (!lines.length) {
    throw new Error("문서 구조를 복원할 원문 줄이 없습니다.");
  }
  const inputBudget = Math.max(
    1_200,
    Math.floor(maxContextSize * 0.55),
  );
  const windows = planDocumentStructureWindows(lines, inputBudget);
  let usage = EMPTY_TOKEN_USAGE;
  let requestCount = 0;

  const windowResults: DocumentStructureDecision[][] = new Array(
    windows.length,
  );
  let nextWindowIndex = 0;
  const runners = Array.from(
    { length: Math.min(3, windows.length) },
    async () => {
      while (nextWindowIndex < windows.length) {
        const windowIndex = nextWindowIndex;
        nextWindowIndex += 1;
        const window = windows[windowIndex];
        const messages = structureMessages(window);
        let validationError = "";
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const attemptMessages =
            attempt === 0
              ? messages
              : [
                  ...messages,
                  {
                    role: "user" as const,
                    content: `The previous structure response failed local validation: ${validationError}. Return a corrected complete JSON mapping for target lines ${window.targetStart}-${window.targetEnd}.`,
                  },
                ];
          const response = await complete(attemptMessages, signal);
          usage = addTokenUsage(usage, response.usage);
          requestCount += 1;
          try {
            windowResults[windowIndex] =
              parseDocumentStructureResponse(response.content, {
                start: window.targetStart,
                end: window.targetEnd,
              });
            validationError = "";
            break;
          } catch (cause) {
            validationError =
              cause instanceof Error ? cause.message : String(cause);
          }
        }
        if (validationError) throw new Error(validationError);
      }
    },
  );
  await Promise.all(runners);

  const bySequence = new Map(
    lines.map((line) => [line.sequence, line]),
  );
  const decisions = windowResults
    .flat()
    .sort((left, right) => left.start - right.start)
    .reduce<DocumentStructureDecision[]>((merged, decision) => {
      const previous = merged.at(-1);
      if (
        previous &&
        shouldJoinWindowDecisions(previous, decision, bySequence)
      ) {
        previous.ranges.push(...decision.ranges);
        previous.end = decision.end;
      } else {
        merged.push({
          ...decision,
          ranges: [...decision.ranges],
        });
      }
      return merged;
    }, []);
  const repairedDecisions = repairInterruptedProseContinuations(
    decisions,
    bySequence,
  );

  return {
    blocks: blocksFromDecisions(
      documentId,
      lines,
      repairedDecisions,
    ),
    usage,
    requestCount,
  };
}
