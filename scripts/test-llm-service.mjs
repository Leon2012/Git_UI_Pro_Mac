import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const {
  DEFAULT_REQUEST_TIMEOUT_MS,
  LlmService,
  buildCommitMessageContext,
  normalizeLlmBaseUrl,
  parseCommitMessageResponse
} = require("../dist-electron/llmService.js");
const { GitService, readUntrackedFileForLlm } = require("../dist-electron/gitService.js");

function fakeCrypto(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

test("LLM 默认请求超时为 15 秒", () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 15_000);
});

test("LLM Base URL permits HTTPS and private HTTP while rejecting public plaintext endpoints", () => {
  assert.deepEqual(normalizeLlmBaseUrl("https://api.example.com/v1/"), {
    baseUrl: "https://api.example.com/v1",
    endpoint: "https://api.example.com/v1/chat/completions",
    insecurePrivateHttp: false
  });
  assert.equal(normalizeLlmBaseUrl("http://localhost:11434/v1").insecurePrivateHttp, true);
  assert.equal(normalizeLlmBaseUrl("http://127.0.0.1:1234/v1").insecurePrivateHttp, true);
  assert.equal(normalizeLlmBaseUrl("http://10.0.3.8/v1").insecurePrivateHttp, true);
  assert.equal(normalizeLlmBaseUrl("http://172.16.4.2/v1").insecurePrivateHttp, true);
  assert.equal(normalizeLlmBaseUrl("http://172.31.255.254/v1").insecurePrivateHttp, true);
  assert.equal(normalizeLlmBaseUrl("http://192.168.0.113:7890/v1").insecurePrivateHttp, true);

  assert.throws(() => normalizeLlmBaseUrl("http://8.8.8.8/v1"), /公网.*HTTPS/);
  assert.throws(() => normalizeLlmBaseUrl("http://172.32.0.1/v1"), /公网.*HTTPS/);
  assert.throws(() => normalizeLlmBaseUrl("ftp://192.168.0.2/v1"), /HTTP/);
  assert.throws(() => normalizeLlmBaseUrl("https://user:password@example.com/v1"), /用户名或密码/);
});

test("commit message parser accepts one English Conventional Commit title and strips wrappers", () => {
  assert.equal(parseCommitMessageResponse("feat(branches): add branch context actions"), "feat(branches): add branch context actions");
  assert.equal(parseCommitMessageResponse("```text\nfix: handle empty repository\n```"), "fix: handle empty repository");
  assert.equal(parseCommitMessageResponse('"docs(readme): clarify setup steps"'), "docs(readme): clarify setup steps");
  assert.equal(parseCommitMessageResponse("Commit message: feat(ui): add branch rail"), "feat(ui): add branch rail");
  assert.equal(parseCommitMessageResponse("Conventional Commit: fix(llm): redact json credentials"), "fix(llm): redact json credentials");

  assert.throws(() => parseCommitMessageResponse("这是一个提交标题"), /Conventional Commit/);
  assert.throws(() => parseCommitMessageResponse("feat: add branch rail\nThis also updates styles."), /单行/);
  assert.throws(() => parseCommitMessageResponse("Here is the message: feat: add branch rail"), /Conventional Commit/);
});

test("secure LLM settings preserve a configured key when the update leaves it blank", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const service = new LlmService(directory, { credentialCrypto: fakeCrypto() });

  const first = await service.saveSettings({
    baseUrl: "http://192.168.0.113:11434/v1",
    model: "gpt-4.1-mini",
    apiKey: "secret-one"
  });
  assert.deepEqual(first, {
    baseUrl: "http://192.168.0.113:11434/v1",
    model: "gpt-4.1-mini",
    apiKeyConfigured: true,
    insecurePrivateHttp: true
  });

  const second = await service.saveSettings({
    baseUrl: "https://llm.example.com/v1",
    model: "gpt-4.1",
    apiKey: ""
  });
  assert.equal(second.apiKeyConfigured, true);
  assert.equal(await service.getApiKeyForRequest(), "secret-one");

  const persisted = JSON.parse(await readFile(path.join(directory, "llm-settings.secure.json"), "utf8"));
  assert.equal(persisted.baseUrl, "https://llm.example.com/v1");
  assert.equal(persisted.model, "gpt-4.1");
  assert.notEqual(persisted.encryptedApiKey, "secret-one");
});

test("secure LLM settings clear credentials only through the explicit clear action", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const service = new LlmService(directory, { credentialCrypto: fakeCrypto() });
  await service.saveSettings({ baseUrl: "https://api.example.com/v1", model: "gpt-4.1", apiKey: "secret-two" });

  assert.equal(await service.clearApiKey(), true);
  assert.equal((await service.getSettings()).apiKeyConfigured, false);
  await assert.rejects(() => service.getApiKeyForRequest(), /API Key/);
  assert.equal(await service.clearApiKey(), false);
});

test("secure LLM settings reject API keys when OS encryption is unavailable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const service = new LlmService(directory, { credentialCrypto: fakeCrypto(false) });

  await assert.rejects(
    () => service.saveSettings({ baseUrl: "https://api.example.com/v1", model: "gpt-4.1", apiKey: "secret" }),
    /无法提供凭据加密/
  );
});

test("commit context uses staged changes when any staged file exists and redacts secrets", () => {
  const context = buildCommitMessageContext({
    worktree: {
      stagedFiles: [{ path: "src/staged.ts", status: "modified", staged: true }],
      unstagedFiles: [{ path: "src/working.ts", status: "modified", staged: false }]
    },
    stagedPatch: [
      "diff --git a/src/staged.ts b/src/staged.ts",
      "+Authorization: Bearer live-token",
      "+api_key=top-secret",
      "+\"apiKey\": \"json-secret\"",
      "+\"Authorization\": \"Bearer json-token\""
    ].join("\n"),
    unstagedPatch: "diff --git a/src/working.ts b/src/working.ts\n+working tree only",
    untrackedFiles: []
  });

  assert.equal(context.scope, "staged");
  assert.match(context.content, /src\/staged\.ts/);
  assert.doesNotMatch(context.content, /working tree only/);
  assert.doesNotMatch(context.content, /live-token|top-secret|json-secret|json-token/);
  assert.match(context.content, /\[REDACTED\]/);
  assert.equal(context.truncated, false);
});

test("commit context uses unstaged patch and safe untracked text when nothing is staged", () => {
  const context = buildCommitMessageContext({
    worktree: {
      stagedFiles: [],
      unstagedFiles: [
        { path: "src/working.ts", status: "modified", staged: false },
        { path: "notes.txt", status: "untracked", staged: false }
      ]
    },
    stagedPatch: "",
    unstagedPatch: "diff --git a/src/working.ts b/src/working.ts\n+working tree only",
    untrackedFiles: [{ path: "notes.txt", kind: "text", content: "new file contents" }]
  });

  assert.equal(context.scope, "working-tree");
  assert.match(context.content, /working tree only/);
  assert.match(context.content, /notes\.txt/);
  assert.match(context.content, /new file contents/);
});

test("remote commit context refuses to omit unsafe untracked file content silently", async () => {
  const service = new GitService();
  service.getWorktree = async () => ({
    stagedFiles: [],
    unstagedFiles: [{ path: "new-feature.ts", status: "untracked", staged: false }],
    conflictedFiles: []
  });
  service.run = async () => ({ ok: true, command: "git diff", stdout: "", stderr: "", exitCode: 0 });

  await assert.rejects(() => service.getCommitMessageContext({
    path: "/srv/repository",
    remote: { type: "ssh", host: "git.example.com", connectionEnabled: true }
  }), /远程项目.*未跟踪文件.*暂存/);
});

test("commit context truncates by UTF-8 bytes and records the truncation", () => {
  const context = buildCommitMessageContext({
    worktree: {
      stagedFiles: [{ path: "large.txt", status: "modified", staged: true }],
      unstagedFiles: []
    },
    stagedPatch: `diff --git a/large.txt b/large.txt\n+${"内容".repeat(200)}`,
    unstagedPatch: "",
    untrackedFiles: [],
    maxBytes: 240
  });

  assert.equal(context.truncated, true);
  assert.ok(Buffer.byteLength(context.content, "utf8") <= 240);
  assert.match(context.content, /TRUNCATED/);
});

test("untracked context reader never follows symbolic links outside the repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-context-"));
  const outsideFile = path.join(path.dirname(directory), `outside-${path.basename(directory)}.txt`);
  await writeFile(outsideFile, "outside-secret-content", "utf8");
  await symlink(outsideFile, path.join(directory, "linked-secret.txt"));
  await writeFile(path.join(directory, "ordinary.txt"), "ordinary text", "utf8");

  const linked = await readUntrackedFileForLlm(directory, "linked-secret.txt");
  const ordinary = await readUntrackedFileForLlm(directory, "ordinary.txt");
  assert.equal(linked.kind, "symlink");
  assert.doesNotMatch(linked.content, /outside-secret-content/);
  assert.doesNotMatch(linked.content, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(ordinary, { path: "ordinary.txt", kind: "text", content: "ordinary text" });
});

test("connection test uses unsaved form values without persisting them", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const calls = [];
  const service = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
      return jsonResponse({ choices: [{ message: { content: "OK" } }] });
    }
  });
  await service.saveSettings({ baseUrl: "https://saved.example.com/v1", model: "saved-model", apiKey: "saved-key" });

  const result = await service.testConnection({
    baseUrl: "http://192.168.0.113:11434/v1",
    model: "draft-model",
    apiKey: "draft-key"
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "http://192.168.0.113:11434/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer draft-key");
  assert.equal(calls[0].body.model, "draft-model");
  assert.deepEqual(await service.getSettings(), {
    baseUrl: "https://saved.example.com/v1",
    model: "saved-model",
    apiKeyConfigured: true,
    insecurePrivateHttp: false
  });
});

test("LLM connection retries transient connect timeouts and reports the safe error code when exhausted", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const connectTimeout = () => Object.assign(new TypeError("fetch failed"), {
    cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
  });
  let recoveredAttempts = 0;
  const recovered = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    fetchImpl: async () => {
      recoveredAttempts += 1;
      if (recoveredAttempts < 3) throw connectTimeout();
      return jsonResponse({ choices: [{ message: { content: "OK" } }] });
    }
  });

  const result = await recovered.testConnection({
    baseUrl: "https://api.example.com/v1",
    model: "model",
    apiKey: "draft-key"
  });
  assert.equal(result.ok, true);
  assert.equal(recoveredAttempts, 3);

  let exhaustedAttempts = 0;
  const exhausted = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    fetchImpl: async () => {
      exhaustedAttempts += 1;
      throw connectTimeout();
    }
  });
  await assert.rejects(
    () => exhausted.testConnection({ baseUrl: "https://api.example.com/v1", model: "model", apiKey: "draft-key" }),
    /UND_ERR_CONNECT_TIMEOUT.*3 次/
  );
  assert.equal(exhaustedAttempts, 3);
});

test("commit generation sends OpenAI Chat Completions and validates the returned title", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  let request;
  const service = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    fetchImpl: async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(String(init.body)) };
      return jsonResponse({ choices: [{ message: { content: "feat(llm): generate commit titles" } }] });
    }
  });
  await service.saveSettings({ baseUrl: "https://api.example.com/v1", model: "commit-model", apiKey: "stored-key" });

  const context = { scope: "staged", content: "Commit scope: staged\nPatch:\n+change", truncated: false, fileCount: 1 };
  const result = await service.generateCommitMessage(context);
  assert.deepEqual(result, { message: "feat(llm): generate commit titles", scope: "staged", truncated: false, fileCount: 1 });
  assert.equal(request.url, "https://api.example.com/v1/chat/completions");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer stored-key");
  assert.equal(request.body.model, "commit-model");
  assert.equal(request.body.stream, false);
  assert.match(request.body.messages[0].content, /Conventional Commit/);
  assert.equal(request.body.messages[1].content, context.content);
});

test("LLM request errors are bounded and never include credentials or response bodies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const unauthorized = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    fetchImpl: async () => new Response("stored-key leaked by provider", { status: 401 })
  });
  await unauthorized.saveSettings({ baseUrl: "https://api.example.com/v1", model: "model", apiKey: "stored-key" });
  await assert.rejects(
    () => unauthorized.generateCommitMessage({ scope: "staged", content: "diff-secret", truncated: false, fileCount: 1 }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /stored-key|diff-secret|leaked by provider/);
      return true;
    }
  );

  const malformed = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    fetchImpl: async () => jsonResponse({ choices: [] })
  });
  await assert.rejects(
    () => malformed.generateCommitMessage({ scope: "staged", content: "patch", truncated: false, fileCount: 1 }),
    /没有返回有效消息/
  );

  const oversized = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    maxResponseBytes: 32,
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "feat: this response is intentionally too large" } }] })
  });
  await assert.rejects(
    () => oversized.generateCommitMessage({ scope: "staged", content: "patch", truncated: false, fileCount: 1 }),
    /响应体过大/
  );
});

test("LLM requests abort after the configured timeout", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-llm-"));
  const service = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    timeoutMs: 10,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  });
  await service.saveSettings({ baseUrl: "https://api.example.com/v1", model: "model", apiKey: "key" });

  await assert.rejects(
    () => service.generateCommitMessage({ scope: "staged", content: "patch", truncated: false, fileCount: 1 }),
    /45 秒|超时/
  );

  const stalledBody = new LlmService(directory, {
    credentialCrypto: fakeCrypto(),
    timeoutMs: 10,
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        this.timer = setTimeout(() => {
          controller.enqueue(new TextEncoder().encode('{"choices":['));
          controller.close();
        }, 80);
      },
      cancel() {
        clearTimeout(this.timer);
      }
    }), { status: 200 })
  });
  await assert.rejects(
    () => stalledBody.generateCommitMessage({ scope: "staged", content: "patch", truncated: false, fileCount: 1 }),
    /超时/
  );
});

test("Electron bridge exposes the complete LLM IPC surface and builds context in the main process", async () => {
  const [mainSource, preloadSource] = await Promise.all([
    readFile(new URL("../electron/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../electron/preload.ts", import.meta.url), "utf8")
  ]);
  for (const channel of [
    "llm:getSettings",
    "llm:saveSettings",
    "llm:clearApiKey",
    "llm:testConnection",
    "llm:generateCommitMessage"
  ]) {
    assert.match(mainSource, new RegExp(`ipcMain\\.handle\\(\\\"${channel.replace(":", "\\:")}\\\"`));
    assert.match(preloadSource, new RegExp(`ipcRenderer\\.invoke\\(\\\"${channel.replace(":", "\\:")}\\\"`));
  }
  assert.match(mainSource, /gitService\.getCommitMessageContext\(repositoryPath\)/);
  assert.match(mainSource, /llmService\.generateCommitMessage\(context\)/);
});

test("merge into current branch keeps HEAD on the current branch and merges the selected source", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "git-ui-pro-branch-merge-"));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Git UI Pro Test");
  git("config", "user.email", "git-ui-pro@example.test");
  await writeFile(path.join(directory, "base.txt"), "base\n", "utf8");
  git("add", "base.txt");
  git("commit", "-m", "chore: initial commit");
  git("switch", "-c", "feature/rail");
  await writeFile(path.join(directory, "branch.txt"), "branch\n", "utf8");
  git("add", "branch.txt");
  git("commit", "-m", "feat: add branch file");
  git("switch", "main");

  const result = await new GitService().mergeIntoCurrentBranch(directory, "feature/rail", "ff");
  assert.equal(result.ok, true, result.messageZh || result.stderr);
  assert.equal(git("branch", "--show-current"), "main");
  assert.equal(await readFile(path.join(directory, "branch.txt"), "utf8"), "branch\n");
});
