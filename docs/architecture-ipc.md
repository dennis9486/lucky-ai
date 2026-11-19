# IPC 契约

渲染进程只能通过 preload 桥（`window.luckyAI`）与主进程通信；通道名是字符串常量，类型系统抓不到改名/漏注册，因此契约由「常量单一来源 + 静态对账测试 + 运行期来源守卫」三层保证。

## 分层

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 通道常量 | [ipc-channels.ts](../src/shared/constants/ipc-channels.ts) | 全部通道的单一来源，按域分组：App / Workspace / Extensions / Formatter / File / Terminal / Agent(AgentScope) / Agent runtime / Settings / Sandbox / Memory / Chronicle / Scheduled tasks / Browser / Conversation / LSP / Window / Updater |
| preload 桥 | [preload/index.ts](../src/preload/index.ts) | 按域组织的 `api` 对象，`LuckyAIBridge = typeof api` 直接导出类型给渲染进程 |
| 主进程 handler | [main/ipc/*.ipc.ts](../src/main/ipc/) | 每个域一个注册函数，统一在 `main/index.ts` 的 `registerAllIpc()` 里调用；返回值统一 `IpcResult<T>`（`{ success, data | error }`） |

## 约定

- **返回形态**：所有 `ipcMain.handle` 返回 `IpcResult`；渲染侧经 `ipc-client.ts` 的 `unwrap` 解包。`success: true` 即成功——不要根据 `data === undefined` 判失败（void handler 合法）。
- **入参序列化**：来自 store 的对象/数组必须先过 `toIpcPlain`（见 agent 事件流文档）。
- **事件推送**：主→渲染用 `webContents.send`；动态通道（如 `AGENT_EVENT:<requestId>`）由渲染侧先订阅再触发。

## 来源守卫（sender guard）

主窗口 `sandbox: false` 且开启 `webviewTag`（内嵌浏览器），渲染进程同时承载不受信任的网页内容。[ipc-sender-guard.ts](../src/main/ipc/ipc-sender-guard.ts) 在 `registerAllIpc()` 第一行包掉 `ipcMain.handle`，对之后注册的所有 handler 统一校验：

- webContents 类型必须是 `'window'`（webview 一律拒绝——它不挂 preload，无合法 IPC 用途）；
- 只认主 frame（iframe 注入脚本到不了 IPC）；
- 主 frame URL 必须是 `file:`（生产 loadFile）或 dev server 同源（`ELECTRON_RENDERER_URL`）。

被拒调用返回 `IpcResult` 失败形态并记 warn 日志。单测见 `ipc-sender-guard.test.ts`。

## 契约测试

[ipc-contract.test.ts](../src/main/ipc/ipc-contract.test.ts) 做静态对账（无需 electron）：扫描 preload 调用的通道、main 注册的 handler、常量声明三个集合，互相求差集。新增通道时三处缺一测试即红。
