/**
 * images —— prompt 图片 → kernel image_url part 解析（G4 双形态）。
 * cloud 路由：字节经 artifacts/publish 上 POD1 → `https://dsh-mini…/a/{sha}.{ext}`
 * 公网不可猜址（content-hash）；local/sim 路由：dev 车道直连上游，
 * `data:{mime};base64,` 内联——kernel 上游校验面对 deepseek 拒绝 data:
 * （vision-inline-image-forbidden）属 kernel 侧 provider 契约，mp io.llm
 * 走 chat/completions 不过该闸；线上以 publish 形态为准。
 */
import type { ImageRef, SessionEngine } from '../../types/protocol'
import { vfsRemoteFor } from '../state/provider'
import { currentRoute } from '../fx/dev'
import { guessMime } from '../vfs/vfs'

export interface ImagePart {
  kind: 'image_url'
  url: string
}

function readLocalBytes(path: string): { bytes: ArrayBuffer; b64: string } {
  const b64 = wx.getFileSystemManager().readFileSync(path, 'base64') as string
  return { bytes: wx.base64ToArrayBuffer(b64), b64 }
}

export async function resolveImageParts(images: ImageRef[], engine?: SessionEngine): Promise<ImagePart[]> {
  if (images.length === 0) return []
  // 引擎裁决先于路由：magpie=纯本地车道 data: 内联；nano-agent=BYOK 面
  // publish→https；无戳旧会话按建时路由派生（cloud→publish、local/sim→
  // data: 内联——cloud-sim dev 流程逐字节不变）。
  const publish = engine !== undefined ? engine !== 'magpie' : currentRoute().mode === 'cloud'
  if (publish) {
    const remote = vfsRemoteFor()
    if (remote === null) {
      // 无静默回退：不偷换 data: 充数——远端 lane 缺位如实上报
      throw new Error('image-upload: remote artifact lane 不可用（cloud 路由句柄缺失）')
    }
    const parts: ImagePart[] = []
    for (const image of images) {
      const { bytes } = readLocalBytes(image.url)
      const mime = guessMime(image.url) ?? 'image/png'
      const a = await remote.publishArtifact(bytes, mime)
      parts.push({ kind: 'image_url', url: a.url })
    }
    return parts
  }
  return images.map((image) => {
    const { b64 } = readLocalBytes(image.url)
    const mime = guessMime(image.url) ?? 'image/png'
    return { kind: 'image_url', url: `data:${mime};base64,${b64}` }
  })
}
