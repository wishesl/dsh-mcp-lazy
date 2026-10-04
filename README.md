# DSH MCP Lazy（@sutong12/dsh-mcp-lazy）

这是一个给 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 使用的插件。

一句话说明它的用途：**MCP 装得越多，模型每轮都要读取的工具说明就越多；这个插件会先把暂时用不到的工具说明藏起来，需要时再加载，从而减少 Token 消耗。**

当前版本：`0.13.0`

## 它解决了什么问题

假设你在 DSH 里装了文件、浏览器、数据库等多个 MCP。即使当前问题只需要文件工具，所有 MCP 的工具名称、说明和参数也可能一起进入模型上下文，白白占用 Token。

安装本插件后：

1. 新会话开始时，兼容 MCP 的大量工具不会全部出现。在这些被接管的 MCP 工具中，模型只会看到一个路由工具：`mcp__router__search_and_activate`。
2. 当任务需要某个 MCP 时，路由工具会找到它，并把它的工具披露给当前会话。
3. 披露是**按会话累积**的：已经出现过的 MCP 工具在本次会话内一直可用，不会在下一轮被收回 —— 工具表保持稳定，对 prompt cache 友好。
4. 其他会话不会继承本会话已经披露的工具；新会话从最省的冷态重新开始。

这个过程叫做 **Schema 按需披露**。这里的 Schema 可以简单理解为“模型调用工具前必须阅读的工具说明书”。

普通 DSH 工具不会被隐藏。不符合要求、无法安全接管的 MCP 也会保持原样，因此不会为了节省 Token 影响工具使用。

## 安装

```sh
dsh plugin --profile web add @sutong12/dsh-mcp-lazy
```

安装后重启 DSH 即可。插件会自动发现已经安装的兼容 MCP，不需要逐个填写 MCP 地址、请求头或密钥。

源码和版本记录在 [GitHub](https://github.com/wishesl/dsh-mcp-lazy)（fork 自 [leaforbook/dsh-mcp-lazy](https://github.com/leaforbook/dsh-mcp-lazy)）。

## 装完以后怎么用

正常向模型提问即可，不需要手动操作插件。

例如你可以说：

> 帮我找出项目里所有超过 10 MB 的 PDF 文件。

模型会先通过共享路由找到文件 MCP，再调用它的原生工具。插件只负责决定“什么时候让模型看到哪些工具”，真正的工具调用仍由原 MCP 完成。

安装包会自动加入下面这条 manager 配置：

```yaml
- insert:
    - id: mcp-lazy-manager
      name: '@sutong12/dsh-mcp-lazy'
      config:
        mode: manager
```

通常不需要手动修改它。

## 能节省多少 Token

节省量取决于你装了多少 MCP，以及它们的工具说明有多长。MCP 越多、工具越复杂，效果通常越明显。

0.4.0 的显式懒加载模式曾对三个常见 MCP 的工具说明做过统一测量：

| MCP | 原来常驻的工具 | 使用插件后的冷态工具 | 工具说明 Token 减少 |
| --- | ---: | ---: | ---: |
| Chrome DevTools MCP 1.7.0 | 29 个 | 2 个控制工具 | 4,585 → 200，减少 95.6% |
| Playwright MCP 0.0.79 | 24 个 | 2 个控制工具 | 3,452 → 195，减少 94.4% |
| Filesystem MCP 2026.7.10 | 14 个 | 2 个控制工具 | 1,694 → 190，减少 88.8% |
| 合计 | 67 个 | 6 个控制工具 | 9,727 → 581，减少 94.0% |

0.5.0 的自动接管测试中，冷态工具说明从 404 Token 降到 63 Token，减少了 84.4%。测试里的工具说明较短，大型 MCP 通常能省下更多绝对 Token。

这里的百分比只表示“工具说明”缩小了多少，不代表整次请求或账单一定下降同样的比例。聊天记录、系统提示和用户输入仍会占用 Token。

**关于缓存**：披露后的工具在会话内一直可见，所以工具表只在“新披露一台服务器”时变化一次，不再每轮抖动 —— 上下文缓存（prompt cache）因此能持续命中。代价是长会话里披露过的服务器越多、工具表越大；新建一个会话即回到最省的冷态。

<details>
<summary>查看完整的 Token 计算示例</summary>

以上面三个 MCP 为例，工具说明每轮少了约 9,146 Token。如果请求中还有其他上下文，整次输入大约会变成：

| 其他上下文 | 原总输入 | 使用插件后 | 约减少 | 整次输入降幅 |
| ---: | ---: | ---: | ---: | ---: |
| 0 Token | 9,727 | 581 | 9,146 | 94.0% |
| 10,000 Token | 19,727 | 10,581 | 9,146 | 46.4% |
| 50,000 Token | 59,727 | 50,581 | 9,146 | 15.3% |
| 100,000 Token | 109,727 | 100,581 | 9,146 | 8.3% |

这些数据使用 `cl100k_base` 对相同格式的工具说明进行比较，只适合观察前后差异，不等同于 DeepSeek 的精确计费 Token。要核算实际收益，请比较同类请求的 `prompt_tokens` 和缓存命中数据。

</details>

## 哪些 MCP 会被自动接管

插件会先做一次**兼容性准入**检查。只有工具名称清楚、没有冲突，而且能够安全隐藏和重新显示的 MCP，才会被接管。

| MCP 类型 | 插件会怎么处理 | MCP 连接由谁管理 |
| --- | --- | --- |
| 显式 `dsh-mcp-lazy` server | 需要时显示工具，并按需建立连接 | 本插件 |
| 通过兼容性准入的其他 DSH MCP | 需要时显示原 MCP 已注册的工具 | 原 MCP 插件 |
| 不兼容或无法确认的 MCP | 完全不接管，工具照常可见 | 原 MCP 插件 |

**不兼容的 MCP 保持原样。** 出现命名异常、工具重名、目录不完整或 DSH 能力不足等情况时，插件会主动放弃接管。

技术上，这种处理方式叫 **fail-open**：只要无法确定接管是安全的，就优先保证工具可用，不强求节省 Token。

## 关闭自动接管

如果你想让所有 MCP 恢复原来的显示方式，只禁用 manager 条目即可。在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中加入：

```yaml
- id: mcp-lazy-manager
  disabled: true
```

请保留这段覆盖配置；删掉后，安装包会再次启用 manager。

它只关闭自动接管，显式 lazy server 配置不会受影响。你不需要卸载 npm 包，也不用修改其他 MCP 的地址、请求头或密钥。

## 需要连 MCP 时才启动它

自动接管主要减少模型看到的工具说明，不会关闭第三方 MCP 进程。

如果你还希望某个 MCP 平时不连接、用到时才启动，可以把它显式配置为本插件的 server。这称为**连接层懒加载**。

<details>
<summary>查看 stdio 和 HTTP 配置示例</summary>

在对应配置目录的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: mcp-lazy
      name: '@sutong12/dsh-mcp-lazy'
      config:
        transport: stdio
        serverName: filesystem
        command: npx
        args: [-y, '@modelcontextprotocol/server-filesystem', '/tmp']
        connectTimeoutMs: 30000
        discoveryTimeoutMs: 60000
        maxToolListPages: 100
        reconnectAttempts: 1
        autoActivate: false
        releaseOnTurnEnd: true
        warmIdleMs: 300000
        routingHints: [文件, 目录]

    - id: mcp-lazy
      name: '@sutong12/dsh-mcp-lazy'
      config:
        transport: streamable-http
        serverName: remote-api
        url: http://127.0.0.1:8000/mcp
        headers: {}
        warmIdleMs: 300000
        routingHints: [远程接口, API]
```

</details>

### 显式 server 配置说明

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `transport` | 无 | 必填。使用 `stdio` 或 `streamable-http`。 |
| `serverName` | 无 | 必填。服务器简称，只能使用字母、数字、下划线和短横线，最长 32 个字符。 |
| `command` / `args` / `env` / `cwd` | 无 | `stdio` 模式下的启动命令、参数、环境变量和工作目录。 |
| `url` / `headers` | 无 | HTTP 模式下的服务地址和请求头。 |
| `toolCallTimeoutMs` | `60000` | 一次工具调用最多等待多少毫秒。 |
| `connectTimeoutMs` | `30000` | 建立连接最多等待多少毫秒。 |
| `discoveryTimeoutMs` | `60000` | 读取一页工具目录最多等待多少毫秒。 |
| `maxToolListPages` | `100` | 一次最多读取多少页工具目录。 |
| `reconnectAttempts` | `1` | 意外断开后最多自动重连几次，设为 `0` 可关闭。 |
| `autoActivate` | `false` | 是否在 DSH 启动时立即连接。开启后不再按需连接。 |
| `releaseOnTurnEnd` | `true` | 当前轮结束后是否隐藏已经加载的工具说明。 |
| `warmIdleMs` | `300000` | 工具隐藏后继续保留连接多久，默认 5 分钟；设为 `0` 会立即断开。 |
| `routingHints` | `[]` | 帮助路由器识别这个 MCP 的关键词，如业务名、能力或常用叫法。 |

连接保温的作用是：本轮结束后先隐藏工具说明，但暂时不断开 MCP。短时间内再次使用时，可以直接复用连接，减少等待。

这一项只属于**显式 server**（`mode: stdio` / `streamable-http`）。`mode: manager` 的接管路径不参与连接生命周期，它的披露按会话累积（见「它解决了什么问题」）；想让显式 server 也跨轮保持可见，把 `releaseOnTurnEnd` 设为 `false`。

## 怎么确认插件已经生效

1. 安装并重启 DSH。
2. 新建一个会话。
3. 在冷态工具列表中，已经被接管的 MCP 工具应该隐藏，只留下共享路由 `mcp__router__search_and_activate`；普通 DSH 工具仍然可见。
4. 提出一个需要某个 MCP 的任务。路由完成后，模型会看到这个 MCP 的工具，并能正常调用。
5. 再发一条消息（不重新路由）：这个 MCP 的工具应该**还在**工具表里 —— 披露在会话内不会每轮被收回。
6. 新建另一个会话。前一个会话披露过的 MCP 工具不应出现在新会话中。

如果某个 MCP 一直可见，通常说明它没有通过兼容性检查，因此被保留为原来的工作方式。这不代表插件失效。

## 兼容性

已经测试的 DSH 版本：`0.1.0-rc.6、0.1.0-rc.7、0.1.0-rc.8、0.2.0-rc.1 和 0.2.0-rc.2`。

`peerDependencies` 声明的走廊是 `>=0.1.0-rc.6 <0.3.0`（`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/dsh-subprocess`）。注意 0.1 线用 `^0.1.0-rc.6` 会**排除整个 0.2 线**：0.2 线（如 `0.2.0-rc.2`）虽然同样提供 `tools.register/schemas/get/restrict`、`tools/change`、`agent/created`、`agent/turn-stopping`、`agent/disposed` 与 `scrubbedParentEnv`，但它的 harness 包之间是**精确锁版**的，跨线混装会对不上。

在 `0.2.0-rc.2` 上，接管路径是按真实宿主验证的：挂载真实的 `@deepseek-ai/cordis` + 真实 `ToolService`、注册真实的 `mcp__*` 工具、再经真实 agent scope 的 `ctx.tools.restrict({ deny })`，结果是该会话只看到 `mcp__router__search_and_activate`、其他 MCP 工具被隐藏、全局目录不受影响、卸载后全部恢复。对应的真实宿主用例在 `test/dsh-version-compat.test.mjs`，由 `dsh-compat` 矩阵逐版本执行。

插件实际通过 DSH 是否提供所需能力来决定能否启用，而不是只看版本号。如果缺少工具目录读取、工具查询或按会话隐藏工具等能力，插件不会施加全局限制。

DSH 升级大版本后，建议先运行本仓库的兼容测试，再用于重要环境。

## 使用限制

- 自动接管只减少模型侧的工具说明，不负责停止、重启或代理第三方 MCP 进程。
- 只有能够被准确识别、安全隐藏并重新显示的完整 MCP，才会被接管。
- 披露在**会话内累计保留**：一个会话里披露过的 MCP 工具会一直可见，直到该会话结束；新会话重新回到冷态。这是为了工具表稳定（缓存命中）而做的取舍。
- 不支持 `tool.execution.taskSupport === 'required'` 的任务型工具，调用时会直接返回错误。
- 自动重连次数有限。超过次数后，需要重新调用 `activate`。
- 保温连接只存在于当前 DSH 进程中，不会写入磁盘。DSH 重启后需要重新读取工具目录。
- Token 数据是工具说明的近似测量，不能直接换算为账单金额。

## 设置面板：「MCP 管理」——看得到注入，也能自定义

装的 MCP 越多，越难记住到底有哪些服务器、各自提供什么。插件在**设置**里注册了一个独立菜单（槽位 `settings.section`，条目 id `mcp-lazy`）；聊天里则直接能看到注入条目（见下一节）。

左侧菜单那一行的图标是插件**自己认领**来的：`settings.section` 只投影 `id` / `order` / `label`，导航图标按 section id 硬编码、未知 id 一律兜底通用齿轮。所以浏览器半挑出「行文本等于自己 label」的那一行，藏掉官方 svg，用 `mask-image` 画一个跟随主题色的漏斗（做法与 dshmarket 的 `settings-nav-icon.ts` 一致）。官方改了设置面板结构时认领会零命中并**优雅退回齿轮**，不影响插件其余功能；官方哪天给 `settings.section` 长出 `icon` 字段，这段整块删掉。

- **注入的提示词（默认展开）**：真正注入的那段**原文**（与聊天里那条独立注入记录逐字相同），可一键复制，并标注通道（会话消息 / 运行时上下文 / 提示词段）与「何时未注入」（`promptIndex: false` / 宿主缺通道 / 当前无受管服务器）。
- **自定义描述与关键词**：每张服务器卡片上有「自定义描述」，编辑后**保存**即写入 profile，下一轮装配生效；「恢复默认」删除覆盖，回到从 MCP 定义派生的结果。字段来源会标成「面板自定义 / 配置文件固定 / 自动派生」。
- 每个受管服务器的名称、工具数、**路由关键词**与可选描述；
- 展开后是它的工具清单（名称 + 描述，描述截断到 300 字符）；
- 未通过兼容性准入的 `mcp__*` 工具单独折叠列出（它们保持常驻可见）；
- 目录签名、快照时间，以及自定义描述的**状态文件路径**（或写不进去的原因），便于判断是否刷新过。

面板数据来自 Host 的 `mcpLazy` Typert Remote 命名空间（`mcpLazy/snapshot`、`mcpLazy/saveProfile`、`mcpLazy/resetProfile`），经真实工具注册表读取。浏览器半是手写的 `__ModuleLoader__` bundle（`lib/client.js`，无构建步骤），React 由宿主模块表提供。宿主缺少 `@deepseek-ai/dsh-typert-protocol` 时（0.1.x 线）面板自动缺席，插件其余功能不受影响。

### 自定义描述存在哪里、谁能覆盖谁

- 面板写入 profile 下的 `.dsh-mcp-lazy/profiles.json`（同目录临时文件 + rename 原子写），**不动 `cordis.patch.yml`、不动 profile 的 `package.json`**，插件升级不丢。
- 与配置键 `serverProfiles` 的优先级是**逐字段**的：配置（手写 YAML）赢，面板只赢它自己设置、配置没有设置的字段；被配置固定的字段在面板上标注，不会让你以为「改了没生效」。
- 自定义的**描述与关键词同时作为路由提示词**参与匹配（不只是展示）：索引里广告的中文别名，路由器真的搜得到。此前 `serverProfiles` 的关键词只进面板与索引、不进路由，这个缺口在 0.8.0 一并修掉。
- 宿主给不出 profile 目录时（少见）降级为**本次会话内有效**，面板会明说，不会假装保存成功。
- 写入只影响「面板展示 + 提示词索引 + 路由提示词」三处，不触碰接管/披露/工具可见性等安全相关行为。

## 提示词索引：注入什么，聊天里就看得到

装配时，插件通过 **`agent.inject()`** 把 MCP 索引作为**一条独立的会话消息**塞进每次请求（`source: { kind: 'mcp-lazy', form: 'catalog' }`）—— 这正是根目录 `AGENTS.md` 的注入方式，所以它会在**聊天消息流里单独成条**：

```text
## MCP 服务器（按需加载）

以下 MCP 服务器的工具默认不在工具表里。需要时调用 `mcp__router__search_and_activate`：带 `query`（能力关键词）或 `serverName`（精确指定服务器名）；披露后本次会话内一直可直接调用。

- chrome-devtools（30 个工具）: page, performance, get, list, take, fill, snapshot, trace
- context7（2 个工具）: library, query, org, project, format, name, score, version
- playwright（25 个工具）: browser, page, network, snapshot, navigate, screenshot, close, drop
- tavily（5 个工具）: research, crawl, extract, map, search, content, urls, information
```

- **为什么是消息而不是别的**：Chat 客户端（`conversation-nodes/message.js`）会把**每一条**「user 角色、但不是用户亲手提交」的消息渲染成独立的 `context` 条目，标签由 `source.kind` 决定、展示形式由 `source.form` 决定（`catalog` 是宿主支持的形式之一）；AGENTS.md 就是这么出现的。而 `systemPrompt.context()` 会被拼进同一条 `Current runtime context` 快照消息里，和沙箱/审批等条目挤在一起，看不出「MCP 注入」这条独立记录。
- **不会打断对话**：`agent.inject` 的语义是「排到下一次 pre-step，**不唤醒驱动器**」；空闲会话把它挂起到下次唤醒。挂载时还会**回填已存在的会话**，老会话的下一次请求也带上索引。
- 索引变化（工具目录变动、面板保存）会**重新排入**：同一文本不会重复排；旧的待消费副本先移除，已进入历史的旧条目保留（与 AGENTS.md 的替换语义一致）。
- **通道优先级与降级**：消息通道（宿主有 `agents` 服务）→ 运行时上下文（`systemPrompt.context`）→ 提示词段（`systemPrompt.section`）。三者互斥、绝不重复注入；面板「注入的提示词」会标明当前走哪条通道，以及「会话里看哪条」。
- **关键词与描述默认全部从 MCP 定义派生**（服务器名、`routingHints`、工具名、工具描述），与路由器打分**同源** —— 面板里看到的、注入的就是路由真正搜索的东西，因此无需人工维护清单。
- 需要中文别名或更贴切的用途说明时，直接在面板里编辑，或用 `serverProfiles` 覆盖；派生结果始终兜底。两者都会参与路由匹配。
- 文本是「目录签名 + 有效配置」的纯函数并做了缓存：注册表不变时**逐字节相同**（对 prompt cache 友好），保存后下一轮装配重算；没有任何受管服务器时**什么都不注入**、零成本。

### agent 自己也能补：`mcp__router__describe_server`

模型面此前只有路由工具，「描述可以改」这件事对 agent 既不可发现、也无从下手。现在 `mode: manager` 会额外注册一个写工具：

- **开关就在面板上**：设置 → MCP 管理 顶部有一个「允许 AI 改描述」开关，**点一下立即生效**（工具当场注册/撤销，不需要重启），选择写进 `.dsh-mcp-lazy/profiles.json` 的 `settings`，重启后保留。
- 想在 YAML 里钉死：manager 配置里写 `modelProfileEdits: true|false`。**配置优先**于面板开关（面板会把它标成「配置文件固定」并禁用），再往下才是内置默认「开」——所以「显式设过」和「没设过」在 schema 里是可区分的。
- 参数：`serverName`（受管服务器的精确名）、`description`（一句话用途，会原样进索引该行，**并参与路由匹配**）、`keywords`（可选，中文别名/路由关键词，最多 24 个）。
- 与面板写**同一份** `.dsh-mcp-lazy/profiles.json`、同一套逐字段合并语义；不传的字段保留原值。
- **不接受 `pinned`**：常驻/收起是工具可见性开关，只留在人类面板上 —— 写描述永远不会把服务器移出或移入接管。
- 结果如实回报四种「写了但不算数」：未知服务器（附当前受管名单）、字段被 `serverProfiles` 固定、目标是常驻（不进索引）、写盘失败（仅本会话有效）。
- 只影响「面板展示 + 提示词索引 + 路由打分的提示词」，不碰 `cordis.patch.yml`、不改连接与工具注册。

## 配置

除既有的 server 配置外，`mode: manager` 还支持：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `promptIndex` | `true` | 是否注入 MCP 提示词索引 |
| `promptIndexLocale` | `zh` | 索引语言：`zh` / `en` |
| `modelProfileEdits` | 面板开关（默认开） | 是否注册 `mcp__router__describe_server`（写描述/关键词）。**不设**＝面板上那个开关说了算；显式写 `true`/`false` 则钉死（面板标「配置文件固定」并禁用） |
| `descriptionChars` | `120` | 单服务器描述截断长度 |
| `keywordsPerServer` | `8` | 每服务器派生关键词上限 |
| `maxServers` | `12` | 索引最多列出的服务器数（超出记一行提示） |
| `maxSnapshotTools` | `200` | 面板快照的工具条目上限（超出计入 `omittedTools`） |
| `serverProfiles` | `{}` | `{ "<serverName>": { description?, keywords? } }` 覆盖派生结果；同时参与路由匹配，与面板写入**逐字段**合并（配置赢） |

显式 lazy server 配置新增 `promptIndex`（默认 `true`），用于把该 server 写进同一段索引：

```yaml
- insert:
    - id: mcp-lazy
      name: '@sutong12/dsh-mcp-lazy'
      config:
        transport: stdio
        serverName: filesystem
        command: npx
        args: [-y, '@modelcontextprotocol/server-filesystem', '/tmp']
        routingHints: [文件, 目录]
        promptIndex: true
```

## 给开发者的工作原理

1. manager 监听 DSH 的工具目录，只接管能够完整识别的 `mcp__<server>__<tool>` 工具组。普通工具、重名工具和无法确认来源的 MCP 直接放行。
2. 每个会话都有独立的隐藏列表。路由器选中一个 MCP 后，它的工具在该会话内一直可见（披露累积，不再按轮收回，以免工具表每轮抖动）。
3. 只有会话关闭、该服务器离开受管目录，或插件清理时，才会释放这些披露与隐藏状态。
4. 目录发生变化或隐藏操作失败时，插件会执行 fail-open，恢复原工具的可见性。
5. 对第三方 MCP，插件只显示原 MCP 注册的工具定义，不替换执行器。因此图片、附件、权限、审计、重试和进程生命周期仍由原插件负责。
6. 对显式配置的 server，插件还负责连接层懒加载、工具目录分页、有限重连和连接保温，支持 `stdio` 与 `streamable-http`。

## 测试

```sh
npm ci --legacy-peer-deps --ignore-scripts
npm test
```

测试覆盖自动接管、会话隔离、动态工具目录、安全放行、原 MCP 执行器保留、显式 server 生命周期、面板写入的持久化与降级，以及真实 stdio MCP 的分页、调用和目录变化通知。CI 会在 `0.1.0-rc.6 / rc.7 / rc.8 / 0.2.0-rc.1 / 0.2.0-rc.2` 的矩阵上逐版本跑真宿主兼容用例；在 `0.2.0-rc.2` 上这些用例还会用**真实的** Typert 协议挂载面板服务，验证「面板显示的提示词 = 系统提示词里那段」「保存的中文别名能被真实注册表路由出来」「覆盖写进 profile 并能被重置」。

维护与交接说明（架构、配置、Typert 硬规则、排障、回滚、backlog）见 [`docs/HANDOVER.md`](./docs/HANDOVER.md)。

### 本地开发：`link:` 安装要补一次宿主包

profile 用 `link:` 指向本仓库时（改一行代码、重启即生效），插件的真实路径就是仓库目录，而宿主启动器只设 `NODE_PATH` —— **CJS 的 `require` 认它，ESM 的 `import` 不认**：

- `@deepseek-ai/dsh-tools` / `dsh-subprocess` 声明在 `peerDependencies` 里，由宿主 loader 映射，照旧能加载；
- `@deepseek-ai/dsh-typert-protocol` 是动态 import（宿主没有就整体跳过），解析失败时**设置面板的服务会静默缺席**，前端只报 `mcpLazy/snapshot: active Service "mcpLazy" is unavailable`。

补一次即可（`npm ci` 会清掉这些链接，重跑脚本即可；脚本同时让仓库能本地跑真宿主兼容用例）：

```sh
node scripts/link-host-peers.mjs                 # 在 DSH 启动的 shell 里（NODE_PATH 可用）
node scripts/link-host-peers.mjs <DSH安装目录>    # 否则显式给 DSH 安装目录
```

## 许可证

MIT

