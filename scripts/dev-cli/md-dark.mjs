import automator from 'miniprogram-automator'
const mp = await automator.connect({ wsEndpoint: 'ws://localhost:9602', timeout: 15000 })
const r = await mp.evaluate(() => {
  const ws = getCurrentPages()[getCurrentPages().length - 1]
  ws.setData({ theme: 'dark', view: 'chat' })
  const ids = (ws.data.displayItems || []).filter(i => String(i.id).startsWith('md-probe')).map(i => 'msg-' + i.id)
  return { ids }
})
console.log('DARK', JSON.stringify(r))
await new Promise(r => setTimeout(r, 1200))
for (const i of [0, 1, 2]) {
  const id = r.ids[i]
  if (!id) continue
  await mp.evaluate((t) => {
    const ws = getCurrentPages()[getCurrentPages().length - 1]
    ws.setData({ view: 'chat', scrollTarget: '' })
    ws.setData({ scrollTarget: t })
  }, id)
  await new Promise(r => setTimeout(r, 900))
  await mp.screenshot({ path: `/tmp/md-dark-${i}.png` })
  console.log('SHOT', `/tmp/md-dark-${i}.png`)
}
await mp.disconnect()
