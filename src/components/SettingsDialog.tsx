import {
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  FileUp,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Save,
  TestTube2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCodexAuthStatus,
  startCodexLogin,
  type CodexAuthStatus,
} from "../lib/llm";
import { importOpenCodeConfig } from "../lib/opencode-config";
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
  const [configText, setConfigText] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);
  const configFileRef = useRef<HTMLInputElement>(null);

  const update = (key: keyof LlmSettings, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const refreshCodexStatus = useCallback(async () => {
    setCodexBusy(true);
    try {
      setCodexStatus(await getCodexAuthStatus());
    } finally {
      setCodexBusy(false);
    }
  }, []);

  useEffect(() => {
    if (draft.connectionMode === "codex" && !codexStatus && !codexBusy) {
      void refreshCodexStatus();
    }
  }, [
    codexBusy,
    codexStatus,
    draft.connectionMode,
    refreshCodexStatus,
  ]);

  const loginWithChatGpt = async () => {
    setCodexBusy(true);
    setCodexStatus((current) => ({
      available: current?.available ?? true,
      authenticated: false,
      message: "브라우저에서 ChatGPT 로그인을 완료해 주세요.",
    }));
    try {
      setCodexStatus(await startCodexLogin());
    } catch (cause) {
      setCodexStatus({
        available: true,
        authenticated: false,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setCodexBusy(false);
    }
  };

  const applyOpenCodeConfig = () => {
    try {
      const imported = importOpenCodeConfig(configText);
      setDraft((current) => ({ ...current, ...imported }));
      setImportMessage(
        `${imported.modelAlias} → ${imported.model} (${imported.providerName}) 설정을 가져왔습니다.`,
      );
    } catch (cause) {
      setImportMessage(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const loadConfigFile = async (file?: File) => {
    if (!file) return;
    const contents = await file.text();
    setConfigText(contents);
    setImportMessage(`${file.name} 파일을 읽었습니다. 설정 적용을 눌러 주세요.`);
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
            <span>LANGUAGE MODEL</span>
            <h2>LLM 연결</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="설정 닫기">
            <X size={17} />
          </button>
        </header>

        <div className="connection-tabs" role="tablist" aria-label="연결 방식">
          <button
            type="button"
            role="tab"
            aria-selected={draft.connectionMode === "api"}
            className={draft.connectionMode === "api" ? "active" : ""}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                connectionMode: "api",
              }))
            }
          >
            API / OpenAI 호환
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={draft.connectionMode === "codex"}
            className={draft.connectionMode === "codex" ? "active" : ""}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                connectionMode: "codex",
              }))
            }
          >
            ChatGPT 로그인
          </button>
        </div>

        {draft.connectionMode === "api" ? (
          <>
            <details className="opencode-import">
              <summary>OpenCode TOML 설정 가져오기</summary>
              <div className="opencode-import-body">
                <input
                  ref={configFileRef}
                  type="file"
                  accept=".toml,text/plain"
                  hidden
                  onChange={(event) => {
                    void loadConfigFile(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
                <textarea
                  value={configText}
                  onChange={(event) => {
                    setConfigText(event.target.value);
                    setImportMessage("");
                  }}
                  spellCheck={false}
                  placeholder={`default_model = "glm-5.2-nvfp4"

[providers.openai]
type = "openai"
base_url = "https://example.com/v1"
api_key = "..."

[models."glm-5.2-nvfp4"]
provider = "openai"
model = "nvidia/GLM-5.2-NVFP4"`}
                />
                <div className="opencode-import-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => configFileRef.current?.click()}
                  >
                    <FileUp size={14} />
                    TOML 파일 선택
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!configText.trim()}
                    onClick={applyOpenCodeConfig}
                  >
                    설정 적용
                  </button>
                </div>
                {importMessage && (
                  <p className="inline-status">{importMessage}</p>
                )}
              </div>
            </details>

            <label>
              <span>API endpoint</span>
              <input
                value={draft.endpoint}
                onChange={(event) => update("endpoint", event.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>

            <label>
              <span>API key · 키가 필요 없는 로컬 서버는 비워 두세요</span>
              <div className="secret-input">
                <input
                  value={draft.apiKey}
                  type={showKey ? "text" : "password"}
                  onChange={(event) => update("apiKey", event.target.value)}
                  autoComplete="off"
                  placeholder="이 장치에만 저장됩니다"
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

            <label>
              <span>실제 API 모델명</span>
              <input
                value={draft.model}
                onChange={(event) => update("model", event.target.value)}
                placeholder="nvidia/GLM-5.2-NVFP4"
              />
            </label>

            <p className="settings-security">
              OpenCode 설정을 가져오면 기본 모델의 별칭을 따라 provider,
              base_url, api_key, 실제 model 값을 자동으로 연결합니다. 키는 이
              장치에만 저장되며 로그에 출력하지 않습니다.
            </p>
          </>
        ) : (
          <>
            <div
              className={`codex-status-card ${
                codexStatus?.authenticated ? "connected" : ""
              }`}
            >
              <div className="codex-status-copy">
                {codexBusy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : codexStatus?.authenticated ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <CircleAlert size={18} />
                )}
                <div>
                  <strong>
                    {codexBusy
                      ? "Codex 확인 중"
                      : codexStatus?.authenticated
                        ? "ChatGPT 연결됨"
                        : "ChatGPT 로그인이 필요합니다"}
                  </strong>
                  <span>
                    {codexStatus?.message ??
                      "이 PC의 공식 Codex 로그인을 확인합니다."}
                  </span>
                </div>
              </div>
              <div className="codex-status-actions">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={codexBusy}
                  onClick={() => void refreshCodexStatus()}
                  aria-label="로그인 상태 새로고침"
                >
                  <RefreshCw size={14} />
                </button>
                {!codexStatus?.authenticated && (
                  <button
                    type="button"
                    className="primary-action compact"
                    disabled={codexBusy || codexStatus?.available === false}
                    onClick={() => void loginWithChatGpt()}
                  >
                    <LogIn size={14} />
                    ChatGPT로 로그인
                  </button>
                )}
              </div>
            </div>

            <label>
              <span>Codex 모델 · 비우면 현재 기본 모델 사용</span>
              <input
                value={draft.codexModel}
                onChange={(event) => update("codexModel", event.target.value)}
                placeholder="기본 모델"
              />
            </label>

            <p className="settings-security">
              Paperloom은 ChatGPT 토큰 파일을 직접 읽지 않습니다. 공식 Codex
              CLI가 로그인과 요청을 처리하며, 대화는 임시 세션으로 실행됩니다.
              API 키 방식과 ChatGPT 구독 사용량은 서로 별개입니다.
            </p>
          </>
        )}

        <div className="settings-row">
          <label>
            <span>번역 언어</span>
            <input
              value={draft.targetLanguage}
              onChange={(event) => update("targetLanguage", event.target.value)}
              placeholder="ko"
            />
          </label>
          <label>
            <span>연결 방식</span>
            <input
              value={
                draft.connectionMode === "codex"
                  ? "ChatGPT / Codex"
                  : "OpenAI 호환 API"
              }
              readOnly
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

        <footer>
          <button
            type="button"
            className="secondary-action"
            disabled={testing || codexBusy}
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
