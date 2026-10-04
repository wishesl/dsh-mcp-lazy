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
  id: '@sutong12/dsh-mcp-lazy',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'settings.mcpLazy'
    const LOCALIZED = 'mcp-lazy: localized panel text'
    // The real npm package name: typert-loader rejects a manifest owned by any
    // other name, and the host registry keys the invocations by this package.
    const PACKAGE = '@sutong12/dsh-mcp-lazy'
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
/* 设计变量：全部指向宿主真实 token（明暗主题自动跟随），圆角/阴影/动效与官方设置页同源。 */
.mcpl-root{
--mcpl-card-bg:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2));
--mcpl-card-stroke:var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1));
--mcpl-radius:var(--dsw-radius-md,12px);
--mcpl-radius-sm:var(--dsw-radius-sm,8px);
--mcpl-ease:var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1));
--mcpl-fast:var(--ds-transition-duration-fast,.1s);
--mcpl-normal:var(--ds-transition-duration,.2s);
--mcpl-mono:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);
display:flex;flex-direction:column;gap:14px;padding:2px 0 6px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5}

/* 头部：标题与操作一行，副标题独占一行（窄面板不再和标题抢宽度）。 */
.mcpl-header{display:flex;flex-direction:column;gap:4px}
.mcpl-headline{display:flex;align-items:center;gap:12px;min-width:0}
.mcpl-title{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.mcpl-subtitle{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6;max-width:72ch}
.mcpl-actions{display:flex;gap:8px;margin-left:auto;flex:0 0 auto}

/* 刷新时保留旧内容，只在顶部走一条细进度线，不再把整页清空成“读取中…”。 */
.mcpl-progress{position:relative;height:2px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.mcpl-progress::after{content:'';position:absolute;inset:0;width:38%;border-radius:inherit;background:var(--dsw-alias-brand-primary);animation:mcpl-slide 1.1s var(--mcpl-ease) infinite}
@keyframes mcpl-slide{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}

/* 按钮：用官方 button-* token；键盘焦点沿用宿主全局 focus-visible 环，不自己造。 */
.mcpl-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font:inherit;font-size:13px;line-height:1;padding:7px 12px;border-radius:var(--mcpl-radius-sm);border:1px solid var(--mcpl-card-stroke);background:var(--mcpl-card-bg);color:var(--dsw-alias-label-primary);transition:background var(--mcpl-fast) var(--mcpl-ease),border-color var(--mcpl-fast) var(--mcpl-ease),color var(--mcpl-fast) var(--mcpl-ease),opacity var(--mcpl-fast) var(--mcpl-ease)}
.mcpl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.mcpl-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.mcpl-btn:disabled{opacity:.5;cursor:not-allowed}
.mcpl-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-brand-text,#fff)}
.mcpl-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));border-color:transparent}
.mcpl-btn-quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.mcpl-btn-quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:transparent;color:var(--dsw-alias-label-primary)}
.mcpl-btn-copied{color:var(--dsw-alias-state-success-primary)}
.mcpl-spinner{width:12px;height:12px;flex:0 0 auto;border-radius:50%;border:1.5px solid currentColor;border-top-color:transparent;animation:mcpl-spin .7s linear infinite}
@keyframes mcpl-spin{to{transform:rotate(360deg)}}

/* 全局区：计数与「允许 AI 改描述」合成一条工具栏，不再各占一块。 */
.mcpl-toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--mcpl-card-stroke);border-radius:var(--mcpl-radius);background:var(--mcpl-card-bg)}
.mcpl-toolbar-left{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.mcpl-toolbar-right{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mcpl-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;border-radius:999px;padding:2px 9px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.mcpl-chip-on{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.mcpl-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mcpl-pill{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:18px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11.5px;font-variant-numeric:tabular-nums}

/* 状态横幅：保存/复制/失败都贴着操作区出现，带图标与语义色。 */
.mcpl-banner{--mcpl-accent:var(--dsw-alias-label-secondary);display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-radius:var(--mcpl-radius-sm);border:1px solid var(--mcpl-card-stroke);background:var(--mcpl-card-bg);font-size:12.5px;line-height:1.5;word-break:break-word}
.mcpl-banner-ok{--mcpl-accent:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent);color:var(--dsw-alias-state-success-primary)}
.mcpl-banner-error{--mcpl-accent:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary)}
.mcpl-banner-icon{flex:0 0 auto;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;line-height:1;background:var(--mcpl-accent);color:var(--mcpl-card-bg)}

/* 服务器卡片 */
.mcpl-list{display:flex;flex-direction:column;gap:10px}
.mcpl-card{border:1px solid var(--mcpl-card-stroke);border-radius:var(--mcpl-radius);padding:12px 14px;background:var(--mcpl-card-bg);transition:border-color var(--mcpl-fast) var(--mcpl-ease),box-shadow var(--mcpl-fast) var(--mcpl-ease)}
.mcpl-card:hover{border-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-shadow-lv1)}
.mcpl-card-pinned{background:var(--dsw-alias-bg-base)}
.mcpl-card-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mcpl-ident{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
.mcpl-server{font-weight:600;font-size:14px;letter-spacing:.01em;word-break:break-word}
.mcpl-count{color:var(--dsw-alias-label-tertiary);font-size:12px}
.mcpl-controls{display:flex;align-items:center;gap:10px;margin-left:auto;flex-wrap:wrap}
.mcpl-desc{margin:8px 0 0;font-size:13px;line-height:1.6;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.mcpl-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:1.4;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.mcpl-badge-custom{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);color:var(--dsw-alias-brand-primary)}
.mcpl-badge-config{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);color:var(--dsw-alias-state-warn-primary)}

/* 可折叠区：自带 chevron 与计数，summary 不再是一行灰字。 */
.mcpl-details{margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px;font-size:13px}
.mcpl-details>summary{display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none;list-style:none}
.mcpl-details>summary::-webkit-details-marker{display:none}
.mcpl-details>summary:hover{color:var(--dsw-alias-label-primary)}
.mcpl-chevron{width:7px;height:7px;flex:0 0 auto;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform var(--mcpl-fast) var(--mcpl-ease)}
.mcpl-details[open] .mcpl-chevron{transform:rotate(45deg)}
.mcpl-summary-label{font-size:12.5px}

/* 注入原文：等宽、可滚动，背景用官方代码块 token。 */
.mcpl-pre{margin:8px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--mcpl-radius-sm);background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-base));white-space:pre-wrap;word-break:break-word;font-family:var(--mcpl-mono);font-size:12.5px;line-height:1.65;max-height:340px;overflow:auto}
.mcpl-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:6px;line-height:1.6}

/* 工具清单：名称与描述各占一行（描述最多两行），不再被 52% 宽截断。 */
.mcpl-tool-list{display:flex;flex-direction:column;margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--mcpl-radius-sm);overflow:auto;max-height:320px}
.mcpl-tool{display:flex;flex-direction:column;gap:2px;padding:8px 10px;background:var(--dsw-alias-bg-base)}
.mcpl-tool+.mcpl-tool{border-top:1px solid var(--dsw-alias-border-l1)}
.mcpl-tool-name{font-family:var(--mcpl-mono);font-size:12.5px;color:var(--dsw-alias-label-primary);word-break:break-all}
.mcpl-tool-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* 编辑器：字段纵向排列（不再 240px 起折行），动作靠右。 */
.mcpl-editor{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}
.mcpl-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.mcpl-row-end{justify-content:flex-end}
.mcpl-editor-fields{display:flex;flex-direction:column;gap:10px}
.mcpl-field{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mcpl-input{font:inherit;font-size:13px;padding:8px 10px;width:100%;box-sizing:border-box;border-radius:var(--mcpl-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);transition:border-color var(--mcpl-fast) var(--mcpl-ease),background var(--mcpl-fast) var(--mcpl-ease),opacity var(--mcpl-fast) var(--mcpl-ease)}
.mcpl-input:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}
.mcpl-input:focus{border-color:var(--dsw-alias-brand-primary)}
.mcpl-input:disabled{opacity:.6;cursor:not-allowed}
.mcpl-textarea{min-height:64px;resize:vertical;line-height:1.6}

/* 开关：完全对齐官方 Switch 组件（dsh-client-ui-primitives 的 Switch.module.css）。
   关键一条：关态轨道用 --dsw-alias-border-l3（明确的中间灰），而不是与卡片同色的
   bg-layer-* —— 后者在浅色主题下几乎和卡片背景融成一片，用户看不到开关在哪。 */
.mcpl-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12.5px;color:var(--dsw-alias-label-secondary)}
.mcpl-switch input{position:absolute;opacity:0;width:0;height:0}
.mcpl-track{position:relative;box-sizing:border-box;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);transition:background var(--mcpl-normal) var(--mcpl-ease)}
.mcpl-knob{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb);box-shadow:var(--dsw-shadow-lv1,0 1px 3px rgba(0,0,0,.2));transition:transform 120ms var(--mcpl-ease)}
.mcpl-switch:hover input:not(:disabled)+.mcpl-track{filter:brightness(.96)}
.mcpl-switch input:checked+.mcpl-track{background:var(--dsw-alias-brand-primary)}
.mcpl-switch input:checked+.mcpl-track .mcpl-knob{background:var(--dsw-alias-label-primary-foreground);transform:translateX(16px)}
.mcpl-switch input:checked~.mcpl-label{color:var(--dsw-alias-label-primary);font-weight:500}
.mcpl-switch input:disabled+.mcpl-track{opacity:.5;cursor:default}
.mcpl-switch input:disabled~*{cursor:not-allowed}
.mcpl-switch input:focus-visible+.mcpl-track{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.mcpl-label{font-size:12.5px;color:var(--dsw-alias-label-primary)}

/* 首屏骨架：没有旧快照时才用，避免“读取中…”一行字撑场面。 */
.mcpl-skeleton-wrap{display:flex;flex-direction:column;gap:10px}
.mcpl-skeleton-card{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--mcpl-card-stroke);border-radius:var(--mcpl-radius);background:var(--mcpl-card-bg)}
.mcpl-skeleton{display:block;height:10px;border-radius:999px;background:var(--dsw-alias-bg-skeleton,var(--dsw-alias-bg-layer-2));animation:mcpl-pulse 1.4s var(--mcpl-ease) infinite}
.mcpl-skeleton-title{width:34%;height:13px}
.mcpl-skeleton-line{width:86%}
.mcpl-skeleton-short{width:52%}
@keyframes mcpl-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.mcpl-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* 空态 / 错误态 / 页脚 */
.mcpl-empty{color:var(--dsw-alias-label-secondary);font-size:13px;padding:12px 0}
.mcpl-state{display:flex;flex-direction:column;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);border-radius:var(--mcpl-radius);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}
.mcpl-state-text{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:1.6;word-break:break-word}
.mcpl-footer{display:flex;gap:8px 14px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary);font-size:11.5px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.mcpl-footer code{font-family:var(--mcpl-mono);font-size:inherit}
.mcpl-warn{color:var(--dsw-alias-state-warn-primary)}

/* 动效偏好：跟随系统关闭动画。 */
@media (prefers-reduced-motion:reduce){
.mcpl-progress::after,.mcpl-skeleton,.mcpl-spinner{animation:none}
.mcpl-btn,.mcpl-input,.mcpl-card,.mcpl-track,.mcpl-knob,.mcpl-chevron{transition:none}
}
`

    /** 注入一次；宿主切换主题时 token 自动跟随，无需重挂。 */
    function ensureStyles(document) {
      const doc = document ?? (typeof globalThis.document === 'undefined' ? undefined : globalThis.document)
      if (doc === undefined || doc.head === null || doc.head === undefined) return
      if (doc.getElementById(STYLE_ID) !== null) return
      const tag = doc.createElement('style')
      tag.id = STYLE_ID
      tag.dataset.plugin = PACKAGE
      tag.textContent = CSS
      doc.head.appendChild(tag)
    }

    // ---- 设置导航图标 --------------------------------------------------------
    // `settings.section` 的注册项只有 id/order/label，**没有图标位**：设置壳按
    // section id 硬编码导航图标（account / models / agent-presets / plugins / …），
    // 未知 id 一律兜底通用齿轮 —— 第三方那一行因此永远戴齿轮。
    // 所以只能自己认领：挑出「行文本等于我们 label」的那一行，藏掉官方 svg、
    // 用 ::before 画自己的漏斗（做法与 dshmarket 的 src/client/settings-nav-icon.ts
    // 一致，社区同款还有 dsh-better-sidebar / dsh-skill-mcp-panel；本机启动器插件
    // 0.2.12 也是这一段）。刻意做窄：只动带标记的那一行，不碰官方结构、不用哈希
    // 类名、不需要 `:has()`。
    // ⚠️ 官方哪天给 `settings.section` 长出 `icon` 字段，这一段整块删掉。
    const NAV_ICON_MARKER = 'data-dsh-mcp-lazy-nav-icon'
    /** 设置对话框左侧的导航列：每条 `settings.section` 渲染成一个 button。 */
    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
    /** 与官方导航图标同尺寸，行距与图标位因此不变。 */
    const NAV_ICON_SIZE = 16
    /** 这段 CSS 单独一个 `<style>`：随认领它的 effect 一起装卸。 */
    const NAV_CSS_TAG_ID = `${PACKAGE}/nav-icon.css`
    // 图标素材：自绘的漏斗剪影（很多工具收成一个网关），单色、内联、无位图、无构建。
    // 用 mask 而不是 background-image：mask 只读 alpha，颜色来自 `background-color:
    // currentColor` ⇒ 图标跟随宿主主题色（浅色主题下不会变成一块深色小卡片）。
    const NAV_ICON_MASK = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#000">'
      + '<path d="M2 3h12l-4.6 5.7v4.6l-2.8-1.8V8.7z"/></svg>'
    )

    /** 被认领那一行的样式：藏官方齿轮，用 ::before 画我们的漏斗。 */
    function navIconCss() {
      return [
        `[${NAV_ICON_MARKER}] > svg{display:none}`,
        `[${NAV_ICON_MARKER}]::before{`,
        `content:'';`,
        `flex:none;`,
        `width:${NAV_ICON_SIZE}px;`,
        `height:${NAV_ICON_SIZE}px;`,
        `background-color:currentColor;`,
        `-webkit-mask-image:url("${NAV_ICON_MASK}");`,
        `mask-image:url("${NAV_ICON_MASK}");`,
        `-webkit-mask-repeat:no-repeat;`,
        `mask-repeat:no-repeat;`,
        `-webkit-mask-position:center;`,
        `mask-position:center;`,
        `-webkit-mask-size:${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
        `mask-size:${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
        `}`
      ].join('\n')
    }

    /**
     * 认领「MCP 管理」那一行导航，把官方兜底的通用齿轮换成漏斗。
     *
     * 处处 fail-soft：没有 document、没有 MutationObserver、body 还没挂上、
     * 官方改了面板结构（选择器零命中）、语言还没解析出来（label 为空）——
     * 一律什么都不做，官方图标照旧，不报错、不影响面板与主题通道。
     * 只动带自己标记的那一行；标记与 `<style>` 都属于这个 effect，随 fiber 清理。
     */
    function installNavIcon(ctx, resolveLabel, doc) {
      const document_ = doc ?? (typeof globalThis.document === 'undefined' ? undefined : globalThis.document)
      if (document_ === undefined) return
      ctx.effect(() => {
        const tag = document_.createElement('style')
        tag.dataset.plugin = PACKAGE
        tag.dataset.pluginCss = NAV_CSS_TAG_ID
        tag.textContent = navIconCss()
        if (document_.head !== null && document_.head !== undefined) document_.head.appendChild(tag)

        let disposed = false
        let scheduled = false

        const sync = () => {
          scheduled = false
          if (disposed) return
          const wanted = String(resolveLabel() ?? '').trim()
          const rows = document_.querySelectorAll(NAV_ROW_SELECTOR)
          for (const row of rows) {
            // 空 label 一条都不标：语言还没解析出来时不能把整个 nav 认成自己的。
            if (wanted !== '' && String(row.textContent ?? '').trim() === wanted) row.setAttribute(NAV_ICON_MARKER, '')
            else row.removeAttribute(NAV_ICON_MARKER)
          }
        }

        // 一串 DOM 变更合并成一次 sync，并赶在下一帧之前落地（别让用户先看到齿轮）。
        const schedule = () => {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(sync)
        }

        sync()
        let observer
        if (typeof globalThis.MutationObserver === 'function' && document_.body !== null && document_.body !== undefined) {
          observer = new globalThis.MutationObserver(schedule)
          observer.observe(document_.body, { childList: true, subtree: true, characterData: true })
        }

        return () => {
          disposed = true
          if (observer !== undefined) observer.disconnect()
          for (const row of document_.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
          if (typeof tag.remove === 'function') tag.remove()
          else if (tag.parentNode) tag.parentNode.removeChild(tag)
        }
      }, 'dsh-mcp-lazy: settings nav icon')
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
        this.state = { status: 'loading', editing: null, draft: null, busy: false, notice: null, copied: false }
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

      componentWillUnmount() {
        if (this.copyTimer !== undefined) clearTimeout(this.copyTimer)
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

      /**
       * 复制注入原文。反馈分两层：按钮自己短暂变成「已复制」（最靠近操作点），
       * 同时顶部横幅留一条可读的确认/失败信息（失败时才是错误态）。
       */
      copyPrompt() {
        const t = this.props.t
        const text = (this.state.snapshot && this.state.snapshot.promptIndex && this.state.snapshot.promptIndex.text) || ''
        const confirmCopied = () => {
          this.setState({ copied: true, notice: { kind: 'ok', text: t('promptCopied') } })
          if (this.copyTimer !== undefined) clearTimeout(this.copyTimer)
          this.copyTimer = setTimeout(() => {
            this.copyTimer = undefined
            this.setState({ copied: false })
          }, 1600)
        }
        const fail = (error) => this.setState({ copied: false, notice: { kind: 'error', text: String((error && error.message) || error) } })
        try {
          Promise.resolve(navigator.clipboard.writeText(text)).then(confirmCopied).catch(fail)
        } catch (error) {
          fail(error)
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
        const field = (key, label, control) => h('label', { key, className: 'mcpl-field' }, [
          h('span', { key: 'label', className: 'mcpl-label' }, label),
          control
        ])
        return h('div', {
          key: 'editor',
          className: 'mcpl-editor',
          'data-mcp-lazy-editor': server.serverName,
          'aria-busy': busy ? 'true' : 'false'
        }, [
          h('div', { key: 'fields', className: 'mcpl-editor-fields' }, [
            field('description', t('descriptionLabel'), h('textarea', {
              key: 'input',
              className: 'mcpl-input mcpl-textarea',
              value: draft.description,
              placeholder: t('descriptionPlaceholder'),
              disabled: busy,
              onChange: event => this.setState({ draft: { ...draft, description: event.target.value } })
            })),
            field('keywords', t('keywordsLabel'), h('input', {
              key: 'input',
              className: 'mcpl-input',
              value: draft.keywords,
              placeholder: t('keywordsPlaceholder'),
              disabled: busy,
              onChange: event => this.setState({ draft: { ...draft, keywords: event.target.value } })
            }))
          ]),
          h('div', { key: 'actions', className: 'mcpl-row mcpl-row-end' }, [
            h('button', {
              key: 'cancel',
              type: 'button',
              className: 'mcpl-btn mcpl-btn-quiet',
              disabled: busy,
              onClick: this.cancelEdit
            }, t('cancel')),
            h('button', {
              key: 'reset',
              type: 'button',
              className: 'mcpl-btn',
              disabled: busy,
              onClick: () => this.resetEdit(server.serverName)
            }, t('reset')),
            h('button', {
              key: 'save',
              type: 'button',
              className: 'mcpl-btn mcpl-btn-primary',
              disabled: busy,
              onClick: () => this.submitEdit(server.serverName)
            }, busy
              ? [h('span', { key: 'spin', className: 'mcpl-spinner' }), t('saving')]
              : t('save'))
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
            'aria-label': pinned ? t('pinPinned') : t('pinCollapsed'),
            onChange: () => this.togglePinned(server)
          }),
          h('span', { key: 'track', className: 'mcpl-track' }, h('span', { key: 'knob', className: 'mcpl-knob' })),
          h('span', { key: 'label', className: 'mcpl-label' }, pinned ? t('pinPinned') : t('pinCollapsed')),
          origin === 'config' ? this.sourceBadge('config') : null
        ])
      }

      renderServer(server) {
        const t = this.props.t
        const editing = this.state.editing === server.serverName
        const pinned = server.pinned === true
        const children = [
          h('div', { key: 'head', className: 'mcpl-card-head' }, [
            h('div', { key: 'ident', className: 'mcpl-ident' }, [
              h('span', { key: 'name', className: 'mcpl-server' }, server.serverName),
              h('span', { key: 'count', className: 'mcpl-count' }, `${server.toolCount} ${t('tools')}`)
            ]),
            h('div', { key: 'controls', className: 'mcpl-controls' }, [
              this.renderPinSwitch(server),
              h('button', {
                key: 'edit',
                type: 'button',
                className: 'mcpl-btn mcpl-btn-quiet',
                disabled: this.state.busy === true,
                onClick: editing ? this.cancelEdit : () => this.startEdit(server)
              }, editing ? t('editHide') : t('edit'))
            ])
          ])
        ]
        if (pinned) children.push(h('div', { key: 'pinnedHint', className: 'mcpl-hint' }, t('pinnedNote')))
        if (server.description) {
          children.push(h('div', { key: 'desc', className: 'mcpl-desc' }, [
            h('span', { key: 'text' }, server.description),
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
            h('summary', { key: 'summary' }, [
              h('span', { key: 'chevron', className: 'mcpl-chevron', 'aria-hidden': 'true' }),
              h('span', { key: 'label', className: 'mcpl-summary-label' }, t('toolsTitle')),
              h('span', { key: 'badge', className: 'mcpl-pill' }, String(server.tools.length))
            ]),
            h('div', { key: 'list', className: 'mcpl-tool-list' }, server.tools.map(tool => h('div', {
              key: tool.name,
              className: 'mcpl-tool'
            }, [
              h('code', { key: 'name', className: 'mcpl-tool-name' }, tool.name),
              h('span', { key: 'desc', className: 'mcpl-tool-desc' }, tool.description || t('noDescription'))
            ])))
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
            h('span', { key: 'chevron', className: 'mcpl-chevron', 'aria-hidden': 'true' }),
            h('span', { key: 'label', className: 'mcpl-summary-label' }, t('promptTitle')),
            index.enabled ? null : h('span', { key: 'state', className: 'mcpl-pill' }, t('promptInactive'))
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
          const copied = this.state.copied === true
          children.push(h('div', { key: 'actions', className: 'mcpl-row mcpl-row-end' }, [
            h('button', {
              key: 'copy',
              type: 'button',
              className: copied ? 'mcpl-btn mcpl-btn-quiet mcpl-btn-copied' : 'mcpl-btn mcpl-btn-quiet',
              onClick: this.copyPrompt
            }, copied ? t('promptCopied') : t('promptCopy'))
          ]))
        }
        return h('details', {
          key: 'promptIndex',
          className: 'mcpl-details',
          open: index.enabled && index.text !== ''
        }, children)
      }

      renderNotice() {
        const notice = this.state.notice
        if (!notice) return null
        const error = notice.kind === 'error'
        return h('div', {
          key: 'notice',
          className: error ? 'mcpl-banner mcpl-banner-error' : 'mcpl-banner mcpl-banner-ok',
          role: error ? 'alert' : 'status',
          'data-mcp-lazy-notice': notice.kind
        }, [
          h('span', { key: 'icon', className: 'mcpl-banner-icon', 'aria-hidden': 'true' }, error ? '!' : '✓'),
          h('span', { key: 'text' }, notice.text)
        ])
      }

      /** 首屏骨架：只在还没有任何快照时出现，避免用一行“读取中…”撑场面。 */
      renderSkeleton() {
        return h('div', {
          key: 'loading',
          className: 'mcpl-skeleton-wrap',
          'data-mcp-lazy-loading': '1'
        }, [
          h('span', { key: 'sr', className: 'mcpl-sr' }, this.props.t('loading')),
          ...[0, 1, 2].map(index => h('div', { key: `card-${index}`, className: 'mcpl-skeleton-card' }, [
            h('span', { key: 'title', className: 'mcpl-skeleton mcpl-skeleton-title' }),
            h('span', { key: 'line', className: 'mcpl-skeleton mcpl-skeleton-line' }),
            h('span', { key: 'short', className: 'mcpl-skeleton mcpl-skeleton-line mcpl-skeleton-short' })
          ]))
        ])
      }

      renderBody() {
        const t = this.props.t
        const snapshot = this.state.snapshot
        if (this.state.status === 'error') {
          return [h('div', { key: 'error', className: 'mcpl-state' }, [
            h('div', { key: 'message', className: 'mcpl-state-text' }, `${t('error')}: ${this.state.message}`),
            h('button', { key: 'retry', type: 'button', className: 'mcpl-btn', onClick: this.reload }, t('retry'))
          ])]
        }
        // 刷新时保留上一份快照（顶部有进度线），只有首屏才显示骨架。
        if (!snapshot) return [this.renderSkeleton()]
        if (snapshot.available === false) return [h('div', { key: 'unavailable', className: 'mcpl-empty' }, t('unavailable'))]
        if (!snapshot.servers || snapshot.servers.length === 0) return [h('div', { key: 'empty', className: 'mcpl-empty' }, t('empty'))]
        return [h('div', { key: 'list', className: 'mcpl-list' }, snapshot.servers.map(server => this.renderServer(server)))]
      }

      renderFooter() {
        const t = this.props.t
        if (this.state.status !== 'ready') return null
        const snapshot = this.state.snapshot
        const parts = [
          h('span', { key: 'signature' }, [
            `${t('signature')}: `,
            h('code', { key: 'value' }, String(snapshot.signature).slice(0, 16) || '—')
          ]),
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
          h('summary', { key: 'summary' }, [
            h('span', { key: 'chevron', className: 'mcpl-chevron', 'aria-hidden': 'true' }),
            h('span', { key: 'label', className: 'mcpl-summary-label' }, t('passthrough')),
            h('span', { key: 'badge', className: 'mcpl-pill' }, String(snapshot.passthrough.length))
          ]),
          h('div', { key: 'hint', className: 'mcpl-hint' }, t('passthroughHint')),
          h('div', { key: 'list', className: 'mcpl-tool-list' }, snapshot.passthrough.map(entry => h('div', {
            key: entry.name,
            className: 'mcpl-tool'
          }, h('code', { key: 'name', className: 'mcpl-tool-name' }, entry.name))))
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
          className: 'mcpl-switch',
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
          h('span', { key: 'label', className: 'mcpl-label' }, t('modelEdits')),
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

      /** 标题、副标题与刷新：副标题独占一行，窄面板不再和标题抢宽度。 */
      renderHeader() {
        const t = this.props.t
        const busy = this.state.status === 'loading'
        return h('div', { key: 'header', className: 'mcpl-header' }, [
          h('div', { key: 'headline', className: 'mcpl-headline' }, [
            h('h3', { key: 'title', className: 'mcpl-title' }, t('title')),
            h('div', { key: 'actions', className: 'mcpl-actions' }, [
              h('button', {
                key: 'refresh',
                type: 'button',
                className: 'mcpl-btn',
                disabled: busy,
                'data-mcp-lazy-refresh': '1',
                onClick: this.reload
              }, busy
                ? [h('span', { key: 'spin', className: 'mcpl-spinner' }), t('loading')]
                : t('refresh'))
            ])
          ]),
          h('p', { key: 'subtitle', className: 'mcpl-subtitle' }, t('subtitle'))
        ])
      }

      /** 全局区：计数 chip 与「允许 AI 改描述」合成一条工具栏。 */
      renderToolbar() {
        const counts = this.renderSummary()
        const edits = this.renderModelEdits()
        if (counts === null && edits === null) return null
        return h('div', { key: 'toolbar', className: 'mcpl-toolbar' }, [
          h('div', { key: 'left', className: 'mcpl-toolbar-left' }, counts),
          h('div', { key: 'right', className: 'mcpl-toolbar-right' }, edits)
        ])
      }

      render() {
        const t = this.props.t
        const loading = this.state.status === 'loading'
        const hasSnapshot = this.state.snapshot !== undefined && this.state.snapshot !== null
        return h('section', { className: 'mcpl-root', 'data-mcp-lazy-panel': '1' }, [
          this.renderHeader(),
          loading && hasSnapshot
            ? h('div', { key: 'progress', className: 'mcpl-progress', role: 'progressbar', 'aria-label': t('loading') })
            : null,
          this.renderToolbar(),
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
        // 设置导航行没有图标位：认领我们那一行，把官方兜底齿轮换成漏斗（同一个
        // label thunk ⇒ 切语言后自动重新认领）。官方加 icon 字段后整段删掉。
        installNavIcon(ctx, () => t('nav'))
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
