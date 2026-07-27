import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type CodexMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CodexRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const ROUTE_PREFIX = "/__paperloom/codex";
const API_COMPLETION_ROUTE = "/__paperloom/llm/complete";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
) {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress ?? "";
  const loopback =
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1";
  if (!loopback) return false;

  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("요청 내용이 너무 큽니다.");
    chunks.push(buffer);
  }
  const source = Buffer.concat(chunks).toString("utf8");
  return source ? JSON.parse(source) : {};
}

function stopProcessTree(child: ChildProcessWithoutNullStreams) {
  if (!child.pid || child.killed) return;
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(child.pid), "/t", "/f"],
      { windowsHide: true, stdio: "ignore" },
    );
    killer.unref();
    return;
  }
  child.kill("SIGTERM");
}

function runCodex(
  codexEntry: string,
  args: string[],
  options: { cwd: string; input?: string; timeoutMs: number },
): Promise<CodexRunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [codexEntry, ...args], {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
        stopProcessTree(child);
        finish(() => rejectRun(new Error("Codex 응답이 너무 큽니다.")));
      }
      return next;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      finish(() => rejectRun(error));
    });
    child.on("close", (code) => {
      finish(() => resolveRun({ code, stdout, stderr }));
    });

    const timeout = setTimeout(() => {
      stopProcessTree(child);
      finish(() => rejectRun(new Error("Codex 응답 시간이 초과되었습니다.")));
    }, options.timeoutMs);

    child.stdin.end(options.input ?? "");
  });
}

function messagePrompt(messages: CodexMessage[]): string {
  return [
    "You are the language-model backend for Paperloom, a local PDF reader.",
    "Do not use tools, inspect files, run commands, or access the environment.",
    "Answer only from the conversation supplied below.",
    "Follow system-role messages as the highest-priority instructions.",
    "Return only the assistant response, with no preamble or commentary.",
    "",
    JSON.stringify({ conversation: messages }),
  ].join("\n");
}

function parseMessages(payload: unknown): {
  messages: CodexMessage[];
  model?: string;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Codex 요청 형식이 올바르지 않습니다.");
  }
  const candidate = payload as { messages?: unknown; model?: unknown };
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw new Error("Codex 요청에 대화 내용이 없습니다.");
  }
  if (candidate.messages.length > 100) {
    throw new Error("한 번에 보낼 수 있는 메시지 수를 초과했습니다.");
  }

  let totalCharacters = 0;
  const messages = candidate.messages.map((message) => {
    if (!message || typeof message !== "object") {
      throw new Error("Codex 메시지 형식이 올바르지 않습니다.");
    }
    const item = message as { role?: unknown; content?: unknown };
    if (
      item.role !== "system" &&
      item.role !== "user" &&
      item.role !== "assistant"
    ) {
      throw new Error("지원하지 않는 Codex 메시지 역할입니다.");
    }
    if (typeof item.content !== "string") {
      throw new Error("Codex 메시지 내용이 문자열이 아닙니다.");
    }
    totalCharacters += item.content.length;
    return {
      role: item.role as CodexMessage["role"],
      content: item.content,
    };
  });
  if (totalCharacters > 1_000_000) {
    throw new Error("한 번에 보낼 수 있는 문서 분량을 초과했습니다.");
  }

  const model =
    typeof candidate.model === "string" && candidate.model.trim()
      ? candidate.model.trim()
      : undefined;
  if (model && model.length > 120) {
    throw new Error("Codex 모델명이 너무 깁니다.");
  }
  return { messages, model };
}

function parseApiRequest(payload: unknown): {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: CodexMessage[];
} {
  const { messages } = parseMessages(payload);
  const candidate = payload as {
    endpoint?: unknown;
    apiKey?: unknown;
    model?: unknown;
  };
  if (typeof candidate.endpoint !== "string") {
    throw new Error("API endpoint가 필요합니다.");
  }
  if (typeof candidate.model !== "string" || !candidate.model.trim()) {
    throw new Error("API 모델명이 필요합니다.");
  }
  if (
    candidate.apiKey !== undefined &&
    typeof candidate.apiKey !== "string"
  ) {
    throw new Error("API key 형식이 올바르지 않습니다.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(candidate.endpoint);
  } catch {
    throw new Error("API endpoint가 올바른 URL이 아닙니다.");
  }
  const isSecure = endpoint.protocol === "https:";
  const isLoopback =
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "localhost" ||
      endpoint.hostname === "127.0.0.1" ||
      endpoint.hostname === "[::1]");
  if (!isSecure && !isLoopback) {
    throw new Error("API endpoint는 HTTPS 또는 로컬 HTTP 주소여야 합니다.");
  }

  return {
    endpoint: endpoint.toString(),
    apiKey: candidate.apiKey ?? "",
    model: candidate.model.trim(),
    messages,
  };
}

async function completeWithApi(payload: unknown): Promise<string> {
  const { endpoint, apiKey, model, messages } = parseApiRequest(payload);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  const responsePayload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(
      responsePayload?.error?.message || `LLM 요청 실패 (${response.status})`,
    );
  }
  const content = responsePayload?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("LLM 응답 내용이 비어 있습니다.");
  return content;
}

export function codexBridge(projectRoot = process.cwd()): Plugin {
  const codexEntry = resolve(
    projectRoot,
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  const workingDirectory = resolve(tmpdir(), "paperloom-codex");
  mkdirSync(workingDirectory, { recursive: true });

  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const path = request.url?.split("?")[0] ?? "";
    if (!path.startsWith(ROUTE_PREFIX) && path !== API_COMPLETION_ROUTE) {
      next();
      return;
    }
    if (!isLocalRequest(request)) {
      sendJson(response, 403, { error: "로컬 요청만 허용됩니다." });
      return;
    }
    if (request.method === "POST" && path === API_COMPLETION_ROUTE) {
      try {
        const content = await completeWithApi(await readJsonBody(request));
        sendJson(response, 200, { content });
      } catch (cause) {
        sendJson(response, 500, {
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
      return;
    }
    if (!existsSync(codexEntry)) {
      sendJson(response, 503, {
        available: false,
        authenticated: false,
        error: "Codex CLI가 설치되어 있지 않습니다. npm install을 실행해 주세요.",
      });
      return;
    }

    try {
      if (request.method === "GET" && path === `${ROUTE_PREFIX}/status`) {
        const result = await runCodex(codexEntry, ["login", "status"], {
          cwd: workingDirectory,
          timeoutMs: 15_000,
        });
        const message = (result.stdout || result.stderr).trim();
        sendJson(response, 200, {
          available: true,
          authenticated:
            result.code === 0 && /logged in|authenticated/i.test(message),
          message: message || "Codex 로그인 상태를 확인했습니다.",
        });
        return;
      }

      if (request.method === "POST" && path === `${ROUTE_PREFIX}/login`) {
        const result = await runCodex(codexEntry, ["login"], {
          cwd: workingDirectory,
          timeoutMs: 5 * 60_000,
        });
        if (result.code !== 0) {
          throw new Error(
            (result.stderr || result.stdout).trim() ||
              "Codex 로그인이 완료되지 않았습니다.",
          );
        }
        sendJson(response, 200, {
          available: true,
          authenticated: true,
          message: (result.stdout || "ChatGPT 로그인이 완료되었습니다.").trim(),
        });
        return;
      }

      if (request.method === "POST" && path === `${ROUTE_PREFIX}/complete`) {
        const { messages, model } = parseMessages(await readJsonBody(request));
        const args = [
          "exec",
          "--sandbox",
          "read-only",
          "--skip-git-repo-check",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--color",
          "never",
          "-C",
          workingDirectory,
        ];
        if (model) args.push("--model", model);
        args.push("-");

        const result = await runCodex(codexEntry, args, {
          cwd: workingDirectory,
          input: messagePrompt(messages),
          timeoutMs: 5 * 60_000,
        });
        if (result.code !== 0) {
          throw new Error(
            result.stderr.trim() ||
              result.stdout.trim() ||
              "Codex 요청이 실패했습니다.",
          );
        }
        const content = result.stdout.trim();
        if (!content) throw new Error("Codex 응답 내용이 비어 있습니다.");
        sendJson(response, 200, { content });
        return;
      }

      sendJson(response, 404, { error: "지원하지 않는 Codex 요청입니다." });
    } catch (cause) {
      sendJson(response, 500, {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  return {
    name: "paperloom-codex-bridge",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
