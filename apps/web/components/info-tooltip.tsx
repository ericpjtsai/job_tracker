'use client'

import { useRef, useState } from 'react'

export function InfoTooltip({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  function show() {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const tipW = 192
    let left = rect.left + rect.width / 2 - tipW / 2
    let top = rect.bottom + 6
    if (left < 8) left = 8
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8
    if (top + 80 > window.innerHeight) top = rect.top - 80 - 6
    setPos({ top, left })
  }

  return (
    <span className="inline-block align-middle ml-0.5" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      <span ref={ref} className="text-muted-foreground/40 cursor-default text-[8px] rounded-full w-2.5 h-2.5 inline-flex items-center justify-center leading-none hover:text-muted-foreground select-none border border-border">i</span>
      {pos && (
        <span className="pointer-events-none fixed z-[9999] bg-black text-white text-xs font-normal normal-case tracking-normal whitespace-normal rounded-md px-2.5 py-2 w-48 shadow-lg leading-snug" style={{ top: pos.top, left: pos.left }}>
          {text}
        </span>
      )}
    </span>
  )
}
