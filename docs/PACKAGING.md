# 打包发布说明

## 常用命令

- `make help`: 查看统一的开发、测试和 macOS arm64 打包入口。
- `make install`: 编译、签名并安装 macOS arm64 应用到 `/Applications/Git UI Pro.app`；默认使用钥匙串中的第一个 codesigning identity，也可通过 `MAC_SIGN_IDENTITY` 指定。
- `make install-deps`: 按 `package-lock.json` 安装项目依赖。
- `npm run release:win`: 启动本地发布控制台，在浏览器中完成版本更新、Windows 打包、版本提交、tag 和 GitHub/Gitee 双远端推送。
- `npm run icons`: 生成 `build/icon.ico`、`build/icon.png` 和 Linux PNG 图标集。
- `npm run dist:dir`: 生成未安装目录包到 `release/win-unpacked`，用于快速验证打包内容。
- `npm run dist:win`: 生成未签名 Windows NSIS 安装包和 Portable 便携版到 `release/`。
- `npm run dist:linux`: 生成 Linux AppImage 和 deb 包到 `release/`。
- `npm run dist:mac`: 仅生成 macOS arm64 dmg 和 zip 包到 `release/`，必须在 arm64 macOS 环境执行。
- `make macos-arm64`: 在隔离临时目录构建、校验并 smoke-test 正式 macOS arm64 包，保留输出路径供后续安装验证。
- `npm run dist:win:signed`: 生成签名 Windows 包，需先配置代码签名证书环境变量。

常规正式打包产物输出到 `release/`。需要做架构和内容隔离验证时，按 macOS arm64 小节使用系统临时目录，避免把历史文件混入校验；不要使用 `release-*` 作为临时目录。

## 本地发布控制台

执行以下命令后，脚本会监听随机的本机回环端口并自动打开浏览器：

```bash
npm run release:win
```

控制台会读取 `package.json` 当前版本和本地 `v*` tag 历史，并根据两者中的最高稳定版本推荐补丁、次版本和主版本号。确认发布后依次执行：

1. 检查当前分支、Git 身份、进行中的 Git 操作、目标 tag 和双远端分支状态。
2. 使用 `npm version --no-git-tag-version` 同步更新 `package.json` 与 `package-lock.json`。
3. 执行 `npm run dist:win -- --publish never`，确认 `release/` 中已生成对应版本的 NSIS 安装包、blockmap、Portable 和 `latest.yml`。
4. 按项目提交规范提交当前全部改动，创建带说明的 `v*` tag。
5. 分别向 Gitee 和 GitHub 原子推送当前分支与 tag。GitHub 收到 tag 后会触发 Actions，并独立创建 GitHub Release。
6. 若在控制台启用“GitHub 正式版完成后自动启动本地镜像同步”，GitHub Release 就绪后会启动单独的 Gitee 国内镜像任务；镜像失败不会改变正式版发布结果。

发布控制台默认识别指向 `gitee.com` 的现有远端。若尚未配置 GitHub 远端，会使用 `package.json` 的 `repository.url` 添加名为 `github` 的远端。HTTPS Git 远端需要提前通过 Git Credential Manager 配置凭据。

Gitee 国内镜像使用单独的私人令牌。可以在发布控制台中临时输入，也可以在启动控制台前设置 `GITEE_TOKEN`；令牌只保留在本机发布进程内，不写入仓库、浏览器存储或安装包。控制台读取 GitHub 正式附件时复用 Git 配置中的 GitHub 代理，而 Gitee API 和大文件上传保持国内直连。

发布前必须显式勾选确认项。构建失败且尚未暂存时，脚本会恢复两个版本文件；本地提交或 tag 已生成后不会自动回滚，远端推送失败时可在当前页面重试。Gitee 镜像可按任意已有稳定标签单独执行“同步 / 修复”，不需要重新发布版本。

Windows 安装包使用辅助安装向导，默认按当前用户安装，并允许用户选择安装目录；Portable 可以直接运行，不创建快捷方式、卸载项或系统级安装记录。

Windows 正式版同时发布 NSIS x64 安装版和 Portable x64 便携版。发布控制台会校验下面四项产物全部存在，任一缺失都会停止提交和推送：

- `Git-UI-Pro-Setup-<version>-x64.exe`: NSIS 正式版安装包。
- `Git-UI-Pro-Setup-<version>-x64.exe.blockmap`: 增量下载索引。
- `Git-UI-Pro-Portable-<version>-x64.exe`: 无需安装的 Windows x64 便携版。
- `latest.yml`: electron-updater 更新元数据；文件名固定，不包含版本号。

## Windows 应用内更新

应用内更新同时支持 Windows x64 NSIS 安装版和 Portable 便携版。开发环境、网页预览和其他操作系统不检查 Windows 在线更新源。

Windows 正式版启动后会静默检查 Gitee 国内更新源，Gitee 不可用或镜像尚未同步完整时自动回退到 GitHub。发现比当前版本更高的稳定版时，左上角显示更新入口。用户打开更新面板后手动开始下载，应用不会在后台自动下载。安装版下载完成后，正常关闭应用会静默安装，用户下次启动时直接进入新版本；也可以点击“重启并完成更新”，立即退出、静默安装并自动启动新版本，整个过程不再显示 NSIS 安装向导。

首次启用时需要先发布并手动安装一个包含双更新源逻辑的基线版本。更早、尚未集成该更新器的旧版本不会自动切换到国内源；从基线版本开始，后续 Gitee 或 GitHub Release 均可完成应用内升级。

GitHub Release 必须同时上传同一版本的 NSIS `.exe`、对应 `.exe.blockmap`、Portable `.exe` 和 `latest.yml`。Gitee Release 除这四项外还会上传 `update-manifest.json`，清单分别记录安装版与 Portable 的文件名、大小和 SHA-256。镜像缺项或摘要不匹配时，客户端不会下载可疑资产，而会尝试 GitHub 备用源。为避免 Gitee 仓库累计 1GB 的附件配额阻断发布，本地镜像同步只保留最近 3 个正式版本的受管下载附件；更早版本的 Release 页面、标签和说明继续保留，完整历史附件仍可从 GitHub 获取。

安装版继续通过 electron-updater 和 blockmap 完成差分下载，差分条件不满足时回退到完整安装包。Portable 使用独立下载与替换流程：更新包流式写入当前 Portable 所在磁盘，严格校验大小和 SHA-256，用户确认后由独立 PowerShell 辅助进程等待应用及外层启动器退出，再替换 Portable 可执行文件并启动新版本。新版本窗口成功加载并写入健康标记后才删除上一版本；若 90 秒内未通过健康检查，则自动恢复旧文件并重新启动。

Portable 默认把项目列表、分组、偏好设置、终端历史和更新状态保存在程序旁边的 `Git-UI-Pro-Data` 目录，与安装版数据隔离。目录不可写时会回退到 `%APPDATA%/Git UI Pro Portable` 并显示中文提示。托管平台令牌继续使用 Windows `safeStorage` 加密；把 Portable 移动到其他电脑或 Windows 账号后，无法解密的令牌需要重新授权，不会以明文方式迁移。

发布后应至少在一台未开启代理的 Windows x64 设备上分别验证安装版与 Portable 的检查、下载、退出更新、重启和版本号，并使用两个连续正式版本验证 Portable 的文件替换及配置保留。

安装向导会在开始安装前显示桌面快捷方式选项，默认勾选“创建桌面快捷方式”，用户可以取消。

打包后的 Windows 应用会保留 `contextIsolation` 并关闭 renderer sandbox，以规避部分自定义安装目录下 Electron renderer 子进程启动失败导致的黑屏问题。

## Windows 签名

默认配置保留图标和版本资源编辑，但将 `win.signExecutable` 设为 `false`，方便本地生成未签名包。

正式发布前使用 `npm run dist:win:signed`，并按 electron-builder 约定提供证书：

- `CSC_LINK` 或 `WIN_CSC_LINK`: `.pfx` 文件路径、base64 内容或证书链接。
- `CSC_KEY_PASSWORD` 或 `WIN_CSC_KEY_PASSWORD`: 证书密码。

签名配置位于 `package.json` 的 `build.win.signtoolOptions`，当前使用 SHA-256 和 DigiCert RFC 3161 时间戳服务器。

未签名构建不会写入伪造的 `publisherName`，避免应用内更新把未签名安装包误判为发行商不匹配；使用真实证书执行签名构建时，electron-builder 会从证书自动生成发行商信息并启用签名校验。

## 原生模块

项目依赖 `@homebridge/node-pty-prebuilt-multiarch`。打包配置关闭 `npmRebuild`，使用 postinstall 已安装的 Electron ABI 预编译产物，并通过 `asarUnpack` 解包：

- `build/Release/**/*.node`
- `build/Release/*.dll`
- `build/Release/*.exe`
- `prebuilds/**/*`
- `third_party/**/*`

这样 packaged app 的终端功能可以从 `app.asar.unpacked` 读取 node-pty 原生文件。

## Electron runtime

`build.electronDist` 指向 `node_modules/electron/dist`，打包时复用本地已安装的 Electron runtime，避免发布验证阶段重复从 GitHub 下载 Electron。

所有 `dist*` 脚本会先执行 `npm run ensure:electron`，校验 Electron 的版本文件、`path.txt` 和当前平台可执行文件。如果 npm 包存在但 runtime 下载不完整，会自动重新运行 `node_modules/electron/install.js`；发布控制台也会在修改版本号前完成同一项预检，避免构建到打包阶段才失败。

首次生成 NSIS 安装包时，electron-builder 仍可能需要下载 NSIS 工具链并缓存到本机；缓存完成后后续构建会复用。

## GitHub Actions 多平台构建

项目已提供 `.github/workflows/build-installers.yml`，支持手动构建和 tag 构建：

- 手动构建：GitHub 仓库页面进入 `Actions` -> `Build Installers` -> `Run workflow`。
- tag 构建：推送 `v*` 格式 tag，例如 `v0.1.0`。

主发布工作流会分别在以下环境执行：

- `windows-latest`: `npm run dist:win`
- `ubuntu-latest`: `npm run dist:linux`

每个系统都会独立执行 `npm ci`，避免复用其它系统的 `node_modules`，这对 `node-pty` 这类原生依赖很重要。

构建产物会作为 GitHub Actions artifacts 上传，名称分别是：

- `git-ui-pro-windows-x64`
- `git-ui-pro-linux-x64`

Actions 只上传安装包、Portable、必要的 blockmap 和 Windows `latest.yml`，不上传 `win-unpacked`、`linux-unpacked` 等解包目录，避免 Release 阶段上传过多文件触发 GitHub secondary rate limit。

当工作流由 `v*` 格式 tag 触发时，会在 Windows 和 Linux 构建完成后自动创建 GitHub Release，并把安装包和 Portable 上传到该 Release。主工作流到此即视为正式发布完成，不再从 GitHub Actions 直接向 Gitee 上传大文件。

Gitee 国内镜像由本地发布控制台执行。控制台会先从 GitHub Release 读取权威附件清单：本地产物或缓存与 GitHub 的大小、SHA-256 一致时直接复用，否则通过本机 GitHub 代理下载到系统临时缓存。随后从本机国内网络依次上传安装包、blockmap、Portable、`latest.yml`，最后上传 `update-manifest.json`。

上传过程中会显示总进度、当前文件和逐文件状态，并支持安全取消。单文件上传总时限为 25 分钟，连续 2 分钟没有传输进度会终止；文件全部发送后，Gitee 服务器必须在 3 分钟内返回结果。失败后重新执行会先校验 Gitee 已有附件的文件大小，完整附件直接跳过，避免再次上传整个文件。只有五项附件均存在且大小一致时才会把镜像标记为就绪。

如果 GitHub Release 已发布，但 Gitee 页面缺少自定义附件，在本地运行 `npm run release:win`，在“Gitee 国内镜像”中填写已有标签和令牌并点击“同步 / 修复”即可，无需重新创建 tag。GitHub 仓库中的 `Repair Gitee Release Mirror` 仍作为无人值守的备用修复入口；只有使用该备用工作流时才需要在 Actions Secrets 中配置 `GITEE_TOKEN`。

尚未包含双更新源逻辑的 v0.1.25 及更早客户端仍只会访问 GitHub，无法通过服务端配置让旧程序自动改用 Gitee。需要开启代理完成一次升级，或在 Gitee 附件修复后手动下载并覆盖安装基线版本；从包含双更新源逻辑的版本开始，后续检查会优先直连 Gitee。

### macOS arm64 构建

macOS 构建拆分到 `.github/workflows/build-macos-installer.yml`，使用 `macos-14` arm64 runner，并在构建前校验 Node 运行时架构。需要时进入 `Actions` -> `Build macOS Installer` -> `Run workflow` 手动触发。该工作流只上传 `git-ui-pro-macos-arm64` artifacts；生成后可手动上传到对应 GitHub Release。

`npm run dist:mac` 与 macOS 配置只包含 arm64 的 DMG 和 ZIP，不生成 x64 产物。由于 `build.electronDist` 复用本地 Electron runtime，跨架构构建不受支持；如果在其他机器执行，必须确认本机和目标架构均为 arm64。

正式构建前先执行 `npm run verify:macos`，确认当前机器、Node 和 Electron runtime 均为 arm64。需要把构建结果与历史 `release/` 隔离时，可使用下面的完整命令块：

```bash
set -euo pipefail
MACOS_OUTPUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/git-ui-pro-macos-arm64.XXXXXX")"
npm run verify:macos
npm run dist:mac -- --config.directories.output="$MACOS_OUTPUT_DIR" --publish never
node scripts/verify-macos-arm64-artifacts.mjs "$MACOS_OUTPUT_DIR"
node scripts/smoke-macos-interface.mjs "$MACOS_OUTPUT_DIR/mac-arm64/Git UI Pro.app"
```

如果依赖下载受到网络限制，可在执行上述命令块前设置 `https_proxy`、`http_proxy` 和 `all_proxy`。产物校验脚本会动态读取当前版本，并且只接受一个 arm64 DMG、一个 arm64 ZIP 和一个 `mac-arm64/Git UI Pro.app`；它还会检查 ZIP/DMG 完整性、主程序和 `app.asar.unpacked` 下原生 `.node` 文件的 Mach-O arm64 架构，不会扫描或引用旧的 `release/` 文件。

`smoke-macos-interface.mjs` 只在 macOS 上运行，会启动传入的精确 `.app`，验证原生交通灯、系统菜单、侧栏/控制台命令、主题和偏好页，并把浅色/深色截图写入临时目录。未配置 Developer ID 时，当前构建保持 `identity: null`，因此包未签名、未公证，不能据此宣称可直接通过 Gatekeeper；正式发布仍需在 macOS 发布环境补充签名和公证。

首次运行时，electron-builder 可能会下载对应系统的打包工具链，耗时会比本地构建更长。

## 远程仓库

Gitee 和 GitHub 远程仓库可以同时存在，不冲突。推荐保留 Gitee 为 `origin`，新增 GitHub 为 `github`：

```bash
git remote add github https://github.com/zjx150504-lgtm/Git_UI_Pro.git
git push github master
```

以后可以按需分别推送：

```bash
git push origin master
git push github master
```

正式发布版本时，同时推送 tag 到两个远程：

```bash
git push github v0.1.0
git push origin v0.1.0
```

GitHub 会通过 Actions 自动生成 Release；Gitee 安装包由本地发布控制台作为独立任务同步，避免 GitHub Actions 到 Gitee 的大文件链路阻塞正式发布。
