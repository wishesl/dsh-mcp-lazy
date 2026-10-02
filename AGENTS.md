# AGENTS.md

DSH 插件 `@sutong12/dsh-mcp-lazy`（fork 自 `leaforbook/dsh-mcp-lazy`）：按会话隐藏兼容 MCP 的工具 schema，只留网关工具 `mcp__router__search_and_activate`，需要时再披露。

本文件会随每次请求注入，所以只写「不说就会做错」的事；架构、配置、Typert 硬规则、排障、回滚见 `docs/HANDOVER.md`（注意它停在 0.10.0 / desktop profile / 154 项测试，那些数字已过期）。

## 命令

```sh
npm ci --legacy-peer-deps --ignore-scripts          # 必须带这两个 flag
npm test                                            # node --test test/*.test.mjs
node scripts/link-host-peers.mjs <DSH 安装目录>      # profile 用 link: 装本仓库时必须先跑一次
DSH_COMPAT_VERSION=0.2.0-rc.2 node --test test/dsh-version-compat.test.mjs
```

- `lib/` 是提交产物，**没有构建步骤**；`lib/client.js` 是手写 `__ModuleLoader__` bundle（`require('react')` 由宿主模块表提供），不要引入打包器或 zod。
- PowerShell 里设环境变量写 `$env:DSH_COMPAT_VERSION='0.2.0-rc.2'`。

## 测试注意（都是环境坑，不是代码缺陷）

- 兼容车道的 7 个宿主包要**一条** `npm install --no-save --ignore-scripts` 装完（分次装会被 npm 当 extraneous 剪掉）；跑基线车道前用 `npm ci --legacy-peer-deps --ignore-scripts` 还原。
- `test/host-runtime-compat.test.mjs` 断言仓库所在 tree 内解析不到 `@deepseek-ai/dsh-tools|dsh-subprocess`。两个原因都会让它失败：① 本地装过宿主包（compat 车道或 `link-host-peers.mjs` 的 junction）→ `npm ci --legacy-peer-deps --ignore-scripts` 还原；② **在 DSH 启动的 shell 里**（launcher 设了 `NODE_PATH`，CJS `require.resolve` 认它，ESM `import` 不认）→ 先 `$env:NODE_PATH=''` 再跑，否则 `npm test`、`npm publish`（prepublishOnly 会跑测试）都会误报。CI 两个原因都没有。
- Windows：`.gitattributes` 定 `eol=lf`，测试读文件统一 `\r\n → \n`；提交用 `git -c core.autocrlf=false`。
- README / `cordis.patch.yml` / CI 流程都有断言测试（`readme-install`、`ci-workflow`、`package-metadata`、`runtime-version`），改这些文件的措辞或结构要同步改期望。

## 不能违反的约束

- **fail-open**：无法确定接管安全就放行、恢复可见；不伪造状态，不改传输/OAuth 协议。
- `lib/wire.js` 与 `lib/client.js` 是同一套 Typert 描述符的两面（浏览器半不能 import wire.js），必须同步改，`test/client-bundle.test.mjs` 会拦漂移。codec 一律 `mode:'strict'`，`TYPERT.package` 必须等于真实包名。
- 不要把 `@deepseek-ai/dsh-*` 宿主包写进 `dependencies`（会 shadow 宿主 runtime）。
- `lib/service.js` 只能动态 import（静态依赖 typert-protocol）；面板服务挂载要 `await` 在 `apply` 内完成。
- 面板显示的注入文本必须复用 `provideText()`，不要另写一份索引求值逻辑。
- 索引通过 `agent.inject(createUserMessage({ source: { kind: 'mcp-lazy', form: 'catalog' } }))` 注入（与根目录 AGENTS.md 同一机制）；通道优先级 message → context → section，三者互斥。
- 面板写入落 `<profile>/.dsh-mcp-lazy/profiles.json`（临时文件 + rename 原子写），不动 `cordis.patch.yml`；配置 `serverProfiles` 逐字段压过面板。`modelProfileEdits` 不设＝面板开关说了算。
- 设置导航行没有图标位（`settings.section` 只投影 `id/order/label`，导航图标按 section id 硬编码）：只能**认领 DOM 行 + 注入 CSS**（`installNavIcon`）。不要往注册项塞 `icon`、不要借 `label` 的非契约行为、不要用 `:has()`；零命中和 fiber 拆卸都必须优雅（退回官方齿轮），`test/client-nav-icon.test.mjs` 会拦。

## 提交

- 提交信息 `type(scope): subject`（`feat(panel): …` / `fix(panel): …` / `docs: …`），推 `main`。
- 动了 `lib/` 或测试就先跑 `npm test`；纯文档改动不必。
