import type {
  AskContextMode,
  DocumentBlock,
  SemanticPaper,
} from "../types";

const QUESTION_TYPES = new Set<DocumentBlock["type"]>([
  "title",
  "abstract",
  "heading",
  "paragraph",
  "figure-caption",
  "table-caption",
  "footnote",
  "equation",
  "code-listing",
]);

const EXCLUDED_FOOTNOTE =
  /\b(?:e-?mail|corresponding author|affiliation|university|institute|department)\b|@/i;

export type PaperQuestionContext = {
  text: string;
  blockIds: string[];
  pageNumbers: number[];
  sectionTitles: string[];
  estimatedTokens: number;
  signature: string;
};

export type DigestSectionInput = {
  id: string;
  title: string;
  text: string;
};

function compactHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function questionBlock(
  block: DocumentBlock,
  paper: SemanticPaper,
): boolean {
  if (block.pageNumber < paper.contentStartPage) return false;
  if (!QUESTION_TYPES.has(block.type)) return false;
  if (block.type === "reference-entry") return false;
  if (/^(references|bibliography)$/i.test(block.text.trim())) return false;
  if (block.type === "footnote" && EXCLUDED_FOOTNOTE.test(block.text)) {
    return false;
  }
  return true;
}

function sectionTitleForBlock(
  blockId: string,
  paper: SemanticPaper,
): string {
  const sectionId = paper.blockSectionIds[blockId];
  return (
    paper.sections.find((section) => section.id === sectionId)?.title ||
    "Front matter"
  );
}

export function estimateContextTokens(text: string): number {
  if (!text) return 0;
  const latinLike = (text.match(/[\x00-\x7f]/g) ?? []).length / text.length;
  const charactersPerToken = latinLike > 0.75 ? 3.7 : 2.2;
  return Math.ceil(text.length / charactersPerToken);
}

export function buildPaperQuestionContext(
  blocks: DocumentBlock[],
  paper: SemanticPaper,
): PaperQuestionContext {
  const included = [...blocks]
    .filter((block) => questionBlock(block, paper))
    .sort(
      (left, right) =>
        left.pageNumber - right.pageNumber ||
        left.readingOrder - right.readingOrder,
    );
  const text = included
    .map((block) => {
      const section = sectionTitleForBlock(block.id, paper);
      return [
        `[[page:${block.pageNumber}|section:${section}|block:${block.id}]]`,
        block.text.trim(),
      ].join("\n");
    })
    .join("\n\n");
  return {
    text,
    blockIds: included.map((block) => block.id),
    pageNumbers: [...new Set(included.map((block) => block.pageNumber))],
    sectionTitles: [
      ...new Set(included.map((block) => sectionTitleForBlock(block.id, paper))),
    ],
    estimatedTokens: estimateContextTokens(text),
    signature: compactHash(
      included.map((block) => `${block.id}:${block.text}`).join("\u001f"),
    ),
  };
}

export function buildDigestSectionInputs(
  blocks: DocumentBlock[],
  paper: SemanticPaper,
): DigestSectionInput[] {
  const included = blocks.filter((block) => questionBlock(block, paper));
  const grouped = new Map<string, DocumentBlock[]>();
  for (const block of included) {
    const sectionId = paper.blockSectionIds[block.id] ?? "front-matter";
    const section = paper.sections.find((candidate) => candidate.id === sectionId);
    const topLevelId = section?.topLevelId ?? sectionId;
    grouped.set(topLevelId, [...(grouped.get(topLevelId) ?? []), block]);
  }
  return [...grouped.entries()].map(([id, sectionBlocks]) => {
    const section = paper.sections.find((candidate) => candidate.id === id);
    return {
      id,
      title: section?.title || "Title and abstract",
      text: sectionBlocks
        .sort(
          (left, right) =>
            left.pageNumber - right.pageNumber ||
            left.readingOrder - right.readingOrder,
        )
        .map((block) => `[p.${block.pageNumber}] ${block.text}`)
        .join("\n\n"),
    };
  });
}

export function paperContextMode(
  context: PaperQuestionContext,
  maxContextSize: number,
  hasDigest: boolean,
): AskContextMode | "digest-required" {
  const usableTokens = Math.max(2_048, Math.floor(maxContextSize * 0.72));
  if (context.estimatedTokens <= usableTokens) return "full-text";
  return hasDigest ? "digest" : "digest-required";
}

export function askContextLabel(mode: AskContextMode): string {
  if (mode === "native-pdf") return "원본 PDF";
  if (mode === "digest") return "논문 전체 요약";
  return "논문 전체 텍스트";
}
