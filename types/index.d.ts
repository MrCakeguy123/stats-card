/** Input, output, cache read and cache write tokens, in that order. */
export type Usage = readonly [number, number, number, number]

export type Day = {
  date: string
  messages: number
  sessions: number
  tools: number
  /** Sessions started in each hour of the day, by hour. */
  hours: Record<string, number>
  longestMs: number
  models: Record<string, Usage>
}

/** What scan/scan.mjs prints. */
export type Stats = {
  generatedAt: number
  today: string
  days: readonly Day[]
  /** From stats-cache.json: older than any transcript, so only "All" counts them. */
  earlierModels: Record<string, Usage>
  earlierHours: Record<string, number>
  earlierLongestMs: number
}

export type View = 'overview' | 'models'
export type Range = 'all' | '30d' | '7d'

declare module 'claude-code' {
  interface PluginState {
    'stats-card': {
      stats: Stats | null
      view: View
      range: Range
      failure: string | null
    }
  }
}
