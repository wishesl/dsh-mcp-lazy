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
        if (value.keywords !== undefined) {
          if (!Array.isArray(value.keywords)) fail('keywords must be an array')
          for (const keyword of value.keywords) {
            if (typeof keyword !== 'string') fail('every keyword must be a string')
          }
        }
        return { serverName: value.serverName, description: value.description, keywords: value.keywords }
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

    const REMOTE = {
      package: PACKAGE,
      descriptors: [SNAPSHOT_DESCRIPTOR, SAVE_PROFILE_DESCRIPTOR, RESET_PROFILE_DESCRIPTOR]
    }

    const DICTIONARIES = {
      zh: {
        nav: 'MCP 管理',
        title: 'MCP 管理',
        subtitle: '已接入的 MCP 服务器；可查看实际注入的提示词、自定义描述（本页内容不进模型上下文）',
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
        subtitle: 'Connected MCP servers; inspect the injected prompt and author descriptions (this page never enters model context)',
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

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0' },
      header: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { margin: 0, fontSize: '1.05em' },
      subtitle: { opacity: 0.7, fontSize: '0.88em' },
      button: { marginLeft: 'auto', cursor: 'pointer', padding: '2px 10px' },
      card: { border: '1px solid currentColor', borderRadius: '8px', padding: '10px 12px', opacity: 0.95 },
      cardHead: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      serverName: { fontWeight: 600 },
      count: { opacity: 0.75, fontSize: '0.9em' },
      chip: { border: '1px solid currentColor', borderRadius: '10px', padding: '0 6px', fontSize: '0.82em', opacity: 0.85 },
      chips: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' },
      description: { marginTop: '6px', fontSize: '0.92em', opacity: 0.9 },
      details: { marginTop: '8px', fontSize: '0.9em' },
      pre: {
        margin: '6px 0 0',
        padding: '8px 10px',
        border: '1px solid rgba(128,128,128,0.35)',
        borderRadius: '6px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.86em',
        opacity: 0.95
      },
      tool: { padding: '4px 0', borderTop: '1px solid rgba(128,128,128,0.25)' },
      toolName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      toolDescription: { opacity: 0.8, display: 'block', marginTop: '2px' },
      row: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' },
      field: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 220px', fontSize: '0.86em' },
      input: { font: 'inherit', padding: '4px 6px', width: '100%', boxSizing: 'border-box' },
      textarea: { font: 'inherit', padding: '4px 6px', width: '100%', boxSizing: 'border-box', minHeight: '48px' },
      linkButton: { cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', textDecoration: 'underline', opacity: 0.85 },
      badge: { fontSize: '0.78em', opacity: 0.7, marginLeft: '6px' },
      notice: { fontSize: '0.86em', marginTop: '6px' },
      errorText: { opacity: 0.9, fontSize: '0.86em', marginTop: '6px' },
      footer: { opacity: 0.6, fontSize: '0.8em', display: 'flex', gap: '10px', flexWrap: 'wrap' }
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
        if (source === 'config') return h('span', { style: styles.badge }, `· ${t('sourceConfig')}`)
        if (source === 'custom') return h('span', { style: styles.badge }, `· ${t('sourceCustom')}`)
        return h('span', { style: styles.badge }, `· ${t('sourceDerived')}`)
      }

      renderEditor(server) {
        const t = this.props.t
        const draft = this.state.draft ?? { description: '', keywords: '' }
        const busy = this.state.busy === true
        return h('div', { key: 'editor', 'data-mcp-lazy-editor': server.serverName }, [
          h('div', { key: 'row', style: styles.row }, [
            h('label', { key: 'description', style: styles.field }, [
              h('span', { key: 'label' }, t('descriptionLabel')),
              h('textarea', {
                key: 'input',
                style: styles.textarea,
                value: draft.description,
                placeholder: t('descriptionPlaceholder'),
                disabled: busy,
                onChange: event => this.setState({ draft: { ...draft, description: event.target.value } })
              })
            ]),
            h('label', { key: 'keywords', style: styles.field }, [
              h('span', { key: 'label' }, t('keywordsLabel')),
              h('input', {
                key: 'input',
                style: styles.input,
                value: draft.keywords,
                placeholder: t('keywordsPlaceholder'),
                disabled: busy,
                onChange: event => this.setState({ draft: { ...draft, keywords: event.target.value } })
              })
            ])
          ]),
          h('div', { key: 'actions', style: styles.row }, [
            h('button', {
              key: 'save',
              type: 'button',
              disabled: busy,
              onClick: () => this.submitEdit(server.serverName)
            }, busy ? t('saving') : t('save')),
            h('button', {
              key: 'reset',
              type: 'button',
              disabled: busy,
              onClick: () => this.resetEdit(server.serverName)
            }, t('reset')),
            h('button', { key: 'cancel', type: 'button', disabled: busy, onClick: this.cancelEdit }, t('cancel'))
          ])
        ])
      }

      renderServer(server) {
        const t = this.props.t
        const editing = this.state.editing === server.serverName
        const children = [
          h('div', { key: 'head', style: styles.cardHead }, [
            h('span', { key: 'name', style: styles.serverName }, server.serverName),
            h('span', { key: 'count', style: styles.count }, `${server.toolCount} ${t('tools')}`),
            h('button', {
              key: 'edit',
              type: 'button',
              style: styles.linkButton,
              onClick: editing ? this.cancelEdit : () => this.startEdit(server)
            }, editing ? t('editHide') : t('edit'))
          ])
        ]
        if (server.description) {
          children.push(h('div', { key: 'desc', style: styles.description }, [
            server.description,
            this.sourceBadge(server.overrideSource && server.overrideSource.description)
          ]))
        }
        if (server.keywords.length > 0) {
          children.push(h('div', { key: 'chips', style: styles.chips }, [
            ...server.keywords.map(keyword => h('span', { key: keyword, style: styles.chip }, keyword)),
            this.sourceBadge(server.overrideSource && server.overrideSource.keywords)
          ]))
        }
        if (editing) children.push(this.renderEditor(server))
        if (server.tools.length > 0) {
          children.push(h('details', { key: 'tools', style: styles.details }, [
            h('summary', { key: 'summary' }, `${t('toolsTitle')} (${server.tools.length})`),
            ...server.tools.map(tool => h('div', { key: tool.name, style: styles.tool }, [
              h('span', { key: 'name', style: styles.toolName }, tool.name),
              h('span', { key: 'desc', style: styles.toolDescription }, tool.description || t('noDescription'))
            ]))
          ]))
        }
        return h('div', { key: server.serverName, style: styles.card }, children)
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
        if (reasonKey !== null) children.push(h('div', { key: 'reason', style: styles.toolDescription }, t(reasonKey)))
        if (index.text !== '') {
          // The channel decides what the meta line may promise: `message` is a
          // real row of its own, `context` shares the runtime-context snapshot
          // row, `section` is prompt text with no row at all.
          const metaKey = index.channel === 'message'
            ? 'promptMetaMessage'
            : index.channel === 'context' ? 'promptMeta' : 'promptMetaSection'
          const orderSuffix = index.order === null ? '' : ` (order ${String(index.order)})`
          children.push(h('div', { key: 'meta', style: styles.toolDescription },
            `${t(metaKey).replace('{name}', index.name).replace('{order}', String(index.order))}${orderSuffix}`))
          if (index.channel === 'message' || index.channel === 'context') {
            children.push(h('div', { key: 'inChat', style: styles.toolDescription },
              t('promptInChat').replace('{name}', index.name)))
          }
          children.push(h('pre', { key: 'text', style: styles.pre, 'data-mcp-lazy-prompt-index': '1' }, index.text))
          children.push(h('div', { key: 'actions', style: styles.row }, [
            h('button', { key: 'copy', type: 'button', style: styles.linkButton, onClick: this.copyPrompt }, t('promptCopy'))
          ]))
        }
        return h('details', {
          key: 'promptIndex',
          style: styles.details,
          open: index.enabled && index.text !== ''
        }, children)
      }

      renderNotice() {
        if (!this.state.notice) return null
        const style = this.state.notice.kind === 'error' ? styles.errorText : styles.notice
        return h('div', { style, 'data-mcp-lazy-notice': this.state.notice.kind }, this.state.notice.text)
      }

      renderBody() {
        const t = this.props.t
        if (this.state.status === 'loading') return [h('div', { key: 'loading' }, t('loading'))]
        if (this.state.status === 'error') {
          return [h('div', { key: 'error' }, [
            h('div', { key: 'message' }, `${t('error')}: ${this.state.message}`),
            h('button', { key: 'retry', type: 'button', style: styles.button, onClick: this.reload }, t('retry'))
          ])]
        }
        const snapshot = this.state.snapshot
        if (snapshot.available === false) return [h('div', { key: 'unavailable' }, t('unavailable'))]
        if (!snapshot.servers || snapshot.servers.length === 0) return [h('div', { key: 'empty' }, t('empty'))]
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
        if (store && store.warning) parts.push(h('span', { key: 'store-warning' }, t('storeWarning').replace('{message}', String(store.warning))))
        else if (store && store.file) parts.push(h('span', { key: 'store-file' }, t('storeFile').replace('{file}', String(store.file))))
        return h('div', { style: styles.footer }, parts)
      }

      renderPassthrough() {
        const snapshot = this.state.snapshot
        if (!snapshot || !snapshot.passthrough || snapshot.passthrough.length === 0) return null
        const t = this.props.t
        return h('details', { style: styles.details }, [
          h('summary', { key: 'summary' }, `${t('passthrough')} (${snapshot.passthrough.length})`),
          h('div', { key: 'hint', style: styles.toolDescription }, t('passthroughHint')),
          ...snapshot.passthrough.map(entry => h('div', { key: entry.name, style: styles.tool }, h('span', { style: styles.toolName }, entry.name)))
        ])
      }

      render() {
        const t = this.props.t
        return h('section', { style: styles.root, 'data-mcp-lazy-panel': '1' }, [
          h('div', { key: 'header', style: styles.header }, [
            h('h3', { key: 'title', style: styles.title }, t('title')),
            h('span', { key: 'subtitle', style: styles.subtitle }, t('subtitle')),
            h('button', { key: 'refresh', type: 'button', style: styles.button, onClick: this.reload }, t('refresh'))
          ]),
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
          scope.slots.inject('settings.section', () => scope.slots.register({
            name: 'settings.section',
            id: 'mcp-lazy',
            order: 45,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ t, load, save, reset })
          }, Panel))
        })
      }
    }
  }
})
