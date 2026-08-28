import path from "node:path";
import { fileURLToPath } from "node:url";

export function verifyMacArm64Environment({ platform = process.platform, arch = process.arch } = {}) {
  if (platform !== "darwin") {
    throw new Error("macOS arm64 构建必须在 macOS 上执行。");
  }
  if (arch !== "arm64") {
    throw new Error("macOS arm64 构建必须在 arm64 主机上执行。");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyMacArm64Environment();
    console.log("[macos-build] 已确认当前构建主机为 macOS arm64");
  } catch (error) {
    console.error(`[macos-build] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
