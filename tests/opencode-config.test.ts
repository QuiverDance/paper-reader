import { describe, expect, it } from "vitest";
import { importOpenCodeConfig } from "../src/lib/opencode-config";

const sample = `
default_model = "glm-5.2-nvfp4"
default_permission_mode = "yolo"
telemetry = false

[providers.openai]
type = "openai"
base_url = "https://llm.example.com/v1"
api_key = "secret-value"

[models."glm-5.2-nvfp4"]
provider = "openai"
model = "nvidia/GLM-5.2-NVFP4"
max_context_size = 262144
capabilities = ["tool_use", "thinking"]
default_effort = "max"
support_efforts = ["low", "high", "max"]
`;

describe("OpenCode config import", () => {
  it("resolves the default model alias through its provider", () => {
    expect(importOpenCodeConfig(sample)).toEqual({
      connectionMode: "api",
      endpoint: "https://llm.example.com/v1",
      apiKey: "secret-value",
      model: "nvidia/GLM-5.2-NVFP4",
      providerName: "openai",
      modelAlias: "glm-5.2-nvfp4",
      maxContextSize: 262144,
      effort: "max",
      capabilities: ["tool_use", "thinking"],
    });
  });

  it("allows providers that do not require an API key", () => {
    expect(
      importOpenCodeConfig(`
        default_model = "local"
        [providers.local]
        type = "openai"
        base_url = "http://127.0.0.1:8000/v1"
        [models.local]
        provider = "local"
        model = "local-model"
      `),
    ).toMatchObject({
      endpoint: "http://127.0.0.1:8000/v1",
      apiKey: "",
      model: "local-model",
    });
  });

  it("reports a missing model section", () => {
    expect(() =>
      importOpenCodeConfig(`
        default_model = "missing"
        [providers.openai]
        type = "openai"
        base_url = "https://example.com/v1"
      `),
    ).toThrow('models."missing"');
  });
});
