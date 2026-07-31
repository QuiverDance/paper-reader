# Paperloom Translation Documents

Paperloom pairs an unchanged source paper with a separately composed Korean
paper. This language defines the bilingual reading experience, what belongs in
the translated document, and what must remain faithful to the source.

## Language

**Source paper (원문 논문)**:
The input paper that remains unchanged and provides the authoritative content,
figures, tables, and provenance.
_Avoid_: Editable PDF

**Source paper identity (원문 논문 식별자)**:
A content hash of the exact source PDF used to reconnect it with its local
re-typeset project. Moving or renaming an unchanged file preserves its identity;
any change to the PDF contents creates a distinct source paper.
_Avoid_: File-path identity, filename matching

**Bilingual paper viewer (원문-한국어 병렬 뷰어)**:
The primary reading experience that presents the unchanged source paper and its
Korean translation re-typeset together for continuous reading and comparison.
_Avoid_: PDF converter, generic PDF reader

**Independent paper panes (독립 논문 패널)**:
The default viewer arrangement with the source paper on the left and Korean
paper on the right. Each pane has independent page navigation, zoom, fit, and
temporary expansion. A narrow window may stack them responsively, but there is
no manual stacked mode or linked navigation state.
_Avoid_: Synchronized page lock, shared zoom, manual stacked layout

**Korean paper creation state (한국어 논문 생성 상태)**:
The right pane's progression from an empty state with a prominent
`한국어 논문 만들기` action, through visible generation progress, to the saved
translation re-typeset. Opening a source paper never starts generation by itself.
_Avoid_: Automatic generation on open, hidden background generation

**Paper library (논문 라이브러리)**:
A lightweight return point for opening a PDF, revisiting recent papers, and
searching those papers by title. Reopening an unchanged source restores its
local re-typeset project through source paper identity.
_Avoid_: Watched-folder catalog, recursive folder scan, manual tags, missing-file manager

**Reading aid (읽기 보조 기능)**:
A non-translation utility that helps the user study either side of a bilingual
paper: highlights, paper-level notes, term lookup, and reference preview. It
does not modify the source paper or the translation re-typeset.
_Avoid_: Translation overlay, editable source PDF

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

**Paper-wide question context (논문 전체 질문 맥락)**:
The title, abstract, section headings, body prose, explanatory footnotes, and
figure or table captions supplied together when asking about a paper. It keeps
in-text citation markers but excludes the bibliography, proceedings cover,
affiliations, and author contact details.
_Avoid_: Selected-block context, bibliography dump

**Paper-wide question digest (논문 전체 질문 요약)**:
A cached hierarchical summary covering every section of a paper, used only when
the paper-wide question context exceeds the selected model's context capacity.
The viewer identifies whether an answer used the full text or this digest.
_Avoid_: Silent truncation, partial-page fallback

**Paper Ask thread (논문 Ask 대화)**:
A locally saved question-and-answer history belonging to one source paper. Every
question uses the paper-wide question context, digest, or native PDF input
without a scope chooser; selected text may be attached automatically as focus.
The thread returns when the paper is reopened, and an answer can be copied or
saved into the paper's notes.
_Avoid_: Manual scope selector, transient chat history, selected-text-only question

**Ask evidence link (Ask 근거 링크)**:
A verified source-page and section reference attached to an Ask answer. Activating
it navigates the left source pane to that location. When the application cannot
resolve a location reliably, it reports that the location is unavailable rather
than inventing a link.
_Avoid_: Unverified page citation, link to the Korean re-typeset as primary evidence

**Native PDF question input (원본 PDF 질문 입력)**:
An Ask path used when the configured provider and model accept PDF files. It
sends the complete, unchanged source paper so the model can use page visuals,
figures, tables, equations, and layout as well as extracted text. Proceedings
cover text, affiliations, author contact details, and bibliography may be
transmitted as part of the file, but the question instructions exclude them as
answer evidence. The upload occurs only on the first Ask for that paper and
provider, then its remote file identity is reused. Opening or translating a
paper never triggers this upload. Removing the local paper project or provider
connection requests remote deletion; a provider that cannot guarantee deletion
must disclose that before upload. Providers without native PDF support fall
back to the paper-wide question context or its digest.
_Avoid_: Eager upload, repeated upload, silent full-file upload, assumed support from every compatible endpoint

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
The explanatory text anchored immediately above or below its figure or table.
Its Korean form may expand into adjacent prose space without moving or clipping
the source-registered asset.
_Avoid_: Text inside an asset, detached caption, clipped caption

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

**Source-corresponding page (원문 대응 페이지)**:
The Korean page paired with one numbered source page even when inserted
continuation pages shift its physical index in the generated PDF.
_Avoid_: Output page index, forced identical page count

**Source-registered asset slot (원문 정합 자산 슬롯)**:
A preserved figure, table, or code listing occupying the same column region,
coordinates, and size on its source-corresponding page, with the complete asset
fitted inside the slot without clipping.
_Avoid_: Floating asset, freely moved asset, clipped crop

**Korean continuation page (한국어 연속 페이지)**:
An extra prose-only page inserted immediately after its source-corresponding
page when readable Korean text cannot fit around the source-registered assets,
labeled with that source page number plus a suffix such as `3-A`.
_Avoid_: Shrinking below readable type, overlapping an asset, dropping prose

**Continuous Korean prose flow (연속 한국어 본문 흐름)**:
Translated prose fills every available reading region around registered asset
slots and may advance text from later source pages to avoid unnecessary gaps.
_Avoid_: Source-page text partition, asset-caused blank column, premature continuation page

**Preserved code listing (보존 코드 블록)**:
A source code sample whose text, formatting, line breaks, and numbering remain
unchanged while its surrounding caption or explanatory prose may be translated.
It occupies a source-registered asset slot.
_Avoid_: Translated source code, reformatted listing, proportional code font

**Reference preview (참조 미리보기)**:
A card anchored to the exact in-text figure, table, or code reference.
It appears immediately above the token with a narrow pointer-safe gap, shows
only the exact preserved asset crop and its caption, remains while the pointer
is over the reference or card, and closes shortly after leaving both unless the
user clicks the token to pin it. Equivalent source and Korean reference tokens
open the same preserved asset without a native browser title tooltip.
_Avoid_: Paragraph hotspot, native title tooltip, card below the token, full-page modal, permanent duplicate, page jump

**Asset reference token (자산 참조 토큰)**:
An exact numbered in-text label such as `Figure 1`, `Table 2`, `Algorithm 3`,
or `Listing 4`, including its localized equivalent and subpart forms such as
`Figure 2a`, that uniquely identifies the parent asset shown by a reference
preview. A subpart reference always previews the complete parent asset.
_Avoid_: Whole paragraph hotspot, unnumbered “figure”, generic “code”

**Exported asset link (내보낸 자산 링크)**:
An in-text figure or table reference that navigates to the corresponding asset
in an exported PDF, paired with a return link when the format permits it.
_Avoid_: PDF hover dependency, unlinked asset reference

**Localized asset label (현지화 자산 표기)**:
A figure or table label rendered as `그림 N` or `표 N` in Korean prose and
captions while retaining the source number and stable asset identity.
_Avoid_: Translated asset number, disconnected label

**Automatic re-typeset validation (재조판 자동 검사)**:
A local integrity check performed after composition and before a generated
Korean paper replaces the current result. It checks missing prose, damaged
assets, equations, and broken caption or reference links without requiring a
separate review window.
_Avoid_: Manual acceptance gate, silent replacement after validation failure

**Integrity blocker (내용 무결성 오류)**:
A missing or damaged prose block, equation, asset, caption, or reference
relationship that must be corrected or explicitly restored from the source
before PDF export.
_Avoid_: Ignorable content warning, silent omission

**Visual warning (외형 경고)**:
A spacing, pagination, or placement issue that does not change paper content and
may be surfaced after automatic application without preventing PDF export.
_Avoid_: Integrity blocker

**Editable translation block (편집 가능한 번역 블록)**:
A translated paragraph or caption that can be corrected in the Korean pane
after generation and immediately reflected in the composed document. Preserved
text, equations, citations, figures, tables, and code listings remain locked.
_Avoid_: Source editing, edit-through retranslation

**Protected manual correction (보호된 직접 수정)**:
An editable translation block changed by the user and excluded from later
section retranslation until the user explicitly unlocks or selects it.
_Avoid_: Silent overwrite, permanent uneditable translation

**Replacement re-typeset candidate (재조판 교체 후보)**:
A newly regenerated Korean paper composed while the current translation
re-typeset remains readable. It replaces the current paper atomically only after
automatic integrity validation; protected manual corrections carry forward,
and a failed regeneration leaves the current paper untouched.
_Avoid_: In-place regeneration, failure that destroys the accepted translation

**Local re-typeset project (로컬 재조판 프로젝트)**:
The resumable local record for one source paper, including analysis, translations,
manual corrections, layout state, warnings, and generation progress. It never alters
the source paper. When the source paper is opened again, an existing completed
translation re-typeset is restored beside it without retranslating.
_Avoid_: Export-only session, modified source file, automatic retranslation

**Section translation checkpoint (섹션 번역 체크포인트)**:
A saved successful section result that survives failures elsewhere in the paper,
so only failed sections need to be retried.
_Avoid_: Whole-paper restart, duplicate completed translation

**Local document processing (로컬 문서 처리)**:
Structure analysis, asset extraction, re-typesetting, and PDF generation that
run on the reader's device. Translation sends only translatable prose; Ask may
send the complete source paper through native PDF question input.
_Avoid_: Undisclosed whole-document upload

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
in a separate secure store. It is configured inside Paperloom rather than
imported from another application's configuration file.
_Avoid_: Project-embedded API key, one global hard-coded model, external configuration import

**Paper execution model (논문 실행 모델)**:
The concrete GPT, Codex, or compatible model identifier selected for a paper,
separate from the connection profile that supplies authentication and transport.
A change applies only to later Ask requests and future translation work.
_Avoid_: Connection profile label as model name, hidden provider default, implicit retranslation

**Available Codex model catalog (사용 가능 Codex 모델 목록)**:
The picker-visible execution models and supported reasoning efforts reported by
the signed-in Codex session, including its recommended default.
_Avoid_: Hard-coded model list, unavailable account model, unsupported effort

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
source-registered asset slots. Korean prose fills the remaining regions
continuously while complete figures, tables, and code listings retain their
source page, coordinates, and dimensions.
_Avoid_: Pixel identity for prose, source-page text partition, arbitrary asset placement

**Korean academic typography (한글 논문 조판)**:
A Korean serif body and caption style that follows the source paper's size,
weight, spacing, and hierarchy. Translated body paragraphs use justified
alignment by distributing only inter-word space while leaving each paragraph's
final line natural, and every translated body paragraph begins with a first-line
indent even when the source uses a spacing-only paragraph break. A Korean
sans-serif counterpart is used when the source body is clearly sans-serif,
source bold leads retain their weight, and an embedded math face supplies Greek
letters and operators that the Korean face does not contain. Preserved headings
retain their source text.
_Avoid_: Generic UI font, forced serif for a sans-serif paper

**Korean-first re-typesetting (한국어 우선 재조판)**:
The sole user-facing target in the first release: a digital English source paper
composed as a Korean academic paper without a target-language choice. The
internal design may remain extensible, but another language is not exposed until
its typography rules are defined and verified.
_Avoid_: Target-language selector, exposed experimental language

**Unofficial translation provenance (비공식 번역 출처)**:
A restrained first-page note and PDF metadata identifying the document as an
unofficial Paperloom-generated translation and recording the source identity
and generation time, without a repeated page watermark.
_Avoid_: Undisclosed generated translation, full-page watermark
