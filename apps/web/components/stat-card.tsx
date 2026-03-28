'use client'

import { motion } from 'framer-motion'

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 }

export function StatCard({ label, value, active, change, changeColor, onClick }: {
  label: string; value: number; active: boolean; change?: string; changeColor?: string; onClick: () => void
}) {
  return (
    <motion.div
      onClick={onClick}
      animate={{ scale: active ? 1.02 : 1 }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={`bg-card rounded-lg px-6 py-5 border cursor-pointer transition-colors ${
        active ? 'border-[1.5px] border-primary' : 'hover:shadow-sm'
      }`}
    >
      <div className="space-y-1">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-semibold font-mono tabular-nums ${active ? 'text-primary' : 'text-foreground'}`}>
            {value.toLocaleString()}
          </span>
          {change && (
            <span className={`text-xs font-medium tabular-nums ${changeColor ?? 'text-green-600'}`}>{change}</span>
          )}
        </div>
      </div>
    </motion.div>
  )
}
