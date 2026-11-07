// unlock-shot.mjs · unlock 悬浮/loading 截图（legacy，已收编 ProbeDriver）
import { ProbeDriver } from './lib/probe.mjs'

const d = await ProbeDriver.open({ via: 'automator', automatorOpts: { port: 9602 } })
const mp = d.mp
// 1) 悬浮态截图
const st = await mp.evaluate(() => {
  const ws = getCurrentPages()[getCurrentPages().length - 1]
  return { needUnlock: ws.data.needUnlock, unlocking: ws.data.unlocking, view: ws.data.view }
})
console.log('STATE', JSON.stringify(st))
await mp.screenshot({ path: '/tmp/unlock-float.png' })
console.log('SHOT /tmp/unlock-float.png')
// 2) loading 态截图（直接置 unlocking）
await mp.evaluate(() => {
  const ws = getCurrentPages()[getCurrentPages().length - 1]
  ws.setData({ unlocking: true, needUnlock: true })
})
await new Promise(r => setTimeout(r, 600))
await mp.screenshot({ path: '/tmp/unlock-loading.png' })
console.log('SHOT /tmp/unlock-loading.png')
// 复位
await mp.evaluate(() => {
  const ws = getCurrentPages()[getCurrentPages().length - 1]
  ws.setData({ unlocking: false })
})
await d.close()
