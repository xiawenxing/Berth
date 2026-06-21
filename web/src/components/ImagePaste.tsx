import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PastedImage {
  name: string
  dataUrl: string
}

function readImageFile(file: File): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve({ name: file.name || 'paste', dataUrl: reader.result })
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

export function usePastedImages() {
  const [images, setImages] = useState<PastedImage[]>([])

  const onPasteImages = useCallback((e: React.ClipboardEvent) => {
    const files = clipboardImageFiles(e)
    if (!files.length) return
    e.preventDefault()
    void Promise.all(files.map(readImageFile))
      .then((next) => setImages((prev) => [...prev, ...next]))
      .catch(() => {})
  }, [])

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const clearImages = useCallback(() => setImages([]), [])

  return { images, setImages, onPasteImages, removeImage, clearImages }
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
