# dsh-mcp-lazy（wishesl fork）交接文档

> 面向下一个接手的人（或下一个会话）。目标：不用重新推导，就能继续开发、验证、排障、回滚。
> 仓库：`https://github.com/wishesl/dsh-mcp-lazy`（fork 自 `leaforbook/dsh-mcp-lazy`）
> 本地克隆：`E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork`
> 当前版本：`0.13.0`（npm 上最新发布仍是 `0.12.0`：`@sutong12/dsh-mcp-lazy`）

---

## 1. 这个插件是干什么的

DSH 的 MCP 懒加载桥：把已连接的 MCP 工具**按会话隐藏**，只暴露一个网关工具，模型需要时再披露该服务器的工具。披露**在会话内累计保留**（轮次边界不收回，换取工具表稳定与 prompt cache 命中），会话结束才释放。

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
| `d1fc363` | **面板可见注入提示词 + 自定义描述（0.8.0）**：新增 `lib/profile-store.js`（profile 内 `.dsh-mcp-lazy/profiles.json`，原子写、fail-soft、无锚点则内存态）；`lib/wire.js` 增 `saveProfile`/`resetProfile` 两个**带 strict 参数 codec** 的调用；`lib/service.js` 从只读升级为读+写并回传 `promptIndex`/`store`；`lib/mcp-view.js` 增 `normalizeProfile`/`mergeServerProfiles`/`withServerOverrides`/`buildPanelSnapshot`/`routingHintsOf`；`lib/tool-router.js` + `lib/universal-manager.js` 让 `routingHints` 支持**函数源**（面板别名真正参与路由）；`lib/client.js` 增「注入的提示词」区块与逐服务器编辑器；新增 `test/profile-store.test.mjs` 并在 compat 车道加真宿主面板用例 |
| `159107c` | **索引改走运行时上下文（0.9.0；实测仍被拼进同一条快照，0.10.0 改为消息通道）**：`lib/index.js` 由 `systemPrompt.section()` 改为 `systemPrompt.context({ name: 'mcp-lazy:index', order: getContextOrder('SUBAGENT_DELEGATION') + 10 })`；快照字段 `sectionName` → `name` 并新增 `channel`，两面 codec 同步；真宿主用例新增 `assemble().contexts` 与 `renderContextSnapshot()` 的逐字断言 |
| `<0.10.0>` | **索引改为独立会话消息**：新增 `lib/prompt-message.js` —— `agent.inject(createUserMessage({ content, source: { kind: 'mcp-lazy', form: 'catalog' } }))`，与根目录 AGENTS.md 同一机制，因而在聊天里**单独成条**；含挂载回填老会话、跟随 `agent/created`/`agent/disposed`、`tools/change` 与面板保存后重新排入、同文本去重、待消费副本先移除、无 `agents` 服务/无 `inject` 时 fail-soft；`lib/index.js` 通道优先级改为 **message → context → section**（互斥，绝不重复注入）；`lib/service.js` 写入后 `refreshPrompt()`；`lib/client.js` 按通道给文案；新增 `test/prompt-message.test.mjs` 与真宿主消息通道用例 |
| `36621d0` | **面板可写描述 + 主题化面板 + 常驻开关（0.11.x）**：面板样式走 `--dsw-*` token；逐服务器「常驻/收起」开关；`modelProfileEdits` 面板开关；修掉「每次保存都过不了网关 JSON 校验」 |
| `c75497b` | **设置导航图标 + 改名发布（0.12.0）**：`lib/client.js` 新增 `installNavIcon`（`settings.section` 没有图标位 ⇒ 认领 `[role="dialog"] nav button` 里文本等于自己 label 的那一行，藏官方 svg、用 `mask-image: url(data:image/svg+xml,…)` + `background-color: currentColor` 画漏斗，跟随主题；`MutationObserver` + `queueMicrotask` 合并；空 label 不认领；随 `ctx.effect` 清理；零命中/无 DOM/无 observer 一律 fail-soft 退回齿轮），新增 `test/client-nav-icon.test.mjs`（5 条）；包名 `@yilinxiao/dsh-mcp-lazy` → **`@sutong12/dsh-mcp-lazy`**（含 `TYPERT.package`、bundle patch、README、断言），版本 0.12.0 并发布到 npm |
| `<0.13.0>` | **会话内持久披露（0.13.0）**：`lib/universal-manager.js` 把 per-agent 的 `selectedServer` 换成 `revealedServers` 集合（披露只增不减）；`onTurnStopping` 只在「fail-open 当轮放行」或「当前没有任何掩码」时重装，**已装掩码一律不动**（`appliedDeny` 相同则短路）；`failOpen` 不再清披露集合、只清当轮放行；离开目录/转常驻的服务器在 reconcile 时剪枝；`lib/mcp-view.js` 的注入索引文案改为「披露后本次会话内一直可直接调用」。动机是每轮收回会让工具表抖动、打掉 prompt cache |

## 4. 本机环境事实

| 项 | 值 |
|---|---|
| harness | 运行中的宿主安装目录是 `E:\gopackage2\2026-8\dsh-start\dsh-vsn\0.2.1-alpha.1`（由 dsh-launcher 监督，网页在 http://127.0.0.1:3080）。`0.2.0-rc.2` 是旧目录：仓库 `node_modules\@deepseek-ai\*` 里的 junction 曾指向它，会让 `test/host-runtime-compat.test.mjs` 失败 → `npm ci` 清掉后，用**当前**安装目录重跑边车脚本 |
| profile | 现在在用的是 **web** profile：`C:\Users\Tony\.dsh\profiles\web`（`DSH_PROFILE=web`）；桌面 desktop profile 另有安装，见 §4 旧记录 |
| 插件安装方式 | web profile `package.json` 里 `"@sutong12/dsh-mcp-lazy": "link:E:/gopackage2/2026-8/woker1/dsh-mcp-lazy-fork"`（改一行代码、重启即生效；**必须**先跑 `node scripts/link-host-peers.mjs E:\gopackage2\2026-8\dsh-start\dsh-vsn\0.2.1-alpha.1`，`npm ci` 会清掉那些 junction） |
| 已装版本 | 仓库 0.13.0（profile 用 `link:` 指本仓库，重启即生效）；npm 上最新发布仍是 0.12.0（首包；0.5.1 是上游 `@yilinxiao` 的发布，不是本 fork） |
| MCP 服务器（全部常开、全部被接管） | `playwright` 25 工具、`chrome-devtools` 30、`tavily` 5、`context7` 2、`magicui`、`pwsh-mcp` |
| 面板自定义描述的落盘位置 | `<profile>\.dsh-mcp-lazy\profiles.json`（本机即 `C:\Users\Tony\.dsh\profiles\web\.dsh-mcp-lazy\profiles.json`） |
| 包名 | `@sutong12/dsh-mcp-lazy`（0.12.0 起；旧名 `@yilinxiao/dsh-mcp-lazy` 只存在于上游发布与历史提交） |
| 重启语义 | 宿主插件与浏览器 bundle 变更后必须重启 DSH 才生效（本会话可用 `dsh-restart` 工具，由 launcher 监督拉起）；**但面板保存的自定义描述不需要重启**（下一轮装配即生效） |

常用命令：

```powershell
# 改了 link: 装的本仓库代码之后：重启 DSH（本会话用 dsh-restart 工具，launcher 会监督拉起）
# 忘了补宿主包 junction 时（npm ci 之后）：面板服务会静默缺席
node scripts/link-host-peers.mjs E:\gopackage2\2026-8\dsh-start\dsh-vsn\0.2.0-rc.2

# 从 npm 装（不用 link: 时）
dsh plugin --profile web add @sutong12/dsh-mcp-lazy
```

## 5. 能力一：设置里的「MCP 管理」面板（读 + 写）

**入口**：设置 → 左侧独立菜单 **MCP 管理**（槽位 `settings.section`，条目 id `mcp-lazy`，order 45）。

**数据流**（浏览器 ←→ Host；3 个 Remote 方法）：

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
| `lib/wire.js` | 包名常量、3 个调用描述符（含 `saveProfile`/`resetProfile` 的 **strict 参数 codec**）、手写结构化 schema |
| `lib/typert.host.js` | `./typert` 导出，`TYPERT` 清单（`package` 必须是真实包名！） |
| `lib/service.js` | `mcpLazy` 服务：`snapshot`（只读，回传**实际注入的提示词原文**与存储状态）+ `saveProfile`/`resetProfile`（写覆盖并回传新快照）；**只能被动态 import**（它静态依赖 typert-protocol） |
| `lib/profile-store.js` | 面板写入的持久化：`<profile>/.dsh-mcp-lazy/profiles.json`，临时文件 + rename 原子写；读坏/写坏/无目录一律降级为内存态并如实上报 |
| `lib/client.js` | 手写 `window.__ModuleLoader__.load({ id, factory })` bundle；只用 `require('react')`；**无构建步骤**；含「注入的提示词」区块与逐服务器编辑器 |
| `lib/mcp-view.js` | 纯函数：关键词派生、覆盖归一化/逐字段合并、面板视图、快照组装、提示词索引文本、缓存键 |
| `lib/universal-manager.js` | `currentCatalog()`（只读视图）与 `installUniversalManager(adapter, { onReady, hintsOf })`；`routerEntryForServer` 的 `routingHints` 是**函数源** |
| `lib/tool-router.js` | `hintsOf(entry)` 同时接受数组与函数；打分与候选提示都走它 |

面板展示：顶部「**注入的提示词**」折叠区（段名、order、未注入原因、**逐字文本**、复制按钮）+ 每服务器卡片（名称、工具数、关键词 chip、描述、来源徽标、**自定义描述编辑器**）+ 可展开工具清单（名称 + 描述截断 300 字符）+ 未通过准入的 `mcp__*` 工具折叠区 + 目录签名/快照时间/状态文件路径（或写入失败原因）；读取失败可重试，保存失败保留草稿，失败不崩。

**写入语义（改这块前先读）**

- 覆盖是**逐字段**合并、**配置文件赢**：`cordis.patch.yml` 的 `serverProfiles` 定过的字段面板改不动（面板标注「配置文件固定」）；没定过的字段面板生效。
- 面板保存**不需要重启**：`readView()` 每次求值都带上 store，`indexSignatureKey` 含 `serverProfiles`，因此下一轮装配重算索引。
- 写入只影响「面板展示 + 提示词索引 + 路由提示词」，**不触碰**接管/披露/工具可见性（那条路径仍只有 `agent/created`、`tools/change`、`restrict`）。
- 保存的**描述与关键词同时是路由提示词**（`dsh-mcp-lazy-fork/lib/index.js` 的 `customHintsOf` → `installUniversalManager({ hintsOf })`），所以索引里广告的中文别名真的能被 `query` 命中。

## 6. 能力二：MCP 提示词索引（聊天消息流里的独立条目）

- **通道一（首选）：一条真实的会话消息**。通过 `agent.inject(createUserMessage({ content:[{type:'text',text}], source:{ kind:'mcp-lazy', form:'catalog' } }))` 注入 —— 与根目录 `AGENTS.md` 同一机制，所以在聊天里**单独成条**。
  - 客户端依据（`@deepseek-ai/dsh-client-ui-chat` 的 `conversation-nodes/message.js`）：`messageDefinition` 把 user 消息分成「用户提交 / steering / 注入上下文」，`contextMessage()` 给每条非用户提交的 user 消息生成独立 `kind:'context'` 节点；标签来自 `contextProducer(source)`（default → `source.kind`），展示形式来自 `contextForm(source)`（`KNOWN_FORMS = [instructions, catalog, snapshot, notice, relay, recall]`）。所以 `kind` 与 `form` 这两个字段是**载荷字段，不是装饰**。
  - `agent.inject` 的语义：「把面向模型的上下文排到下一次 pre-step，**不唤醒驱动器**」（`dsh-agent` 的 `runtime-types.d.ts`）；空闲会话挂起到下次唤醒。
  - 挂载时用宿主 `agents` 服务 `list()` **回填已存在的会话**；随后跟随 `agent/created` / `agent/disposed` / `tools/change`。
  - 去重与更新：同一文本不重复排；文本变化时先移除**待消费**的旧副本再排新的（已进历史的旧条目保留，与 AGENTS.md 的替换语义一致）。
  - 消息工厂优先用宿主 `@deepseek-ai/dsh-llm` 的 `createUserMessage`（带 branded id、deepFreeze）；解析不到时用本地同形状实现（`{ id: uuid, role:'user', content, source }` 冻结）。
- **通道二（降级）**：`systemPrompt.context({ name:'mcp-lazy:index', order: getContextOrder('SUBAGENT_DELEGATION')+10 })`，模型可见，但会话里与沙箱/审批挤在同一条 `Current runtime context` 快照里。
- **通道三（再降级）**：`systemPrompt.section({ name:'mcp-lazy:index', order: getSectionOrder('MCP_SERVERS')+50, interpolate:false })`，只进提示词正文。
- 三者**互斥**：选了消息通道就完全不注册 context/section（防重复注入）；真宿主用例断言过「context 生效时 section 数为 0」。
- 为什么通道一需要 `agents` 服务：它是宿主自己的活体注册表，也是「挂载即回填老会话」的来源；只有 `adapter.on` 而没有 `agents` 的替身仍走降级通道（fixture 断言依赖这一点）。
- 装配求值仍是「目录 signature + 有效配置」的纯函数 + 缓存：注册表不变时逐字节相同；面板保存/工具变化会 `refresh()` 重新排入。
- 语言：`promptIndexLocale: 'zh' | 'en'`，默认 `zh`；`promptIndex: false` 时三条通道都不安装。
- **面板「注入的提示词」显示的就是这条注入的原文**（同一个 `provideText()`），并标出当前通道。
## 7. 配置参考（新增）

`mode: manager`：

| 键 | 默认 | 说明 |
|---|---|---|
| `promptIndex` | `true` | 是否注入索引（0.9.0 起走运行时上下文） |
| `promptIndexLocale` | `zh` | `zh` / `en` |
| `descriptionChars` | `120` | 单服务器描述截断 |
| `keywordsPerServer` | `8` | 每服务器派生关键词上限 |
| `maxServers` | `12` | 索引最多列出的服务器数 |
| `maxSnapshotTools` | `200` | 面板快照工具条目上限 |
| `serverProfiles` | `{}` | `{ "<serverName>": { description?, keywords? } }`；与面板写入**逐字段**合并（配置赢），并且**参与路由匹配** |

显式 lazy server 新增 `promptIndex`（默认 `true`）。示例见 `README.md` 的「配置」一节。0.8.0/0.9.0 **没有新增配置键**：自定义描述走面板 + `<profile>\.dsh-mcp-lazy\profiles.json`。

## 8. Typert 远程通道：三条硬规则（踩过的坑）

`@deepseek-ai/dsh-typert-loader` 的 `validateTypertManifest` / `requireInvocation`：

1. **`TYPERT.package` 必须等于导出它的真实包名（含 scope）**。写成 `dsh-mcp-lazy` 会抛错，且从面板侧表现为 `/api/mcpLazy/snapshot` **HTTP 404**（调用根本没注册）。
2. **描述符的 result / 参数 codec 必须是 `mode: 'strict'`**；`src-json` 会被拒绝（"must use a strict codec"）。我们用手写结构化 schema 充当 strict codec，浏览器半因此不需要 zod、也不需要打包器。
3. **带参数的方法要按 `requireInvocation` 的字段填**：每个参数 `{ name, wire, source: 'json', codec: { mode:'strict', typeSymbol, create } }`，同一调用内 `wire` 不能重复，`source: 'json'` 时不能带 `lookup`。`saveProfile`/`resetProfile` 就是这么写的；写错只在**真实 loader** 下才报（`test/dsh-version-compat.test.mjs` 的 real-host 用例 + `_contract/host/probe-manifest.mjs`）。

另有两条经验：

- **不要把 `@deepseek-ai/dsh-typert-protocol` 声明成 peer**（即使 optional）：会让 CI 的 `npm install --no-save @deepseek-ai/dsh@…`（无 `--legacy-peer-deps`）与 dsh-agent 的精确 pin 冲突 → ERESOLVE。我们是动态 import + 能力探测，无需声明。
- 服务挂载必须 `await` 在 `apply` 内完成（不要在游离的 async 任务里挂），否则面板先渲染、路由后注册 → 首屏 404。

## 9. 测试与验证

```powershell
cd E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork
npm ci --legacy-peer-deps --ignore-scripts
npm test                      # 183 项：179 通过 / 0 失败 / 4 skipped（compat 门控；junction 残留会让 host-runtime-compat 失败，属环境问题）
```

| 测试文件 | 覆盖 |
|---|---|
| `test/mcp-view.test.mjs` | 关键词派生（含 CJK 不产噪声）、覆盖归一化/逐字段合并与来源、截断/上限、空目录、字节稳定、快照裁剪、**面板 payload 的 available 语义**、`routingHintsOf` 的数组/函数两种源 |
| `test/prompt-message.test.mjs` | 消息通道：注入一条 user 消息并带自有 source、同文本不重复排、文本变化时先移除待消费副本再排、空索引不注入、无 `inject()` 的 agent 跳过、`inject()` 抛错只记日志、`refresh` 只补过期者、`agents` 服务缺失/抛错时整体降级、本地消息形状与宿主一致 |\n| `test/profile-store.test.mjs` | 面板写入落盘与重载、原子写（无残留 tmp）、归一化、删除、损坏文件降级、无 profile 目录/锚点不可用→内存态、空 serverName 拒绝 |
| `test/client-bundle.test.mjs` | 浏览器 bundle：`__ModuleLoader__` 注册、`settings.section` 参数、**两面 3 个描述符逐字段一致**（含参数 codec）、快照/参数 codec 行为、面板渲染（含**注入提示词区块**与编辑器）、空态/不可用/错误态、保存/重置/失败保留草稿/内存态提示 |
| `test/dsh-version-compat.test.mjs` | stub-host（无 `context()`）：回退 section 的段名/order 3150/文本/稳定；real-host ① 另加：**注册为运行时上下文**（order 130）、`assemble().contexts` 与 `renderContextSnapshot()` 逐字含索引、**用 context 时 section 数为 0**；real-host ①：真 cordis + 真 ToolService + 真 scope `restrict` + 真 system-prompt 段位 + **真实 `validateTypertManifest`**；real-host ②（0.8.0 新增）：**真 TypertRemoteService** 挂载面板服务，`snapshot` 文本 == 上下文文本、`saveProfile` 落盘、中文别名经真实注册表**路由并披露**、`resetProfile` 还原、空 serverName 报错 |
| `test/package-metadata.test.mjs` | 版本/仓库/exports/`dsh.client`/peer 走廊/**`TYPERT.package === pkg.name`** + 清单形状 + 3 个调用与参数 codec 行为 |
| `test/universal-manager.test.mjs` | 现有覆盖 + **`hintsOf` 函数源即时生效**（保存后同一对象下一次查询即命中，并经路由工具披露）、抛错的 hints 源降级、**会话内持久披露**（第二台累加不替换、轮次边界不收回、静默轮次不重装掩码、重复披露幂等、离开目录剪枝、fail-open 不丢披露） |
| `test/fixtures/plugin-host-harness.mjs` | 真 stdio MCP 夹具的完整生命周期（含配置默认值断言） |

真宿主 / CI 等价流程（**7 个包必须一条命令装**：`--no-save` 的第二次安装会把上一次未写进 package.json 的包当 extraneous 剪掉）：

```powershell
cd E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork
npm install --no-save --ignore-scripts @deepseek-ai/dsh@0.2.0-rc.2 @deepseek-ai/dsh-tools@0.2.0-rc.2 @deepseek-ai/dsh-subprocess@0.2.0-rc.2 @deepseek-ai/dsh-scope@0.2.0-rc.2 @deepseek-ai/dsh-system-prompt@0.2.0-rc.2 @deepseek-ai/dsh-typert-protocol@0.2.0-rc.2 @deepseek-ai/dsh-typert-loader@0.2.0-rc.2
$env:DSH_COMPAT_VERSION='0.2.0-rc.2'; node --test test/dsh-version-compat.test.mjs; Remove-Item Env:\DSH_COMPAT_VERSION
npm ci --legacy-peer-deps --ignore-scripts   # 装完必须还原，否则基线 lane 的 host-runtime-compat 用例会失败
```

CI（`.github/workflows/test.yml`）：`test` 作业跑全量（Node 20/24）；`dsh-compat` 作业矩阵 `0.1.0-rc.6 / rc.7 / rc.8 / 0.2.0-rc.1 / 0.2.0-rc.2`，第二步 `continue-on-error` 尝试装上面 4 个可选包（0.1.x 没有 typert，装不上就保持第一步的状态，用例自行 skip）。

**已验证（0.10.0，本机）**：`npm test` 154 项 / 150 通过 / 0 失败 / 4 skipped；`0.2.0-rc.2` 上 compat **4/4 通过**，其中消息通道用例证明：已存在的会话被回填、注入的是宿主 `createUserMessage` 产物（冻结、branded id）、`source` 为 `{ kind:'mcp-lazy', form:'catalog' }`、内容与面板 `promptIndex.text` 逐字一致、面板 channel 为 `message`；`validateTypertManifest` 对本地与 `_contract/host` 沙盒都通过。
**未验证（装机后做）**：0.10.0 装机后**聊天消息流里出现标着 `mcp-lazy` 的注入条目**（见 §10 第 2 条）——主验收，Node 侧覆盖不到最后一跳「Chat 把这条 user 消息渲染成 `context` 行」（依据来自客户端 `conversation-nodes/message.js` 的 `contextMessage/contextProducer/contextForm`，已按源码对齐 `kind`/`form`）。另外**客户端→网关的「位置参数 → wire 字段」装箱**在浏览器半（`@deepseek-ai/dsh-api-remotes` 的 `$mount`），Node 侧同样无法覆盖：描述符按 `InvocationParameterDescriptor` 原样写（`name: 'input'` / `wire: 'input'` / `source: 'json'` / strict codec），若这一跳有问题，表现会是保存时报 codec/参数错误（面板会显示原文），届时对照 `lib/wire.js` 的 `saveProfile` 描述符排查。

## 10. 装机后必做的 live 验证（0.10.0）

先推送 → `plugin_manager install_bundle target=github:wishesl/dsh-mcp-lazy` → **重启桌面版**。

1. **面板数据**：设置 → MCP 管理 → 应列出 4 个服务器（playwright 25 / chrome-devtools 30 / tavily 5 / context7 2）、关键词、可展开工具清单；点「刷新」应更新快照时间。
   - 若仍 404：检查 `plugin_manager list_plugins` 里 `mcp-lazy-manager` 是否 active，以及 profile 是否真的装到 0.10.0。
2. **聊天消息流里的注入条目（0.10.0 主验收）**：**随便发一句**（老会话也会被回填），消息流里应出现一条标着 `mcp-lazy` 的注入记录（与根目录 AGENTS.md 的注入记录同一形态），展开后是 §6 的那段清单，含你机器上的 4 台服务器。
   - 看不到条目：面板「注入的提示词」会写清通道与原因（`disabled` / `unsupported` / `empty`）；通道显示「运行时上下文」或「提示词段」说明该宿主没有 `agents` 服务，退回旧通道（仍然注入，只是不单独成条）。
   - 这条消息是**真实注入**而非 UI 复述：它就是模型看到的那条 user 消息本身（`agent.inject` 排入，客户端按 source 单独渲染成行）。
3. **面板对照**：设置 → MCP 管理 → 同一条原文逐字可见（默认展开），点「复制」应写入剪贴板。
4. **自定义描述生效**：任选一台服务器 → 「自定义描述」→ 填描述与中文关键词 → 保存。预期：① 底部出现状态文件路径 `...\.dsh-mcp-lazy\profiles.json`；② 该服务器的描述/关键词 chip 立刻更新，并出现「面板自定义」徽标；③ 面板顶部的注入文本同步改变，**聊天里那条条目也随之更新**；④ **新建会话**后直接用中文别名调 `mcp__router__search_and_activate`，应能命中该服务器；⑤ 点「恢复默认」后一切回到派生结果。
   - 若保存后徽标显示「配置文件固定」：说明 `cordis.patch.yml` 里 `serverProfiles` 定义了同名字段（配置赢，属预期）。

## 11. 已知限制与待办

**限制（当前设计如此）**

- 插件**挂载前就存在的会话不会被接管**：管理器只从 `agent/created` 认识 agent，老会话保持满量工具（fail-open）。→ 新会话才享受懒加载。
- 披露在**会话内累计保留**（0.13.0 起）：轮次边界不收回任何已披露的工具，只做 fail-open 恢复与「当前无掩码」时的重试；代价是长会话里可见工具只增不减，新会话才回到冷态。这是为 prompt cache 命中做的取舍。
- 某个 MCP 若在某会话的工具掩码算完之后才连上，它对该会话保持可见，直到下一轮 reconcile。
- 面板是**全局视图**，不含 per-session 披露状态（避免再开一条会话态通道）。
- `0.1.x` 矩阵行会跳过面板相关断言（该线没有 typert）；插件本体仍可用。
- 中文 query 对英文工具名的路由命中率差：**0.8.0 起可在面板里给每台服务器写中文别名**（别名会作为路由提示词），或在配置里用 `routingHints`/`serverProfiles` 补；未补时建议调用带 `serverName`。
- 面板是全局视图，但**自定义覆盖是全局状态**：`profiles.json` 属于 profile，不是 per-session；所有会话共享同一份描述。
- 面板保存的是「提示词与路由提示词」，**不改工具本身的 description**：模型看到的工具 schema 仍来自 MCP 原定义（避免伪造工具契约）。

**待办 backlog（按价值排序）**

1. **回填补丁**：挂载时从 `ctx.agents` 枚举既有 agent 并接管，让"装上即对当前会话生效"（可选注入，老线自动跳过）。
2. **包名/scope**：0.12.0 起已定为 `@sutong12/dsh-mcp-lazy`（同步了 `cordis.patch.yml`、README、断言、`TYPERT.package`）；GitHub 仓库仍是 `wishesl/dsh-mcp-lazy`。
3. 面板增强：按会话显示"已披露"状态、一键复制 `serverName`、覆盖的导入/导出（`profiles.json` 目前只能手改）、关键词编辑器做 tag 化。
4. ~~发布 npm~~ 已完成：`@sutong12/dsh-mcp-lazy@0.12.0`（`npm publish --registry=https://registry.npmjs.org/`）。
5. 上游回流：把 0.2 线兼容与这些功能作为 PR 提回 `leaforbook/dsh-mcp-lazy`。
6. 可选：把面板编辑的字段也写进 `cordis.patch.yml` 的 `serverProfiles`（现在是本插件自己的状态文件，好处是不改用户的 YAML，代价是用户的配置体系里看不到这些覆盖）。
7. 可选：给 CI 加一条 tag → npm 发布的工作流（现在是本地手发）。

## 12. 本地开发注意

- **免构建**：`lib/` 是提交产物，安装端不跑构建（pnpm 不装 git 依赖的 devDeps）。浏览器半是手写 bundle，改完直接提交。
- **Windows 换行**：仓库有 `.gitattributes`（`eol=lf`）；测试读文件时统一 `\r\n → \n`。提交用 `git -c core.autocrlf=false`。
- **清点验证工具**：`E:\gopackage2\2026-8\woker1\_contract\host` 是沙盒（装了真实 typert-loader / typert-protocol 等），`probe-manifest.mjs`、`probe-installed.mjs` 可直接用真实 loader 校验清单；改 `TYPERT` 或增删调用前后都跑一次（`cd _contract\host; node probe-manifest.mjs`）。
- **装机时宿主在跑 → `install_bundle` 可能报 `application: failed` + `ambiguous-install`**：pnpm 其实成功（exitCode 0），profile 里 `node_modules\@sutong12\dsh-mcp-lazy` 也已换成新版本（读 `package.json` 版本号 + 比对 `lib\*.js` 哈希即可确认；注意本地工作区可能是 CRLF、git 检出是 LF），只是运行中的进程还持有旧模块，管理器无法声称一次干净的激活。**以磁盘文件为准，然后重启 DSH**，不要为此反复重装。
- **`npm install --no-save` 会互相剪包**：它把上一次未写进 package.json 的包当 extraneous 删掉，所以 compat 的多个包必须**一条命令**装；跑完基线 lane 前记得 `npm ci` 还原，否则 `test/host-runtime-compat.test.mjs`（"profile 不得 shadow 宿主 runtime 包"）会失败——这是**环境问题，不是代码缺陷**，CI 里两个 job 天然分开所以不会遇到。
- **面板写入的状态文件**：`<profile>\.dsh-mcp-lazy\profiles.json`。手工改它也能生效（下一轮装配读）；字段与 `serverProfiles` 同形，超长/多行会被归一化（描述折成一行、关键词去重截断）。
- **不要做的事**：
  - 不要用 `plugin_manager set_plugin target=include:mcp-playwright enabled=false` 关 MCP —— 关掉会让该 server 从路由目录消失，等于删能力；要停用整个接管，改 profile patch 里 `- id: mcp-lazy-manager` + `disabled: true`。
  - 不要递归扫描 `AppData` 找日志（几百万文件，会卡死）；日志不在 `$DSH_HOME/logs`（桌面版另有去向，未定位）。
  - 不要把宿主管家包写进 `dependencies`（会 shadow 宿主 runtime，`test/host-runtime-compat.test.mjs` 会拦）。
  - 不要再单独写一份「索引文本」的求值逻辑给面板用：面板必须复用 `provideText()`（否则会出现"看到的不等于注入的"这类最难查的 bug）。

## 13. 排障速查

| 症状 | 最可能原因 | 检查点 |
|---|---|---|
| 面板出现但「读取失败 … HTTP 404」 | 清单校验失败 → 调用没注册 | `TYPERT.package` 是否等于真实包名；codec 是否 `strict`（result **和每个参数**）；用 `_contract/host/probe-installed.mjs` 跑真实 loader |
| 设置里没有「MCP 管理」 | 客户端 bundle 没加载 / 宿主缺 typert | `plugin_manager list_plugins` 看插件是否 active；`dsh.client` 声明是否在；重启是否完成 |
| 聊天里没有 MCP 注入条目 | 宿主没有 `agents` 服务（面板通道会显示「运行时上下文」或「提示词段」，那两种都不会单独成条），或索引未启用/为空 | 面板「注入的提示词」写明通道与原因（`disabled` / `unsupported` / `empty`）；确认 `promptIndex: false` 没被配置 |
| 保存了描述但索引没变 | 配置同名字段优先；或保存失败 | 卡片上的来源徽标是否「配置文件固定」；底部状态文件路径/失败原因；点刷新看 `override` 是否已更新 |
| 保存后底部显示「未找到 profile 目录」 | 宿主没暴露 `ctx.baseUrl` / `desktopProfiles` | 只在本次会话有效；检查宿主是否在 `apply` 前设好 `baseUrl`（typert-loader 也依赖它） |
| 面板文本与模型实际收到的不一致 | 有人另写了一份求值逻辑 | 必须复用 `provideText()`；compat 用例 `real host: the panel service…` 会断言二者逐字节相等 |
| 新会话仍看到全部 MCP 工具 | 老会话未接管 / 服务器在该会话掩码算完后才连上 | 换新会话；`/mcp` 式路由查询；`plugin_manager list_plugins` 看 MCP 是否 active |
| 路由查不到某个 server | 该 MCP 未通过兼容性准入；或别名没进 hints | 工具名是否规范 `mcp__<server>__<tool>`、是否有重名；中文别名请在面板保存（保存后即时进入路由） |

## 14. 回滚与停用

```yaml
# C:\Users\Tony\.dsh\profiles\web\cordis.patch.yml（末尾追加覆盖行）
- id: mcp-lazy-manager
  disabled: true       # 停用接管：工具恢复常驻可见，插件仍安装
```

```powershell
# 完全卸载（web profile）
dsh plugin --profile web remove @sutong12/dsh-mcp-lazy
# 或手工把 profile package.json 里的依赖键与 dsh.profile.bundles 项一起删掉，再 pnpm install + 重启
```

停用接管后，若同时把 playwright / chrome-devtools 保持常开，每个会话会多出 55 个工具 schema —— 这也是本次新增索引面板想避免的情况。

---

### 附：一页速查

```
仓库        https://github.com/wishesl/dsh-mcp-lazy          HEAD <见 §3 最新一行> / 0.13.0
npm         @sutong12/dsh-mcp-lazy@0.12.0                   （最新发布；发布用 --registry=https://registry.npmjs.org/）
本地克隆    E:\gopackage2\2026-8\woker1\dsh-mcp-lazy-fork
沙盒        E:\gopackage2\2026-8\woker1\_contract\host      （真实 typert-loader 校验：node probe-manifest.mjs）
profile     C:\Users\Tony\.dsh\profiles\web                  （link: 本仓库；改插件后需重启 DSH）
宿主包      node scripts/link-host-peers.mjs E:\gopackage2\2026-8\dsh-start\dsh-vsn\0.2.1-alpha.1   （npm ci 后必跑，用当前宿主目录）
网关工具    mcp__router__search_and_activate(query, serverName?)
面板        settings.section id=mcp-lazy / remote 命名空间 mcpLazy
            snapshot() / saveProfile({serverName,description?,keywords?}) / resetProfile({serverName})
导航图标    认领 [role="dialog"] nav button 里文本=自己 label 的那一行（官方无图标位），mask 剪影跟随主题
面板状态    <profile>\.dsh-mcp-lazy\profiles.json            （面板自定义描述/关键词，原子写）
注入条目    一条 user 消息：source `{ kind: 'mcp-lazy', form: 'catalog' }`（聊天里单独成条）；降级：运行时上下文 `mcp-lazy:index` @ order 130 → 提示词段 @ order 3150
测试        npm test → 183 项（179 通过 / 4 skipped 左右）；真宿主 DSH_COMPAT_VERSION=0.2.0-rc.2 → 4/4
真宿主      DSH_COMPAT_VERSION=0.2.0-rc.2 node --test test/dsh-version-compat.test.mjs   （3/3）
```
