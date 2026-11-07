// live 只走手机也有的公网。SSH 隧道、127.0.0.1、/dev/ticket 都不是 live 的前提。
import { PRODUCTION_BASE } from './env.mjs'
import { openEvidence } from './evidence.mjs'

export function liveWithoutTunnel(dir, sim) {
  return openEvidence(dir, 'live').finish({
    sim,
    status: 'live-blocked',
    endpoint: PRODUCTION_BASE,
    shots: [],
    note: '不用 SSH 隧道。手机没有这条隧道。写操作要手机自己的票打 https://dsh-mini.saobao.com；/dev/ticket 不在公网，不能用隧道补。',
  })
}
