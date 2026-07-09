import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const BUILD = join(ROOT, 'build')
const ICONSET = join(BUILD, 'icon.iconset')

const BLUE_TOP = [83, 191, 255, 255]
const BLUE_BOTTOM = [31, 101, 225, 255]
const BLUE_EDGE = [13, 37, 103, 70]
const WHITE = [255, 255, 255, 255]
const SHADOW = [0, 12, 38, 74]
const HIGHLIGHT = [255, 255, 255, 54]

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="188" y1="116" x2="836" y2="908" gradientUnits="userSpaceOnUse">
      <stop stop-color="#53bfff"/>
      <stop offset="1" stop-color="#1f65e1"/>
    </linearGradient>
  </defs>
  <rect x="88" y="88" width="848" height="848" rx="224" fill="url(#bg)"/>
  <path d="M160 202C244 130 362 88 512 88h198c125 0 226 101 226 226v128" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="34" stroke-linecap="round"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M336 744V276" stroke="#00143b" stroke-opacity=".26" stroke-width="96"/>
    <path d="M336 288c168 60 282 156 336 288-114 12-228-12-336-72" stroke="#00143b" stroke-opacity=".26" stroke-width="96"/>
    <path d="M336 744c96-114 216-174 360-180" stroke="#00143b" stroke-opacity=".26" stroke-width="96"/>
    <path d="M336 744V276" stroke="#fff" stroke-width="84"/>
    <path d="M336 288c168 60 282 156 336 288-114 12-228-12-336-72" stroke="#fff" stroke-width="84"/>
    <path d="M336 744c96-114 216-174 360-180" stroke="#fff" stroke-width="84"/>
  </g>
  <rect x="88" y="88" width="848" height="848" rx="224" fill="none" stroke="#0d2567" stroke-opacity=".22" stroke-width="20"/>
</svg>
`

function main() {
  mkdirSync(BUILD, { recursive: true })
  writeFileSync(join(BUILD, 'icon.svg'), ICON_SVG)

  rmSync(ICONSET, { recursive: true, force: true })
  mkdirSync(ICONSET, { recursive: true })

  const pngs = new Map()
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    pngs.set(size, encodePng(renderIcon(size)))
  }

  const iconsetEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ]
  for (const [name, size] of iconsetEntries) {
    writeFileSync(join(ICONSET, name), pngs.get(size))
  }

  writeFileSync(join(BUILD, 'icon.png'), pngs.get(1024))
  writeFileSync(join(BUILD, 'icon.ico'), encodeIco([16, 32, 48, 64, 128, 256].map((size) => [size, pngs.get(size)])))

  const iconutil = spawnSync('iconutil', ['-c', 'icns', ICONSET, '-o', join(BUILD, 'icon.icns')], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (iconutil.status !== 0 || !existsSync(join(BUILD, 'icon.icns'))) {
    throw new Error('iconutil failed to create build/icon.icns')
  }
}

function renderIcon(size) {
  const ss = size < 128 ? 4 : size < 512 ? 3 : 2
  const w = size * ss
  const h = size * ss
  const scale = w / 1024
  const pixels = new Uint8ClampedArray(w * h * 4)

  drawRoundedRect(pixels, w, h, 88 * scale, 88 * scale, 848 * scale, 848 * scale, 224 * scale, (x, y) => {
    const t = Math.min(1, Math.max(0, (x + y) / (w + h)))
    return mix(BLUE_TOP, BLUE_BOTTOM, t)
  })
  drawArcHighlight(pixels, w, h, scale)
  drawRoundedRectStroke(pixels, w, h, 88 * scale, 88 * scale, 848 * scale, 848 * scale, 224 * scale, 20 * scale, BLUE_EDGE)

  drawShip(pixels, w, h, scale, SHADOW, 96 * scale, 0, 18 * scale)
  drawShip(pixels, w, h, scale, WHITE, 84 * scale, 0, 0)

  return downsample(pixels, w, h, ss)
}

function drawShip(pixels, w, h, scale, color, width, dx, dy) {
  const tx = (x) => x * scale + dx
  const ty = (y) => y * scale + dy
  drawStroke(pixels, w, h, [[tx(336), ty(744)], [tx(336), ty(276)]], width, color)
  drawStroke(
    pixels,
    w,
    h,
    cubicPoints([336, 288], [504, 348], [618, 444], [672, 576], scale, dx, dy)
      .concat(cubicPoints([672, 576], [558, 588], [444, 564], [336, 504], scale, dx, dy).slice(1)),
    width,
    color,
  )
  drawStroke(pixels, w, h, cubicPoints([336, 744], [432, 630], [552, 570], [696, 564], scale, dx, dy), width, color)
}

function cubicPoints(a, b, c, d, scale, dx = 0, dy = 0) {
  const out = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const mt = 1 - t
    const x = mt ** 3 * a[0] + 3 * mt ** 2 * t * b[0] + 3 * mt * t ** 2 * c[0] + t ** 3 * d[0]
    const y = mt ** 3 * a[1] + 3 * mt ** 2 * t * b[1] + 3 * mt * t ** 2 * c[1] + t ** 3 * d[1]
    out.push([x * scale + dx, y * scale + dy])
  }
  return out
}

function drawRoundedRect(pixels, w, h, x, y, rw, rh, r, colorAt) {
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(h, Math.ceil(y + rh)); py++) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(w, Math.ceil(x + rw)); px++) {
      const alpha = roundedRectCoverage(px + 0.5, py + 0.5, x, y, rw, rh, r)
      if (alpha <= 0) continue
      const color = typeof colorAt === 'function' ? colorAt(px, py) : colorAt
      blend(pixels, (py * w + px) * 4, color, alpha)
    }
  }
}

function drawRoundedRectStroke(pixels, w, h, x, y, rw, rh, r, width, color) {
  const inset = width / 2
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(h, Math.ceil(y + rh)); py++) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(w, Math.ceil(x + rw)); px++) {
      const outer = roundedRectCoverage(px + 0.5, py + 0.5, x, y, rw, rh, r)
      const inner = roundedRectCoverage(px + 0.5, py + 0.5, x + inset, y + inset, rw - width, rh - width, r - inset)
      const alpha = Math.max(0, outer - inner)
      if (alpha > 0) blend(pixels, (py * w + px) * 4, color, alpha)
    }
  }
}

function drawArcHighlight(pixels, w, h, scale) {
  const cx = 512 * scale
  const cy = 416 * scale
  const rx = 420 * scale
  const ry = 340 * scale
  const width = 34 * scale
  for (let py = Math.floor(100 * scale); py < Math.ceil(450 * scale); py++) {
    for (let px = Math.floor(130 * scale); px < Math.ceil(930 * scale); px++) {
      const nx = (px + 0.5 - cx) / rx
      const ny = (py + 0.5 - cy) / ry
      const d = Math.abs(Math.sqrt(nx * nx + ny * ny) - 1) * Math.max(rx, ry)
      if (d > width) continue
      if (px < 160 * scale || px > 936 * scale || py > 442 * scale) continue
      const alpha = Math.max(0, 1 - d / width) * 0.72
      blend(pixels, (py * w + px) * 4, HIGHLIGHT, alpha)
    }
  }
}

function drawStroke(pixels, w, h, points, width, color) {
  const radius = width / 2
  for (let i = 0; i < points.length - 1; i++) {
    drawSegment(pixels, w, h, points[i], points[i + 1], radius, color)
  }
  for (const p of points) drawCircle(pixels, w, h, p[0], p[1], radius, color)
}

function drawSegment(pixels, w, h, a, b, r, color) {
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 2))
  const maxX = Math.min(w, Math.ceil(Math.max(a[0], b[0]) + r + 2))
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 2))
  const maxY = Math.min(h, Math.ceil(Math.max(a[1], b[1]) + r + 2))
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const len2 = vx * vx + vy * vy || 1
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x + 0.5 - a[0]) * vx + (y + 0.5 - a[1]) * vy) / len2))
      const px = a[0] + t * vx
      const py = a[1] + t * vy
      const dist = Math.hypot(x + 0.5 - px, y + 0.5 - py)
      const alpha = Math.max(0, Math.min(1, r + 0.75 - dist))
      if (alpha > 0) blend(pixels, (y * w + x) * 4, color, alpha)
    }
  }
}

function drawCircle(pixels, w, h, cx, cy, r, color) {
  const minX = Math.max(0, Math.floor(cx - r - 2))
  const maxX = Math.min(w, Math.ceil(cx + r + 2))
  const minY = Math.max(0, Math.floor(cy - r - 2))
  const maxY = Math.min(h, Math.ceil(cy + r + 2))
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const alpha = Math.max(0, Math.min(1, r + 0.75 - dist))
      if (alpha > 0) blend(pixels, (y * w + x) * 4, color, alpha)
    }
  }
}

function roundedRectCoverage(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r)
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  const dist = outside + inside - r
  return Math.max(0, Math.min(1, 0.5 - dist))
}

function blend(pixels, i, color, alpha = 1) {
  const srcA = (color[3] / 255) * alpha
  const dstA = pixels[i + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  pixels[i] = Math.round((color[0] * srcA + pixels[i] * dstA * (1 - srcA)) / outA)
  pixels[i + 1] = Math.round((color[1] * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA)
  pixels[i + 2] = Math.round((color[2] * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA)
  pixels[i + 3] = Math.round(outA * 255)
}

function mix(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
    Math.round(a[3] * (1 - t) + b[3] * t),
  ]
}

function downsample(src, w, h, factor) {
  const outW = w / factor
  const outH = h / factor
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const acc = [0, 0, 0, 0]
      for (let yy = 0; yy < factor; yy++) {
        for (let xx = 0; xx < factor; xx++) {
          const i = ((y * factor + yy) * w + x * factor + xx) * 4
          acc[0] += src[i]
          acc[1] += src[i + 1]
          acc[2] += src[i + 2]
          acc[3] += src[i + 3]
        }
      }
      const n = factor * factor
      const o = (y * outW + x) * 4
      out[o] = Math.round(acc[0] / n)
      out[o + 1] = Math.round(acc[1] / n)
      out[o + 2] = Math.round(acc[2] / n)
      out[o + 3] = Math.round(acc[3] / n)
    }
  }
  return { width: outW, height: outH, data: out }
}

function encodePng(image) {
  const { width, height, data } = image
  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    scanlines[row] = 0
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(scanlines, row + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function encodeIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6 + count * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  let offset = header.length
  const images = []
  entries.forEach(([size, png], idx) => {
    const pos = 6 + idx * 16
    header[pos] = size >= 256 ? 0 : size
    header[pos + 1] = size >= 256 ? 0 : size
    header[pos + 2] = 0
    header[pos + 3] = 0
    header.writeUInt16LE(1, pos + 4)
    header.writeUInt16LE(32, pos + 6)
    header.writeUInt32LE(png.length, pos + 8)
    header.writeUInt32LE(offset, pos + 12)
    images.push(png)
    offset += png.length
  })
  return Buffer.concat([header, ...images])
}

function chunk(type, data) {
  const name = Buffer.from(type)
  return Buffer.concat([u32(data.length), name, data, u32(crc32(Buffer.concat([name, data])))])
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

main()
