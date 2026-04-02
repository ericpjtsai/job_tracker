'use client'

import { cn } from '@/lib/utils'

interface FitBadgeProps {
  fit: number | null
}

export function FitBadge({ fit }: FitBadgeProps) {
  if (fit === null) return <span className="text-xs text-muted-foreground">—</span>

  const color =
    fit >= 70
      ? 'text-emerald-700'
      : fit >= 40
      ? 'text-amber-700'
      : 'text-muted-foreground'

  return <span className={cn('text-xs font-medium tabular-nums', color)}>{fit}%</span>
}
