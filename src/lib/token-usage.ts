import type { LlmTokenUsage, LlmUsageByPhase } from "../types";

export const EMPTY_TOKEN_USAGE: LlmTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimated: false,
};

export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const character of text) {
    if (character.charCodeAt(0) <= 0x7f) ascii += 1;
    else wide += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4 + wide / 1.7));
}

export function estimatedTokenUsage(
  input: string,
  output: string,
): LlmTokenUsage {
  const inputTokens = estimateTextTokens(input);
  const outputTokens = estimateTextTokens(output);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true,
  };
}

export function addTokenUsage(
  ...usages: Array<LlmTokenUsage | undefined>
): LlmTokenUsage {
  const present = usages.filter(
    (usage): usage is LlmTokenUsage => Boolean(usage),
  );
  return {
    inputTokens: present.reduce(
      (total, usage) => total + usage.inputTokens,
      0,
    ),
    outputTokens: present.reduce(
      (total, usage) => total + usage.outputTokens,
      0,
    ),
    totalTokens: present.reduce(
      (total, usage) => total + usage.totalTokens,
      0,
    ),
    estimated: present.some((usage) => usage.estimated),
  };
}

export function usageByPhase(
  structure: LlmTokenUsage = EMPTY_TOKEN_USAGE,
  translation: LlmTokenUsage = EMPTY_TOKEN_USAGE,
): LlmUsageByPhase {
  return {
    structure,
    translation,
    total: addTokenUsage(structure, translation),
  };
}
