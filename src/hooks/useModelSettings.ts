import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeModelProfile,
  applyModelProfile,
  completeChat,
  deleteQuestionPdf,
  listCodexModels,
  type CodexModelOption,
} from "../lib/llm";
import {
  loadLlmSettings,
  saveLlmSettings,
  saveRetypesetProject,
} from "../lib/storage";
import type {
  LlmSettings,
  ModelConnectionProfile,
  ReaderDocument,
  RetypesetProject,
} from "../types";

type UseModelSettingsOptions = {
  settings: LlmSettings | null;
  onSettingsChange: (settings: LlmSettings) => void;
  document: ReaderDocument | null;
  onDocumentChange: (document: ReaderDocument) => Promise<void>;
  project: RetypesetProject | null;
  onProjectChange: (project: RetypesetProject) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
};

export function useModelSettings({
  settings,
  onSettingsChange,
  document,
  onDocumentChange,
  project,
  onProjectChange,
  onError,
  onNotice,
}: UseModelSettingsOptions) {
  const [codexModels, setCodexModels] = useState<CodexModelOption[]>([]);
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void loadLlmSettings()
      .then(onSettingsChange)
      .catch((cause: unknown) => {
        onError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [onError, onSettingsChange]);

  const activeProfile = settings ? activeModelProfile(settings) : null;
  useEffect(() => {
    if (activeProfile?.connectionMode !== "codex") {
      setCodexModels([]);
      return;
    }
    let cancelled = false;
    void listCodexModels()
      .then((models) => {
        if (!cancelled) setCodexModels(models);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          onNotice(
            cause instanceof Error
              ? cause.message
              : "Codex 모델 목록을 읽지 못했습니다.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfile?.connectionMode, onNotice]);

  const models = useMemo<CodexModelOption[]>(() => {
    if (!activeProfile || !settings) return [];
    if (activeProfile.connectionMode === "codex") {
      return codexModels.length
        ? codexModels
        : [
            {
              id: activeProfile.codexModel || "default",
              displayName:
                activeProfile.codexModel || "Codex 기본 모델",
              isDefault: true,
              defaultReasoningEffort: "default",
              supportedReasoningEfforts: ["default"],
            },
          ];
    }
    const seen = new Set<string>();
    return settings.profiles.flatMap((profile) => {
      const id = profile.model.trim();
      if (
        profile.connectionMode !== "api" ||
        profile.endpoint !== activeProfile.endpoint ||
        !id ||
        seen.has(id)
      ) {
        return [];
      }
      seen.add(id);
      return [
        {
          id,
          displayName: id,
          isDefault: profile.id === activeProfile.id,
          defaultReasoningEffort: profile.effort,
          supportedReasoningEfforts: [
            "default",
            "low",
            "medium",
            "high",
            "max",
          ],
        },
      ];
    });
  }, [activeProfile, codexModels, settings]);

  const activeModelId = activeProfile
    ? activeProfile.connectionMode === "codex"
      ? activeProfile.codexModel ||
        models.find((model) => model.isDefault)?.id ||
        models[0]?.id ||
        ""
      : activeProfile.model
    : "";
  const selectedModel = models.find((model) => model.id === activeModelId);
  const effortOptions: ModelConnectionProfile["effort"][] =
    selectedModel?.supportedReasoningEfforts.length
      ? selectedModel.supportedReasoningEfforts
      : ["default", "low", "medium", "high", "max"];

  const persistPaperModel = useCallback(
    async (nextSettings: LlmSettings) => {
      await saveLlmSettings(nextSettings);
      onSettingsChange(nextSettings);
      if (!document) return;
      await onDocumentChange({
        ...document,
        activeProfileId: nextSettings.activeProfileId,
        reasoningEffort: nextSettings.effort,
      });
    },
    [document, onDocumentChange, onSettingsChange],
  );

  const selectModel = useCallback(
    async (modelId: string) => {
      if (!settings) return;
      const profile = activeModelProfile(settings);
      const model = models.find((candidate) => candidate.id === modelId);
      const supported = model?.supportedReasoningEfforts ?? [];
      const effort = supported.includes(profile.effort)
        ? profile.effort
        : model?.defaultReasoningEffort ?? profile.effort;
      const nextProfile = {
        ...profile,
        model: profile.connectionMode === "api" ? modelId : profile.model,
        codexModel:
          profile.connectionMode === "codex" ? modelId : profile.codexModel,
        effort,
      };
      await persistPaperModel(
        applyModelProfile(
          {
            ...settings,
            profiles: settings.profiles.map((candidate) =>
              candidate.id === nextProfile.id ? nextProfile : candidate,
            ),
          },
          nextProfile,
        ),
      );
    },
    [models, persistPaperModel, settings],
  );

  const selectEffort = useCallback(
    async (effort: ModelConnectionProfile["effort"]) => {
      if (!settings) return;
      const profile = activeModelProfile(settings);
      const nextProfile = { ...profile, effort };
      await persistPaperModel(
        applyModelProfile(
          {
            ...settings,
            profiles: settings.profiles.map((candidate) =>
              candidate.id === nextProfile.id ? nextProfile : candidate,
            ),
          },
          nextProfile,
        ),
      );
    },
    [persistPaperModel, settings],
  );

  const save = useCallback(
    async (next: LlmSettings) => {
      const koreanOnly = { ...next, targetLanguage: "ko" };
      if (settings && project?.nativePdfFileIds) {
        const retainedIds = new Set(
          koreanOnly.profiles.map((profile) => profile.id),
        );
        const removedProfiles = settings.profiles.filter(
          (profile) => !retainedIds.has(profile.id),
        );
        const nextFileIds = { ...project.nativePdfFileIds };
        for (const profile of removedProfiles) {
          const profileSettings = applyModelProfile(settings, profile);
          for (const [signature, fileId] of Object.entries(nextFileIds)) {
            if (!signature.startsWith(`${profile.id}|`)) continue;
            try {
              await deleteQuestionPdf(profileSettings, fileId);
            } catch {
              onNotice(
                `${profile.name}의 원격 PDF 삭제를 확인하지 못했습니다.`,
              );
            }
            delete nextFileIds[signature];
          }
        }
        if (
          Object.keys(nextFileIds).length !==
          Object.keys(project.nativePdfFileIds).length
        ) {
          const nextProject = {
            ...project,
            nativePdfFileIds: nextFileIds,
            updatedAt: new Date().toISOString(),
          };
          await saveRetypesetProject(nextProject);
          onProjectChange(nextProject);
        }
      }
      await persistPaperModel(koreanOnly);
      setOpen(false);
      onNotice("모델 연결 설정을 저장했습니다.");
    },
    [
      onNotice,
      onProjectChange,
      persistPaperModel,
      project,
      settings,
    ],
  );

  const test = useCallback(
    async (draft: LlmSettings) => {
      setTesting(true);
      onError(null);
      try {
        await completeChat(draft, [
          { role: "user", content: "Reply with exactly OK." },
        ]);
        onNotice("모델 연결에 성공했습니다.");
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setTesting(false);
      }
    },
    [onError, onNotice],
  );

  return {
    activeProfile,
    models,
    activeModelId,
    effortOptions,
    open,
    testing,
    setOpen,
    selectModel,
    selectEffort,
    save,
    test,
  };
}
