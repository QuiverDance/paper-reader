# Paperloom Translation Documents

Paperloom distinguishes a fast reading aid from a separately composed translated
paper. This language defines what belongs in the translated document and what
must remain faithful to the source.

## Language

**Source paper (원문 논문)**:
The input paper that remains unchanged and provides the authoritative content,
figures, tables, and provenance.
_Avoid_: Editable PDF

**Translation re-typeset (번역 재조판본)**:
A separate paper whose pagination and element coordinates may change so that
translated prose reads naturally while retaining the source paper's visual character.
_Avoid_: Overlay PDF, patched original

**Translatable prose (번역 대상 본문)**:
The abstract body, body paragraphs, and figure or table captions that appear in
the translation re-typeset in the target language. The `Abstract` label itself
remains preserved text.
_Avoid_: Every extracted text block

**Section translation unit (섹션 번역 단위)**:
All translatable prose belonging to one logical section, collected independently
of source pages, columns, and line breaks and translated as one coherent context.
The section heading marks the boundary but remains preserved text.
_Avoid_: Page translation, isolated paragraph translation

**Hierarchical section context (계층형 섹션 문맥)**:
A top-level section and its descendant subsections treated as one translation
context. If it cannot fit as one unit, it may be divided only at subsection
boundaries while retaining the same document translation brief.
_Avoid_: Unrelated chunk split, context reset

**Document translation brief (논문 번역 기준)**:
A paper-wide record of terminology, subject context, and writing voice applied
consistently to every section translation unit.
_Avoid_: Independent section style, page-local terminology

**Preserved text (보존 텍스트)**:
Cover text, section headings, references, and text embedded inside figures or
tables that remain in the source language.
_Avoid_: Untranslated leftovers

**Recomposed preserved text (재조판 보존 텍스트)**:
Preserved text placed as searchable, selectable text in the new document flow
without changing its wording. Its source coordinates and page breaks need not
be retained.
_Avoid_: Flattened source page, fixed-coordinate text

**Caption (캡션)**:
The explanatory text associated with a figure or table, outside the figure or
table asset itself.
_Avoid_: Text inside a figure, text inside a table

**Preserved equation (보존 수식)**:
An inline or display equation whose mathematical content and visual form remain
unchanged while its position may move with the translated prose around it.
_Avoid_: Translated equation, regenerated equation

**Source equation fragment (원본 수식 조각)**:
A vector-preserving fragment taken from the source paper and placed at the
appropriate baseline or display position in the translation re-typeset.
_Avoid_: Inferred LaTeX, rasterized equation

**Preserved citation (보존 인용)**:
An in-text citation marker whose numbering or author-year form remains unchanged
and links to the corresponding untranslated reference entry.
_Avoid_: Translated citation, renumbered citation

**Translated explanatory footnote (번역 설명 각주)**:
A numbered footnote that expands on body content and is translated while keeping
its original marker. Author affiliations, email addresses, and other first-page
notes remain preserved text.
_Avoid_: Translated affiliation

**Anchored asset (참조 고정 자산)**:
A preserved figure or table that remains in its original order and section, near
the prose that first references it, without requiring its original coordinates.
_Avoid_: Fixed-position asset, freely reordered asset

**Reference preview (참조 미리보기)**:
A transient view of a referenced figure or table shown when the reader hovers
over its in-text reference, without requiring navigation to the asset's page.
It pairs the preserved original asset with its translated caption.
_Avoid_: Permanent duplicate, page jump

**Exported asset link (내보낸 자산 링크)**:
An in-text figure or table reference that navigates to the corresponding asset
in an exported PDF, paired with a return link when the format permits it.
_Avoid_: PDF hover dependency, unlinked asset reference

**Localized asset label (현지화 자산 표기)**:
A figure or table label rendered as `그림 N` or `표 N` in Korean prose and
captions while retaining the source number and stable asset identity.
_Avoid_: Translated asset number, disconnected label

**Re-typeset review (재조판 검수)**:
A required comparison of the source paper and translation re-typeset before
export, including visible warnings for missing prose, damaged assets, equations,
and broken caption or reference links.
_Avoid_: Blind export, post-export review

**Integrity blocker (내용 무결성 오류)**:
A missing or damaged prose block, equation, asset, caption, or reference
relationship that must be corrected or explicitly restored from the source
before PDF export.
_Avoid_: Ignorable content warning, silent omission

**Visual warning (외형 경고)**:
A spacing, pagination, or placement issue that does not change paper content and
may be acknowledged during review without preventing PDF export.
_Avoid_: Integrity blocker

**Editable translation block (편집 가능한 번역 블록)**:
A translated paragraph or caption that can be corrected directly during
re-typeset review and immediately reflected in the composed document. Preserved
text, equations, citations, figures, and tables remain locked.
_Avoid_: Source editing, edit-through retranslation

**Protected manual correction (보호된 직접 수정)**:
An editable translation block changed by the user and excluded from later
section retranslation until the user explicitly unlocks or selects it.
_Avoid_: Silent overwrite, permanent uneditable translation

**Local re-typeset project (로컬 재조판 프로젝트)**:
The resumable local record for one source paper, including analysis, translations,
manual corrections, layout state, warnings, and review progress. It never alters
the source paper.
_Avoid_: Export-only session, modified source file

**Section translation checkpoint (섹션 번역 체크포인트)**:
A saved successful section result that survives failures elsewhere in the paper,
so only failed sections need to be retried.
_Avoid_: Whole-paper restart, duplicate completed translation

**Local document processing (로컬 문서 처리)**:
Structure analysis, asset extraction, re-typesetting, and PDF generation that
run on the reader's device. Only translatable prose is sent to the configured
language model.
_Avoid_: Whole-document upload

**Translation transmission consent (번역 전송 동의)**:
A one-time acknowledgement of the selected external provider and the categories
of translatable prose it will receive. It is renewed when the provider or data
scope changes, not for every whole-paper translation.
_Avoid_: Per-section confirmation, hidden external transmission

**Direct model connection (직접 모델 연결)**:
The stable translation connection using an API key and an OpenAI-compatible
endpoint, with an explicitly selected provider, base address, and model.
_Avoid_: Implicit account session, fixed OpenAI-only endpoint

**Codex session bridge (Codex 세션 연결)**:
An optional beta translation connection mediated by the official local Codex
interface and its ChatGPT sign-in. Paperloom neither reads nor stores Codex
credentials directly.
_Avoid_: Generic ChatGPT OAuth, copied Codex token

**Model connection profile (모델 연결 프로필)**:
A named, reusable provider configuration selected per paper, including endpoint,
model, context capacity, and supported effort settings while keeping credentials
in a separate secure store. OpenAI-compatible settings may be imported from a
familiar text configuration.
_Avoid_: Project-embedded API key, one global hard-coded model

**Standard local analysis (표준 로컬 분석)**:
The default CPU-only analysis path for digital source papers. It must work on a
typical modern laptop without a dedicated GPU and favor predictable resource use.
_Avoid_: GPU-required analysis, high-end workstation mode

**Enhanced recovery analysis (고급 복구 분석)**:
An optional, separately obtained analysis path suggested only when standard
local analysis reports that a complex paper could not be reconstructed reliably.
_Avoid_: Mandatory model download, silent fallback

**On-demand analysis package (주문형 분석 패키지)**:
The local components for standard local analysis, installed once after the user
is shown the download size when they first request a translation re-typeset.
_Avoid_: Hidden download, mandatory oversized app bundle

**Digital source paper (디지털 원문 논문)**:
A source paper with an extractable text layer. Image-only and scanned papers are
outside the first re-typesetting release and are reported as unsupported.
_Avoid_: OCR-ready paper

**Visual similarity (시각적 유사성)**:
A preference for the source page size, column count, typography hierarchy, and
familiar asset placement. Line breaks, column breaks, pagination, and exact
coordinates may change to fit translated prose naturally.
_Avoid_: Pixel identity, fixed pagination

**Korean academic typography (한글 논문 조판)**:
A Korean serif body and caption style that follows the source paper's size,
weight, spacing, and hierarchy. A Korean sans-serif counterpart is used when
the source body is clearly sans-serif, while preserved headings retain their
source text.
_Avoid_: Generic UI font, forced serif for a sans-serif paper

**Korean-first re-typesetting (한국어 우선 재조판)**:
The first quality-guaranteed re-typesetting scope: a digital English source
paper composed as a Korean academic paper. Other target languages may remain
experimental until their typography rules are defined and verified.
_Avoid_: Equal-quality claim for every target language

**Unofficial translation provenance (비공식 번역 출처)**:
A restrained first-page note and PDF metadata identifying the document as an
unofficial Paperloom-generated translation and recording the source identity
and generation time, without a repeated page watermark.
_Avoid_: Undisclosed generated translation, full-page watermark
