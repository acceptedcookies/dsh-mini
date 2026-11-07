// md-shot-scroll.mjs · 滚屏连拍（md-visual-probe 注入后使用；legacy，已收编 ProbeDriver）
import { ProbeDriver } from './lib/probe.mjs'

const ENDPOINT = process.env.MP_WS || 'ws://localhost:9602'
const d = await ProbeDriver.open({ via: 'automator', automatorOpts: { wsEndpoint: ENDPOINT } })
const mp = d.mp

const N = Number(process.env.SHOTS || 3)
const START = Number(process.env.START || 0)
for (let i = 0; i < N; i++) {
  const top = START + i * Number(process.env.STEP || 700)
  await mp.evaluate((t) => new Promise((r) => wx.pageScrollTo({ scrollTop: t, duration: 0, complete: r })), top)
  await new Promise(r => setTimeout(r, 900))
  const p = `/tmp/md-shot-${i}.png`
  await mp.screenshot({ path: p })
  console.log('SHOT', p, 'top=' + top)
}
await d.close()
