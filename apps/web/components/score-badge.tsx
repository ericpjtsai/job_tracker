'use client'

import { Badge } from '@/components/ui/badge'
import { cn, capitalize } from '@/lib/utils'

interface StatusChipProps {
  status: string
  onChange?: (status: string) => void
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-blue-500/15 text-blue-700',
  reviewed: 'bg-muted text-muted-foreground',
  applied: 'bg-green-500/15 text-green-700',
  skipped: 'bg-muted text-muted-foreground/60',
}

const STATUSES = ['new', 'reviewed', 'applied', 'skipped']

export function StatusChip({ status, onChange }: StatusChipProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.new

  if (!onChange) {
    return <Badge className={style}>{capitalize(status)}</Badge>
  }

  return (
    <select
      aria-label="Job status"
      value={status}
      onChange={(e) => onChange(e.target.value)}
      className={cn('inline-flex items-center rounded-md pl-2 pr-6 py-0.5 text-xs font-medium cursor-pointer appearance-none bg-no-repeat w-fit', style)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundSize: '12px', backgroundPosition: 'right 4px center' }}
      onClick={(e) => e.stopPropagation()}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>{capitalize(s)}</option>
      ))}
    </select>
  )
}

interface FitBadgeProps {
  fit: number | null
}

export function FitBadge({ fit }: FitBadgeProps) {
  if (fit === null) return <span className="text-xs text-muted-foreground">—</span>

  const color =
    fit >= 70
      ? 'text-green-600'
      : fit >= 40
      ? 'text-amber-600'
      : 'text-muted-foreground'

  return <span className={cn('text-xs font-medium tabular-nums', color)}>{fit}%</span>
}
