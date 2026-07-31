import type {
  DocumentBlock,
  DocumentReference,
} from "../types";

export type ParsedReferenceLabel = {
  label: string;
  kind: DocumentReference["kind"];
  number: string;
  subpart?: string;
  start: number;
  end: number;
  language: "en" | "ko";
};

const REFERENCE_PATTERN =
  /\b(Fig(?:ure)?s?\.?|Tables?|Algorithms?|Listings?|Code)\s*(\d+)(?:\s*(?:\(\s*([a-z])\s*\)|([a-z])\b))?|(?:그림|표|알고리즘|목록|코드)\s*(\d+)(?:\s*(?:\(\s*([a-z])\s*\)|([a-z])\b))?/giu;

const CAPTION_PATTERNS: Record<DocumentReference["kind"], RegExp> = {
  figure: /^(?:Fig(?:ure)?\.?|그림)\s*(\d+)\b/i,
  table: /^(?:Table|표)\s*(\d+)\b/i,
  code: /^(?:Algorithm|Listing|Code|알고리즘|목록|코드)\s*(\d+)\b/i,
};

function referenceKind(
  label: string,
): DocumentReference["kind"] {
  const normalized = label.toLowerCase();
  if (normalized.startsWith("tab") || label.startsWith("표")) {
    return "table";
  }
  if (
    normalized.startsWith("algorithm") ||
    normalized.startsWith("listing") ||
    normalized.startsWith("code") ||
    label.startsWith("알고리즘") ||
    label.startsWith("목록") ||
    label.startsWith("코드")
  ) {
    return "code";
  }
  return "figure";
}

export function findDocumentReferenceLabels(
  text: string,
): ParsedReferenceLabel[] {
  return [...text.matchAll(REFERENCE_PATTERN)].map((match) => {
    const label = match[0];
    const number = match[2] ?? match[5];
    const subpart = (match[3] ?? match[4] ?? match[6] ?? match[7])
      ?.toLowerCase();
    return {
      label,
      kind: referenceKind(label),
      number,
      ...(subpart ? { subpart } : {}),
      start: match.index,
      end: match.index + label.length,
      language: match[1] ? "en" : "ko",
    };
  });
}

export function parseDocumentReferenceLabel(
  label: string,
): ParsedReferenceLabel | null {
  return (
    findDocumentReferenceLabels(label).find(
      (candidate) =>
        candidate.start === 0 && candidate.end === label.length,
    ) ?? null
  );
}

export function documentReferenceKey(
  reference: Pick<DocumentReference, "kind" | "number">,
): string {
  return `${reference.kind}:${reference.number.toLowerCase()}`;
}

export function detectDocumentReferences(
  blocks: DocumentBlock[],
): DocumentReference[] {
  const references: DocumentReference[] = [];
  for (const block of blocks) {
    if (
      block.type !== "paragraph" &&
      block.type !== "abstract" &&
      block.type !== "footnote"
    ) {
      continue;
    }
    for (const match of findDocumentReferenceLabels(block.text)) {
      references.push({
        id: `${block.id}-ref-${references.length}`,
        sourceBlockId: block.id,
        sourceBbox: block.bbox,
        label: match.label,
        kind: match.kind,
        number: match.number,
        subpart: match.subpart,
        sourcePageNumber: block.pageNumber,
        sourceStart: match.start,
        sourceEnd: match.end,
        provenance: "parser",
      });
    }
  }
  return references;
}

export function mergeDocumentReferences(
  primary: DocumentReference[],
  fallback: DocumentReference[],
): DocumentReference[] {
  const merged = [...primary];
  for (const candidate of fallback) {
    const duplicate = merged.some(
      (reference) =>
        reference.sourcePageNumber === candidate.sourcePageNumber &&
        reference.kind === candidate.kind &&
        reference.number.toLowerCase() ===
          candidate.number.toLowerCase() &&
        (reference.subpart ?? "").toLowerCase() ===
          (candidate.subpart ?? "").toLowerCase() &&
        reference.sourceStart < candidate.sourceEnd &&
        candidate.sourceStart < reference.sourceEnd,
    );
    if (!duplicate) merged.push(candidate);
  }
  return merged.sort(
    (left, right) =>
      left.sourcePageNumber - right.sourcePageNumber ||
      left.sourceStart - right.sourceStart,
  );
}

export function resolveDocumentReferences(
  blocks: DocumentBlock[],
  references = detectDocumentReferences(blocks),
): DocumentReference[] {
  const targets = new Map<
    string,
    Pick<DocumentBlock, "id" | "pageNumber" | "bbox">
  >();
  for (const block of blocks) {
    const kind: DocumentReference["kind"] | null =
      block.type === "figure-caption"
        ? "figure"
        : block.type === "table-caption"
          ? "table"
          : block.type === "code-caption" ||
              block.type === "code-listing" ||
              (block.type === "equation" &&
                /^(?:Algorithm|Listing|Code|알고리즘|목록|코드)\s*\d+/i.test(
                  block.text.trim(),
                ))
            ? "code"
            : null;
    if (!kind) continue;
    const match = block.text.trim().match(CAPTION_PATTERNS[kind]);
    if (match) {
      targets.set(
        documentReferenceKey({ kind, number: match[1] }),
        block,
      );
    }
  }

  return references.map((reference) => {
    const target = targets.get(documentReferenceKey(reference));
    return target
      ? {
          ...reference,
          targetBlockId: target.id,
          targetPageNumber: target.pageNumber,
          targetBbox: target.bbox,
        }
      : reference;
  });
}

export function localizeDocumentReferenceLabels(
  text: string,
): string {
  const references = findDocumentReferenceLabels(text).filter(
    (reference) => reference.language === "en",
  );
  if (!references.length) return text;
  let localized = "";
  let cursor = 0;
  for (const reference of references) {
    const normalized = reference.label.toLowerCase();
    const prefix =
      reference.kind === "figure"
        ? "그림"
        : reference.kind === "table"
          ? "표"
          : normalized.startsWith("listing")
            ? "목록"
            : normalized.startsWith("code")
              ? "코드"
              : "알고리즘";
    localized += text.slice(cursor, reference.start);
    localized += `${prefix} ${reference.number}${
      reference.subpart ? `(${reference.subpart})` : ""
    }`;
    cursor = reference.end;
  }
  return localized + text.slice(cursor);
}
