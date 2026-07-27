# Paperloom

로컬 PDF 논문을 읽고, 같은 문서를 동기화된 두 패널에서 비교할 수 있는
Tauri 2 데스크톱 리더의 첫 번째 구현입니다.

## 현재 구현 범위

- 네이티브 PDF 파일 선택
- PDF.js 기반 연속 스크롤 및 텍스트 레이어
- 페이지 이동, 확대·축소, 너비 맞춤, 페이지 맞춤, 회전
- 원문 단일 보기, 좌우 분할, 상하 분할
- 페이지·상대 스크롤 위치·배율·회전 동기화
- 동기화 해제 후 패널별 독립 탐색
- SQLite 기반 최근 문서 및 마지막 읽던 상태 복원
- PDF 메타데이터 제목 추출과 파일명 fallback
- 원본 PDF를 수정하지 않는 읽기 전용 Rust 명령

번역 API, 텍스트 블록 분석, 번역 오버레이, Figure/Table 탐지,
하이라이트, 메모, LLM 질문은 의도적으로 포함하지 않았습니다.

## 요구사항

- Node.js 20 이상
- Rust 1.77.2 이상
- Tauri가 요구하는 운영체제별 시스템 의존성

운영체제별 준비 항목은
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)를 확인하세요.

## 실행

```bash
npm install
npm run tauri dev
```

프런트엔드만 빠르게 확인하려면 다음 명령을 사용합니다. 이 경우 브라우저
파일 선택 fallback이 동작하지만, 최근 파일 경로 재열기와 SQLite는 Tauri
앱에서만 사용할 수 있습니다.

```bash
npm run dev
```

## 검사

```bash
npm test
npm run build
```

설치 파일을 만들려면 다음을 실행합니다.

```bash
npm run tauri build
```

## 구조

```text
src/
  components/       UI와 PDF.js 뷰 패널
  lib/pdf.ts        PDF 로딩과 제목 추출
  lib/reader-state.ts
                    동기화 상태의 정규화
  lib/storage.ts    SQLite 및 브라우저 fallback
src-tauri/
  src/lib.rs        PDF 읽기 명령과 SQLite migration
  capabilities/    최소 플러그인 권한
tests/
  reader-state.test.ts
```

## 상태 저장 모델

스크롤은 픽셀이 아니라 아래 anchor로 저장합니다.

```ts
type ScrollAnchor = {
  pageNumber: number;
  relativeOffsetY: number;
};
```

두 패널을 동기화할 때 현재 페이지, 페이지 내부 상대 위치, 배율 모드,
실제 배율, 회전을 함께 전달합니다. 창 크기나 분할 방향이 바뀌어도 저장된
위치를 다시 계산할 수 있습니다.

