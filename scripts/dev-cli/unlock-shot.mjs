import automator from 'miniprogram-automator'
const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9602', timeout: 15000 })
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
await mp.disconnect()
