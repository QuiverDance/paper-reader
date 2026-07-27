# Paperloom

Paperloom은 PDF 논문을 원문과 번역문으로 나란히 읽고, 읽는 맥락을 로컬에
보존하는 Tauri 2 데스크톱 앱입니다. 원본 PDF는 수정하지 않으며 번역, 메모,
하이라이트, 질문 기록은 SQLite에 저장합니다.

## 구현된 기능

- PDF.js 기반 연속 페이지 렌더링과 텍스트 선택
- 페이지 이동, 확대·축소, 너비/페이지 맞춤, 회전
- 원문 단일 보기, 좌우 분할, 상하 분할
- 분할 화면의 페이지·스크롤·배율·회전 동기화
- PDF 텍스트의 문단 블록 분석과 정규화 좌표 저장
- 현재 페이지, 페이지 범위, 선택 영역, 전체 문서 번역
- 실패한 번역 재시도, 실행 취소, 캐시 재사용, 번역문 직접 수정
- 원문 좌표를 유지하는 HTML 번역 오버레이
- 문맥 기반 영단어 사전
- 선택 영역·현재 페이지를 근거로 한 LLM 질문과 대화 기록
- 하이라이트와 Markdown 메모의 생성·수정·삭제
- Figure/Table 참조 탐지, 대상 페이지 연결, 미리보기
- 논문 폴더 재귀 스캔, 새 파일/누락 파일 갱신
- 최근 문서, 제목·경로·태그 검색, 태그 편집
- 마지막 읽기 위치와 분할 화면 상태 복원
- OpenAI-compatible API endpoint, 모델, 번역 언어 설정

## 요구 사항

- Node.js 20 이상
- Rust stable
- Windows에서는 Visual Studio C++ Build Tools
- Tauri가 요구하는 운영체제별 시스템 의존성

운영체제별 준비 항목은
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)에서 확인할 수
있습니다.

## 실행

Windows에서는 저장소 루트의 `Paperloom.cmd`를 더블클릭하면 필요한 패키지를
자동으로 준비하고 브라우저에서 Paperloom을 엽니다.

```bash
npm install
npm run tauri dev
```

프런트엔드만 빠르게 확인할 때는 다음 명령을 사용합니다.

```bash
npm run dev
```

브라우저 모드에서는 파일 선택과 localStorage 저장을 사용할 수 있지만, 폴더 스캔,
최근 파일 경로 재열기, SQLite 저장은 데스크톱 앱에서만 동작합니다.

## LLM 설정

오른쪽 위 설정 버튼에서 두 가지 연결 방식 중 하나를 선택합니다.

### API / OpenAI 호환

- API endpoint: `https://api.openai.com/v1` 또는 호환 서버 주소
- API key: 키가 필요 없는 localhost 서버는 비워 둘 수 있음
- 실제 API 모델 이름과 번역 대상 언어
- OpenCode TOML 파일 선택 또는 설정 텍스트 붙여넣기

OpenCode 가져오기는 `default_model`의 별칭을 따라 `[models]`와 `[providers]`를
찾고 `base_url`, `api_key`, 실제 `model` 값을 Paperloom 설정에 적용합니다.

### ChatGPT 로그인

Paperloom에 포함된 공식 Codex CLI가 브라우저 로그인, 자격 증명 보관, 모델 요청을
담당합니다. 설정에서 **ChatGPT 로그인**을 선택하면 현재 로그인 상태를 확인할 수
있고, 필요하면 브라우저 로그인 절차를 시작할 수 있습니다. Paperloom은 Codex의
토큰 파일을 직접 읽지 않으며 각 요청은 기록을 남기지 않는 임시 세션으로 실행됩니다.

데스크톱 앱의 요청은 Rust 계층에서, `Paperloom.cmd` 브라우저 모드의 요청은
localhost 브리지를 통해 전송됩니다. 설정은 이 장치의 Paperloom 데이터에만
저장되고 애플리케이션 로그에는 출력하지 않습니다.

## 검증과 빌드

```bash
npm test
npm run build
npm run tauri build
```

## 주요 구조

```text
src/
  components/            리더, 라이브러리, 도구 패널, 설정 UI
  lib/document-blocks.ts PDF 텍스트 문단화와 Figure/Table 참조 탐지
  lib/llm.ts             번역·사전·질문 요청과 응답 검증
  lib/pdf.ts             PDF 로딩과 메타데이터 추출
  lib/reader-state.ts    동기화된 읽기 상태 계산
  lib/storage.ts         SQLite 및 브라우저 저장소
src-tauri/
  src/lib.rs             PDF 읽기, 폴더 스캔, LLM 프록시, DB migration
tests/                   상태·문단·LLM 응답 단위 테스트
docs/                    구현 명세
```

## 현재 범위 밖

현재 버전은 디지털 텍스트가 포함된 PDF를 대상으로 합니다. OCR, 수식 내부 번역,
Figure/Table 이미지 내부 글자 번역, 번역 PDF 내보내기, 원문과 동일한 완전 재조판,
다중 논문 RAG·벡터 검색, 계정·클라우드 동기화·협업은 포함하지 않습니다.
