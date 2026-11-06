import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PREFIX = "[macos-identity]";
const LC_UUID = 0x1b;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_MAGIC_32 = 0xfeedface;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const scriptPath = fileURLToPath(import.meta.url);
const defaultRootDir = path.resolve(path.dirname(scriptPath), "..");
const defaultEntitlementsPath = path.join(defaultRootDir, "build", "entitlements.mac.plist");

function fail(message) {
  throw new Error(message);
}

function formatUuid(buffer, offset) {
  const hex = buffer.subarray(offset, offset + 16).toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuidToBytes(value) {
  const normalized = value.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/u.test(normalized)) {
    fail(`UUID 格式不正确：${value}`);
  }
  return Buffer.from(normalized, "hex");
}

function readThinUuids(buffer, sliceStart, sliceEnd, entries) {
  const magic = buffer.readUInt32LE(sliceStart);
  const is64 = magic === MH_MAGIC_64;
  if (!is64 && magic !== MH_MAGIC_32) {
    fail(`不支持的 Mach-O 魔数：0x${magic.toString(16)}`);
  }
  const commandCount = buffer.readUInt32LE(sliceStart + 16);
  let cursor = sliceStart + (is64 ? 32 : 28);
  for (let index = 0; index < commandCount; index += 1) {
    if (cursor + 8 > sliceEnd) {
      fail("Mach-O load command 越界。");
    }
    const command = buffer.readUInt32LE(cursor);
    const commandSize = buffer.readUInt32LE(cursor + 4);
    if (commandSize < 8) {
      fail("Mach-O load command 长度非法。");
    }
    if (command === LC_UUID) {
      entries.push({ offset: cursor + 8, uuid: formatUuid(buffer, cursor + 8) });
    }
    cursor += commandSize;
  }
}

// 通用二进制（universal）里的每个 slice 都要处理。
export function collectUuidEntries(buffer) {
  const entries = [];
  const magicBigEndian = buffer.readUInt32BE(0);
  if (magicBigEndian === FAT_MAGIC || magicBigEndian === FAT_MAGIC_64) {
    const isFat64 = magicBigEndian === FAT_MAGIC_64;
    const archCount = buffer.readUInt32BE(4);
    const archEntrySize = isFat64 ? 32 : 20;
    let cursor = 8;
    for (let index = 0; index < archCount; index += 1) {
      const sliceOffset = isFat64
        ? Number(buffer.readBigUInt64BE(cursor + 8))
        : buffer.readUInt32BE(cursor + 8);
      const sliceSize = isFat64
        ? Number(buffer.readBigUInt64BE(cursor + 16))
        : buffer.readUInt32BE(cursor + 12);
      readThinUuids(buffer, sliceOffset, Math.min(sliceOffset + sliceSize, buffer.length), entries);
      cursor += archEntrySize;
    }
    return entries;
  }
  readThinUuids(buffer, 0, buffer.length, entries);
  return entries;
}

export function patchUuid(buffer, nextUuid, entries = collectUuidEntries(buffer)) {
  const bytes = uuidToBytes(nextUuid);
  for (const entry of entries) {
    bytes.copy(buffer, entry.offset);
  }
  return entries.length;
}

function readBundleInfo(appPath) {
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  if (!existsSync(infoPlistPath)) {
    fail(`找不到 Info.plist：${infoPlistPath}`);
  }
  const raw = execFileSync("plutil", ["-convert", "json", "-o", "-", infoPlistPath], { encoding: "utf8" });
  const info = JSON.parse(raw);
  const executableName = info.CFBundleExecutable;
  if (typeof executableName !== "string" || !executableName) {
    fail("Info.plist 缺少 CFBundleExecutable。");
  }
  return {
    bundleId: typeof info.CFBundleIdentifier === "string" ? info.CFBundleIdentifier : path.basename(appPath, ".app"),
    executablePath: path.join(appPath, "Contents", "MacOS", executableName)
  };
}

export function resolveSigningIdentity(explicitIdentity) {
  if (explicitIdentity) {
    return explicitIdentity;
  }
  if (process.env.MAC_SIGN_IDENTITY) {
    return process.env.MAC_SIGN_IDENTITY;
  }
  try {
    const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = output.match(/"([^"]+)"/u);
    if (match) {
      return match[1];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseArgs(argv) {
  const options = {
    appPath: undefined,
    dryRun: false,
    entitlementsPath: defaultEntitlementsPath,
    identity: undefined,
    uuid: undefined
  };
  const queue = [...argv];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === "--dry-run") {
      options.dryRun = true;
    } else if (current === "--identity") {
      options.identity = queue.shift();
    } else if (current === "--entitlements") {
      options.entitlementsPath = path.resolve(queue.shift());
    } else if (current === "--uuid") {
      options.uuid = queue.shift();
    } else if (!current.startsWith("-") && !options.appPath) {
      options.appPath = current;
    } else {
      fail(`无法识别的参数：${current}`);
    }
  }
  if (!options.appPath) {
    fail("用法：node scripts/patch-macos-binary-uuid.mjs <AppPath> [--identity <name|->] [--uuid <UUID>] [--entitlements <plist>] [--dry-run]");
  }
  return options;
}

export function patchMacAppUuid(appPath, options = {}) {
  const info = readBundleInfo(appPath);
  if (!existsSync(info.executablePath)) {
    fail(`找不到主可执行文件：${info.executablePath}`);
  }
  const buffer = readFileSync(info.executablePath);
  const entries = collectUuidEntries(buffer);
  if (entries.length === 0) {
    fail(`主可执行文件没有 LC_UUID：${info.executablePath}`);
  }
  const previousUuids = entries.map((entry) => entry.uuid);
  const nextUuid = (options.uuid ?? randomUUID()).toUpperCase();
  const changed = previousUuids.some((uuid) => uuid !== nextUuid);
  if (changed && !options.dryRun) {
    patchUuid(buffer, nextUuid, entries);
    writeFileSync(info.executablePath, buffer);
  }
  return {
    appPath,
    bundleId: info.bundleId,
    changed,
    executablePath: info.executablePath,
    nextUuid,
    previousUuids
  };
}

export function signMacApp(appPath, options) {
  const { bundleId, entitlementsPath, identity } = options;
  if (!existsSync(entitlementsPath)) {
    fail(`找不到 entitlements 文件：${entitlementsPath}`);
  }
  execFileSync("codesign", [
    "--force",
    "--sign", identity,
    "--options", "runtime",
    "--entitlements", entitlementsPath,
    "--identifier", bundleId,
    appPath
  ], { stdio: "inherit" });
}

export function verifyMacApp(appPath) {
  execFileSync("codesign", ["--verify", "--strict", "--verbose=2", appPath], { stdio: "inherit" });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appPath = path.resolve(options.appPath);
  const identity = resolveSigningIdentity(options.identity);
  if (!identity) {
    fail("没有可用的签名身份；请设置 MAC_SIGN_IDENTITY 或传入 --identity（adhoc 可用 -）。");
  }
  console.log(`${LOG_PREFIX} app=${appPath}`);
  console.log(`${LOG_PREFIX} identity=${identity}`);
  console.log(`${LOG_PREFIX} entitlements=${options.entitlementsPath}`);
  const result = patchMacAppUuid(appPath, { dryRun: options.dryRun, uuid: options.uuid });
  console.log(`${LOG_PREFIX} bundleId=${result.bundleId}`);
  console.log(`${LOG_PREFIX} executable=${result.executablePath}`);
  console.log(`${LOG_PREFIX} uuid ${result.previousUuids.join(", ")} -> ${result.nextUuid}${result.changed ? "" : " (unchanged)"}`);
  if (options.dryRun) {
    console.log(`${LOG_PREFIX} dry-run: 未写入文件，未重新签名`);
    return;
  }
  signMacApp(appPath, { bundleId: result.bundleId, entitlementsPath: options.entitlementsPath, identity });
  verifyMacApp(appPath);
  console.log(`${LOG_PREFIX} signed and verified app=${appPath}`);
}

if (process.argv[1] === scriptPath) {
  try {
    main();
  } catch (error) {
    console.error(`${LOG_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
