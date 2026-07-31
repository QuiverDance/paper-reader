import { FileOutput, LoaderCircle, Sparkles } from "lucide-react";
import type { LlmUsageByPhase } from "../types";

type KoreanPaperEmptyProps = {
  analyzing: boolean;
  working: boolean;
  progressMessage: string;
  completed: number;
  total: number;
  tokenUsage?: LlmUsageByPhase;
  modelName: string;
  onCreate: () => void;
};

export function KoreanPaperEmpty({
  analyzing,
  working,
  progressMessage,
  completed,
  total,
  tokenUsage,
  modelName,
  onCreate,
}: KoreanPaperEmptyProps) {
  return (
    <section className="pdf-pane korean-paper-empty" aria-label="한국어 논문">
      <header className="pane-header">
        <div className="pane-title">
          <span className="pane-dot pane-dot--companion" />
          <strong>한국어 논문</strong>
          <span>아직 생성되지 않음</span>
        </div>
      </header>
      <div className="korean-paper-empty-body">
        <span className="korean-paper-empty-icon">
          {working ? (
            <LoaderCircle className="spin" size={30} />
          ) : (
            <FileOutput size={30} />
          )}
        </span>
        <div>
          <span className="eyebrow">KOREAN PAPER</span>
          <h2>{working ? "한국어 논문을 준비하고 있습니다" : "한국어로 편하게 읽으세요"}</h2>
          <p>
            {working
              ? progressMessage || "한국어 논문을 만드는 중입니다."
              : "논문 전체의 용어와 문맥을 반영해 그림·표·코드를 보존한 한국어 논문을 만듭니다."}
          </p>
          {working && total > 0 && (
            <small className="korean-paper-progress">
              {completed} / {total} 섹션
            </small>
          )}
          {tokenUsage && (
            <small className="korean-paper-progress">
              구조 {tokenUsage.structure.totalTokens.toLocaleString()} ·
              번역 {tokenUsage.translation.totalTokens.toLocaleString()} ·
              합계 {tokenUsage.total.totalTokens.toLocaleString()} 토큰
              {tokenUsage.total.estimated ? " (추정)" : ""}
            </small>
          )}
        </div>
        <button
          type="button"
          className="create-korean-paper"
          disabled={analyzing || working}
          onClick={onCreate}
        >
          {working ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <Sparkles size={18} />
          )}
          <span>
            <strong>
              {analyzing
                ? "원문 분석 중…"
                : working
                  ? "한국어 논문 생성 중"
                  : "한국어 논문 만들기"}
            </strong>
            <small>{modelName || "모델 연결을 선택해 주세요"}</small>
          </span>
        </button>
        <small className="korean-paper-empty-note">
          원문은 변경하지 않으며 생성은 이 버튼을 눌렀을 때만 시작됩니다.
        </small>
      </div>
    </section>
  );
}
