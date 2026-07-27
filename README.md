# Paperloom

Paperloom은 영문 논문 PDF를 읽고 번역하며, 번역된 본문을 한국어 논문처럼 다시 조판해 별도의 PDF로 내보내는 로컬 우선 데스크톱 앱입니다. 원본 PDF는 수정하지 않습니다.

## 주요 기능

- PDF.js 기반 원문·번역 분할 뷰와 동기화된 페이지 이동
- 문단, 캡션, 수식, 그림·표 참조를 포함한 문서 구조 분석
- 현재 페이지, 페이지 범위, 선택 영역, 전체 논문 번역
- 섹션 전체 문맥을 이용한 영문→한국어 번역과 실패 섹션만 재시도
- 제목·저자·섹션 제목·참고문헌은 원문 유지
- 본문, 초록 본문, 그림·표 캡션, 설명형 각주는 번역
- 그림·표 내부 글자와 수식은 원본 PDF의 벡터 영역으로 보존
- 한국어 학술 문서 형태로 새 PDF 조판
- 원문/재조판본 좌우 검수, 번역문 직접 수정·잠금
- 누락 번역, 손상된 그림·수식, 끊긴 참조가 있으면 내보내기 차단
- 그림·표 미리보기와 PDF 내부 이동 링크
- 로컬 프로젝트 자동 저장과 중단 지점 복원
- OpenAI 호환 API, OpenCode TOML 가져오기, Codex/ChatGPT 로그인 연결
- 이름이 있는 여러 모델 프로필과 컨텍스트 크기·추론 강도 설정
- 데스크톱 앱에서 API 키를 운영체제 보안 저장소에 보관

## 바로 실행하기

Windows에서는 저장소 루트의 `Paperloom.cmd`를 더블클릭하세요. 필요한 패키지를 준비한 뒤 Paperloom을 실행합니다.

처음 한국어 PDF를 만들 때 약 4.9MB의 한글 조판 글꼴 패키지를 한 번 설치합니다. GPU는 필요하지 않으며 일반적인 노트북 CPU에서 동작합니다.

개발 환경에서 직접 실행하려면:

```bash
npm install
npm run tauri dev
```

브라우저에서 화면만 빠르게 확인하려면:

```bash
npm run dev
```

브라우저 모드는 파일 선택과 브라우저 저장소를 사용합니다. 폴더 스캔, 최근 파일 경로 재열기, SQLite, 운영체제 보안 저장소는 데스크톱 앱에서만 동작합니다.

데스크톱 개발 빌드에는 Node.js 20 이상, Rust stable, Visual Studio C++ Build Tools와 WebView2가 필요합니다. 저장소의 `rust-toolchain.toml`이 Tauri에 필요한 Windows MSVC 대상을 선택합니다.

## 한국어 논문 PDF 만들기

1. `PDF 열기`로 디지털 텍스트가 포함된 영문 논문을 엽니다.
2. 오른쪽 도구에서 `한국어 논문 PDF 만들기`를 누릅니다.
3. 처음이라면 한글 조판 패키지를 설치합니다.
4. `섹션 전체 번역`을 실행합니다.
5. 원문과 재조판본을 나란히 검수하고 필요한 문장을 직접 수정합니다.
6. 내용 무결성 검사가 통과하면 `PDF 내보내기`를 누릅니다.

표지 정보, 섹션 제목, 참고문헌, 그림·표 내부 글자는 번역하지 않습니다. 본문과 초록 본문, 그림·표 설명을 번역하고, 페이지 수와 요소 위치는 한국어 흐름에 맞게 달라질 수 있습니다.

## LLM 연결

### API / OpenAI 호환

설정에서 endpoint, API key, 실제 모델명, 최대 컨텍스트, 추론 강도를 지정할 수 있습니다. API 키가 필요 없는 localhost 서버는 키를 비워 둘 수 있습니다.

OpenCode TOML을 가져오면 `default_model` 별칭을 따라 `[models]`와 `[providers]`에서 다음 값을 읽습니다.

- `base_url`
- `api_key`
- 실제 `model`
- `max_context_size`
- `default_effort`
- `capabilities`

여러 구성을 이름이 있는 프로필로 저장하고 전환할 수 있습니다.

### ChatGPT / Codex 로그인

이 방식은 공식 Codex 로그인을 사용합니다. Paperloom이 ChatGPT 인증 파일을 직접 읽지 않고 Codex가 로그인과 모델 요청을 처리합니다. 현재 이 연결은 베타이며, OpenAI 호환 API 프로필이 안정적인 기본 경로입니다.

논문 전체가 모델에 전송되지는 않습니다. 번역 대상으로 판정된 본문 텍스트와 캡션만 전송하며, 첫 사용 때 전송 범위를 확인합니다.

## 지원 범위

현재 품질 목표는 디지털 텍스트가 포함된 영문 PDF를 한국어 PDF로 재조판하는 것입니다.

- 지원: 1단·2단 논문, 본문/초록/캡션 번역, 원본 그림·표·수식 보존
- 미지원: 스캔 PDF, OCR이 필요한 PDF, 암호화되어 열 수 없는 PDF
- 문서 구조가 매우 비표준이면 그림·표 영역을 검수 화면에서 확인해야 합니다.

생성 PDF 첫 페이지와 메타데이터에는 비공식 번역본임을 표시합니다.

## 검증과 빌드

```bash
npm test
npm run build
npm run tauri build
```

## 주요 구조

```text
src/
  components/RetypesetReviewDialog.tsx  원문/재조판 검수와 내보내기
  lib/document-blocks.ts                PDF 텍스트 블록과 참조 분석
  lib/semantic-paper.ts                 페이지와 분리된 논문 의미 구조
  lib/section-translator.ts             섹션 문맥 번역과 체크포인트
  lib/retypeset-pdf.ts                  한국어 PDF 조판과 내부 링크
  lib/typesetting-package.ts            한글 조판 글꼴 설치·검증
  lib/llm.ts                            모델 프로필과 LLM 요청
  lib/storage.ts                        SQLite/브라우저 저장
src-tauri/src/lib.rs                    파일, 보안 저장소, 글꼴, DB 명령
tests/                                  구조·번역·PDF 통합 테스트
docs/                                   구현 명세와 ADR
```

설계 결정은 [ADR 0001](docs/adr/0001-semantic-translation-retypesetting.md), 제3자 글꼴 고지는 [THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md)에서 확인할 수 있습니다.
