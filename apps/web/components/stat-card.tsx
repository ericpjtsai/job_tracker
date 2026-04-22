'use client'

export function StatCard({ label, value, active, change, changeColor, onClick, locked }: {
  label: string; value: number; active: boolean; change?: string; changeColor?: string; onClick: () => void; locked?: boolean
}) {
  return (
    <div
      onClick={locked ? undefined : onClick}
      className={`bg-card rounded-lg px-6 py-5 border shadow-stripe-sm transition-all ${
        locked ? 'cursor-not-allowed' : 'cursor-pointer hover:shadow-stripe'
      } ${active ? 'border-[1.5px] border-primary' : ''}`}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          {locked && (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Locked in demo"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-light tabular-nums tracking-tight ${active ? 'text-primary' : 'text-foreground'}`}>
            {value.toLocaleString()}
          </span>
          {change && (
            <span className={`text-xs font-normal tabular-nums ${changeColor ?? 'text-emerald-700'}`}>{change}</span>
          )}
        </div>
      </div>
    </div>
  )
}
