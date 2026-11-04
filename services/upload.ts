import type { ImageRef } from '../types/protocol'
import { randomId } from '../utils/uuid'

function chooseImage(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles[0]
        if (file === undefined) reject(new Error('未选择图片'))
        else resolve(file.tempFilePath)
      },
      fail: (error) => reject(new Error(error.errMsg)),
    })
  })
}

/** 选择一张图片，返回小程序本地临时路径；不经过任何服务器。 */
export async function pickImage(): Promise<ImageRef | undefined> {
  try {
    const path = await chooseImage()
    return { id: randomId('image'), url: path }
  } catch {
    return undefined
  }
}
