import { describe, expect, it } from 'vitest'
import { imagePathPlaceholderText, setDisplayHome, shortCwd, splitImagePathPlaceholders } from './format'

describe('shortCwd', () => {
  it('shortens only the real home path supplied by the backend', () => {
    setDisplayHome('/home/alice')
    expect(shortCwd('/home/alice/code/berth')).toBe('~/code/berth')
    expect(shortCwd('/home/bob/code/berth')).toBe('/home/bob/code/berth')
    setDisplayHome('C:\\Users\\Alice')
    expect(shortCwd('C:\\Users\\Alice\\code\\berth')).toBe('~\\code\\berth')
  })
})

describe('image path placeholders', () => {
  it('formats image paths as [图片] for compact titles', () => {
    expect(
      imagePathPlaceholderText('/Users/example/Documents/Notes/assets/image.png 1. 打包失败'),
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
