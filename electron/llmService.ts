import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LlmSettingsSummary {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  insecurePrivateHttp: boolean;
}

export interface LlmSettingsUpdate {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface LlmConnectionTestInput {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface LlmConnectionTestResult {
  ok: true;
  model: string;
}

export interface LlmCommitMessageResult {
  message: string;
  scope: CommitMessageContext["scope"];
  truncated: boolean;
  fileCount: number;
}

export interface CommitMessageContextFile {
  path: string;
  kind: "text" | "binary" | "symlink" | "other";
  content: string;
}

export interface CommitMessageContext {
  scope: "staged" | "working-tree";
  content: string;
  truncated: boolean;
  fileCount: number;
}

export interface CommitMessageContextInput {
  worktree: {
    stagedFiles: Array<{ path: string; status: string; staged: boolean }>;
    unstagedFiles: Array<{ path: string; status: string; staged: boolean }>;
  };
  stagedPatch: string;
  unstagedPatch: string;
  untrackedFiles: CommitMessageContextFile[];
  maxBytes?: number;
}

export type LlmDiagnosticEvent =
  | "context_build_started"
  | "context_build_succeeded"
  | "context_build_failed"
  | "request_started"
  | "attempt_started"
  | "attempt_failed"
  | "response_headers_received"
  | "response_body_read"
  | "request_succeeded"
  | "request_failed"
  | "request_timed_out";

export type LlmDiagnosticDetails = Record<string, string | number | boolean | null | undefined>;

export interface LlmDiagnosticLogger {
  log(event: LlmDiagnosticEvent, details?: LlmDiagnosticDetails): void;
  flush(): Promise<void>;
}

export interface CredentialCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface LlmStoreDocument {
  version: 1;
  baseUrl: string;
  model: string;
  encryptedApiKey?: string;
}

interface LlmServiceOptions {
  credentialCrypto?: CredentialCrypto;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  diagnosticLogger?: Pick<LlmDiagnosticLogger, "log">;
}

interface NormalizedLlmUrl {
  baseUrl: string;
  endpoint: string;
  insecurePrivateHttp: boolean;
}

const emptyStore: LlmStoreDocument = {
  version: 1,
  baseUrl: "",
  model: ""
};

const DEFAULT_CONTEXT_MAX_BYTES = 64 * 1024;
const TRUNCATION_MARKER = "\n\n[CONTEXT TRUNCATED]";
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RESPONSE_MAX_BYTES = 256 * 1024;
const MAX_CONNECT_ATTEMPTS = 3;
const RETRYABLE_CONNECT_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH"
]);
const COMMIT_SYSTEM_PROMPT = [
  "Generate exactly one Conventional Commit title for the supplied Git changes.",
  "Use the form type(scope): subject or type: subject, keeping type and optional scope in lowercase English.",
  "Write the subject as a concise Simplified Chinese phrase containing at least one Chinese character.",
  "Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.",
  "Return only the title, with no Markdown, quotes, body, explanation, or trailing period."
].join(" ");

const noopDiagnosticLogger: Pick<LlmDiagnosticLogger, "log"> = {
  log: () => undefined
};

export function createLlmDiagnosticLogger(userDataPath: string): LlmDiagnosticLogger {
  const logPath = path.join(userDataPath, "logs", "llm-diagnostics.log");
  let writeQueue = Promise.resolve();
  return {
    log(event, details = {}) {
      const entry = {
        timestamp: new Date().toISOString(),
        event,
        ...details
      };
      const line = JSON.stringify(entry);
      console.info(`[llm-diagnostic] ${line}`);
      writeQueue = writeQueue
        .then(async () => {
          await mkdir(path.dirname(logPath), { recursive: true });
          await appendFile(logPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
        })
        .catch((error) => {
          console.warn("[llm-diagnostic] 无法写入诊断日志", error instanceof Error ? error.message : String(error));
        });
    },
    flush: () => writeQueue
  };
}

const electronCredentialCrypto: CredentialCrypto = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value)
};

export class LlmService {
  private readonly storePath: string;
  private readonly credentialCrypto: CredentialCrypto;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly diagnosticLogger: Pick<LlmDiagnosticLogger, "log">;

  constructor(userDataPath: string, options: LlmServiceOptions = {}) {
    this.storePath = path.join(userDataPath, "llm-settings.secure.json");
    this.credentialCrypto = options.credentialCrypto ?? electronCredentialCrypto;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_RESPONSE_MAX_BYTES;
    this.diagnosticLogger = options.diagnosticLogger ?? noopDiagnosticLogger;
  }

  async getSettings(): Promise<LlmSettingsSummary> {
    return publicSettings(await this.loadStore());
  }

  async saveSettings(input: LlmSettingsUpdate): Promise<LlmSettingsSummary> {
    const normalizedUrl = normalizeLlmBaseUrl(input.baseUrl);
    const model = requireModel(input.model);
    const current = await this.loadStore();
    const apiKey = input.apiKey?.trim();
    let encryptedApiKey = current.encryptedApiKey;

    if (apiKey) {
      if (!this.credentialCrypto.isEncryptionAvailable()) {
        throw new Error("当前系统无法提供凭据加密，已拒绝保存 API Key。");
      }
      encryptedApiKey = this.credentialCrypto.encryptString(apiKey).toString("base64");
    }

    const next: LlmStoreDocument = {
      version: 1,
      baseUrl: normalizedUrl.baseUrl,
      model,
      ...(encryptedApiKey ? { encryptedApiKey } : {})
    };
    await this.persistStore(next);
    return publicSettings(next);
  }

  async clearApiKey(): Promise<boolean> {
    const current = await this.loadStore();
    if (!current.encryptedApiKey) {
      return false;
    }

    const { encryptedApiKey: _removed, ...next } = current;
    await this.persistStore(next);
    return true;
  }

  async getApiKeyForRequest(): Promise<string> {
    const store = await this.loadStore();
    if (!store.encryptedApiKey) {
      throw new Error("尚未配置 LLM API Key。");
    }
    if (!this.credentialCrypto.isEncryptionAvailable()) {
      throw new Error("当前系统无法提供凭据解密，不能读取 LLM API Key。");
    }

    try {
      return this.credentialCrypto.decryptString(Buffer.from(store.encryptedApiKey, "base64"));
    } catch {
      throw new Error("LLM API Key 无法解密，请清除后重新配置。");
    }
  }

  async testConnection(input: LlmConnectionTestInput): Promise<LlmConnectionTestResult> {
    const normalizedUrl = normalizeLlmBaseUrl(input.baseUrl);
    const model = requireModel(input.model);
    const apiKey = input.apiKey?.trim() || await this.getApiKeyForRequest();
    await this.requestChatCompletion(normalizedUrl.endpoint, model, apiKey, [
      { role: "user", content: "Reply with OK." }
    ], {
      requestId: randomUUID(),
      operation: "connection_test"
    });
    return { ok: true, model };
  }

  async generateCommitMessage(context: CommitMessageContext, requestId = randomUUID()): Promise<LlmCommitMessageResult> {
    const settings = await this.loadStore();
    const normalizedUrl = normalizeLlmBaseUrl(settings.baseUrl);
    const model = requireModel(settings.model);
    const apiKey = await this.getApiKeyForRequest();
    const content = await this.requestChatCompletion(normalizedUrl.endpoint, model, apiKey, [
      { role: "system", content: COMMIT_SYSTEM_PROMPT },
      { role: "user", content: context.content }
    ], {
      requestId,
      operation: "commit_message",
      contextBytes: Buffer.byteLength(context.content, "utf8"),
      contextFiles: context.fileCount,
      contextScope: context.scope,
      contextTruncated: context.truncated
    });
    return {
      message: parseCommitMessageResponse(content),
      scope: context.scope,
      truncated: context.truncated,
      fileCount: context.fileCount
    };
  }

  private async requestChatCompletion(
    endpoint: string,
    model: string,
    apiKey: string,
    messages: Array<{ role: "system" | "user"; content: string }>,
    diagnostic: {
      requestId: string;
      operation: "connection_test" | "commit_message";
      contextBytes?: number;
      contextFiles?: number;
      contextScope?: CommitMessageContext["scope"];
      contextTruncated?: boolean;
    }
  ): Promise<string> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestBody = JSON.stringify({
      model,
      messages,
      temperature: 0,
      stream: false
    });
    let stage = "preparing_request";
    let attemptCount = 0;
    let response: Response | undefined;
    this.diagnosticLogger.log("request_started", {
      requestId: diagnostic.requestId,
      operation: diagnostic.operation,
      endpoint: diagnosticEndpoint(endpoint),
      model,
      timeoutMs: this.timeoutMs,
      requestBytes: Buffer.byteLength(requestBody, "utf8"),
      contextBytes: diagnostic.contextBytes,
      contextFiles: diagnostic.contextFiles,
      contextScope: diagnostic.contextScope,
      contextTruncated: diagnostic.contextTruncated,
      elapsedMs: 0
    });
    try {
      while (!response && attemptCount < MAX_CONNECT_ATTEMPTS) {
        attemptCount += 1;
        const attemptStartedAt = Date.now();
        stage = "awaiting_response_headers";
        this.diagnosticLogger.log("attempt_started", {
          requestId: diagnostic.requestId,
          attempt: attemptCount,
          elapsedMs: Date.now() - startedAt
        });
        try {
          response = await this.fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`
            },
            body: requestBody,
            signal: controller.signal
          });
          this.diagnosticLogger.log("response_headers_received", {
            requestId: diagnostic.requestId,
            attempt: attemptCount,
            status: response.status,
            attemptElapsedMs: Date.now() - attemptStartedAt,
            elapsedMs: Date.now() - startedAt,
            contentLength: safeContentLength(response.headers.get("content-length"))
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw requestTimeoutError(this.timeoutMs);
          }
          const errorCode = networkErrorCode(error);
          this.diagnosticLogger.log("attempt_failed", {
            requestId: diagnostic.requestId,
            attempt: attemptCount,
            stage,
            errorCode: errorCode ?? "UNKNOWN",
            elapsedMs: Date.now() - startedAt
          });
          if (errorCode && RETRYABLE_CONNECT_ERROR_CODES.has(errorCode) && attemptCount < MAX_CONNECT_ATTEMPTS) {
            continue;
          }
          throw llmConnectionError(errorCode, attemptCount);
        }
      }
      if (!response) {
        throw llmConnectionError(undefined, attemptCount);
      }

      if (!response.ok) {
        stage = "validating_response_status";
        throw new Error(`LLM 服务返回 HTTP ${response.status}，请检查 API Key、Model 和服务配置。`);
      }
      stage = "reading_response_body";
      const { payload, responseBytes } = await this.readBoundedJson(response, controller.signal);
      this.diagnosticLogger.log("response_body_read", {
        requestId: diagnostic.requestId,
        attempt: attemptCount,
        responseBytes,
        elapsedMs: Date.now() - startedAt
      });
      stage = "validating_response_body";
      const content = payload && typeof payload === "object"
        ? (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
        : undefined;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("LLM 服务没有返回有效消息，请确认其兼容 Chat Completions 接口。");
      }
      this.diagnosticLogger.log("request_succeeded", {
        requestId: diagnostic.requestId,
        attempt: attemptCount,
        elapsedMs: Date.now() - startedAt
      });
      return content;
    } catch (error) {
      if (controller.signal.aborted) {
        this.diagnosticLogger.log("request_timed_out", {
          requestId: diagnostic.requestId,
          attempt: attemptCount,
          stage,
          elapsedMs: Date.now() - startedAt,
          timeoutMs: this.timeoutMs
        });
        throw requestTimeoutError(this.timeoutMs);
      }
      this.diagnosticLogger.log("request_failed", {
        requestId: diagnostic.requestId,
        attempt: attemptCount,
        stage,
        status: response?.status,
        errorCode: networkErrorCode(error) ?? "UNKNOWN",
        errorName: error instanceof Error ? error.name : typeof error,
        elapsedMs: Date.now() - startedAt
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readBoundedJson(response: Response, signal: AbortSignal): Promise<{ payload: unknown; responseBytes: number }> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("LLM 服务返回了空响应。");
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let rejectAborted: ((reason?: unknown) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    const abortHandler = () => {
      void reader.cancel();
      rejectAborted?.(new Error("LLM request aborted"));
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > this.maxResponseBytes) {
          await reader.cancel();
          throw new Error("LLM 服务响应体过大，已停止读取。");
        }
        chunks.push(value);
      }
    } finally {
      signal.removeEventListener("abort", abortHandler);
      reader.releaseLock();
    }

    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    try {
      return { payload: JSON.parse(body), responseBytes: totalBytes };
    } catch {
      throw new Error("LLM 服务返回的 JSON 格式不正确。");
    }
  }

  private async loadStore(): Promise<LlmStoreDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.storePath, "utf8")) as Partial<LlmStoreDocument>;
      if (parsed.version !== 1 || typeof parsed.baseUrl !== "string" || typeof parsed.model !== "string") {
        throw new Error("LLM 配置文件格式不正确。");
      }
      if (parsed.encryptedApiKey !== undefined && typeof parsed.encryptedApiKey !== "string") {
        throw new Error("LLM 凭据格式不正确。");
      }
      return {
        version: 1,
        baseUrl: parsed.baseUrl,
        model: parsed.model,
        ...(parsed.encryptedApiKey ? { encryptedApiKey: parsed.encryptedApiKey } : {})
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return { ...emptyStore };
      }
      throw error;
    }
  }

  private async persistStore(store: LlmStoreDocument): Promise<void> {
    const directory = path.dirname(this.storePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.llm-settings.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.storePath);
  }
}

function requestTimeoutError(timeoutMs: number): Error {
  return new Error(`LLM 请求超时（${Math.ceil(timeoutMs / 1000)} 秒），请检查服务地址和网络连接。`);
}

function llmConnectionError(errorCode: string | undefined, attempts: number): Error {
  const detail = errorCode ? `${errorCode}，已尝试 ${attempts} 次` : `网络连接失败，已尝试 ${attempts} 次`;
  return new Error(`无法连接 LLM 服务（${detail}），请检查 Base URL、网络和代理设置。`);
}

function networkErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[A-Z0-9_]{2,64}$/.test(candidate.code)) {
      return candidate.code;
    }
    current = candidate.cause;
  }
  return undefined;
}

function diagnosticEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

function safeContentLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function normalizeLlmBaseUrl(value: string): NormalizedLlmUrl {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("LLM Base URL 不能为空。");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("LLM Base URL 格式不正确。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("LLM Base URL 只支持 HTTP 或 HTTPS。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("LLM Base URL 不能包含用户名或密码。");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("LLM Base URL 不能包含查询参数或片段。");
  }

  const insecurePrivateHttp = parsed.protocol === "http:";
  if (insecurePrivateHttp && !isPrivateHttpHost(parsed.hostname)) {
    throw new Error("公网 LLM 地址必须使用 HTTPS；HTTP 仅允许本机或 RFC1918 私网地址。");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "";
  const baseUrl = parsed.toString().replace(/\/$/, "");
  return {
    baseUrl,
    endpoint: `${baseUrl}/chat/completions`,
    insecurePrivateHttp
  };
}

export function parseCommitMessageResponse(value: string): string {
  let normalized = value.trim();
  const codeFence = normalized.match(/^```(?:text|txt|markdown)?\s*\n([\s\S]*?)\n```$/i);
  if (codeFence) {
    normalized = codeFence[1].trim();
  }
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/^(?:commit message|conventional commit|suggested commit message|commit title)\s*:\s*/i, "");
  if (/\r|\n/.test(normalized)) {
    throw new Error("LLM 必须返回单行提交标题。");
  }
  const match = normalized.match(/^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: (.+)$/u);
  if (!match || /[\u0000-\u001f\u007f]/u.test(match[1])) {
    throw new Error("LLM 返回值不是有效的 Conventional Commit 标题。");
  }
  if (!/\p{Script=Han}/u.test(match[1])) {
    throw new Error("LLM 返回的提交标题摘要必须包含中文。");
  }
  return normalized;
}

export function buildCommitMessageContext(input: CommitMessageContextInput): CommitMessageContext {
  const staged = input.worktree.stagedFiles.length > 0;
  const selectedFiles = staged ? input.worktree.stagedFiles : input.worktree.unstagedFiles;
  const scope: CommitMessageContext["scope"] = staged ? "staged" : "working-tree";
  const sections = [
    `Commit scope: ${scope}`,
    "Changed files:",
    ...selectedFiles.map((file) => `- ${file.status}: ${sanitizeRepositoryPath(file.path)}`)
  ];
  const patch = staged ? input.stagedPatch : input.unstagedPatch;
  if (patch.trim()) {
    sections.push("", "Patch:", patch.trim());
  }
  if (!staged && input.untrackedFiles.length > 0) {
    sections.push("", "Untracked files:");
    for (const file of input.untrackedFiles) {
      sections.push(`--- ${file.kind}: ${sanitizeRepositoryPath(file.path)} ---`, file.content);
    }
  }

  const redacted = redactSensitiveText(sections.join("\n"));
  const maxBytes = Math.max(Buffer.byteLength(TRUNCATION_MARKER, "utf8") + 1, input.maxBytes ?? DEFAULT_CONTEXT_MAX_BYTES);
  const truncated = Buffer.byteLength(redacted, "utf8") > maxBytes;
  return {
    scope,
    content: truncated ? truncateUtf8(redacted, maxBytes) : redacted,
    truncated,
    fileCount: selectedFiles.length
  };
}

export function redactSensitiveText(value: string): string {
  const credentialKey = String.raw`(?:authorization|api[_-]?key|apiKey|access[_-]?token|accessToken|auth[_-]?token|authToken|password|passwd|secret|token)`;
  return value
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(new RegExp(`((?:["']?)${credentialKey}(?:["']?)\\s*[:=]\\s*)(["'])([^\\r\\n]*?)\\2`, "gi"), "$1$2[REDACTED]$2")
    .replace(/(authorization\s*:\s*(?:bearer\s+|basic\s+)?)[^\s\r\n]+/gi, "$1[REDACTED]")
    .replace(new RegExp(`((?:["']?)${credentialKey}(?:["']?)\\s*[:=]\\s*)[^\\s,;\\r\\n]+`, "gi"), "$1[REDACTED]");
}

function publicSettings(store: LlmStoreDocument): LlmSettingsSummary {
  return {
    baseUrl: store.baseUrl,
    model: store.model,
    apiKeyConfigured: Boolean(store.encryptedApiKey),
    insecurePrivateHttp: store.baseUrl.startsWith("http://")
  };
}

function requireModel(value: string): string {
  const model = value.trim();
  if (!model) {
    throw new Error("LLM Model 不能为空。");
  }
  if (/\r|\n|[\u0000-\u001f\u007f]/.test(model)) {
    throw new Error("LLM Model 包含不允许的控制字符。");
  }
  return model;
}

function sanitizeRepositoryPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/(?:^|\/)\.\.(?=\/|$)/g, "[parent]");
}

function truncateUtf8(value: string, maxBytes: number): string {
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const availableBytes = Math.max(0, maxBytes - markerBytes);
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= availableBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${value.slice(0, low)}${TRUNCATION_MARKER}`;
}

function isPrivateHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") {
    return true;
  }
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return octets[0] === 127
    || octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
