import {
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  LogIn,
  Plus,
  RefreshCw,
  Save,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  applyModelProfile,
  getCodexAuthStatus,
  normalizeLlmSettings,
  startCodexLogin,
  type CodexAuthStatus,
} from "../lib/llm";
import type {
  LlmSettings,
  ModelConnectionProfile,
} from "../types";

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
  const [draft, setDraft] = useState(() => normalizeLlmSettings(settings));
  const [showKey, setShowKey] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);

  const activeProfile =
    draft.profiles.find((profile) => profile.id === draft.activeProfileId) ??
    draft.profiles[0];

  const updateProfile = (changes: Partial<ModelConnectionProfile>) => {
    setDraft((current) => {
      const currentProfile =
        current.profiles.find(
          (profile) => profile.id === current.activeProfileId,
        ) ?? current.profiles[0];
      const nextProfile = { ...currentProfile, ...changes };
      return applyModelProfile(
        {
          ...current,
          profiles: current.profiles.map((profile) =>
            profile.id === nextProfile.id ? nextProfile : profile,
          ),
        },
        nextProfile,
      );
    });
  };

  const update = (
    key:
      | "endpoint"
      | "apiKey"
      | "model"
      | "codexModel"
      | "instructions",
    value: string,
  ) => {
    if (
      key === "endpoint" ||
      key === "apiKey" ||
      key === "model" ||
      key === "codexModel"
    ) {
      updateProfile({ [key]: value });
      return;
    }
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

        <section className="profile-picker">
          <label>
            <span>연결 프로필</span>
            <select
              value={activeProfile.id}
              onChange={(event) => {
                const profile = draft.profiles.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (profile) {
                  setDraft((current) => applyModelProfile(current, profile));
                }
              }}
            >
              {draft.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.beta ? " · 베타" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>프로필 이름</span>
            <input
              value={activeProfile.name}
              onChange={(event) => updateProfile({ name: event.target.value })}
            />
          </label>
          <div className="profile-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                const id = `profile-${crypto.randomUUID()}`;
                const profile: ModelConnectionProfile = {
                  ...activeProfile,
                  id,
                  name: "새 모델 연결",
                  apiKey: "",
                  beta: false,
                };
                setDraft((current) =>
                  applyModelProfile(
                    { ...current, profiles: [...current.profiles, profile] },
                    profile,
                  ),
                );
              }}
            >
              <Plus size={14} />
              새 프로필
            </button>
            <button
              type="button"
              className="secondary-action danger"
              disabled={draft.profiles.length <= 1}
              onClick={() => {
                const remaining = draft.profiles.filter(
                  (profile) => profile.id !== activeProfile.id,
                );
                setDraft((current) =>
                  applyModelProfile(
                    { ...current, profiles: remaining },
                    remaining[0],
                  ),
                );
              }}
            >
              <Trash2 size={14} />
              삭제
            </button>
          </div>
        </section>

        <div className="connection-tabs" role="tablist" aria-label="연결 방식">
          <button
            type="button"
            role="tab"
            aria-selected={draft.connectionMode === "api"}
            className={draft.connectionMode === "api" ? "active" : ""}
            onClick={() =>
              updateProfile({ connectionMode: "api", beta: false })
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
              updateProfile({ connectionMode: "codex", beta: true })
            }
          >
            ChatGPT 로그인
          </button>
        </div>

        {draft.connectionMode === "api" ? (
          <>
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

            <div className="settings-row">
              <label>
                <span>최대 컨텍스트</span>
                <input
                  type="number"
                  min={4096}
                  value={activeProfile.maxContextSize}
                  onChange={(event) =>
                    updateProfile({
                      maxContextSize: Math.max(
                        4096,
                        Number(event.target.value) || 128000,
                      ),
                    })
                  }
                />
              </label>
              <label>
                <span>추론 강도</span>
                <select
                  value={activeProfile.effort}
                  onChange={(event) =>
                    updateProfile({
                      effort: event.target
                        .value as ModelConnectionProfile["effort"],
                    })
                  }
                >
                  <option value="default">기본</option>
                  <option value="low">낮음</option>
                  <option value="high">높음</option>
                  <option value="max">최대</option>
                </select>
              </label>
            </div>

            <div className="settings-capabilities">
              <label>
                <input
                  type="checkbox"
                  checked={activeProfile.capabilities.includes("pdf-input")}
                  onChange={(event) => {
                    const withoutPdf = activeProfile.capabilities.filter(
                      (capability) =>
                        capability !== "pdf-input" &&
                        capability !== "remote-file-delete",
                    );
                    updateProfile({
                      capabilities: event.target.checked
                        ? [...withoutPdf, "pdf-input"]
                        : withoutPdf,
                    });
                  }}
                />
                <span>
                  <strong>원본 PDF 질문 입력</strong>
                  <small>
                    이 제공자가 Responses API의 PDF 파일 입력을 지원할 때만
                    켜세요.
                  </small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={!activeProfile.capabilities.includes("pdf-input")}
                  checked={activeProfile.capabilities.includes(
                    "remote-file-delete",
                  )}
                  onChange={(event) => {
                    const capabilities = activeProfile.capabilities.filter(
                      (capability) => capability !== "remote-file-delete",
                    );
                    updateProfile({
                      capabilities: event.target.checked
                        ? [...capabilities, "remote-file-delete"]
                        : capabilities,
                    });
                  }}
                />
                <span>
                  <strong>원격 파일 삭제 지원</strong>
                  <small>
                    프로젝트 삭제 시 제공자의 파일 삭제 API를 호출할 수
                    있습니다.
                  </small>
                </span>
              </label>
            </div>

            <p className="settings-security">
              API 키는 이 장치의 보안 저장소에만 저장되며 로그에 출력하지
              않습니다. PDF 입력 지원 여부는 호환 endpoint 이름만으로
              추정하지 않습니다.
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
            onClick={() => onSave(normalizeLlmSettings(draft))}
          >
            <Save size={15} />
            저장
          </button>
        </footer>
      </section>
    </div>
  );
}
