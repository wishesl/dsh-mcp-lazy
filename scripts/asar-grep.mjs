// 一次性排查脚本：在 DSH 的 app.asar（未压缩的拼接包）里做字节级字符串搜索，
// 用来确认宿主自己是怎么把「自动注入的内容」做成聊天记录的。
// 用法: node scripts/asar-grep.mjs <asar路径> <needle> [前后字节数] [最多命中数]
import { readFileSync } from 'node:fs'

const [file, needle, windowArg, limitArg] = process.argv.slice(2)
const window = Number(windowArg ?? 500)
const limit = Number(limitArg ?? 8)

const buffer = readFileSync(file)
const haystack = buffer.toString('latin1')

let index = 0
let matches = 0
while (matches < limit) {
  index = haystack.indexOf(needle, index)
  if (index === -1) break
  const start = Math.max(0, index - window)
  const end = Math.min(buffer.length, index + window)
  const snippet = buffer.subarray(start, end).toString('utf8').replace(/\s+/g, ' ')
  console.log(`--- #${matches + 1} @${index} ---`)
  console.log(snippet)
  index += needle.length
  matches += 1
}
console.log(`(matches: ${matches})`)
