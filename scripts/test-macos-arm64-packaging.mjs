import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { verifyMacArm64Environment } from "./verify-macos-arm64-environment.mjs";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
const macWorkflow = await readFile(
  path.join(rootDir, ".github", "workflows", "build-macos-installer.yml"),
  "utf8",
);
const makefile = await readFile(path.join(rootDir, "Makefile"), "utf8");

test("macOS package targets arm64 only", () => {
  assert.deepEqual(packageJson.build.mac.target, [
    { target: "dmg", arch: ["arm64"] },
    { target: "zip", arch: ["arm64"] },
  ]);
  assert.match(packageJson.scripts["dist:mac"], /npm run verify:macos\b/);
  assert.match(packageJson.scripts["dist:mac"], /electron-builder --mac --arm64\b/);
  assert.doesNotMatch(packageJson.scripts["dist:mac"], /--x64\b/);
});

test("macOS workflow is labeled and uploaded as arm64", () => {
  assert.match(macWorkflow, /name: Build macOS arm64/);
  assert.match(macWorkflow, /runs-on: macos-14/);
  assert.match(macWorkflow, /run: npm run verify:macos/);
  assert.match(macWorkflow, /name: git-ui-pro-macos-arm64/);
  assert.match(macWorkflow, /npm run dist:mac -- --publish never/);
});

test("local macOS install builds only the unpacked app", () => {
  const installTarget = makefile.match(/^install:\n([\s\S]*?)\n\ndev:/m)?.[1];
  assert.ok(installTarget, "Makefile 必须包含 install 目标");
  assert.match(installTarget, /\$\(NPM\) run dist:mac -- --dir\b/);
});

test("local macOS install does not require a timestamp server", () => {
  const installTarget = makefile.match(/^install:\n([\s\S]*?)\n\ndev:/m)?.[1];
  assert.ok(installTarget, "Makefile 必须包含 install 目标");
  assert.match(installTarget, /--config\.mac\.timestamp=none\b/);
});

test("macOS build guard rejects non-arm64 hosts", () => {
  assert.doesNotThrow(() => verifyMacArm64Environment({ platform: "darwin", arch: "arm64" }));
  assert.throws(
    () => verifyMacArm64Environment({ platform: "darwin", arch: "x64" }),
    /必须在 arm64 主机上执行/,
  );
  assert.throws(
    () => verifyMacArm64Environment({ platform: "linux", arch: "arm64" }),
    /必须在 macOS 上执行/,
  );
});
