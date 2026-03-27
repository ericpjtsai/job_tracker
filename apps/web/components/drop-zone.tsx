'use client'

import { useState } from 'react'

interface DropZoneProps {
  accept: string
  multiple?: boolean
  label: string
  sublabel: string
  dragLabel: string
  uploading?: boolean
  progress?: number
  progressLabel?: string
  onFiles: (files: File[]) => void
}

export function DropZone({ accept, multiple = false, label, sublabel, dragLabel, uploading, progress, progressLabel, onFiles }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false)
        const files = Array.from(e.dataTransfer.files).filter(f => {
          const ext = '.' + f.name.split('.').pop()?.toLowerCase()
          return accept.split(',').some(a => a.trim() === ext || a.trim() === f.type)
        })
        if (files.length) onFiles(files)
      }}
      onClick={() => {
        if (uploading) return
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = accept
        input.multiple = multiple
        input.onchange = () => {
          if (input.files?.length) onFiles(Array.from(input.files))
        }
        input.click()
      }}
      className={`rounded-xl p-8 text-center transition-all border-2 border-dashed ${
        uploading
          ? 'border-border bg-card cursor-default'
          : dragOver
            ? 'border-primary bg-primary/5 scale-[1.01] cursor-pointer'
            : 'border-border hover:border-primary/50 bg-card cursor-pointer'
      }`}
    >
      {uploading ? (
        <div className="w-full max-w-xs mx-auto space-y-2">
          <div className="text-sm text-muted-foreground">{progressLabel ?? 'Uploading...'}</div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress ?? 0}%` }} />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{progress ?? 0}%</div>
        </div>
      ) : (
        <>
          <div className="text-sm font-medium">{dragOver ? dragLabel : label}</div>
          <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>
        </>
      )}
    </div>
  )
}
