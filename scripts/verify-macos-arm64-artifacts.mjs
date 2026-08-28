import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

export async function verifyMacArm64Artifacts(outputDir, options = {}) {
  const resolvedOutputDir = path.resolve(outputDir ?? "");
  assert.ok(outputDir, "必须传入 electron-builder 的独立 output 目录。");
  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const version = String(packageJson.version);
  const productName = String(packageJson.build?.productName ?? packageJson.name);
  const entries = await readdir(resolvedOutputDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name);

  const dmgNames = names.filter((name) => name.endsWith("-mac-arm64.dmg"));
  const zipNames = names.filter((name) => name.endsWith("-mac-arm64.zip"));
  assert.deepEqual(dmgNames, [`${artifactPrefix(productName, version)}-mac-arm64.dmg`], "必须恰好生成一个 macOS arm64 DMG。");
  assert.deepEqual(zipNames, [`${artifactPrefix(productName, version)}-mac-arm64.zip`], "必须恰好生成一个 macOS arm64 ZIP。");
  assert.equal(names.some((name) => /mac-(?:x64|universal)|-(?:x64|universal)\.(?:dmg|zip)$/i.test(name)), false, "macOS arm64 output 不得包含 x64 或 universal 产物。");

  const architectureDirectories = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("mac-"));
  assert.deepEqual(architectureDirectories.map((entry) => entry.name), ["mac-arm64"], "output 目录只能包含 mac-arm64 架构目录。");

  const appPath = path.join(resolvedOutputDir, "mac-arm64", `${productName}.app`);
  const appStat = await stat(appPath);
  assert.equal(appStat.isDirectory(), true, `缺少 ${appPath}`);
  const executablePath = path.join(appPath, "Contents", "MacOS", productName);
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const asarPath = path.join(resourcesPath, "app.asar");
  const unpackedPath = path.join(resourcesPath, "app.asar.unpacked");
  await stat(executablePath);
  await stat(asarPath);
  await stat(unpackedPath);

  await assertArm64MachO(executablePath, options);
  const nativeFiles = await findFiles(unpackedPath, (name) => name.endsWith(".node"));
  assert.ok(nativeFiles.length > 0, "app.asar.unpacked 中至少应包含一个原生 .node 模块。");
  for (const nativeFile of nativeFiles) {
    await assertArm64MachO(nativeFile, options);
  }

  await verifyZip(path.join(resolvedOutputDir, zipNames[0]), productName, options);
  await verifyDmg(path.join(resolvedOutputDir, dmgNames[0]), options);

  return {
    outputDir: resolvedOutputDir,
    version,
    productName,
    dmg: path.join(resolvedOutputDir, dmgNames[0]),
    zip: path.join(resolvedOutputDir, zipNames[0]),
    app: appPath,
    nativeFiles
  };
}

function artifactPrefix(productName, version) {
  return `${productName.replace(/[^A-Za-z0-9._-]+/g, "-")}-${version}`;
}

async function assertArm64MachO(filePath, options) {
  const fileInfo = await runCommand("file", [filePath], options);
  assert.match(fileInfo, /Mach-O/i, `${filePath} 不是 Mach-O 文件：${fileInfo}`);
  assert.match(fileInfo, /arm64/i, `${filePath} 不是 arm64 架构：${fileInfo}`);
  assert.doesNotMatch(fileInfo, /x86_64|i386|universal/i, `${filePath} 不能是 x64 或 universal 架构：${fileInfo}`);

  const lipoInfo = await runCommand("lipo", ["-info", filePath], options);
  assert.match(lipoInfo, /arm64/i, `${filePath} 的 lipo 信息未包含 arm64：${lipoInfo}`);
  assert.doesNotMatch(lipoInfo, /x86_64|i386|universal/i, `${filePath} 的 lipo 信息包含非 arm64 架构：${lipoInfo}`);
}

async function verifyZip(zipPath, productName, options) {
  const zipInfo = await runCommand("file", [zipPath], options);
  assert.match(zipInfo, /Zip archive data/i, `${zipPath} 不是有效 ZIP：${zipInfo}`);
  await runCommand("unzip", ["-t", zipPath], options);
  const listing = await runCommand("unzip", ["-Z1", zipPath], options);
  assert.match(listing, new RegExp(`${escapeRegExp(productName)}\\.app/Contents/MacOS/`), "ZIP 中缺少应用主程序。");
  assert.doesNotMatch(listing, /mac-(?:x64|universal)|(?:x64|universal)\.(?:dmg|zip)/i, "ZIP 中包含非 arm64 产物路径。");
}

async function verifyDmg(dmgPath, options) {
  const dmgInfo = await runCommand("file", [dmgPath], options);
  assert.match(dmgInfo, /Disk Image|UDIF|zlib compressed data/i, `${dmgPath} 不是有效 DMG：${dmgInfo}`);
  await runCommand("hdiutil", ["verify", dmgPath], options);
}

async function runCommand(command, args, options) {
  if (options.runner) {
    return options.runner(command, args);
  }
  try {
    const result = await execFile(command, args, { cwd: rootDir, maxBuffer: 1024 * 1024 * 16 });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} ${args.join(" ")} 执行失败：${detail}`);
  }
}

async function findFiles(directory, predicate) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await findFiles(entryPath, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      result.push(entryPath);
    }
  }
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const result = await verifyMacArm64Artifacts(process.argv[2]);
    console.log(`[macos-artifacts] 已验证 ${result.dmg}`);
    console.log(`[macos-artifacts] 已验证 ${result.zip}`);
    console.log(`[macos-artifacts] 已验证 ${result.app}`);
    console.log(`[macos-artifacts] 原生模块 ${result.nativeFiles.length} 个，全部为 arm64`);
  } catch (error) {
    console.error(`[macos-artifacts] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
