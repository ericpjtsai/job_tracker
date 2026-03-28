'use client'

import { InfoTooltip } from '@/components/info-tooltip'

export function SortHeader({ label, order, onSort, tooltip }: { label: string; order: 'asc' | 'desc' | null; onSort: () => void; tooltip?: string }) {
  return (
    <span onClick={onSort} className="cursor-pointer select-none whitespace-nowrap hover:text-foreground inline-flex items-center gap-0.5">
      {label}
      {tooltip && <InfoTooltip text={tooltip} />}
      <span className={order ? 'text-foreground' : 'text-muted-foreground/30'}>
        {order === 'desc' ? ' ↓' : order === 'asc' ? ' ↑' : ' ↕'}
      </span>
    </span>
  )
}
