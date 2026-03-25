export type SourceType = 'stream' | 'poll'
export type SourceStatus = 'connected' | 'healthy' | 'polling' | 'error' | 'disabled' | 'idle'

export interface SourceHealth {
  status: SourceStatus
  lastPollAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  jobsFound: number
  consecutiveFailures: number
}

export interface DataSourceConfig {
  id: string
  name: string
  type: SourceType
  schedule: string
  cost: string | null
  envVars: string[]
  triggerPath: string | null
}

export interface DataSource extends DataSourceConfig {
  health: SourceHealth
  poll: () => Promise<void>
  stop?: () => void
}

export function createHealth(): SourceHealth {
  return {
    status: 'idle',
    lastPollAt: null,
    lastErrorAt: null,
    lastError: null,
    jobsFound: 0,
    consecutiveFailures: 0,
  }
}

/** Wraps a poll function with health tracking */
export function withHealthTracking(
  health: SourceHealth,
  fn: () => Promise<number | void>,
): () => Promise<void> {
  return async () => {
    health.status = 'polling'
    try {
      const result = await fn()
      health.lastPollAt = Date.now()
      health.status = 'healthy'
      health.consecutiveFailures = 0
      health.lastError = null
      if (typeof result === 'number') health.jobsFound = result
    } catch (err) {
      health.status = 'error'
      health.lastErrorAt = Date.now()
      health.lastError = err instanceof Error ? err.message : String(err)
      health.consecutiveFailures++
      throw err
    }
  }
}
