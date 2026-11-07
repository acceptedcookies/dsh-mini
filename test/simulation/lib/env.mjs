// simulation 环境真源：只读本机 gateway.env 的键名，不打印密钥。
// mock 用本机网关。live 不走这里。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SIM_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const REPO = dirname(dirname(SIM_ROOT))
const ENV_PATH = join(REPO, '.anote/frd1/gateway.env')

export function loadGatewayEnv() {
  if (!existsSync(ENV_PATH)) return {}
  const out = {}
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const t = line.trim()
    if (t.length === 0 || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    out[t.slice(0, i)] = t.slice(i + 1)
  }
  return out
}

export const PRODUCTION_BASE = 'https://dsh-mini.saobao.com'
export const SIM_BASE = 'http://127.0.0.1:3426'
export const MAGPIE_BASE = 'http://127.0.0.1:3425/v1'
export const TEST_OID = 'sim-test-oid'
export const OTHER_OID = 'sim-other-oid'

/** mock 用的本机网关。不是 live。 */
export function liveWriteBase() {
  return (process.env.SIM_LIVE_BASE ?? 'http://127.0.0.1:19097').replace(/\/$/, '')
}

export function gatewayPresent() {
  const e = loadGatewayEnv()
  return ['TICKET_SECRET', 'ADMIN_TOKEN', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].every((k) => (e[k] ?? '').length > 0)
}
