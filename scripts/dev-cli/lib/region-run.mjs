// dev-cli · 区域截图三步合成（T-O-4）：element_action geo → simulator_screenshot
// 全图 → jimp 裁切。region.mjs 与 session.mjs 共用本函数，合成逻辑单一真源。
// 产物: <out>.png + <out>.json 元数据（anchor/rect/dp/px/pixelRatio/route/时间戳）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { flagOf } from './args.mjs'

const require = createRequire(import.meta.url)
const Jimp = require('jimp')

/** @returns {{png: string, meta: object}} */
export default async function regionRun(d, target, flags = {}) {
  const sel = await d.resolveAnchor(target, { id: flagOf(flags, 'id', undefined) })
  const route = await d.route()

  // 1) 几何（dp）+ pixelRatio 同条读
  const dp = await d.elementRect(target, { id: flagOf(flags, 'id', undefined) })
  if (!dp?.w || !dp?.h) throw new Error(`区域几何为空：${sel} → ${JSON.stringify(dp)}`)
  const win = await d.eval('() => ({w: wx.getWindowInfo().windowWidth, h: wx.getWindowInfo().windowHeight, pr: wx.getWindowInfo().pixelRatio})')

  // 2) 全图——viewport_action 截图与 element offset 同坐标系（设备视口）；
  //    simulator_screenshot 截 OS 窗口会被屏幕边缘裁切，坐标对不上（实测坑）。
  const tmp = resolve(`.anote/shots/_region-full-${Date.now()}.png`)
  mkdirSync(dirname(tmp), { recursive: true })
  await d.shot(tmp)

  // 3) 裁切。实测校比 = 图px/视口dp（≠wx pr：截图密度跟模拟器窗口走，非设备pr）。
  //    元素可在视口外（位移/隐藏容器）——出屏即报明错。
  const img = await Jimp.read(tmp)
  const scale = img.bitmap.width / win.w
  const scaleY = img.bitmap.height / win.h
  if (Math.abs(scale - scaleY) / scale > 0.02) {
    throw new Error(`截图轴向校比不一致：x=${scale.toFixed(4)} y=${scaleY.toFixed(4)}——坐标系异常，中止裁切`)
  }
  const px = { x: Math.round(dp.x * scale), y: Math.round(dp.y * scale), w: Math.round(dp.w * scale), h: Math.round(dp.h * scale) }
  const cx = Math.max(0, px.x), cy = Math.max(0, px.y)
  const cw = Math.min(px.w, img.bitmap.width - cx), ch = Math.min(px.h, img.bitmap.height - cy)
  if (cw <= 0 || ch <= 0) {
    throw new Error(`元素不在可视截图区：dp=${JSON.stringify(dp)} scale=${scale.toFixed(4)} → px x=${px.x} y=${px.y}，`
      + `全图 ${img.bitmap.width}×${img.bitmap.height}。先 inject/act 使其可见再 region。`)
  }
  img.crop(cx, cy, cw, ch)

  const out = resolve(flagOf(flags, 'o', `.anote/shots/region-${Date.now()}.png`))
  mkdirSync(dirname(out), { recursive: true })
  await img.writeAsync(out)

  const meta = {
    schema: 'dsh-mini.region.v1', anchor: target.startsWith('@') ? target.slice(1) : null,
    selector: sel, route, dpRect: dp, pxRect: { x: cx, y: cy, w: cw, h: ch },
    scale, wxPixelRatio: win?.pr, viewportDp: win ? { w: win.w, h: win.h } : null,
    png: { w: img.bitmap.width, h: img.bitmap.height }, capturedAt: new Date().toISOString(),
  }
  writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(meta, null, 2))
  return { png: out, meta }
}
