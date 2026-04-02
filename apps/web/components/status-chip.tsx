'use client'

import { Badge } from '@/components/ui/badge'
import { cn, capitalize } from '@/lib/utils'
import { JOB_STATUSES } from '@/lib/supabase'

interface StatusChipProps {
  status: string
  onChange?: (status: string) => void
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-teal-500/15 text-teal-800',
  reviewed: 'bg-muted text-muted-foreground',
  applied: 'bg-emerald-500/15 text-emerald-800',
  skipped: 'bg-muted text-muted-foreground/60',
  unavailable: 'bg-muted text-muted-foreground/60',
}

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
      {JOB_STATUSES.map((s) => (
        <option key={s} value={s}>{capitalize(s)}</option>
      ))}
    </select>
  )
}
