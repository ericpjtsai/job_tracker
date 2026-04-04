'use client'

import { Badge } from '@/components/ui/badge'
import { cn, capitalize } from '@/lib/utils'

interface StatusChipProps {
  status: string
  onChange?: (status: string) => void
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-sky-500/15 text-sky-800',
  reviewed: 'bg-muted text-muted-foreground',
  applied: 'bg-emerald-500/15 text-emerald-800',
  interview: 'bg-violet-500/15 text-violet-800',
  offer: 'bg-emerald-500/25 text-emerald-800',
  rejected: 'bg-rose-400/15 text-rose-800',
  skipped: 'bg-muted text-muted-foreground/60',
  unavailable: 'bg-muted text-muted-foreground/60',
}

const PRE_APPLICATION = ['new', 'reviewed', 'skipped', 'unavailable'] as const
const POST_APPLICATION = ['applied', 'interview', 'offer', 'rejected'] as const

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
      className={cn('inline-block rounded-md pl-2 pr-5 py-0.5 text-xs font-medium cursor-pointer appearance-none bg-no-repeat', style)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundSize: '12px', backgroundPosition: 'right 4px center' }}
      onClick={(e) => e.stopPropagation()}
    >
      <optgroup label="Before application">
        {PRE_APPLICATION.map((s) => (
          <option key={s} value={s}>{capitalize(s)}</option>
        ))}
      </optgroup>
      <optgroup label="After application">
        {POST_APPLICATION.map((s) => (
          <option key={s} value={s}>{capitalize(s)}</option>
        ))}
      </optgroup>
    </select>
  )
}
