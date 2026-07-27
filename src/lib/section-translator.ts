import type {
  DocumentBlock,
  LlmSettings,
  PaperSection,
  RetypesetProject,
  SemanticPaper,
  TranslationRecord,
} from "../types";
import {
  completeChat,
  makeTranslationRecord,
  parseTranslationBriefResponse,
  parseTranslationResponse,
  sectionTranslationMessages,
  translationBriefMessages,
} from "./llm";

type TranslationCheckpoint = {
  sectionId: string;
  completed: number;
  total: number;
  records: TranslationRecord[];
  project: RetypesetProject;
};

type TranslatePaperOptions = {
  title: string;
  paper: SemanticPaper;
  blocks: DocumentBlock[];
  settings: LlmSettings;
  project: RetypesetProject;
  existingTranslations: TranslationRecord[];
  signal?: AbortSignal;
  onCheckpoint?: (checkpoint: TranslationCheckpoint) => void | Promise<void>;
};

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

function orderedBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.pageNumber - right.pageNumber ||
      left.readingOrder - right.readingOrder,
  );
}

function sourceForTranslation(block: DocumentBlock): string {
  if (block.type === "abstract") {
    return block.text.replace(/^abstract(?:\s*[:.—-]\s*|\s+)/i, "").trim();
  }
  return block.text.trim();
}

export function protectCitations(text: string): ProtectedText {
  const markers: ProtectedText["markers"] = [];
  const protectedText = text.replace(CITATION_PATTERN, (source) => {
    const token = `⟦CITATION_${markers.length + 1}⟧`;
    markers.push({ token, source });
    return token;
  });
  return { text: protectedText, markers };
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
  targetLanguage: string,
  sectionId: string,
  error: string,
): TranslationRecord {
  return {
    id: `${block.id}:${targetLanguage}`,
    documentId: block.documentId,
    blockId: block.id,
    targetLanguage,
    sourceText: block.text,
    translatedText: "",
    status: "failed",
    error,
    sectionId,
    manuallyEdited: false,
    locked: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function translatePaperSections({
  title,
  paper,
  blocks,
  settings,
  project,
  existingTranslations,
  signal,
  onCheckpoint,
}: TranslatePaperOptions): Promise<{
  project: RetypesetProject;
  translations: TranslationRecord[];
  failedSectionIds: string[];
}> {
  const workingProject = { ...project };
  const recordsByBlock = new Map(
    existingTranslations.map((record) => [record.blockId, record]),
  );
  const sourceBlocks = paper.translatableBlockIds
    .map((id) => blocks.find((block) => block.id === id))
    .filter((block): block is DocumentBlock => Boolean(block));

  if (!workingProject.translationBrief.trim()) {
    const briefResponse = await completeChat(
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
    workingProject.translationBrief =
      parseTranslationBriefResponse(briefResponse);
    workingProject.updatedAt = new Date().toISOString();
  }

  const units = buildSectionUnits(
    paper,
    blocks,
    settings.maxContextSize || 128000,
  );
  const failedSectionIds: string[] = [];
  let completed = 0;

  for (const unit of units) {
    if (signal?.aborted) throw new DOMException("번역이 취소되었습니다.", "AbortError");
    const pending = unit.blocks.filter((block) => {
      const record = recordsByBlock.get(block.id);
      return !(
        record?.status === "translated" &&
        record.translatedText.trim() &&
        (record.locked || record.sectionId === unit.id)
      );
    });
    if (!pending.length) {
      completed += 1;
      await onCheckpoint?.({
        sectionId: unit.id,
        completed,
        total: units.length,
        records: [...recordsByBlock.values()],
        project: workingProject,
      });
      continue;
    }

    const protectedByBlock = new Map(
      pending.map((block) => [
        block.id,
        protectCitations(sourceForTranslation(block)),
      ]),
    );
    try {
      const response = await completeChat(
        settings,
        sectionTranslationMessages(
          settings.targetLanguage,
          {
            id: unit.id,
            title: unit.title,
            subsections: unit.subsectionTitles,
            blocks: pending.map((block) => ({
              id: block.id,
              type: block.type,
              text: protectedByBlock.get(block.id)!.text,
            })),
          },
          workingProject.translationBrief,
          settings.instructions,
        ),
        signal,
      );
      const translated = parseTranslationResponse(
        response,
        pending.map((block) => block.id),
      );
      for (const result of translated) {
        const block = pending.find((candidate) => candidate.id === result.blockId)!;
        const restored = restoreProtectedText(
          result.text,
          protectedByBlock.get(result.blockId)!.markers,
        );
        recordsByBlock.set(
          result.blockId,
          makeTranslationRecord(
            block.documentId,
            block.id,
            block.text,
            restored,
            settings.targetLanguage,
            unit.id,
          ),
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failedSectionIds.push(unit.id);
      for (const block of pending) {
        const current = recordsByBlock.get(block.id);
        if (current?.locked) continue;
        recordsByBlock.set(
          block.id,
          failedRecord(block, settings.targetLanguage, unit.id, message),
        );
      }
    }

    completed += 1;
    workingProject.updatedAt = new Date().toISOString();
    await onCheckpoint?.({
      sectionId: unit.id,
      completed,
      total: units.length,
      records: [...recordsByBlock.values()],
      project: workingProject,
    });
  }

  return {
    project: workingProject,
    translations: [...recordsByBlock.values()],
    failedSectionIds,
  };
}
