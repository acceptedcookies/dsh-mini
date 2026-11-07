// 截图必须绑定当时的 route 与关键数据，单独的图片不算验证。
import { join } from 'node:path'

export async function capture(app, evidence, name, expect) {
  const file = join(evidence.shots, `${name}.png`)
  await app.shot(file)
  const path = await app.path()
  const data = await app.data().catch(() => ({}))
  const routeOk = expect.route === undefined || path === expect.route || path.endsWith(expect.route)
  const text = JSON.stringify({
    path,
    theme: data.theme,
    title: data.state?.current?.summary?.title ?? data.title,
    input: data.input,
    needUnlock: data.needUnlock,
  })
  const textOk = (expect.includes ?? []).every((s) => text.includes(s))
  evidence.check(`shot:${name}`, routeOk && textOk, `route=${path} text=${text.slice(0, 180)}`)
  return { name, file, path }
}
