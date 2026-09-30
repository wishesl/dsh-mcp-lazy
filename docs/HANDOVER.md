# dsh-mcp-lazy（wishesl fork）交接文档

> 面向下一个接手的人（或下一个会话）。目标：不用重新推导，就能继续开发、验证、排障、回滚。
> 仓库：`https://github.com/wishesl/dsh-mcp-lazy`（fork 自 `leaforbook/dsh-mcp-lazy`）
> 本地克隆：`E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork`
> 当前版本：`0.7.0`（HEAD = `c587384`，已推送）

---

## 1. 这个插件是干什么的

DSH 的 MCP 懒加载桥：把已连接的 MCP 工具**按会话隐藏**，只暴露一个网关工具，模型需要时再披露该服务器的工具。

- 网关工具：`mcp__router__search_and_activate(query, serverName?)`
- 两种模式：
  - `mode: manager`（本机在用）：接管**已由官方 `@deepseek-ai/dsh-mcp-client` 注册**的 `mcp__<server>__<tool>` 组；连接与执行仍归原生 mcp-client，本插件只决定"什么时候让模型看到哪些工具"。
  - 显式 lazy server：本插件自己负责连接（stdio / streamable-http）、工具目录分页、有限重连与连接保温。
- 设计纪律（改动时务必保持）：**fail-open**（无法确定安全就放行、恢复可见）、**只读优先**、不伪造状态、不改传输/OAuth/协议。

## 2. 为什么会有这个 fork

上游 `^0.1.0-rc.6` 的 peer 走廊**排除整个 0.2 线**，而本机 harness 是 `0.2.0-rc.2`。fork 的目标是：把走廊拉到 `>=0.1.0-rc.6 <0.3.0`、补上真实宿主验证、修掉 Windows 下的测试基建，并在其上新增两个功能（设置面板 + 提示词索引）。

## 3. 已推送的提交

| commit | 内容 |
|---|---|
| `b300509` | **兼容 0.2 线**：peer 走廊 `>=0.1.0-rc.6 <0.3.0` 且标 optional；CI `dsh-compat` 矩阵加 `0.2.0-rc.1/rc.2`；新增真宿主用例（真 cordis + 真 ToolService + 真 scope `restrict`）；Windows 修复（`--import` + file URL、CRLF 容错、`.gitattributes`）；仓库地址指向本 fork；0.6.0 |
| `9ae40ce` | **设置面板 + 提示词索引**：新增 `lib/wire.js`、`lib/service.js`、`lib/typert.host.js`、`lib/client.js`、`lib/mcp-view.js`；`apply` 接线；7 个新配置键；0.7.0 |
| `c587384` | **修复面板 404**：`TYPERT.package` 用真实包名；codec 改 `strict`；Remote 服务改为 `apply` 内 await 挂载；加三道防回归（含真实 `validateTypertManifest`） |

## 4. 本机环境事实

| 项 | 值 |
|---|---|
| harness | `@deepseek-ai/dsh-desktop-runtime@0.2.0-rc.2`（全部 `@deepseek-ai/dsh-*` 都是 0.2.0-rc.2，`cordis 4.0.4`）；安装目录 `D:\work\tool\DSH` |
| profile | `C:\Users\Tony\.dsh\profiles\desktop`（Electron 独占；`dsh --profile desktop` 会被拒绝） |
| 插件安装方式 | profile `package.json` 里 `"@yilinxiao/dsh-mcp-lazy": "github:wishesl/dsh-mcp-lazy"` |
| 已装版本 | `0.7.0`，已装 commit `c587384`（`plugin_manager install_bundle` 触发） |
| MCP 服务器（全部常开、全部被接管） | `playwright` 25 工具、`chrome-devtools` 30、`tavily` 5、`context7` 2 |
| 包名 | 仍是 `@yilinxiao/dsh-mcp-lazy`（**未**改成 `@wishesl/...`，见 §10 待决策） |
| 重启语义 | 宿主插件与浏览器 bundle 变更后 `plugin_manager` 返回 `application: restart-required`，必须重启桌面版才生效 |

常用命令：

```powershell
# 更新到 fork 最新（改完代码、推送后）
plugin_manager install_bundle target=github:wishesl/dsh-mcp-lazy   # 工具调用；之后重启桌面版

# 打开/关闭两个默认关闭过的大 MCP（现在应当保持常开，见 §11）
plugin_manager set_plugin target=include:mcp-playwright enabled=true
plugin_manager set_plugin target=include:mcp-chrome-devtools enabled=true
```

## 5. 能力一：设置里的只读「MCP 管理」面板

**入口**：设置 → 左侧独立菜单 **MCP 管理**（槽位 `settings.section`，条目 id `mcp-lazy`，order 45）。

**数据流**（浏览器 ← Host，单向只读）：

```
lib/client.js   ── ctx.remote.$mount(descriptor) ──▶ 客户端 Remote 命名空间 remote.mcpLazy
      │                                                        │  snapshot()
      │  ctx.slots.register('settings.section', Panel)          ▼
      └──────────────────────────────────────────────  /api/mcpLazy/snapshot
                                                                 ▲
lib/typert.host.js (TYPERT 清单) ── typert-loader 注册调用 ──────┘
lib/service.js  McpLazyService extends TypertRemoteService
      └─ readCatalog() → lib/universal-manager.js record.controller.currentCatalog()
                              └─ 路由器同源 entry：{ serverName, routingHints, toolNames, getCatalog }
```

**文件职责**

| 文件 | 职责 |
|---|---|
| `lib/wire.js` | 包名常量、快照描述符、手写结构化 schema（strict codec） |
| `lib/typert.host.js` | `./typert` 导出，`TYPERT` 清单（`package` 必须是真实包名！） |
| `lib/service.js` | 只读 `mcpLazy/snapshot` 服务；**只能被动态 import**（它静态依赖 typert-protocol） |
| `lib/client.js` | 手写 `window.__ModuleLoader__.load({ id, factory })` bundle；只用 `require('react')`；**无构建步骤** |
| `lib/mcp-view.js` | 纯函数：关键词派生、面板视图、提示词索引文本、缓存键 |
| `lib/universal-manager.js` | 新增 `currentCatalog()`（只读视图）与 `installUniversalManager(adapter, { onReady })` |

面板展示：每服务器卡片（名称、工具数、关键词 chip、可选描述）+ 可展开工具清单（名称 + 描述截断 300 字符）+ 未通过准入的 `mcp__*` 工具折叠区 + 目录签名/快照时间；错误可重试，失败不崩。

## 6. 能力二：MCP 提示词索引（取代手工维护的清单）

- 段名 `mcp-lazy:index`，order = `ctx.systemPrompt.getSectionOrder('MCP_SERVERS') + 50`（即 3100 + 50），`interpolate: false`。
- 每次装配求值（新会话 / 工具变化自然更新），按「目录 signature + 配置」缓存 → 注册表不变时**逐字节相同**（prompt cache 友好）；无受管服务器时返回空串。
- 每服务器一行：`- <name>（N 个工具）: <description 或 关键词列表>`。
- **关键词/描述来源**：默认**全部从 MCP 定义派生**（服务器名、`routingHints`、工具名、工具描述）——与路由器 `searchableText` 同源；中文别名等用 `serverProfiles` 覆盖。
- 语言：`promptIndexLocale: 'zh' | 'en'`，默认 `zh`。

## 7. 配置参考（新增）

`mode: manager`：

| 键 | 默认 | 说明 |
|---|---|---|
| `promptIndex` | `true` | 是否注入索引段 |
| `promptIndexLocale` | `zh` | `zh` / `en` |
| `descriptionChars` | `120` | 单服务器描述截断 |
| `keywordsPerServer` | `8` | 每服务器派生关键词上限 |
| `maxServers` | `12` | 索引最多列出的服务器数 |
| `maxSnapshotTools` | `200` | 面板快照工具条目上限 |
| `serverProfiles` | `{}` | `{ "<serverName>": { description?, keywords? } }` |

显式 lazy server 新增 `promptIndex`（默认 `true`）。示例见 `README.md` 的「配置」一节。

## 8. Typert 远程通道：两条硬规则（踩过的坑）

`@deepseek-ai/dsh-typert-loader` 的 `validateTypertManifest` / `requireInvocation`：

1. **`TYPERT.package` 必须等于导出它的真实包名（含 scope）**。写成 `dsh-mcp-lazy` 会抛错，且从面板侧表现为 `/api/mcpLazy/snapshot` **HTTP 404**（调用根本没注册）。
2. **描述符的 result / 参数 codec 必须是 `mode: 'strict'`**；`src-json` 会被拒绝（"must use a strict codec"）。我们用手写结构化 schema 充当 strict codec，浏览器半因此不需要 zod、也不需要打包器。

另有两条经验：

- **不要把 `@deepseek-ai/dsh-typert-protocol` 声明成 peer**（即使 optional）：会让 CI 的 `npm install --no-save @deepseek-ai/dsh@…`（无 `--legacy-peer-deps`）与 dsh-agent 的精确 pin 冲突 → ERESOLVE。我们是动态 import + 能力探测，无需声明。
- 服务挂载必须 `await` 在 `apply` 内完成（不要在游离的 async 任务里挂），否则面板先渲染、路由后注册 → 首屏 404。

## 9. 测试与验证

```powershell
cd E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork
npm ci --legacy-peer-deps --ignore-scripts
npm test                      # 124 项：122 通过 / 0 失败 / 2 skipped（compat 门控）
```

| 测试文件 | 覆盖 |
|---|---|
| `test/mcp-view.test.mjs` | 关键词派生（含 CJK 不产噪声）、覆盖合并、截断/上限、空目录、字节稳定、快照裁剪 |
| `test/client-bundle.test.mjs` | 浏览器 bundle：`__ModuleLoader__` 注册、`settings.section` 参数、**两面描述符逐字段一致**、codec 行为、面板渲染/空态/不可用/错误态 |
| `test/dsh-version-compat.test.mjs` | stub-host：索引段名/order/文本/稳定；real-host：真 cordis + 真 ToolService + 真 scope `restrict` + 真 system-prompt 段位 + **真实 `validateTypertManifest`** |
| `test/package-metadata.test.mjs` | 版本/仓库/exports/`dsh.client`/peer 走廊/**`TYPERT.package === pkg.name`** + 清单形状 |
| `test/fixtures/plugin-host-harness.mjs` | 真 stdio MCP 夹具的完整生命周期（含配置默认值断言） |

真宿主 / CI 等价流程：

```powershell
npm install --no-save --ignore-scripts @deepseek-ai/dsh@0.2.0-rc.2 @deepseek-ai/dsh-tools@0.2.0-rc.2 @deepseek-ai/dsh-subprocess@0.2.0-rc.2
$env:DSH_COMPAT_VERSION='0.2.0-rc.2'; node --test test/dsh-version-compat.test.mjs; Remove-Item Env:\DSH_COMPAT_VERSION
```

CI（`.github/workflows/test.yml`）：`test` 作业跑全量（Node 20/24）；`dsh-compat` 作业矩阵 `0.1.0-rc.6 / rc.7 / rc.8 / 0.2.0-rc.1 / 0.2.0-rc.2`。

**已验证**：全量测试绿；`0.2.0-rc.2` 上 compat 2/2 通过；`validateTypertManifest` 对**已安装副本**通过；桌面版已出现「MCP 管理」菜单并正确渲染（i18n/槽位/刷新按钮）。
**未验证（重启后做）**：面板拿到真实数据；提示词索引真的进入模型上下文。

## 10. 重启后必做的两条 live 验证

1. **面板数据**：设置 → MCP 管理 → 应列出 4 个服务器（playwright 25 / chrome-devtools 30 / tavily 5 / context7 2）、关键词、可展开工具清单；点「刷新」应更新快照时间。
   - 若仍 404：检查 `plugin_manager list_plugins` 里 `mcp-lazy-manager` 是否 active，以及 profile 是否真的装到 `c587384`。
2. **提示词注入**：**新建会话**，派一个子 agent，要求它**不调用任何工具**说出"有哪些 MCP 服务器、各自关键词/能力"。
   - 说得出来 → `mcp-lazy:index` 生效。
   - 说不出来 → 检查该 host 的 `systemPrompt.getSectionOrder('MCP_SERVERS')` 是否存在（段位查询缺失时插件会跳过注入，这是 fail-soft 设计）。

## 11. 已知限制与待办

**限制（当前设计如此）**

- 插件**挂载前就存在的会话不会被接管**：管理器只从 `agent/created` 认识 agent，老会话保持满量工具（fail-open）。→ 新会话才享受懒加载。
- 某个 MCP 若在某会话的工具掩码算完之后才连上，它对该会话保持可见，直到下一轮 reconcile。
- 面板是**全局视图**，不含 per-session 披露状态（避免再开一条会话态通道）。
- `0.1.x` 矩阵行会跳过面板相关断言（该线没有 typert）；插件本体仍可用。
- 中文 query 对英文工具名的路由命中率差：建议调用时带 `serverName`；索引里的关键词是英文 token，中文别名用 `serverProfiles` 补。

**待办 backlog（按价值排序）**

1. **回填补丁**：挂载时从 `ctx.agents` 枚举既有 agent 并接管，让"装上即对当前会话生效"（可选注入，老线自动跳过）。
2. **包名/scope 决策**：是否把 `name` 改成 `@wishesl/dsh-mcp-lazy`（需同步 `cordis.patch.yml`、README、3 处断言）。
3. 面板增强：按会话显示"已披露"状态、一键复制 `serverName`、关键词覆盖的可视化编辑。
4. 发布 npm（当前只有 git 通道）。
5. 上游回流：把 0.2 线兼容与两个功能作为 PR 提回 `leaforbook/dsh-mcp-lazy`。

## 12. 本地开发注意

- **免构建**：`lib/` 是提交产物，安装端不跑构建（pnpm 不装 git 依赖的 devDeps）。浏览器半是手写 bundle，改完直接提交。
- **Windows 换行**：仓库有 `.gitattributes`（`eol=lf`）；测试读文件时统一 `\r\n → \n`。提交用 `git -c core.autocrlf=false`。
- **清点验证工具**：`E:\gopackage2\2026-8\woker1\_contract\host` 是沙盒（装了真实 typert-loader / typert-protocol 等），`probe-manifest.mjs`、`probe-installed.mjs` 可直接用真实 loader 校验清单；改 `TYPERT` 前后都跑一次。
- **不要做的事**：
  - 不要用 `plugin_manager set_plugin target=include:mcp-playwright enabled=false` 关 MCP —— 关掉会让该 server 从路由目录消失，等于删能力；要停用整个接管，改 profile patch 里 `- id: mcp-lazy-manager` + `disabled: true`。
  - 不要递归扫描 `AppData` 找日志（几百万文件，会卡死）；日志不在 `$DSH_HOME/logs`（桌面版另有去向，未定位）。
  - 不要把宿主管家包写进 `dependencies`（会 shadow 宿主 runtime，`test/host-runtime-compat.test.mjs` 会拦）。

## 13. 排障速查

| 症状 | 最可能原因 | 检查点 |
|---|---|---|
| 面板出现但「读取失败 … HTTP 404」 | 清单校验失败 → 调用没注册 | `TYPERT.package` 是否等于真实包名；codec 是否 `strict`；用 `_contract/host/probe-installed.mjs` 跑真实 loader |
| 设置里没有「MCP 管理」 | 客户端 bundle 没加载 / 宿主缺 typert | `plugin_manager list_plugins` 看插件是否 active；`dsh.client` 声明是否在；重启是否完成 |
| 提示词里没有索引段 | `systemPrompt` 缺失或没有 `getSectionOrder` | 该 host 的段位查询；`promptIndex: false` 是否被配置 |
| 新会话仍看到全部 MCP 工具 | 老会话未接管 / 服务器在该会话掩码算完后才连上 | 换新会话；`/mcp` 式路由查询；`plugin_manager list_plugins` 看 MCP 是否 active |
| 路由查不到某个 server | 该 MCP 未通过兼容性准入 | 工具名是否规范 `mcp__<server>__<tool>`、是否有重名 |

## 14. 回滚与停用

```yaml
# C:\Users\Tony\.dsh\profiles\desktop\cordis.patch.yml（末尾追加覆盖行）
- id: mcp-lazy-manager
  disabled: true       # 停用接管：工具恢复常驻可见，插件仍安装
```

```powershell
# 完全卸载
plugin_manager set_plugin target=@yilinxiao/dsh-mcp-lazy enabled=false
# 或从 profile 依赖里移除 github:wishesl/dsh-mcp-lazy 后重启
```

停用接管后，若同时把 playwright / chrome-devtools 保持常开，每个会话会多出 55 个工具 schema —— 这也是本次新增索引面板想避免的情况。

---

### 附：一页速查

```
仓库        https://github.com/wishesl/dsh-mcp-lazy          HEAD c587384 / 0.7.0
本地克隆    E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork
沙盒        E:\gopackage2\2026-8\woker1\_contract\host      （真实 typert-loader 校验）
profile     C:\Users\Tony\.dsh\profiles\desktop              （Electron 独占，改插件后需重启）
网关工具    mcp__router__search_and_activate(query, serverName?)
面板        settings.section id=mcp-lazy / remote 命名空间 mcpLazy / 方法 snapshot
索引段      mcp-lazy:index @ order 3150（= MCP_SERVERS 3100 + 50）
测试        npm test → 124 项（122 通过 / 2 skipped）
真宿主      DSH_COMPAT_VERSION=0.2.0-rc.2 node --test test/dsh-version-compat.test.mjs
```
