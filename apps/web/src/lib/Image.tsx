// Shim for the legacy `next/image` import used throughout the ported UI.
//
// Vite has no built-in image optimizer comparable to next/image. For now
// we render a plain <img> and accept the Next.js-specific props
// (`fill`, `priority`, `quality`, `placeholder`, `blurDataURL`, `sizes`)
// without doing anything with them — they're optimization hints in
// Next.js, and ignoring them produces a working image with no visual
// regression beyond layout sizing in `fill` cases. Phase 13 may revisit
// per-component layout if we observe issues; for Phase 5.1 this keeps
// the build green and behavior correct for `width`/`height` cases.
//
// Replaces `import Image from 'next/image'` with
// `import Image from '@/lib/Image'`. Same default-export shape so
// callers don't need to change.

import type { ImgHTMLAttributes } from 'react'

interface NextImageCompatProps extends ImgHTMLAttributes<HTMLImageElement> {
  fill?: boolean
  priority?: boolean
  quality?: number
  placeholder?: 'blur' | 'empty'
  blurDataURL?: string
  sizes?: string
  unoptimized?: boolean
}

export default function Image({
  fill: _fill,
  priority: _priority,
  quality: _quality,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  sizes: _sizes,
  unoptimized: _unoptimized,
  style,
  ...rest
}: NextImageCompatProps) {
  // `fill` in next/image stretches the image to its parent. Approximate
  // with absolute-positioned inset:0 for the rare callers using it.
  const fillStyle = _fill
    ? { position: 'absolute' as const, inset: 0, width: '100%', height: '100%' }
    : undefined
  // Perf defaults: async decode keeps large icons off the main thread's
  // paint path, and lazy loading skips offscreen list images. `priority`
  // (next/image semantics) opts back into eager loading; any explicit
  // `decoding` / `loading` in props wins via the spread below.
  return (
    <img
      decoding="async"
      loading={_priority ? 'eager' : 'lazy'}
      {...rest}
      style={{ ...fillStyle, ...style }}
    />
  )
}
