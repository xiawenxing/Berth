import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PastedImage {
  id?: string
  name: string
  dataUrl: string
  marker?: string
}

function readImageFile(file: File, meta: Pick<PastedImage, 'id' | 'marker'> = {}): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve({ ...meta, name: file.name || 'paste', dataUrl: reader.result })
      else reject(new Error('image read failed'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('image read failed'))
    reader.readAsDataURL(file)
  })
}

function clipboardImageFiles(e: React.ClipboardEvent): File[] {
  const files: File[] = []
  const seen = new Set<string>()
  const add = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }
  for (const item of Array.from(e.clipboardData.items ?? [])) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) add(file)
  }
  for (const file of Array.from(e.clipboardData.files ?? [])) {
    add(file)
  }
  return files
}

export interface ImagePastePlacement {
  value: string
  setValue: (next: SetStateAction<string>) => void
  target?: HTMLTextAreaElement | null
}

interface CapturedImagePastePlacement extends ImagePastePlacement {
  start: number
  end: number
}

const IMAGE_MARKER_RE = /\[Image #\d+\]/g

interface ImageMarkerRange {
  marker: string
  start: number
  end: number
}

function imageMarkerRanges(value: string): ImageMarkerRange[] {
  const ranges: ImageMarkerRange[] = []
  for (const match of value.matchAll(IMAGE_MARKER_RE)) {
    if (typeof match.index !== 'number') continue
    ranges.push({ marker: match[0], start: match.index, end: match.index + match[0].length })
  }
  return ranges
}

function countImagePlaceholders(value: string): number {
  return imageMarkerRanges(value).length
}

function capturePlacement(placement: ImagePastePlacement): CapturedImagePastePlacement {
  const target = placement.target
  const value = placement.value ?? ''
  const start = typeof target?.selectionStart === 'number' ? target.selectionStart : value.length
  const end = typeof target?.selectionEnd === 'number' ? target.selectionEnd : start
  return { ...placement, value, start, end }
}

function insertMarkersAtSelection(placement: ImagePastePlacement, markers: string[]) {
  const target = placement.target
  const value = placement.value ?? ''
  const captured = 'start' in placement
    ? placement as CapturedImagePastePlacement
    : capturePlacement(placement)
  const start = captured.start
  const end = captured.end
  const insertion = markers.join('\n')
  const cursor = start + insertion.length
  placement.setValue((current) => {
    const base = typeof current === 'string' ? current : value
    const safeStart = Math.min(start, base.length)
    const safeEnd = Math.min(Math.max(end, safeStart), base.length)
    return base.slice(0, safeStart) + insertion + base.slice(safeEnd)
  })
  if (target) {
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => { setTimeout(() => cb(Date.now()), 0); return 0 }
    raf(() => {
      try {
        target.selectionStart = cursor
        target.selectionEnd = cursor
        target.focus()
      } catch {
        /* textarea may have unmounted */
      }
    })
  }
}

function removeMarkerText(value: string, marker: string): string {
  const index = value.indexOf(marker)
  if (index < 0) return value
  return value.slice(0, index) + value.slice(index + marker.length)
}

function findMarkerDeletion(value: string, start: number, end: number, key: string): { start: number; end: number; markers: Set<string> } | null {
  const ranges = imageMarkerRanges(value)
  if (!ranges.length) return null
  const touched = start === end
    ? ranges.filter((range) => (
      key === 'Backspace'
        ? start > range.start && start <= range.end
        : start >= range.start && start < range.end
    ))
    : ranges.filter((range) => start < range.end && end > range.start)
  if (!touched.length) return null
  return {
    start: Math.min(start, ...touched.map((range) => range.start)),
    end: Math.max(end, ...touched.map((range) => range.end)),
    markers: new Set(touched.map((range) => range.marker)),
  }
}

function restoreTextareaCursor(target: HTMLTextAreaElement | null | undefined, cursor: number) {
  if (!target) return
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => { setTimeout(() => cb(Date.now()), 0); return 0 }
  raf(() => {
    try {
      target.selectionStart = cursor
      target.selectionEnd = cursor
      target.focus()
    } catch {
      /* textarea may have unmounted */
    }
  })
}

export function usePastedImages() {
  const [images, setImageState] = useState<PastedImage[]>([])
  const imagesRef = useRef<PastedImage[]>([])

  const setImages = useCallback((next: SetStateAction<PastedImage[]>) => {
    setImageState((prev) => {
      const resolved = typeof next === 'function'
        ? (next as (prev: PastedImage[]) => PastedImage[])(prev)
        : next
      imagesRef.current = resolved
      return resolved
    })
  }, [])

  const onPasteImages = useCallback((e: React.ClipboardEvent, placement?: ImagePastePlacement) => {
    const files = clipboardImageFiles(e)
    if (!files.length) return
    e.preventDefault()
    const captured = placement ? capturePlacement(placement) : undefined
    void Promise.all(files.map((file) => readImageFile(file)))
      .then((read) => {
        const seen = new Set(imagesRef.current.map((image) => image.dataUrl))
        const unique = read.filter((image) => {
          if (seen.has(image.dataUrl)) return false
          seen.add(image.dataUrl)
          return true
        })
        if (!unique.length) return
        const baseNo = captured ? countImagePlaceholders(captured.value) + 1 : imagesRef.current.length + 1
        const pasteId = Date.now()
        const next = unique.map((image, idx) => {
          const n = baseNo + idx
          return { ...image, id: `paste_${pasteId}_${n}`, marker: `[Image #${n}]` }
        })
        if (captured) insertMarkersAtSelection(captured, next.map((image) => image.marker ?? ''))
        setImages((prev) => next.length ? [...prev, ...next] : prev)
      })
      .catch(() => {})
  }, [setImages])

  const reconcileImagePlaceholders = useCallback((nextValue: string) => {
    const markers = new Set(imageMarkerRanges(nextValue).map((range) => range.marker))
    setImages((prev) => prev.filter((image) => !image.marker || markers.has(image.marker)))
    return nextValue
  }, [setImages])

  const handleImagePlaceholderKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>, placement: ImagePastePlacement) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return false
    if (e.key !== 'Backspace' && e.key !== 'Delete') return false
    const captured = capturePlacement(placement)
    const deletion = findMarkerDeletion(captured.value, captured.start, captured.end, e.key)
    if (!deletion) return false
    e.preventDefault()
    placement.setValue(captured.value.slice(0, deletion.start) + captured.value.slice(deletion.end))
    setImages((prev) => prev.filter((image) => !image.marker || !deletion.markers.has(image.marker)))
    restoreTextareaCursor(captured.target, deletion.start)
    return true
  }, [setImages])

  const removeImage = useCallback((idx: number, placement?: ImagePastePlacement) => {
    const image = imagesRef.current[idx]
    if (placement && image?.marker) {
      const captured = capturePlacement(placement)
      const nextValue = removeMarkerText(captured.value, image.marker)
      if (nextValue !== captured.value) {
        const cursor = Math.min(captured.start, nextValue.length)
        placement.setValue(nextValue)
        restoreTextareaCursor(captured.target, cursor)
      }
    }
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }, [setImages])

  const clearImages = useCallback(() => setImages([]), [])

  return { images, setImages, onPasteImages, removeImage, clearImages, reconcileImagePlaceholders, handleImagePlaceholderKeyDown }
}

export function pastedImageDataUrls(images: PastedImage[]): string[] {
  return images.map((image) => image.dataUrl)
}

export function PastedImageStrip({
  images,
  onRemove,
  className,
}: {
  images: PastedImage[]
  onRemove: (idx: number) => void
  className?: string
}) {
  if (!images.length) return null
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {images.map((image, idx) => (
        <div key={`${image.name}-${idx}`} className="group relative h-16 w-16 overflow-hidden rounded-md border border-border bg-background">
          <img src={image.dataUrl} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100"
            title="移除图片"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
