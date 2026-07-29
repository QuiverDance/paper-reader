import type {
  DocumentBlock,
  LlmSettings,
  LlmTokenUsage,
  PaperSection,
  RetypesetProject,
  SemanticPaper,
  TranslationRecord,
} from "../types";
import {
  completeChatWithUsage,
  makeTranslationRecord,
  parseTranslationBriefResponse,
  parseTranslationResponse,
  sectionTranslationMessages,
  translationBriefMessages,
} from "./llm";
import {
  addTokenUsage,
  EMPTY_TOKEN_USAGE,
  usageByPhase,
} from "./token-usage";
import {
  groupTranslationParagraphs,
  translationSourceText,
  type TranslationParagraph,
} from "./translation-paragraphs";
export {
  groupTranslationParagraphs,
  type TranslationParagraph,
} from "./translation-paragraphs";

type TranslationCheckpoint = {
  sectionId: string;
  completed: number;
  total: number;
  records: TranslationRecord[];
  project: RetypesetProject;
  usage: LlmTokenUsage;
};

type TranslatePaperOptions = {
  title: string;
  paper: SemanticPaper;
  blocks: DocumentBlock[];
  settings: LlmSettings;
  project: RetypesetProject;
  existingTranslations: TranslationRecord[];
  forceRetranslate?: boolean;
  signal?: AbortSignal;
  onCheckpoint?: (checkpoint: TranslationCheckpoint) => void | Promise<void>;
};

export function translationNeedsRefresh(
  record: TranslationRecord | undefined,
  sectionId: string,
  forceRetranslate = false,
  sourceText?: string,
): boolean {
  if (
    !record ||
    record.status !== "translated" ||
    !record.translatedText.trim()
  ) {
    return true;
  }
  if (record.locked) return false;
  if (forceRetranslate) return true;
  return (
    record.sectionId !== sectionId ||
    (sourceText !== undefined && record.sourceText !== sourceText)
  );
}

type SectionUnit = {
  id: string;
  title: string;
  subsectionTitles: string[];
  blocks: DocumentBlock[];
};

type ProtectedText = {
  text: string;
  markers: Array<{ token: string; source: string }>;
};

const CITATION_PATTERN =
  /\[[^\]\n]{0,90}\d[^\]\n]{0,90}\]|\([^()\n]{0,100}(?:19|20)\d{2}[a-z]?[^()\n]{0,80}\)/gi;
const INLINE_MATH_PATTERN =
  /(?:[A-Za-z]|[Α-Ωα-ω])\s*=\s*[A-Za-zΑ-Ωα-ω0-9]+(?:\s*[·×*/+\-−]\s*[A-Za-zΑ-Ωα-ω0-9]+){0,4}/g;

function orderedBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
}

function sourceForTranslation(block: DocumentBlock): string {
  return translationSourceText(block);
}

export function protectCitations(
  text: string,
  tokenNamespace = "",
): ProtectedText {
  const markers: ProtectedText["markers"] = [];
  const protectedText = text.replace(CITATION_PATTERN, (source) => {
    const token = `⟦${tokenNamespace}CITATION_${markers.length + 1}⟧`;
    markers.push({ token, source });
    return token;
  });
  const protectedMath = protectedText.replace(
    INLINE_MATH_PATTERN,
    (source) => {
      const token = `⟦${tokenNamespace}MATH_${markers.length + 1}⟧`;
      markers.push({ token, source });
      return token;
    },
  );
  return { text: protectedMath, markers };
}

export function restoreProtectedText(
  translated: string,
  markers: ProtectedText["markers"],
): string {
  let restored = translated;
  for (const marker of markers) {
    const count = restored.split(marker.token).length - 1;
    if (count !== 1) {
      throw new Error(`${marker.token} 보존 표식이 번역 과정에서 변경되었습니다.`);
    }
    restored = restored.replace(marker.token, marker.source);
  }
  return restored;
}

function candidateTerms(blocks: DocumentBlock[]): string[] {
  const counts = new Map<string, number>();
  const pattern = /\b(?:[A-Z][A-Za-z0-9+._-]{2,}|[a-z][A-Za-z0-9+._-]{5,})\b/g;
  for (const block of blocks) {
    for (const term of block.text.match(pattern) ?? []) {
      const normalized = term.toLowerCase();
      if (
        /^(?:figure|table|section|using|which|these|those|their|there|where|abstract|introduction|method|results|discussion)$/i.test(
          term,
        )
      ) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 120)
    .map(([term]) => term);
}

function descendants(
  section: PaperSection,
  sectionById: Map<string, PaperSection>,
): PaperSection[] {
  const result = [section];
  for (const childId of section.childIds) {
    const child = sectionById.get(childId);
    if (child) result.push(...descendants(child, sectionById));
  }
  return result;
}

function buildSectionUnits(
  paper: SemanticPaper,
  blocks: DocumentBlock[],
  maxContextSize: number,
): SectionUnit[] {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const translatable = new Set(paper.translatableBlockIds);
  const sectionById = new Map(
    paper.sections.map((section) => [section.id, section]),
  );
  const roots = paper.sections.filter(
    (section) => !section.parentId && section.id !== "front-matter",
  );
  if (
    paper.sections
      .find((section) => section.id === "front-matter")
      ?.blockIds.some((id) => translatable.has(id))
  ) {
    roots.unshift(sectionById.get("front-matter")!);
  }

  const characterBudget = Math.min(
    600_000,
    Math.max(20_000, Math.floor(maxContextSize * 2.2)),
  );
  const units: SectionUnit[] = [];

  for (const root of roots) {
    const tree = descendants(root, sectionById);
    const treeBlocks = orderedBlocks(
      tree.flatMap((section) =>
        section.blockIds.flatMap((id) => {
          const block = blockById.get(id);
          return block && translatable.has(id) ? [block] : [];
        }),
      ),
    );
    if (!treeBlocks.length) continue;
    const totalCharacters = treeBlocks.reduce(
      (sum, block) => sum + sourceForTranslation(block).length,
      0,
    );
    if (totalCharacters <= characterBudget) {
      units.push({
        id: root.id,
        title: root.title,
        subsectionTitles: tree.slice(1).map((section) => section.title),
        blocks: treeBlocks,
      });
      continue;
    }

    // Keep the shared top-level context but divide only at descendant section
    // seams. A single oversized subsection is surfaced as a failed unit rather
    // than silently chopping a paragraph in half.
    const groups = root.childIds.length
      ? root.childIds
          .map((childId) => sectionById.get(childId))
          .filter((section): section is PaperSection => Boolean(section))
      : [root];
    for (const group of groups) {
      const groupTree = descendants(group, sectionById);
      const groupBlocks = orderedBlocks(
        groupTree.flatMap((section) =>
          section.blockIds.flatMap((id) => {
            const block = blockById.get(id);
            return block && translatable.has(id) ? [block] : [];
          }),
        ),
      );
      if (groupBlocks.length) {
        units.push({
          id: group.id,
          title: `${root.title} / ${group.title}`,
          subsectionTitles: groupTree.slice(1).map((section) => section.title),
          blocks: groupBlocks,
        });
      }
    }
  }
  return units;
}

function briefSections(
  paper: SemanticPaper,
  blocks: DocumentBlock[],
): Array<{ title: string; text: string }> {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const translatable = new Set(paper.translatableBlockIds);
  const roots = paper.sections.filter(
    (section) => !section.parentId && section.id !== "front-matter",
  );
  return roots.map((section) => ({
    title: section.title,
    text: section.blockIds
      .flatMap((id) => {
        const block = blockById.get(id);
        return block && translatable.has(id)
          ? [sourceForTranslation(block)]
          : [];
      })
      .join(" ")
      .slice(0, 1800),
  }));
}

function failedRecord(
  block: DocumentBlock,
  sourceText: string,
  targetLanguage: string,
  sectionId: string,
  error: string,
): TranslationRecord {
  return {
    id: `${block.id}:${targetLanguage}`,
    documentId: block.documentId,
    blockId: block.id,
    targetLanguage,
    sourceText,
    translatedText: "",
    status: "failed",
    error,
    sectionId,
    manuallyEdited: false,
    locked: false,
    updatedAt: new Date().toISOString(),
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

export async function translatePaperSections({
  title,
  paper,
  blocks,
  settings,
  project,
  existingTranslations,
  forceRetranslate = false,
  signal,
  onCheckpoint,
}: TranslatePaperOptions): Promise<{
  project: RetypesetProject;
  translations: TranslationRecord[];
  failedSectionIds: string[];
  usage: LlmTokenUsage;
}> {
  const workingProject = { ...project };
  let usage =
    workingProject.tokenUsage?.translation ?? EMPTY_TOKEN_USAGE;
  const updateProjectUsage = () => {
    workingProject.tokenUsage = usageByPhase(
      workingProject.documentStructure?.usage,
      usage,
    );
  };
  updateProjectUsage();
  const validRecordIds = new Set(paper.translatableBlockIds);
  const recordsByBlock = new Map(
    existingTranslations
      .filter((record) => validRecordIds.has(record.blockId))
      .map((record) => [record.blockId, record]),
  );
  const sourceBlocks = paper.translatableBlockIds
    .map((id) => blocks.find((block) => block.id === id))
    .filter((block): block is DocumentBlock => Boolean(block));

  if (!workingProject.translationBrief.trim()) {
    const briefResponse = await completeChatWithUsage(
      settings,
      translationBriefMessages(
        settings.targetLanguage,
        title,
        [
          ...briefSections(paper, blocks),
          {
            title: "Candidate terminology",
            text: candidateTerms(sourceBlocks).join(", "),
          },
        ],
        settings.instructions,
      ),
      signal,
    );
    usage = addTokenUsage(usage, briefResponse.usage);
    updateProjectUsage();
    workingProject.translationBrief =
      parseTranslationBriefResponse(briefResponse.content);
    workingProject.updatedAt = new Date().toISOString();
  }

  const units = buildSectionUnits(
    paper,
    blocks,
    settings.maxContextSize || 128000,
  );
  const failedSectionIds: string[] = [];
  let completed = 0;
  let checkpointQueue = Promise.resolve();
  const checkpoint = (sectionId: string): Promise<void> => {
    completed += 1;
    workingProject.updatedAt = new Date().toISOString();
    const snapshot: TranslationCheckpoint = {
      sectionId,
      completed,
      total: units.length,
      records: [...recordsByBlock.values()],
      project: { ...workingProject },
      usage,
    };
    checkpointQueue = checkpointQueue.then(async () => {
      await onCheckpoint?.(snapshot);
    });
    return checkpointQueue;
  };

  await runWithConcurrency(units, 3, async (unit) => {
    if (signal?.aborted) throw new DOMException("번역이 취소되었습니다.", "AbortError");
    const blockById = new Map(unit.blocks.map((block) => [block.id, block]));
    const lockedBlockIds = new Set(
      unit.blocks
        .filter((block) => recordsByBlock.get(block.id)?.locked)
        .map((block) => block.id),
    );
    const pending = groupTranslationParagraphs(
      unit.blocks,
      lockedBlockIds,
    ).filter(
      (paragraph) => {
        const record = recordsByBlock.get(paragraph.id);
        return translationNeedsRefresh(
          record,
          unit.id,
          forceRetranslate,
          paragraph.text,
        );
      },
    );
    if (!pending.length) {
      await checkpoint(unit.id);
      return;
    }

    const protectedByParagraph = new Map(
      pending.map((paragraph) => [
        paragraph.id,
        protectCitations(
          paragraph.text,
          `${paragraph.id.replace(/[^A-Za-z0-9]/g, "_")}_`,
        ),
      ]),
    );
    const logicalParagraphs: TranslationParagraph[] = pending.map(
      (paragraph) => ({
        ...paragraph,
        text: protectedByParagraph.get(paragraph.id)!.text,
      }),
    );
    try {
      const response = await completeChatWithUsage(
        settings,
        sectionTranslationMessages(
          settings.targetLanguage,
          {
            id: unit.id,
            title: unit.title,
            subsections: unit.subsectionTitles,
            blocks: pending.map((paragraph) => ({
              id: paragraph.id,
              type: blockById.get(paragraph.id)!.type,
              text: protectedByParagraph.get(paragraph.id)!.text,
            })),
            logicalParagraphs,
          },
          workingProject.translationBrief,
          settings.instructions,
        ),
        signal,
      );
      usage = addTokenUsage(usage, response.usage);
      updateProjectUsage();
      const translated = parseTranslationResponse(
        response.content,
        pending.map((paragraph) => paragraph.id),
      );
      for (const result of translated) {
        const paragraph = pending.find(
          (candidate) => candidate.id === result.blockId,
        )!;
        const block = blockById.get(paragraph.id)!;
        const restored = restoreProtectedText(
          result.text,
          protectedByParagraph.get(result.blockId)!.markers,
        );
        recordsByBlock.set(
          result.blockId,
          makeTranslationRecord(
            block.documentId,
            block.id,
            paragraph.text,
            restored,
            settings.targetLanguage,
            unit.id,
          ),
        );
        for (const followerId of paragraph.blockIds.slice(1)) {
          recordsByBlock.delete(followerId);
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failedSectionIds.push(unit.id);
      for (const paragraph of pending) {
        const block = blockById.get(paragraph.id)!;
        const current = recordsByBlock.get(paragraph.id);
        if (current?.locked) continue;
        recordsByBlock.set(
          paragraph.id,
          failedRecord(
            block,
            paragraph.text,
            settings.targetLanguage,
            unit.id,
            message,
          ),
        );
      }
    }

    await checkpoint(unit.id);
  });

  const failed = new Set(failedSectionIds);
  return {
    project: workingProject,
    translations: [...recordsByBlock.values()],
    usage,
    failedSectionIds: units
      .map((unit) => unit.id)
      .filter((sectionId) => failed.has(sectionId)),
  };
}
