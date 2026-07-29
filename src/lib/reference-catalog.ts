import type {
  AnnotationSource,
  DocumentBlock,
  DocumentReference,
  SemanticPaper,
  TranslationRecord,
} from "../types";
import {
  detectDocumentReferences,
  resolveDocumentReferences,
} from "./document-blocks";
import { referencePreviewCaption } from "./reference-preview";
import { analyzeSemanticPaper } from "./semantic-paper";
import { translationParagraphsForPaper } from "./translation-paragraphs";

export type SourceReferenceIndex = {
  blocks: DocumentBlock[];
  paper: SemanticPaper;
  references: DocumentReference[];
};

export type ReferenceCatalog = {
  original: DocumentReference[];
  translation: DocumentReference[];
  previewCaption: (
    reference: DocumentReference,
    surface: AnnotationSource,
  ) => string | undefined;
};

type ReferenceCatalogInput = {
  source: SourceReferenceIndex;
  translatedBlocks: DocumentBlock[];
  translations: TranslationRecord[];
};

function referenceKey(
  reference: Pick<DocumentReference, "kind" | "number">,
): string {
  return `${reference.kind}:${reference.number.toLowerCase()}`;
}

function codeTargetByNumber(
  blocks: DocumentBlock[],
): Map<string, DocumentBlock> {
  const targets = new Map<string, DocumentBlock>();
  for (const block of blocks) {
    if (block.type !== "code-listing") continue;
    const match = block.text
      .trim()
      .match(/^(?:Algorithm|Listing|Code)\s*(\d+[a-z]?)\b/i);
    if (match && !targets.has(match[1].toLowerCase())) {
      targets.set(match[1].toLowerCase(), block);
    }
  }
  return targets;
}

export function buildSourceReferenceIndex(
  blocks: DocumentBlock[],
): SourceReferenceIndex {
  const resolved = resolveDocumentReferences(
    blocks,
    detectDocumentReferences(blocks, { language: "source" }),
  );
  const paper = analyzeSemanticPaper(blocks, resolved);
  const assets = new Map(
    paper.assets.map((asset) => [
      `${asset.kind}:${asset.number.toLowerCase()}`,
      asset,
    ]),
  );
  const codeTargets = codeTargetByNumber(blocks);
  const references = resolved.map((reference) => {
    const asset = assets.get(referenceKey(reference));
    if (asset) {
      return {
        ...reference,
        targetBlockId: asset.captionBlockId,
        targetPageNumber: asset.pageNumber,
        targetBbox: asset.bbox,
      };
    }
    if (reference.kind !== "code") return reference;
    const code = codeTargets.get(reference.number.toLowerCase());
    return code
      ? {
          ...reference,
          targetBlockId: code.id,
          targetPageNumber: code.pageNumber,
          targetBbox: code.bbox,
        }
      : reference;
  });

  return { blocks, paper, references };
}

export function buildReferenceCatalog({
  source,
  translatedBlocks,
  translations,
}: ReferenceCatalogInput): ReferenceCatalog {
  const sourceByKey = new Map(
    source.references.map((reference) => [referenceKey(reference), reference]),
  );
  const translation = resolveDocumentReferences(
    translatedBlocks,
    detectDocumentReferences(translatedBlocks, { language: "translation" }),
  ).map((reference) => {
    const sourceReference = sourceByKey.get(referenceKey(reference));
    return sourceReference
      ? {
          ...reference,
          targetBlockId: sourceReference.targetBlockId,
          targetPageNumber: sourceReference.targetPageNumber,
          targetBbox: sourceReference.targetBbox,
        }
      : reference;
  });
  const translationParagraphs = translationParagraphsForPaper(
    source.blocks,
    source.paper.translatableBlockIds,
  );

  return {
    original: source.references,
    translation,
    previewCaption: (reference, surface) =>
      referencePreviewCaption({
        surface,
        reference,
        sourceReferences: source.references,
        sourceBlocks: source.blocks,
        translatedBlocks,
        translations,
        translationParagraphs,
      }),
  };
}
