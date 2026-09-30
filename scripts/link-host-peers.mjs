// 本地开发用：把宿主（DSH 安装）里的 host 包链接进本仓库的 node_modules。
//
// 为什么需要它：当 profile 用 `link:` 指向本仓库（这样改一行代码、重启即生效）时，
// 插件的真实路径变成仓库目录，于是它 import 的宿主包必须**从仓库这里**能解析出来。
// 而启动器只设了 NODE_PATH —— CJS 的 require 认它，**ESM 的 import 不认**：
//   * `@deepseek-ai/dsh-tools` / `dsh-subprocess` 声明在 peerDependencies 里，
//     由宿主 loader 映射，所以照旧能加载；
//   * `@deepseek-ai/dsh-typert-protocol` 是动态 import（宿主没有就跳过），
//     于是设置面板的服务会**静默缺席**，前端报
//     `mcpLazy/snapshot: active Service "mcpLazy" is unavailable`。
// 补上这些链接即可（npm ci 会清掉，重跑本脚本）。
//
// 用法：
//   node scripts/link-host-peers.mjs                  # 在 DSH 启动的 shell 里（NODE_PATH 可用）
//   node scripts/link-host-peers.mjs <DSH安装目录>     # 例如 .../dsh-vsn/0.2.0-rc.2
import { mkdirSync, symlinkSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Packages the plugin reaches at runtime (first four) and the tests reach (the rest). */
const PACKAGES = [
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-typert-loader'
]

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const installRoot = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
const anchor = installRoot === undefined ? join(repoRoot, 'lib', 'index.js') : join(installRoot, 'package.json')
const require = createRequire(anchor)

/** Real directory of one installed package, found from its resolved entry point. */
function packageRoot(packageName) {
  const entry = require.resolve(packageName)
  const marker = `node_modules${sep}${packageName.split('/').join(sep)}`
  const at = entry.lastIndexOf(marker)
  return at < 0 ? undefined : entry.slice(0, at + marker.length)
}

let linked = 0
for (const packageName of PACKAGES) {
  const link = join(repoRoot, 'node_modules', ...packageName.split('/'))
  let target
  try {
    target = packageRoot(packageName)
  } catch (error) {
    console.log(`skip  ${packageName} (not resolvable from ${anchor}: ${error.code ?? error.message})`)
    continue
  }
  if (target === undefined) {
    console.log(`skip  ${packageName} (no node_modules marker in its resolved path)`)
    continue
  }
  if (existsSync(link)) {
    console.log(`have  ${packageName}`)
    continue
  }
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`link  ${packageName} -> ${target}`)
  linked += 1
}
console.log(linked === 0 ? 'nothing to do' : `linked ${linked} package(s)`)
