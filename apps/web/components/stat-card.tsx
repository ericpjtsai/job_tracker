'use client'

export function StatCard({ label, value, active, change, changeColor, onClick }: {
  label: string; value: number; active: boolean; change?: string; changeColor?: string; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card rounded-lg px-6 py-5 border cursor-pointer shadow-stripe-sm hover:shadow-stripe transition-all ${
        active ? 'border-[1.5px] border-primary' : ''
      }`}
    >
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">{label}</div>
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
