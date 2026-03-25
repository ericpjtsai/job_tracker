import type { DataSource, DataSourceConfig, SourceHealth } from './types'

const sources: Map<string, DataSource> = new Map()

export function registerSource(source: DataSource): void {
  sources.set(source.id, source)
}

export function getSource(id: string): DataSource | undefined {
  return sources.get(id)
}

export function getAllSources(): DataSource[] {
  return Array.from(sources.values())
}

export interface SourceStatusPayload extends DataSourceConfig {
  health: SourceHealth
}

export function getSourcesStatus(): SourceStatusPayload[] {
  return getAllSources().map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    schedule: s.schedule,
    cost: s.cost,
    envVars: s.envVars,
    triggerPath: s.triggerPath,
    health: { ...s.health },
  }))
}
