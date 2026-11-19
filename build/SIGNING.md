# macOS 代码签名与公证（auto-update 必需）

macOS 的 Squirrel.Mac **拒绝更新未签名/未公证的 App**，所以要让自动更新在 mac 上生效，发版的安装包必须经过「Developer ID 签名 + 公证（notarize）」。本目录已备好骨架：

- `entitlements.mac.plist` — Hardened Runtime 所需 entitlements（JIT / 关闭库校验以加载 better-sqlite3·node-pty / 网络）。
- `package.json` 的 `build.mac` 已开启 `hardenedRuntime`、`gatekeeperAssess:false`，并引用上面的 entitlements；`notarize` 默认 `false`（避免无凭证时构建失败）。

## 启用步骤

1. **签名证书（Developer ID Application）**——二选一：
   - 证书已在本机钥匙串：electron-builder 会自动挑选；或用 `mac.identity` 指定。
   - CI / 无钥匙串：导出 `.p12`，设环境变量：
     ```bash
     export CSC_LINK=/abs/path/DeveloperIDApp.p12   # 或 base64
     export CSC_KEY_PASSWORD=********
     ```

2. **公证（notarytool）**——把 `package.json` 的 `build.mac.notarize` 改为：
   ```json
   "notarize": { "teamId": "YOURTEAMID" }
   ```
   并提供 Apple 凭证（二选一）：
   - App 专用密码：
     ```bash
     export APPLE_ID="you@example.com"
     export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
     export APPLE_TEAM_ID="YOURTEAMID"
     ```
   - App Store Connect API Key：
     ```bash
     export APPLE_API_KEY=/abs/AuthKey_XXXX.p8
     export APPLE_API_KEY_ID=XXXX
     export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
     ```

3. **发布**：
   推送版本标签即可。`.github/workflows/release.yml` 会在 macOS、Linux、Windows 上打包，并把安装包与 `latest*.yml` 上传到 [dennis9486/lucky-ai](https://github.com/dennis9486/lucky-ai/releases)。
   ```bash
   # package.json 的 version 必须与标签一致，例如 0.1.0 → v0.1.0
   git tag v0.1.0
   git push origin v0.1.0
   ```
   需要签名的 macOS 构建，把下面这些名字加到仓库 Actions secrets：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。没有这些 secret 时，macOS 包仍会上传，但是未签名，Squirrel.Mac 不会自动安装更新。Windows NSIS 与 Linux AppImage 不依赖该证书即可更新。

   本地手动发布：
   ```bash
   export GH_TOKEN=ghp_xxx          # 上传到 GitHub Release
   pnpm release                     # = pnpm build && electron-builder --publish always
   ```
   产物会包含 `*.dmg`、`*.zip` 与 `latest-mac.yml`（autoUpdater 据此更新；`zip` target 已配置，mac 自动更新必需）。

## 注意

- 每次发版先 bump `package.json` 的 `version`。
- Windows（nsis）、Linux（AppImage）开箱支持自动更新。
- 私有 GitHub 仓库：客户端拉更新需在 `autoUpdater.requestHeaders` 注入 token；公开仓库无需。
- 开发态（未打包）自动更新为 `disabled`，「设置 → 关于」会显示“开发环境不支持自动更新”。
