import {
  BrainCircuit,
  FilePlus2,
  Search,
  Settings2,
} from "lucide-react";
import type { CodexModelOption } from "../lib/llm";
import type { ModelConnectionProfile } from "../types";

type TopBarProps = {
  hasDocument: boolean;
  title: string;
  models: CodexModelOption[];
  activeModelId: string;
  effortOptions: ModelConnectionProfile["effort"][];
  effort: ModelConnectionProfile["effort"];
  onOpen: () => void;
  onModel: (modelId: string) => void;
  onEffort: (effort: ModelConnectionProfile["effort"]) => void;
  onSettings: () => void;
};

export function TopBar({
  hasDocument,
  title,
  models,
  activeModelId,
  effortOptions,
  effort,
  onOpen,
  onModel,
  onEffort,
  onSettings,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <span>Paperloom</span>
      </div>

      <button type="button" className="open-button" onClick={onOpen}>
        <FilePlus2 size={16} />
        PDF 열기
      </button>

      <div className="document-chip" title={title}>
        <Search size={15} />
        <span>{hasDocument ? title : "논문을 열어 시작하세요"}</span>
      </div>

      <div className="paper-model-controls" aria-label="현재 논문 실행 모델">
        <label>
          <span>모델</span>
          <select
            value={activeModelId}
            disabled={!models.length}
            onChange={(event) => onModel(event.target.value)}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <BrainCircuit size={14} />
          <span>추론</span>
          <select
            value={effort}
            onChange={(event) =>
              onEffort(
                event.target.value as ModelConnectionProfile["effort"],
              )
            }
          >
            {effortOptions.map((option) => (
              <option key={option} value={option}>
                {option === "default" ? "기본" : option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className="icon-button"
        aria-label="모델 연결 설정"
        title="모델 연결 설정"
        onClick={onSettings}
      >
        <Settings2 size={17} />
      </button>
    </header>
  );
}
