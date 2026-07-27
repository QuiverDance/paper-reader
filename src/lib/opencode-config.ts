import type { LlmSettings } from "../types";

type TomlSection =
  | { kind: "root" }
  | { kind: "provider"; name: string }
  | { kind: "model"; name: string }
  | { kind: "other" };

type ProviderConfig = {
  type?: string;
  baseUrl?: string;
  apiKey?: string;
};

type ModelConfig = {
  provider?: string;
  model?: string;
};

export type OpenCodeImport = Pick<
  LlmSettings,
  "connectionMode" | "endpoint" | "apiKey" | "model"
> & {
  providerName: string;
  modelAlias: string;
};

function stripInlineComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === "#" && !quote) return line.slice(0, index);
  }

  return line;
}

function parseTomlString(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new Error(`문자열 값을 읽지 못했습니다: ${value}`);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseSection(line: string): TomlSection {
  const provider = line.match(/^\[providers\.([A-Za-z0-9_-]+)\]$/);
  if (provider) return { kind: "provider", name: provider[1] };

  const model = line.match(
    /^\[models\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\]]+))\]$/,
  );
  if (model) {
    const rawName = model[1] ?? model[2] ?? model[3];
    return {
      kind: "model",
      name: model[1] ? parseTomlString(`"${rawName}"`) : rawName.trim(),
    };
  }

  return { kind: "other" };
}

export function importOpenCodeConfig(source: string): OpenCodeImport {
  let section: TomlSection = { kind: "root" };
  let defaultModel = "";
  const providers = new Map<string, ProviderConfig>();
  const models = new Map<string, ModelConfig>();

  for (const originalLine of source.split(/\r?\n/)) {
    const line = stripInlineComment(originalLine).trim();
    if (!line) continue;

    if (line.startsWith("[") && line.endsWith("]")) {
      section = parseSection(line);
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    const value = parseTomlString(rawValue);

    if (section.kind === "root" && key === "default_model") {
      defaultModel = value;
      continue;
    }

    if (section.kind === "provider") {
      const provider = providers.get(section.name) ?? {};
      if (key === "type") provider.type = value;
      if (key === "base_url") provider.baseUrl = value;
      if (key === "api_key") provider.apiKey = value;
      providers.set(section.name, provider);
      continue;
    }

    if (section.kind === "model") {
      const model = models.get(section.name) ?? {};
      if (key === "provider") model.provider = value;
      if (key === "model") model.model = value;
      models.set(section.name, model);
    }
  }

  if (!defaultModel) {
    throw new Error("default_model 값을 찾지 못했습니다.");
  }

  const modelConfig = models.get(defaultModel);
  if (!modelConfig) {
    throw new Error(`models."${defaultModel}" 설정을 찾지 못했습니다.`);
  }

  const providerName = modelConfig.provider || "openai";
  const provider = providers.get(providerName);
  if (!provider) {
    throw new Error(`providers.${providerName} 설정을 찾지 못했습니다.`);
  }
  if (provider.type && provider.type.toLowerCase() !== "openai") {
    throw new Error(
      `providers.${providerName}의 type은 현재 openai만 지원합니다.`,
    );
  }
  if (!provider.baseUrl) {
    throw new Error(`providers.${providerName}.base_url 값이 필요합니다.`);
  }
  if (!modelConfig.model) {
    throw new Error(`models."${defaultModel}".model 값이 필요합니다.`);
  }

  return {
    connectionMode: "api",
    endpoint: provider.baseUrl,
    apiKey: provider.apiKey ?? "",
    model: modelConfig.model,
    providerName,
    modelAlias: defaultModel,
  };
}
