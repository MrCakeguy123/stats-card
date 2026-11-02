import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Range, Stats, View } from '../types'
import {
  forRange,
  groupedCount,
  hourLabel,
  modelName,
  models,
  overview,
  shortCount,
} from './card'

const PANE = 'stats-card'
const COMMAND = 'stats-card'
const STORE_KEY = 'stats'
const SCAN_TIMEOUT_MS = 180_000
const REFRESH_MS = 5 * 60_000
const VIEWS: readonly { value: View; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'models', label: 'Models' },
]
const RANGES: readonly { value: Range; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '30d', label: '30d' },
  { value: '7d', label: '7d' },
]

const stats = atom({ plugin: 'stats-card', key: 'stats' } as const, null)
const view = atom({ plugin: 'stats-card', key: 'view' } as const, 'overview')
const range = atom({ plugin: 'stats-card', key: 'range' } as const, 'all')
const failure = atom({ plugin: 'stats-card', key: 'failure' } as const, null)

function isStats(value: unknown): value is Stats {
  const candidate = value as Partial<Stats> | null | undefined

  return typeof candidate?.today === 'string' && Array.isArray(candidate.days)
}

async function scan($: EngineInterface): Promise<void> {
  try {
    const script = `${$.plugin.root}/scan/scan.mjs`
    const ran = await $.process.run(['node', script], { timeoutMs: SCAN_TIMEOUT_MS })
    if (ran.exitCode !== 0) {
      throw new Error(ran.stderr.trim() || `the scan exited with ${ran.exitCode}`)
    }
    const scanned: unknown = JSON.parse(ran.stdout)
    if (!isStats(scanned)) throw new Error('the scan printed something unexpected')
    await update($, stats, () => scanned)
    await update($, failure, () => null)
    await $.store.set(STORE_KEY, scanned)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await update($, failure, () => reason)
  }
}

function openCard($: EngineInterface): Promise<unknown> {
  void $.clock.after(0, () => void scan($))

  return $.ui.open({ id: PANE, title: 'Stats' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the usage stats card',
    })
    const stored = await $.store.get(STORE_KEY)
    if (isStats(stored)) await update($, stats, () => stored)
    void $.clock.every(REFRESH_MS, async () => {
      const panes = await $.ui.panes()
      if (panes.some(pane => pane.id === PANE)) await scan($)
    })

    // The nearest a mod can get to the new-session screen, which draws before any
    // session exists: open as a new session starts, and once on the first load. A
    // desktop session has no surface yet here, so it is told by its entrypoint.
    const entrypoint = await $.env.get('CLAUDE_CODE_ENTRYPOINT')
    if (entrypoint === 'claude-desktop') {
      const messages = await $.session.messages()
      if (messages.length === 0 || !isStats(stored)) void openCard($)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await openCard($)

    return { text: 'Stats card opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [held, shownView, shownRange, failed] = await Promise.all([
      read($, stats),
      read($, view),
      read($, range),
      read($, failure),
    ])
    if (held === null) {
      return (
        <Text dimColor>
          {failed === null ? 'Counting your sessions…' : `Couldn’t load usage stats: ${failed}`}
        </Text>
      )
    }

    const buttons = (
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" gap="xs">
          {VIEWS.map(option => (
            <Button
              key={`view-${option.value}`}
              label={option.label}
              plain
              dimColor={option.value !== shownView}
              onPress={() => update($, view, () => option.value)}
            />
          ))}
        </Box>
        <Box flexDirection="row" gap="xs">
          {RANGES.map(option => (
            <Button
              key={`range-${option.value}`}
              label={option.label}
              plain
              dimColor={option.value !== shownRange}
              onPress={() => update($, range, () => option.value)}
            />
          ))}
        </Box>
      </Box>
    )

    if (e.surface === 'terminal') {
      const ranged = forRange(held, shownRange)
      const favorite = ranged.models[0]

      return (
        <Box flexDirection="column" gap={1}>
          {buttons}
          {shownView === 'overview' ? (
            <Text>
              {groupedCount(ranged.sessions)} sessions, {groupedCount(ranged.messages)} messages,{' '}
              {shortCount(ranged.tokens)} tokens, {groupedCount(ranged.activeDays)} active days
              {ranged.peakHour === null ? '' : `, peak hour ${hourLabel(ranged.peakHour)}`}
              {favorite ? `, favorite model ${modelName(favorite.model)}` : ''}
            </Text>
          ) : (
            <Box flexDirection="column">
              {ranged.models.map(model => (
                <Text key={model.model}>
                  {modelName(model.model)}: {shortCount(model.tokens)}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const drawing =
      shownView === 'overview' ? overview(held, shownRange) : models(held, shownRange)

    return (
      <Box flexDirection="column" gap="sm">
        {buttons}
        <Svg
          source={drawing.source}
          alt={drawing.alt}
          width={drawing.width}
          height={drawing.height}
          isInteractive
        />
      </Box>
    )
  })
}
