/**
 * objects —— 字节对象层（USER_DATA_PATH content-addressed，R2 analog）。
 * ObjectBackend 是 S3 接缝：local 已实现，s3 为合约占位（not-configured）。
 * 诚实语义：USER_DATA_PATH 是 cache-tier 不是 truth（rules/filesystem.md §2）。
 */
import { VfsError } from './paths'
import type { S3BackendConfig } from './store'

export interface ObjectBackend {
  readonly kind: 'local' | 's3' | 'cloud'
  /** 写入字节（key 即 content_hash，天然幂等）。 */
  write(key: string, bytes: ArrayBuffer): void
  /** 读完整对象；不存在抛 path-not-found。 */
  read(key: string): ArrayBuffer
  exists(key: string): boolean
  remove(key: string): void
}

/** 惰性求值：模块加载期 wx.env 可能未就绪（appService 初始化序），调用时才取。 */
function rootDir(): string {
  return `${wx.env.USER_DATA_PATH}/dsh-vfs`
}

function fsm(): WechatMiniprogram.FileSystemManager {
  return wx.getFileSystemManager()
}

function ensureDir(path: string): void {
  try {
    fsm().accessSync(path)
  } catch {
    fsm().mkdirSync(path, true)
  }
}

function keyToPath(key: string): string {
  return `${rootDir()}/objects/${key.slice(0, 2)}/${key}`
}

/** 本地对象后端：content-addressed，tmp→rename 写入序（对象先于行）。 */
export const localObjects: ObjectBackend = {
  kind: 'local',

  write(key: string, bytes: ArrayBuffer): void {
    ensureDir(`${rootDir()}/objects/${key.slice(0, 2)}`)
    const target = keyToPath(key)
    try {
      fsm().accessSync(target)
      return // content-addressed：同 key 即同字节
    } catch {
      /* 不存在则写 */
    }
    const tmp = `${target}.tmp-${Date.now().toString(36)}`
    // DevTools/真机 FSM 裸 ArrayBuffer 写入会被字符串化为 "[object ArrayBuffer]"，
    // Uint8Array 报 invalid data——二进制必须走 base64 编码通道。
    fsm().writeFileSync(tmp, wx.arrayBufferToBase64(bytes), 'base64')
    try {
      fsm().renameSync(tmp, target)
    } catch (e) {
      try {
        fsm().unlinkSync(tmp)
      } catch {
        /* noop */
      }
      throw e instanceof Error ? e : new Error(String(e))
    }
  },

  read(key: string): ArrayBuffer {
    try {
      // 无编码 readFileSync 返回的 Buffer 对象在此环境不可直接转 Uint8Array——读 base64 再解码。
      const b64 = fsm().readFileSync(keyToPath(key), 'base64') as string
      return wx.base64ToArrayBuffer(b64)
    } catch {
      throw new VfsError('bytes-missing', `对象 ${key.slice(0, 12)} 字节缺失（USER_DATA_PATH 可能被清理）`)
    }
  },

  exists(key: string): boolean {
    try {
      fsm().accessSync(keyToPath(key))
      return true
    } catch {
      return false
    }
  },

  remove(key: string): void {
    try {
      fsm().unlinkSync(keyToPath(key))
    } catch {
      /* 已不存在 */
    }
  },
}

/**
 * S3 对象后端 —— 合约占位（业主：仅合约和占位，暂不测试）。
 * 形状与 ObjectBackend 一致：待真 S3 接入时，唯一变化是本类方法的实现
 * （sigv4 签名 + wx.request PUT/GET），行/placement/lane 语义全部不变。
 */
export class S3ObjectBackend implements ObjectBackend {
  readonly kind: 's3' = 's3'
  constructor(readonly config: S3BackendConfig) {}
  private unavailable(): never {
    throw new VfsError('backend-unavailable', `S3 后端未启用（${this.config.endpoint}/${this.config.bucket}）：合约占位，待接入`)
  }
  write(): never {
    return this.unavailable()
  }
  read(): never {
    return this.unavailable()
  }
  exists(): never {
    return this.unavailable()
  }
  remove(): never {
    return this.unavailable()
  }
}

/**
 * placement → backend 解析。s3-pinned/cloud-pinned 的 backend 未启用时
 * 抛 backend-unavailable——placement 是显式声明，不静默降级为 local。
 */
export function backendFor(placement: 'local-scratch' | 'local-hub' | 'cloud-pinned' | 's3-pinned', s3Config?: S3BackendConfig): ObjectBackend {
  if (placement === 's3-pinned') {
    if (s3Config === undefined) throw new VfsError('backend-unavailable', 's3-pinned placement 但无 S3 配置')
    return new S3ObjectBackend(s3Config)
  }
  if (placement === 'cloud-pinned') throw new VfsError('backend-unavailable', 'cloud-pinned placement 后端待接入')
  return localObjects
}
