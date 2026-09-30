import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as passiveToolProvider from './fixtures/passive-tool-provider.mjs'

const execute = promisify(execFile)
// `--import` wants a module specifier (a file URL keeps Windows drive letters
// out of URL parsing), while the main entry must stay a filesystem path.
const hooks = new URL('./fixtures/dsh-peer-hooks.mjs', import.meta.url).href
const harness = fileURLToPath(new URL('./fixtures/plugin-host-harness.mjs', import.meta.url))

test('passive browser fixture declares its DSH tools dependency', () => {
  assert.deepEqual(passiveToolProvider.inject, ['tools'])
})

test('plugin apply lifecycle keeps real MCP fixture connections warm', async () => {
  const { stdout } = await execute(process.execPath, [
    '--no-warnings',
    '--import', hooks,
    harness
  ], { timeout: 45000 })

  assert.match(stdout, /plugin lifecycle ok/)
})
