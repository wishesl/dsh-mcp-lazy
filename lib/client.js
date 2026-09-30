// 浏览器半：设置里注册一个独立的「MCP 管理」菜单。
//
// 格式是宿主浏览器模块表的懒工厂（harness 自带模板 templates/decoration/client.js
// 即此形态）：`window.__ModuleLoader__.load({ id, factory(require) })`，React 由
// `require('react')` 从模块表拿，不重复安装、不打包。因此本文件**手写、无构建**，
// 与本仓库 `lib/` 既有的「提交产物、装机即用」一致。
//
// 三块内容：
//   1. 目录快照：每台被接管的 MCP（工具数、关键词、工具清单、未准入的直通工具）；
//   2. **注入的提示词**：段 `mcp-lazy:index` 的实际文本，逐字展示（可复制）——
//      用户终于能看到模型到底收到了什么，而不是靠文档描述；
//   3. **自定义描述/关键词**：可编辑，保存后写进 profile 的状态文件，下一轮装配
//      即生效（Host 侧 lib/service.js + lib/profile-store.js）。
// 面板内容本身永不进入模型上下文；只有第 2 块展示的是「确实进了上下文的那段」。
//
// 注意：手写 bundle 不能 import './wire.js'，下面三个 DESCRIPTOR 是它的等价字面量；
// test/client-bundle.test.mjs 会断言两面逐字段一致（防漂移）。

window.__ModuleLoader__.load({
  id: '@yilinxiao/dsh-mcp-lazy',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'settings.mcpLazy'
    const LOCALIZED = 'mcp-lazy: localized panel text'
    // The real npm package name: typert-loader rejects a manifest owned by any
    // other name, and the host registry keys the invocations by this package.
    const PACKAGE = '@yilinxiao/dsh-mcp-lazy'
    const NAMESPACE = 'mcpLazy'

    // Mirrors lib/wire.js. The loader requires a `strict` codec for both the
    // result and every parameter, and the browser half cannot import the host
    // file, so the descriptors are duplicated here; test/client-bundle.test.mjs
    // asserts the two faces do not drift.
    const SNAPSHOT_SCHEMA = {
      parse(value) {
        const fail = (detail) => {
          throw new Error(`mcpLazy/snapshot: ${detail}`)
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('result must be an object')
        if (typeof value.routerTool !== 'string') fail('routerTool must be a string')
        if (typeof value.generatedAt !== 'number' || !Number.isFinite(value.generatedAt)) fail('generatedAt must be a finite number')
        if (typeof value.signature !== 'string') fail('signature must be a string')
        if (!Array.isArray(value.servers)) fail('servers must be an array')
        for (const server of value.servers) {
          if (server === null || typeof server !== 'object' || Array.isArray(server)) fail('every server must be an object')
          if (typeof server.serverName !== 'string') fail('serverName must be a string')
          if (typeof server.toolCount !== 'number') fail('toolCount must be a number')
          if (!Array.isArray(server.keywords)) fail('keywords must be an array')
          if (!Array.isArray(server.tools)) fail('tools must be an array')
          if (server.override === null || typeof server.override !== 'object' || Array.isArray(server.override)) {
            fail('every server must carry an override object')
          }
          if (server.override.description !== null && typeof server.override.description !== 'string') {
            fail('override.description must be a string or null')
          }
          if (server.override.keywords !== null && !Array.isArray(server.override.keywords)) {
            fail('override.keywords must be an array or null')
          }
          if (server.overrideSource === null || typeof server.overrideSource !== 'object' || Array.isArray(server.overrideSource)) {
            fail('every server must carry an overrideSource object')
          }
        }
        if (!Array.isArray(value.passthrough)) fail('passthrough must be an array')
        const index = value.promptIndex
        if (index === null || typeof index !== 'object' || Array.isArray(index)) fail('promptIndex must be an object')
        if (typeof index.enabled !== 'boolean') fail('promptIndex.enabled must be a boolean')
        if (typeof index.text !== 'string') fail('promptIndex.text must be a string')
        if (typeof index.name !== 'string') fail('promptIndex.name must be a string')
        if (typeof index.channel !== 'string') fail('promptIndex.channel must be a string')
        if (index.order !== null && typeof index.order !== 'number') fail('promptIndex.order must be a number or null')
        const store = value.store
        if (store === null || typeof store !== 'object' || Array.isArray(store)) fail('store must be an object')
        if (typeof store.persisted !== 'boolean') fail('store.persisted must be a boolean')
        const edits = value.modelProfileEdits
        if (edits === null || typeof edits !== 'object' || Array.isArray(edits)) fail('modelProfileEdits must be an object')
        if (typeof edits.enabled !== 'boolean') fail('modelProfileEdits.enabled must be a boolean')
        if (typeof edits.source !== 'string') fail('modelProfileEdits.source must be a string')
        return value
      }
    }

    const PROFILE_INPUT_SCHEMA = {
      parse(value) {
        const fail = (detail) => {
          throw new Error(`mcpLazy/saveProfile: ${detail}`)
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('input must be an object')
        if (typeof value.serverName !== 'string' || value.serverName === '') fail('serverName must be a non-empty string')
        if (value.description !== undefined && typeof value.description !== 'string') fail('description must be a string')
        if (value.pinned !== undefined && typeof value.pinned !== 'boolean') fail('pinned must be a boolean')
        if (value.keywords !== undefined) {
          if (!Array.isArray(value.keywords)) fail('keywords must be an array')
          for (const keyword of value.keywords) {
            if (typeof keyword !== 'string') fail('every keyword must be a string')
          }
        }
        // 只回传存在的字段（见 lib/wire.js 的同款说明：undefined 属性不是 JSON-safe）。
        const result = { serverName: value.serverName }
        if (value.description !== undefined) result.description = value.description
        if (value.keywords !== undefined) result.keywords = value.keywords
        if (value.pinned !== undefined) result.pinned = value.pinned
        return result
      }
    }

    const RESET_INPUT_SCHEMA = {
      parse(value) {
        const fail = (detail) => {
          throw new Error(`mcpLazy/resetProfile: ${detail}`)
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('input must be an object')
        if (typeof value.serverName !== 'string' || value.serverName === '') fail('serverName must be a non-empty string')
        return { serverName: value.serverName }
      }
    }

    const SETTINGS_INPUT_SCHEMA = {
      parse(value) {
        const fail = (detail) => {
          throw new Error(`mcpLazy/saveSettings: ${detail}`)
        }
        if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('input must be an object')
        if (typeof value.modelProfileEdits !== 'boolean') fail('modelProfileEdits must be a boolean')
        return { modelProfileEdits: value.modelProfileEdits }
      }
    }

    const RESULT_TYPE_SYMBOL = `${PACKAGE}/types#McpLazySnapshot`
    const SNAPSHOT_RESULT = { mode: 'strict', typeSymbol: RESULT_TYPE_SYMBOL, create: () => SNAPSHOT_SCHEMA }
    const SOURCE_LOCATION = { file: 'lib/wire.js', line: 1, column: 1 }

    const jsonInput = (name, typeSymbol, create) => ({
      name,
      wire: name,
      source: 'json',
      codec: { mode: 'strict', typeSymbol, create }
    })

    const SNAPSHOT_DESCRIPTOR = {
      id: `${PACKAGE}#${NAMESPACE}/snapshot`,
      service: NAMESPACE,
      namespace: NAMESPACE,
      method: 'snapshot',
      invocation: { kind: 'direct' },
      parameters: [],
      result: SNAPSHOT_RESULT,
      sourceLocation: SOURCE_LOCATION
    }

    const SAVE_PROFILE_DESCRIPTOR = {
      id: `${PACKAGE}#${NAMESPACE}/saveProfile`,
      service: NAMESPACE,
      namespace: NAMESPACE,
      method: 'saveProfile',
      invocation: { kind: 'direct' },
      parameters: [jsonInput('input', `${PACKAGE}/types#McpLazyProfileInput`, () => PROFILE_INPUT_SCHEMA)],
      result: SNAPSHOT_RESULT,
      sourceLocation: SOURCE_LOCATION
    }

    const RESET_PROFILE_DESCRIPTOR = {
      id: `${PACKAGE}#${NAMESPACE}/resetProfile`,
      service: NAMESPACE,
      namespace: NAMESPACE,
      method: 'resetProfile',
      invocation: { kind: 'direct' },
      parameters: [jsonInput('input', `${PACKAGE}/types#McpLazyResetInput`, () => RESET_INPUT_SCHEMA)],
      result: SNAPSHOT_RESULT,
      sourceLocation: SOURCE_LOCATION
    }

    const SAVE_SETTINGS_DESCRIPTOR = {
      id: `${PACKAGE}#${NAMESPACE}/saveSettings`,
      service: NAMESPACE,
      namespace: NAMESPACE,
      method: 'saveSettings',
      invocation: { kind: 'direct' },
      parameters: [jsonInput('input', `${PACKAGE}/types#McpLazySettingsInput`, () => SETTINGS_INPUT_SCHEMA)],
      result: SNAPSHOT_RESULT,
      sourceLocation: SOURCE_LOCATION
    }

    const REMOTE = {
      package: PACKAGE,
      descriptors: [SNAPSHOT_DESCRIPTOR, SAVE_PROFILE_DESCRIPTOR, RESET_PROFILE_DESCRIPTOR, SAVE_SETTINGS_DESCRIPTOR]
    }

    const DICTIONARIES = {
      zh: {
        nav: 'MCP 管理',
        title: 'MCP 管理',
        subtitle: '每台 MCP 可设「收起（进提示词索引）」或「常驻（工具常显）」；下方是真正注入的原文',
        refresh: '刷新',
        loading: '读取中…',
        empty: '未发现可接管的 MCP 服务器。',
        unavailable: '本机没有可用的目录快照服务；插件其余功能不受影响。',
        error: '读取失败',
        retry: '重试',
        keywords: '关键词',
        tools: '个工具',
        toolsTitle: '工具',
        passthrough: '未接管的 MCP 工具',
        passthroughHint: '这些工具没有通过兼容性准入，保持常驻可见。',
        signature: '目录签名',
        generatedAt: '快照时间',
        noDescription: '（无描述）',
        omitted: '另有 {count} 个工具未在本页列出',
        summaryCollapsed: '{count} 台收起（会被注入索引）',
        summaryPinned: '{count} 台常驻（工具常显，不进索引）',
        modelEdits: '允许 AI 改描述',
        modelEditsHint: '开启后 agent 可调用 mcp__router__describe_server 补描述/关键词；它不能改「常驻」，随时可关',
        modelEditsConfigPinned: 'modelProfileEdits',
        pinCollapsed: '收起',
        pinPinned: '常驻',
        pinCollapsedHint: '收起：工具默认隐藏，需要时由路由器披露，并写进提示词索引',
        pinPinnedHint: '常驻：工具始终可见（不进索引、不做懒加载）',
        pinnedNote: '常驻中：这台服务器的工具始终在工具表里，因此不会出现在提示词索引里。',
        promptTitle: '注入的提示词',
        promptInactive: '（未注入）',
        promptMetaMessage: '独立会话条目（source：kind “mcp-lazy” / form “catalog”）· 与 AGENTS.md 同一种注入方式',
        promptMeta: '运行时上下文条目 “{name}” · order {order} · 与沙箱/审批等同处一条快照',
        promptMetaSection: '提示词段 “{name}” · order {order} · 该宿主没有会话条目通道，本条不会单独出现在消息流里',
        promptInChat: '会话里看：每条请求中标题为 “{name}” 的那条注入记录',
        promptDisabled: '配置里 promptIndex: false，索引不会注入。',
        promptUnsupported: '该宿主既没有 agents 服务也没有 systemPrompt.context()，索引已按 fail-soft 跳过（不注入、也不显示）。',
        promptEmpty: '当前没有被接管的服务器，索引为空串（不占 token）。',
        promptCopy: '复制',
        promptCopied: '已复制',
        edit: '自定义描述',
        editHide: '收起',
        descriptionLabel: '描述（注入索引里这一行的说明）',
        descriptionPlaceholder: '例如：浏览器自动化：导航、点击、截图、抓取页面',
        keywordsLabel: '关键词（逗号分隔，同时用于路由匹配）',
        keywordsPlaceholder: '例如：浏览器, 网页自动化, 截图',
        save: '保存',
        saving: '保存中…',
        reset: '恢复默认',
        cancel: '取消',
        saved: '已保存；下一轮装配即生效。',
        savedMemoryOnly: '已保存（宿主未给出 profile 目录：本次会话有效，重启后丢失）。',
        saveFailed: '保存失败',
        sourceConfig: '配置文件固定',
        sourceCustom: '面板自定义',
        sourceDerived: '自动派生',
        storeWarning: '无法写入 profile 状态文件：{message}',
        storeFile: '状态文件 {file}'
      },
      en: {
        nav: 'MCP servers',
        title: 'MCP servers',
        subtitle: 'Per-server: collapsed (listed in the injected index) or resident (tools always visible); below is the exact injected text',
        refresh: 'Refresh',
        loading: 'Loading…',
        empty: 'No takeover-eligible MCP server found.',
        unavailable: 'No catalog snapshot service on this host; the rest of the plugin is unaffected.',
        error: 'Failed to load',
        retry: 'Retry',
        keywords: 'Keywords',
        tools: 'tools',
        toolsTitle: 'Tools',
        passthrough: 'MCP tools not taken over',
        passthroughHint: 'These tools failed compatibility admission and stay resident.',
        signature: 'Catalog signature',
        generatedAt: 'Snapshot',
        noDescription: '(no description)',
        omitted: '{count} more tool(s) are not listed here',
        summaryCollapsed: '{count} collapsed (injected into the index)',
        summaryPinned: '{count} resident (tools always visible, not in the index)',
        modelEdits: 'Let the model edit descriptions',
        modelEditsHint: 'When on, an agent may call mcp__router__describe_server to add descriptions/keywords; it can never change "resident", and you can switch this off any time',
        modelEditsConfigPinned: 'modelProfileEdits',
        pinCollapsed: 'Collapsed',
        pinPinned: 'Resident',
        pinCollapsedHint: 'Collapsed: tools stay hidden until the router discloses them, and this server is listed in the injected index',
        pinPinnedHint: 'Resident: tools are always in the tool table (no lazy loading, not listed in the index)',
        pinnedNote: 'Resident: these tools are always in the tool table, so this server is left out of the injected index.',
        promptTitle: 'Injected prompt',
        promptInactive: '(not injected)',
        promptMetaMessage: 'its own conversation row (source: kind “mcp-lazy” / form “catalog”) — the same injection shape as AGENTS.md',
        promptMeta: 'runtime-context entry “{name}” · order {order} · shares one snapshot row with sandbox/approval',
        promptMetaSection: 'prompt section “{name}” · order {order} · this host has no message channel, so it is not itemized in the conversation',
        promptInChat: 'In chat: the injection row labelled “{name}” on each request',
        promptDisabled: 'promptIndex: false is configured, so the index is not injected.',
        promptUnsupported: 'This host has neither an agents service nor systemPrompt.context(); the index was skipped (fail-soft).',
        promptEmpty: 'No managed server right now, so the index is an empty string (no tokens).',
        promptCopy: 'Copy',
        promptCopied: 'Copied',
        edit: 'Edit description',
        editHide: 'Collapse',
        descriptionLabel: 'Description (becomes the line in the injected index)',
        descriptionPlaceholder: 'e.g. Browser automation: navigate, click, screenshot, scrape',
        keywordsLabel: 'Keywords (comma separated; also used for routing)',
        keywordsPlaceholder: 'e.g. browser, web automation, screenshot',
        save: 'Save',
        saving: 'Saving…',
        reset: 'Reset to derived',
        cancel: 'Cancel',
        saved: 'Saved; it applies on the next assembly.',
        savedMemoryOnly: 'Saved (this host exposes no profile directory: session-only, lost on restart).',
        saveFailed: 'Save failed',
        sourceConfig: 'pinned by config',
        sourceCustom: 'panel override',
        sourceDerived: 'derived',
        storeWarning: 'Cannot write the profile state file: {message}',
        storeFile: 'State file {file}'
      }
    }

    // ---- 面板样式：注入到宿主主题之上（用 --dsw-* token，自动跟随明暗主题）----
    // 手写 bundle 不能 import 样式文件，所以这里注入一段带 data-plugin 的 <style>
    // （与宿主自己的插件同款做法），并用类名而不是内联对象 —— 才有 hover/focus/
    // 过渡和真正的层级感。
    const STYLE_ID = 'dsh-mcp-lazy-styles'
    const CSS = `
.mcpl-root{display:flex;flex-direction:column;gap:14px;padding:2px 0;color:var(--dsw-alias-label-primary);font-size:14px}
.mcpl-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mcpl-title{margin:0;font-size:16px;font-weight:600}
.mcpl-subtitle{color:var(--dsw-alias-label-secondary);font-size:12.5px;flex:1 1 260px}
.mcpl-actions{display:flex;gap:8px;margin-left:auto}
.mcpl-btn{cursor:pointer;font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);transition:background .15s,border-color .15s,opacity .15s}
.mcpl-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.mcpl-btn:disabled{opacity:.5;cursor:default}
.mcpl-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}
.mcpl-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);opacity:.9}
.mcpl-btn-ghost{border-color:transparent;background:none;color:var(--dsw-alias-label-secondary);padding:5px 8px}
.mcpl-btn-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.mcpl-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s}
.mcpl-card:hover{border-color:var(--dsw-alias-border-l2)}
.mcpl-card-pinned{background:var(--dsw-alias-bg-base);border-style:dashed}
.mcpl-card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mcpl-server{font-weight:600;font-size:14.5px}
.mcpl-count{color:var(--dsw-alias-label-secondary);font-size:12.5px}
.mcpl-spacer{flex:1 1 auto}
.mcpl-chip{display:inline-block;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 9px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base)}
.mcpl-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.mcpl-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
.mcpl-switch-global{margin-top:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base)}
.mcpl-switch-global .mcpl-label{margin-left:8px;font-size:13px;color:var(--dsw-alias-label-primary)}
.mcpl-desc{margin-top:8px;font-size:13px;line-height:1.55}
.mcpl-details{margin-top:10px;font-size:13px}
.mcpl-details>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none}
.mcpl-details>summary:hover{color:var(--dsw-alias-label-primary)}
.mcpl-pre{margin:8px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;max-height:340px;overflow:auto}
.mcpl-tool{display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1);align-items:baseline}
.mcpl-tool:first-of-type{border-top:none}
.mcpl-tool-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;flex:0 0 auto;max-width:52%}
.mcpl-tool-desc{color:var(--dsw-alias-label-secondary);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mcpl-hint{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:6px;line-height:1.5}
.mcpl-editor{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}
.mcpl-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:flex-end}
.mcpl-field{display:flex;flex-direction:column;gap:4px;flex:1 1 240px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mcpl-input{font:inherit;font-size:13px;padding:7px 9px;width:100%;box-sizing:border-box;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .15s}
.mcpl-input:focus{border-color:var(--dsw-alias-brand-primary)}
.mcpl-textarea{min-height:56px;resize:vertical}
.mcpl-badge{font-size:11.5px;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.mcpl-badge-custom{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.mcpl-badge-config{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.mcpl-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mcpl-switch input{position:absolute;opacity:0;width:0;height:0}
.mcpl-track{position:relative;width:38px;height:21px;border-radius:999px;background:var(--dsw-alias-state-idle-primary);transition:background .18s;flex:0 0 auto}
.mcpl-knob{position:absolute;top:2.5px;left:2.5px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 3px rgba(0,0,0,.28);transition:transform .18s}
.mcpl-switch input:checked+.mcpl-track{background:var(--dsw-alias-brand-primary)}
.mcpl-switch input:checked+.mcpl-track .mcpl-knob{transform:translateX(17px)}
.mcpl-switch input:focus-visible+.mcpl-track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.mcpl-notice{margin-top:8px;font-size:12.5px;color:var(--dsw-alias-state-success-primary)}
.mcpl-error{color:var(--dsw-alias-state-error-primary)}
.mcpl-footer{display:flex;gap:14px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:11.5px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.mcpl-warn{color:var(--dsw-alias-state-warn-primary)}
.mcpl-empty{color:var(--dsw-alias-label-secondary);font-size:13px;padding:10px 0}
`

    /** 注入一次；宿主切换主题时 token 自动跟随，无需重挂。 */
    function ensureStyles(document) {
      const doc = document ?? (typeof globalThis.document === 'undefined' ? undefined : globalThis.document)
      if (doc === undefined || doc.head === null || doc.head === undefined) return
      if (doc.getElementById(STYLE_ID) !== null) return
      const tag = doc.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.plugin = '@yilinxiao/dsh-mcp-lazy'
      tag.textContent = CSS
      doc.head.appendChild(tag)
    }

    /** Split the keyword field on any comma flavour and drop empties. */
    function splitKeywords(text) {
      return String(text ?? '')
        .split(/[,，\n]/)
        .map(part => part.trim())
        .filter(part => part !== '')
    }

    class Panel extends React.Component {
      constructor(props) {
        super(props)
        this.state = { status: 'loading', editing: null, draft: null, busy: false, notice: null }
        this.reload = this.reload.bind(this)
        this.startEdit = this.startEdit.bind(this)
        this.cancelEdit = this.cancelEdit.bind(this)
        this.submitEdit = this.submitEdit.bind(this)
        this.resetEdit = this.resetEdit.bind(this)
        this.togglePinned = this.togglePinned.bind(this)
        this.toggleModelEdits = this.toggleModelEdits.bind(this)
        this.copyPrompt = this.copyPrompt.bind(this)
      }

      componentDidMount() {
        this.reload()
      }

      reload() {
        this.setState({ status: 'loading', notice: null })
        Promise.resolve()
          .then(() => this.props.load())
          .then(snapshot => this.setState({ status: 'ready', snapshot }))
          .catch(error => this.setState({ status: 'error', message: String((error && error.message) || error) }))
      }

      /** One write path for save and reset: the host answers with a fresh snapshot. */
      runWrite(operation) {
        this.setState({ busy: true, notice: null })
        Promise.resolve()
          .then(operation)
          .then(snapshot => this.setState({
            busy: false,
            editing: null,
            draft: null,
            status: 'ready',
            snapshot,
            notice: { kind: 'ok', text: snapshot && snapshot.store && snapshot.store.persisted === false
              ? this.props.t('savedMemoryOnly')
              : this.props.t('saved') }
          }))
          .catch(error => this.setState({
            busy: false,
            notice: { kind: 'error', text: `${this.props.t('saveFailed')}: ${String((error && error.message) || error)}` }
          }))
      }

      startEdit(server) {
        this.setState({
          editing: server.serverName,
          draft: {
            description: server.override.description ?? '',
            keywords: (server.override.keywords ?? []).join(', ')
          },
          notice: null
        })
      }

      cancelEdit() {
        this.setState({ editing: null, draft: null, notice: null })
      }

      submitEdit(serverName) {
        const draft = this.state.draft ?? { description: '', keywords: '' }
        const description = draft.description.trim()
        this.runWrite(() => this.props.save({
          serverName,
          // Sending both fields is what makes "clear the box" mean "drop the
          // override": omitted fields would keep their stored value.
          description,
          keywords: splitKeywords(draft.keywords)
        }))
      }

      resetEdit(serverName) {
        this.runWrite(() => this.props.reset({ serverName }))
      }

      /**
       * 常驻 / 收起 开关。
       *
       * Sends `pinned` alone: the host merges it over what is stored, so the
       * description box keeps its text. 收起（false）puts the server back under
       * takeover — its tools hide until routed and it returns to the index;
       * 常驻（true）keeps its tools visible and drops it from the index.
       */
      togglePinned(server) {
        const next = server.pinned !== true
        this.runWrite(() => this.props.save({ serverName: server.serverName, pinned: next }))
      }

      /**
       * 「允许 AI 改描述」开关。
       *
       * The host decides the effective value (a hand-written `modelProfileEdits`
       * config wins) and answers with a fresh snapshot, so the panel renders
       * whatever actually took effect rather than the click.
       */
      toggleModelEdits() {
        const snapshot = this.state.snapshot
        const enabled = snapshot && snapshot.modelProfileEdits ? snapshot.modelProfileEdits.enabled === true : false
        this.runWrite(() => this.props.saveSettings({ modelProfileEdits: !enabled }))
      }

      copyPrompt() {
        const t = this.props.t
        const text = (this.state.snapshot && this.state.snapshot.promptIndex && this.state.snapshot.promptIndex.text) || ''
        try {
          Promise.resolve(navigator.clipboard.writeText(text))
            .then(() => this.setState({ notice: { kind: 'ok', text: t('promptCopied') } }))
            .catch(error => this.setState({ notice: { kind: 'error', text: String((error && error.message) || error) } }))
        } catch (error) {
          this.setState({ notice: { kind: 'error', text: String((error && error.message) || error) } })
        }
      }

      sourceBadge(source) {
        const t = this.props.t
        if (source === 'config') return h('span', { className: 'mcpl-badge mcpl-badge-config' }, t('sourceConfig'))
        if (source === 'custom') return h('span', { className: 'mcpl-badge mcpl-badge-custom' }, t('sourceCustom'))
        return h('span', { className: 'mcpl-badge' }, t('sourceDerived'))
      }

      renderEditor(server) {
        const t = this.props.t
        const draft = this.state.draft ?? { description: '', keywords: '' }
        const busy = this.state.busy === true
        return h('div', { key: 'editor', className: 'mcpl-editor', 'data-mcp-lazy-editor': server.serverName }, [
          h('div', { key: 'row', className: 'mcpl-row' }, [
            h('label', { key: 'description', className: 'mcpl-field' }, [
              h('span', { key: 'label' }, t('descriptionLabel')),
              h('textarea', {
                key: 'input',
                className: 'mcpl-input mcpl-textarea',
                value: draft.description,
                placeholder: t('descriptionPlaceholder'),
                disabled: busy,
                onChange: event => this.setState({ draft: { ...draft, description: event.target.value } })
              })
            ]),
            h('label', { key: 'keywords', className: 'mcpl-field' }, [
              h('span', { key: 'label' }, t('keywordsLabel')),
              h('input', {
                key: 'input',
                className: 'mcpl-input',
                value: draft.keywords,
                placeholder: t('keywordsPlaceholder'),
                disabled: busy,
                onChange: event => this.setState({ draft: { ...draft, keywords: event.target.value } })
              })
            ])
          ]),
          h('div', { key: 'actions', className: 'mcpl-row' }, [
            h('button', {
              key: 'save',
              type: 'button',
              className: 'mcpl-btn mcpl-btn-primary',
              disabled: busy,
              onClick: () => this.submitEdit(server.serverName)
            }, busy ? t('saving') : t('save')),
            h('button', {
              key: 'reset',
              type: 'button',
              className: 'mcpl-btn',
              disabled: busy,
              onClick: () => this.resetEdit(server.serverName)
            }, t('reset')),
            h('button', {
              key: 'cancel',
              type: 'button',
              className: 'mcpl-btn mcpl-btn-ghost',
              disabled: busy,
              onClick: this.cancelEdit
            }, t('cancel'))
          ])
        ])
      }

      /** 常驻/收起 开关：收起（默认）才由本插件接管并写进提示词索引。 */
      renderPinSwitch(server) {
        const t = this.props.t
        const busy = this.state.busy === true
        const pinned = server.pinned === true
        const origin = server.overrideSource && server.overrideSource.pinned
        return h('label', {
          key: 'pin',
          className: 'mcpl-switch',
          title: pinned ? t('pinPinnedHint') : t('pinCollapsedHint')
        }, [
          h('input', {
            key: 'input',
            type: 'checkbox',
            checked: pinned,
            disabled: busy,
            onChange: () => this.togglePinned(server)
          }),
          h('span', { key: 'track', className: 'mcpl-track' }, h('span', { key: 'knob', className: 'mcpl-knob' })),
          h('span', { key: 'label' }, pinned ? t('pinPinned') : t('pinCollapsed')),
          origin === 'config' ? this.sourceBadge('config') : null
        ])
      }

      renderServer(server) {
        const t = this.props.t
        const editing = this.state.editing === server.serverName
        const pinned = server.pinned === true
        const children = [
          h('div', { key: 'head', className: 'mcpl-card-head' }, [
            h('span', { key: 'name', className: 'mcpl-server' }, server.serverName),
            h('span', { key: 'count', className: 'mcpl-count' }, `${server.toolCount} ${t('tools')}`),
            h('span', { key: 'spacer', className: 'mcpl-spacer' }),
            this.renderPinSwitch(server),
            h('button', {
              key: 'edit',
              type: 'button',
              className: 'mcpl-btn mcpl-btn-ghost',
              onClick: editing ? this.cancelEdit : () => this.startEdit(server)
            }, editing ? t('editHide') : t('edit'))
          ])
        ]
        if (pinned) children.push(h('div', { key: 'pinnedHint', className: 'mcpl-hint' }, t('pinnedNote')))
        if (server.description) {
          children.push(h('div', { key: 'desc', className: 'mcpl-desc' }, [
            server.description,
            this.sourceBadge(server.overrideSource && server.overrideSource.description)
          ]))
        }
        if (server.keywords.length > 0) {
          children.push(h('div', { key: 'chips', className: 'mcpl-chips' }, [
            ...server.keywords.map(keyword => h('span', { key: keyword, className: 'mcpl-chip' }, keyword)),
            this.sourceBadge(server.overrideSource && server.overrideSource.keywords)
          ]))
        }
        if (editing) children.push(this.renderEditor(server))
        if (server.tools.length > 0) {
          children.push(h('details', { key: 'tools', className: 'mcpl-details' }, [
            h('summary', { key: 'summary' }, `${t('toolsTitle')} (${server.tools.length})`),
            ...server.tools.map(tool => h('div', { key: tool.name, className: 'mcpl-tool' }, [
              h('span', { key: 'name', className: 'mcpl-tool-name' }, tool.name),
              h('span', { key: 'desc', className: 'mcpl-tool-desc' }, tool.description || t('noDescription'))
            ]))
          ]))
        }
        return h('div', {
          key: server.serverName,
          className: pinned ? 'mcpl-card mcpl-card-pinned' : 'mcpl-card',
          'data-mcp-lazy-server': server.serverName
        }, children)
      }

      renderPromptIndex() {
        const snapshot = this.state.snapshot
        if (!snapshot || !snapshot.promptIndex) return null
        const t = this.props.t
        const index = snapshot.promptIndex
        const reasonKey = index.reason === 'disabled'
          ? 'promptDisabled'
          : index.reason === 'unsupported'
            ? 'promptUnsupported'
            : index.reason === 'empty' ? 'promptEmpty' : null
        const children = [
          h('summary', { key: 'summary' }, [
            t('promptTitle'),
            index.enabled ? null : ` ${t('promptInactive')}`
          ])
        ]
        if (reasonKey !== null) children.push(h('div', { key: 'reason', className: 'mcpl-hint' }, t(reasonKey)))
        if (index.text !== '') {
          // The channel decides what the meta line may promise: `message` is a
          // real row of its own, `context` shares the runtime-context snapshot
          // row, `section` is prompt text with no row at all.
          const metaKey = index.channel === 'message'
            ? 'promptMetaMessage'
            : index.channel === 'context' ? 'promptMeta' : 'promptMetaSection'
          const orderSuffix = index.order === null ? '' : ` (order ${String(index.order)})`
          children.push(h('div', { key: 'meta', className: 'mcpl-hint' },
            `${t(metaKey).replace('{name}', index.name).replace('{order}', String(index.order))}${orderSuffix}`))
          if (index.channel === 'message' || index.channel === 'context') {
            children.push(h('div', { key: 'inChat', className: 'mcpl-hint' },
              t('promptInChat').replace('{name}', index.name)))
          }
          children.push(h('pre', { key: 'text', className: 'mcpl-pre', 'data-mcp-lazy-prompt-index': '1' }, index.text))
          children.push(h('div', { key: 'actions', className: 'mcpl-row' }, [
            h('button', { key: 'copy', type: 'button', className: 'mcpl-btn mcpl-btn-ghost', onClick: this.copyPrompt }, t('promptCopy'))
          ]))
        }
        return h('details', {
          key: 'promptIndex',
          className: 'mcpl-details',
          open: index.enabled && index.text !== ''
        }, children)
      }

      renderNotice() {
        if (!this.state.notice) return null
        const className = this.state.notice.kind === 'error' ? 'mcpl-notice mcpl-error' : 'mcpl-notice'
        return h('div', { className, 'data-mcp-lazy-notice': this.state.notice.kind }, this.state.notice.text)
      }

      renderBody() {
        const t = this.props.t
        if (this.state.status === 'loading') return [h('div', { key: 'loading', className: 'mcpl-empty' }, t('loading'))]
        if (this.state.status === 'error') {
          return [h('div', { key: 'error' }, [
            h('div', { key: 'message' }, `${t('error')}: ${this.state.message}`),
            h('button', { key: 'retry', type: 'button', className: 'mcpl-btn', onClick: this.reload }, t('retry'))
          ])]
        }
        const snapshot = this.state.snapshot
        if (snapshot.available === false) return [h('div', { key: 'unavailable', className: 'mcpl-empty' }, t('unavailable'))]
        if (!snapshot.servers || snapshot.servers.length === 0) return [h('div', { key: 'empty', className: 'mcpl-empty' }, t('empty'))]
        return snapshot.servers.map(server => this.renderServer(server))
      }

      renderFooter() {
        const t = this.props.t
        if (this.state.status !== 'ready') return null
        const snapshot = this.state.snapshot
        const parts = [
          h('span', { key: 'signature' }, `${t('signature')}: ${String(snapshot.signature).slice(0, 16) || '—'}`),
          h('span', { key: 'generated' }, `${t('generatedAt')}: ${new Date(snapshot.generatedAt).toLocaleTimeString()}`)
        ]
        if (snapshot.omittedTools > 0) parts.push(h('span', { key: 'omitted' }, t('omitted').replace('{count}', String(snapshot.omittedTools))))
        const store = snapshot.store
        if (store && store.warning) parts.push(h('span', { key: 'store-warning', className: 'mcpl-warn' }, t('storeWarning').replace('{message}', String(store.warning))))
        else if (store && store.file) parts.push(h('span', { key: 'store-file' }, t('storeFile').replace('{file}', String(store.file))))
        return h('div', { className: 'mcpl-footer' }, parts)
      }

      renderPassthrough() {
        const snapshot = this.state.snapshot
        if (!snapshot || !snapshot.passthrough || snapshot.passthrough.length === 0) return null
        const t = this.props.t
        return h('details', { className: 'mcpl-details' }, [
          h('summary', { key: 'summary' }, `${t('passthrough')} (${snapshot.passthrough.length})`),
          h('div', { key: 'hint', className: 'mcpl-hint' }, t('passthroughHint')),
          ...snapshot.passthrough.map(entry => h('div', { key: entry.name, className: 'mcpl-tool' }, h('span', { className: 'mcpl-tool-name' }, entry.name)))
        ])
      }

      /**
       * 「允许 AI 改描述」开关：控制 agent 能不能调用 mcp__router__describe_server。
       *
       * `source === 'config'` 时这份开关不生效（配置优先），面板把它标成
       * 「配置文件固定」并禁用输入，而不是让用户以为点了没反应。
       */
      renderModelEdits() {
        const snapshot = this.state.snapshot
        const state = snapshot && snapshot.modelProfileEdits
        if (!state || typeof state.enabled !== 'boolean') return null
        const t = this.props.t
        const pinnedByConfig = state.source === 'config'
        return h('label', {
          key: 'modelEdits',
          className: 'mcpl-switch mcpl-switch-global',
          'data-mcp-lazy-model-edits': '1',
          title: t('modelEditsHint')
        }, [
          h('input', {
            key: 'input',
            type: 'checkbox',
            checked: state.enabled === true,
            disabled: pinnedByConfig || this.state.busy === true,
            onChange: this.toggleModelEdits
          }),
          h('span', { key: 'track', className: 'mcpl-track' }, h('span', { key: 'knob', className: 'mcpl-knob' })),
          h('span', { key: 'label' }, t('modelEdits')),
          pinnedByConfig ? this.sourceBadge('config') : null
        ])
      }

      /** 一眼看清「谁在索引里」：收起＝被接管并写进提示词，常驻＝工具常显、不进索引。 */
      renderSummary() {
        const snapshot = this.state.snapshot
        if (!snapshot || !Array.isArray(snapshot.servers) || snapshot.servers.length === 0) return null
        const t = this.props.t
        const pinned = snapshot.servers.filter(server => server.pinned === true).length
        const collapsed = snapshot.servers.length - pinned
        return h('div', { key: 'summary', className: 'mcpl-chips' }, [
          h('span', { key: 'collapsed', className: 'mcpl-chip mcpl-chip-on' },
            t('summaryCollapsed').replace('{count}', String(collapsed))),
          h('span', { key: 'pinned', className: 'mcpl-chip' },
            t('summaryPinned').replace('{count}', String(pinned)))
        ])
      }

      render() {
        const t = this.props.t
        return h('section', { className: 'mcpl-root', 'data-mcp-lazy-panel': '1' }, [
          h('div', { key: 'header', className: 'mcpl-header' }, [
            h('h3', { key: 'title', className: 'mcpl-title' }, t('title')),
            h('span', { key: 'subtitle', className: 'mcpl-subtitle' }, t('subtitle')),
            h('button', { key: 'refresh', type: 'button', className: 'mcpl-btn', onClick: this.reload }, t('refresh'))
          ]),
          this.renderSummary(),
          this.renderModelEdits(),
          this.renderNotice(),
          this.renderPromptIndex(),
          ...this.renderBody(),
          this.renderFooter(),
          this.renderPassthrough()
        ])
      }
    }

    return {
      name: 'dsh-mcp-lazy',
      // Client-side service injection: the settings shell (`slots`), copy
      // (`locale`), and the host Remote gateway (`remote`).
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        ensureStyles()
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), LOCALIZED)
        await ctx.remote.$mount(REMOTE)
        const t = ctx.locale.bind(NS)
        ctx.inject(['remote.mcpLazy', 'slots'], (scope) => {
          /** Every Remote call answers a RemoteResult; unwrap it or explain why. */
          const unwrap = async (call) => {
            const result = await call
            if (!result || result.ok !== true) {
              const code = result && result.error ? result.error.code : 'remote/unavailable'
              const message = result && result.error ? result.error.message : 'no RemoteResult'
              throw new Error(`${code}: ${message}`)
            }
            return result.value
          }
          const load = () => unwrap(scope.remote.mcpLazy.snapshot())
          const save = (input) => unwrap(scope.remote.mcpLazy.saveProfile(input))
          const reset = (input) => unwrap(scope.remote.mcpLazy.resetProfile(input))
          const saveSettings = (input) => unwrap(scope.remote.mcpLazy.saveSettings(input))
          scope.slots.inject('settings.section', () => scope.slots.register({
            name: 'settings.section',
            id: 'mcp-lazy',
            order: 45,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ t, load, save, reset, saveSettings })
          }, Panel))
        })
      }
    }
  }
})
