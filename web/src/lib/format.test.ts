import { describe, expect, it } from 'vitest'
import { imagePathPlaceholderText, splitImagePathPlaceholders } from './format'

describe('image path placeholders', () => {
  it('formats image paths as [图片] for compact titles', () => {
    expect(
      imagePathPlaceholderText('/Users/bytedance/Documents/Obsidian\\ Vault/assets/imagepng-1782446492681-2567.png 1. 打包失败'),
    ).toBe('[图片] 1. 打包失败')
  })

  it('keeps the original path on image placeholder parts for hover titles', () => {
    const parts = splitImagePathPlaceholders('看 /tmp/shot.webp 和这里')
    expect(parts).toEqual([
      { kind: 'text', text: '看 ' },
      { kind: 'image', path: '/tmp/shot.webp', text: '[图片]' },
      { kind: 'text', text: ' 和这里' },
    ])
  })
})
