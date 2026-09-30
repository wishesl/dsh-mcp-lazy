import { register } from 'node:module'

// Install the peer-stub resolve hook through `--import`, which takes a real
// URL. `--experimental-loader` received the fixture's Windows path and Node
// parsed it as a URL ("e:" scheme), so the harness could not start on Windows.
register('./dsh-peer-loader.mjs', import.meta.url)
