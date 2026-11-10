// App 旅程：只操作真实页面与真实 wx API，不替换 App 内部服务。
import { capture } from './screenshots.mjs'

export async function bootWorkspace(app, evidence) {
  await app.relaunch('/pages/workspace/workspace')
  return capture(app, evidence, '01-start', { route: 'pages/workspace/workspace' })
}

export async function typeAndSend(app, evidence, text) {
  await app.setData({ input: text })
  const typed = await capture(app, evidence, '02-typed', {
    route: 'pages/workspace/workspace',
    includes: [text.slice(0, 24)],
  })
  await app.call('send')
  const data = await settle(app, 25000)
  const done = await capture(app, evidence, '03-settled', { route: 'pages/workspace/workspace' })
  return { typed, done, data }
}

export async function openSettings(app, evidence, name = '04-settings') {
  await app.navigate('/pages/settings/settings')
  return capture(app, evidence, name, { route: 'pages/settings/settings' })
}

export async function openModels(app, evidence) {
  await app.navigate('/pages/models/models')
  return capture(app, evidence, '05-models', { route: 'pages/models/models' })
}

/** 真机 Page.callMethod 对页面方法不可靠（this.newSession is not a function）——
 *  走真实 UI 锚点，并等 current.sessionId 真的换代。 */
export async function newSession(app, timeoutMs = 8000) {
  const before = await app.data()
  const prev = before.state?.current?.sessionId
  await app.tap('[data-anchor="workspace.newSession"]')
  const deadline = Date.now() + timeoutMs
  let last = before
  while (Date.now() < deadline) {
    last = await app.data()
    const id = last.state?.current?.sessionId
    if (typeof id === 'string' && id.length > 0 && id !== prev) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  return last
}

export function currentText(data) {
  const items = data?.state?.current?.items ?? []
  return items.map((item) => item.text ?? item.kind ?? '').join('\n')
}

async function settle(app, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = await app.data()
  while (Date.now() < deadline) {
    last = await app.data()
    const running = last.state?.current?.status === 'running' || last.state?.sending === true
    if (!running && (last.state?.current?.items?.length ?? 0) > 0) return last
    if (typeof last.state?.error === 'string' && last.state.error.length > 0) return last
    await new Promise((r) => setTimeout(r, 300))
  }
  return last
}
