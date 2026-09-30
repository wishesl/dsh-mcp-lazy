// 浏览器半：设置里注册一个独立的只读「MCP 管理」菜单。
//
// 格式是宿主浏览器模块表的懒工厂（harness 自带模板 templates/decoration/client.js
// 即此形态）：`window.__ModuleLoader__.load({ id, factory(require) })`，React 由
// `require('react')` 从模块表拿，不重复安装、不打包。因此本文件**手写、无构建**，
// 与本仓库 `lib/` 既有的「提交产物、装机即用」一致。
//
// 数据来自 Host 的 `mcpLazy` Typert Remote 命名空间（lib/service.js），全程只读：
// 没有写入、没有审批、没有 profile 修改。面板内容永不进入模型上下文。
//
// 注意：手写 bundle 不能 import './wire.js'，下面的 SNAPSHOT_DESCRIPTOR 是它的等价
// 字面量；test/client-bundle.test.mjs 会断言两者深度相等（防漂移）。

window.__ModuleLoader__.load({
  id: '@yilinxiao/dsh-mcp-lazy',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'settings.mcpLazy'
    const LOCALIZED = 'mcp-lazy: localized panel text'

    const SNAPSHOT_DESCRIPTOR = {
      id: 'dsh-mcp-lazy#mcpLazy/snapshot',
      service: 'mcpLazy',
      namespace: 'mcpLazy',
      method: 'snapshot',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'src-json' },
      sourceLocation: { file: 'lib/wire.js', line: 1, column: 1 }
    }

    const REMOTE = { package: 'dsh-mcp-lazy', descriptors: [SNAPSHOT_DESCRIPTOR] }

    const DICTIONARIES = {
      zh: {
        nav: 'MCP 管理',
        title: 'MCP 管理',
        subtitle: '已接入的 MCP 服务器与工具（只读；本页内容不进模型上下文）',
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
        omitted: '另有 {count} 个工具未在本页列出'
      },
      en: {
        nav: 'MCP servers',
        title: 'MCP servers',
        subtitle: 'Connected MCP servers and tools (read-only; this page never enters model context)',
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
        omitted: '{count} more tool(s) are not listed here'
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
      tool: { padding: '4px 0', borderTop: '1px solid rgba(128,128,128,0.25)' },
      toolName: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      toolDescription: { opacity: 0.8, display: 'block', marginTop: '2px' },
      footer: { opacity: 0.6, fontSize: '0.8em', display: 'flex', gap: '10px', flexWrap: 'wrap' }
    }

    class Panel extends React.Component {
      constructor(props) {
        super(props)
        this.state = { status: 'loading' }
        this.reload = this.reload.bind(this)
      }

      componentDidMount() {
        this.reload()
      }

      reload() {
        this.setState({ status: 'loading' })
        Promise.resolve()
          .then(() => this.props.load())
          .then(snapshot => this.setState({ status: 'ready', snapshot }))
          .catch(error => this.setState({ status: 'error', message: String((error && error.message) || error) }))
      }

      renderServer(server) {
        const t = this.props.t
        const children = [
          h('div', { key: 'head', style: styles.cardHead }, [
            h('span', { key: 'name', style: styles.serverName }, server.serverName),
            h('span', { key: 'count', style: styles.count }, `${server.toolCount} ${t('tools')}`)
          ])
        ]
        if (server.description) children.push(h('div', { key: 'desc', style: styles.description }, server.description))
        if (server.keywords.length > 0) {
          children.push(h('div', { key: 'chips', style: styles.chips },
            server.keywords.map(keyword => h('span', { key: keyword, style: styles.chip }, keyword))))
        }
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
          const load = async () => {
            const result = await scope.remote.mcpLazy.snapshot()
            if (!result || result.ok !== true) {
              const code = result && result.error ? result.error.code : 'remote/unavailable'
              const message = result && result.error ? result.error.message : 'no RemoteResult'
              throw new Error(`${code}: ${message}`)
            }
            return result.value
          }
          scope.slots.inject('settings.section', () => scope.slots.register({
            name: 'settings.section',
            id: 'mcp-lazy',
            order: 45,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ t, load })
          }, Panel))
        })
      }
    }
  }
})
