# 密码 / 自动填充 — 设计文档（实现前必读）

> 状态：**设计**（未实现）。这是一个安全敏感子系统，半成品比不做更糟（明文密码风险）。
> 本文先把威胁模型、存储加密、边界定死，评审通过后再按分期实现。

## 1. 原则与威胁模型

**原则**
- 明文密码**永不落盘**、**永不进渲染进程的可持久化状态**、**永不写日志**。
- 加密委托操作系统钥匙串（不自造密码学）。
- 注入只发生在**同源**、**用户手势触发或用户确认**的前提下。
- 无痕（incognito）标签**永不保存**、**永不自动填充**。

**假设的威胁**
- 磁盘被读取（丢设备 / 备份泄露）→ 靠 OS 钥匙串加密,拿不到明文。
- 恶意网页想窃取其它站点的凭据 → 靠严格同源匹配 + 只注入探测到的本站表单。
- 渲染进程被 XSS/供应链污染 → 明文只在「主进程 ↔ guest 页面上下文」间流动,不经宿主渲染进程可存储状态;宿主拿到的只有元数据(origin/username)。

**不在范围内(明确不做)**
- 自造对称/非对称加密、自研 KDF。
- 云同步 / 跨设备。
- 保存到工作区文件或 SQLite 明文列。

## 2. 存储加密

用 Electron `safeStorage`(底层:macOS Keychain / Windows DPAPI / Linux libsecret)。
- `safeStorage.isEncryptionAvailable()` 为 false 时**禁用整个功能**并提示(绝不降级为明文)。
- 每条凭据的 password 单独 `encryptString` → 得到 `Buffer` 密文,存 SQLite 的 `BLOB` 列。
- username / origin 是元数据,可明文存(便于匹配/展示),但不含 password。

**可选增强(二期)**:主密码层——用户设主密码,用 `scrypt`(node:crypto)派生 key 再对 safeStorage 密文做二次封装,解锁后内存缓存有 TTL。一期不做,safeStorage 单层已是 VS Code 等采用的合规基线。

## 3. 数据模型（migration，新表）

```sql
CREATE TABLE browser_credentials (
  id            TEXT PRIMARY KEY,
  origin        TEXT NOT NULL,          -- 规范化 scheme://host[:port]
  username      TEXT NOT NULL,
  password_enc  BLOB NOT NULL,          -- safeStorage 密文
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE UNIQUE INDEX idx_cred_origin_user ON browser_credentials(origin, username);
```

origin 规范化:只保留 scheme+host+port,去 path/query;仅 https(可选允许 http,但标记 insecure 并默认不自动填充)。

## 4. 主进程 CredentialVaultService

`src/main/services/credential-vault.service.ts`
- `isAvailable(): boolean` — `safeStorage.isEncryptionAvailable()`。
- `save({ origin, username, password }): void` — upsert,`encryptString(password)`。
- `listForOrigin(origin): Array<{ id, username }>` — **不返回密码**。
- `getSecret(id): string` — 解密单条密码,**仅供注入/复制流程内部同步调用,不经通用 IPC 直返渲染层**(见 §6 注入)。
- `list(): Array<{ id, origin, username, updatedAt }>` — 设置面板用,无密码。
- `delete(id)` / `clearAll()`。
- incognito:调用方保证不 save;service 不感知模式。

## 5. IPC 面

| 通道 | 方向 | 载荷 | 说明 |
|---|---|---|---|
| `credentials:list` | R→M | — | 元数据列表(设置面板) |
| `credentials:list-for-origin` | R→M | origin | {id, username}[](保存/填充提示用) |
| `credentials:save` | R→M | {origin, username, password} | 用户确认保存 |
| `credentials:delete` | R→M | id | — |
| `credentials:autofill` | R→M | {webContentsId, id} | **主进程直接向 guest 注入**,密码不回渲染层(见 §6) |
| `credentials:offer-save` | M→R | {origin, username} | 探测到登录提交,提示是否保存 |

契约测试(现有 `ipc-contract.test.ts`)会自动覆盖这些新通道的 preload↔main 对账。

## 6. 捕获与自动填充（注入边界）

复用现有「主进程直控 guest webContents」的通道(见 [[lucky-ai-client-browser]] 的 Agent 控制浏览器):`webview.getWebContentsId()` 已上报,主进程 `webContents.fromId()` 可直接 `executeJavaScript`。

**捕获(保存)**
1. dom-ready 后主进程向 guest 注入一段**探测脚本**:监听 form submit,若表单含 `input[type=password]` 且有可识别的 username 字段(type=email/text 且 autocomplete 提示),收集 `{origin, username, password}`。
2. 探测脚本经 `ipcRenderer`(guest 预加载)或 `executeJavaScript` 回传结果给主进程。**注意:webview guest 默认无 preload,需为凭据功能配一个最小 preload,只暴露一个 `postCredential` 通道**。
3. 主进程发 `credentials:offer-save` → 宿主渲染层弹「保存密码?」条(只显示 origin+username)。用户点保存 → `credentials:save`。

**填充(autofill)**
1. dom-ready 后,宿主渲染层调 `credentials:list-for-origin(origin)`。有匹配 → 在用户名输入框旁显示钥匙图标 / 或直接提示。
2. 用户选择某条 → `credentials:autofill({ webContentsId, id })`。
3. **主进程**内部 `getSecret(id)` 解密,`webContents.executeJavaScript` 把明文只注入到 guest 页面的密码框(通过 CSS 选择器定位探测到的表单),**明文不经宿主渲染进程**。注入后立刻丢弃内存引用。

**边界硬约束**
- 只在 origin 完全一致时匹配/填充。
- 只填充 dom-ready 后、真实存在的密码表单;找不到就放弃(不猜)。
- 默认需用户点击选择(不做静默自动填充);「自动填充」偏好可选开,但仍限同源。
- 注入脚本用 IIFE + 不污染全局;探测脚本不读取非本表单的 input。

## 7. UI

- **设置面板**:`BrowserSettingsMenu` 加「密码」入口 → 打开一个「已保存密码」列表(origin/username/更新时间 + 删除 + 全部清除)。密码默认隐藏,「显示」需再次确认(可要求系统生物识别,二期)。
- **保存提示条**:登录提交后在地址栏下方弹条「为 <origin> 保存密码?」保存/不保存/永不。
- **填充提示**:用户名框聚焦时若有匹配,显示下拉选择账号。

## 8. 分期

- **一期(MVP)**:safeStorage 存储 + service + IPC + 设置面板(增删查)+ 手动填充(用户选账号→主进程注入)。**不做**自动探测保存(先让用户在设置里手动加,或从填充选择时记住)。
- **二期**:登录表单自动探测 + 保存提示条 + 同源 autofill 建议。
- **三期(硬化)**:主密码/生物识别解锁、显示密码前二次验证、http 站点策略、可选主密码层。

## 9. 验证

- service 的纯逻辑(origin 规范化、upsert 语义)走 `*InternalsForTest` 单测。
- IPC 契约测试覆盖新通道接线。
- safeStorage / 注入属 electron 运行时,只能类型/lint/手动实测(启动 Electron 登录一个站点走完保存→填充闭环)。

---

相关:[[lucky-ai-client-browser]]、[[lucky-ai-client-arch]]、[[lucky-ai-client-testing]]。
