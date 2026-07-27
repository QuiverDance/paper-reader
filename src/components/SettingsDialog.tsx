import { Eye, EyeOff, Save, TestTube2, X } from "lucide-react";
import { useState } from "react";
import type { LlmSettings } from "../types";

type SettingsDialogProps = {
  settings: LlmSettings;
  testing: boolean;
  onClose: () => void;
  onSave: (settings: LlmSettings) => void;
  onTest: (settings: LlmSettings) => void;
};

export function SettingsDialog({
  settings,
  testing,
  onClose,
  onSave,
  onTest,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(settings);
  const [showKey, setShowKey] = useState(false);

  const update = (key: keyof LlmSettings, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="LLM 설정"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>LOCAL PROVIDER</span>
            <h2>OpenAI-compatible API</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="설정 닫기">
            <X size={17} />
          </button>
        </header>

        <label>
          <span>API endpoint</span>
          <input
            value={draft.endpoint}
            onChange={(event) => update("endpoint", event.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <label>
          <span>API key</span>
          <div className="secret-input">
            <input
              value={draft.apiKey}
              type={showKey ? "text" : "password"}
              onChange={(event) => update("apiKey", event.target.value)}
              autoComplete="off"
              placeholder="로컬에만 저장됩니다"
            />
            <button
              type="button"
              onClick={() => setShowKey((visible) => !visible)}
              aria-label={showKey ? "API key 숨기기" : "API key 보기"}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </label>

        <div className="settings-row">
          <label>
            <span>모델</span>
            <input
              value={draft.model}
              onChange={(event) => update("model", event.target.value)}
              placeholder="gpt-4.1-mini"
            />
          </label>
          <label>
            <span>번역 언어</span>
            <input
              value={draft.targetLanguage}
              onChange={(event) => update("targetLanguage", event.target.value)}
              placeholder="ko"
            />
          </label>
        </div>

        <label>
          <span>추가 번역 지침</span>
          <textarea
            value={draft.instructions}
            onChange={(event) => update("instructions", event.target.value)}
            placeholder="용어집, 문체, 번역하지 않을 고유명사 등을 입력하세요."
          />
        </label>

        <p className="settings-security">
          API key와 설정은 이 장치의 Paperloom 데이터에만 저장되며 로그에
          출력되지 않습니다.
        </p>

        <footer>
          <button
            type="button"
            className="secondary-action"
            disabled={testing}
            onClick={() => onTest(draft)}
          >
            <TestTube2 size={15} />
            {testing ? "연결 확인 중…" : "연결 테스트"}
          </button>
          <button
            type="button"
            className="primary-action compact"
            onClick={() => onSave(draft)}
          >
            <Save size={15} />
            저장
          </button>
        </footer>
      </section>
    </div>
  );
}
