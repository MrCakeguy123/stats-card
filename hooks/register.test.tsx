import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Stats } from '../types'
import {
  bookLine,
  forRange,
  heatCells,
  hourLabel,
  modelName,
  models,
  overview,
  shortCount,
} from './card'

const STATS: Stats = {
  generatedAt: 1,
  today: '2026-11-01',
  days: [
    {
      date: '2026-10-01',
      messages: 100,
      sessions: 2,
      tools: 40,
      hours: { 15: 2 },
      longestMs: 1000,
      models: { 'claude-opus-4-8': [1, 2, 3, 4] },
    },
    {
      date: '2026-10-30',
      messages: 300,
      sessions: 1,
      tools: 90,
      hours: { 9: 1 },
      longestMs: 1000,
      models: { 'claude-opus-5-5': [100, 200, 300, 400], 'claude-opus-4-8': [1, 1, 1, 1] },
    },
  ],
  earlierModels: { 'claude-sonnet-4-5-20250929': [5, 5, 5, 5] },
  earlierHours: { 20: 7 },
  earlierLongestMs: 0,
}

const SCANNED = {
  exitCode: 0,
  stdout: JSON.stringify(STATS),
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
}

const PANE = {
  plugin: 'stats-card',
  component: 'Pane',
  requestId: 'stats-card',
  props: {
    title: 'Stats',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('numbers read as they did on the old card', () => {
  expect(shortCount(1_998_208_000)).toBe('2B')
  expect(shortCount(11_675_579_638)).toBe('11.7B')
  expect(shortCount(1_500_000)).toBe('1.5M')
  expect(shortCount(812)).toBe('812')
  expect(hourLabel(15)).toBe('3 PM')
  expect(hourLabel(0)).toBe('12 AM')
  expect(hourLabel(12)).toBe('12 PM')
})

test('model ids read as names', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5')).toBe('Fable 5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelName('something-else')).toBe('something-else')
})

test('the book line matches the screenshot', () => {
  const lines = Array.from({ length: 200 }, (_, seed) => bookLine(1_998_300_000, `${seed}`))

  expect(lines).toContain('You’ve used ~7456× more tokens than Moby-Dick.')
  expect(bookLine(100, 'any')).toBeNull()
})

test('a range counts its own days, and only All counts the old cache', () => {
  const all = forRange(STATS, 'all')
  const month = forRange(STATS, '30d')
  const week = forRange(STATS, '7d')

  expect(all.sessions).toBe(3)
  expect(all.messages).toBe(400)
  expect(all.tokens).toBe(10 + 1000 + 4 + 20)
  expect(all.activeDays).toBe(2)
  expect(all.peakHour).toBe(20)
  expect(all.models.map(model => model.model)).toEqual([
    'claude-opus-5-5',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-8',
  ])
  expect(month.messages).toBe(300)
  expect(month.peakHour).toBe(9)
  expect(week.tokens).toBe(1004)
})

test('a tied peak hour is the earlier one', () => {
  const tied: Stats = {
    ...STATS,
    earlierHours: {},
    days: [{ ...STATS.days[0]!, hours: { 22: 3, 7: 3 } }],
  }

  expect(forRange(tied, 'all').peakHour).toBe(7)
})

test('the grid is 26 weeks ending today, however old the data is', () => {
  const cells = heatCells(STATS)
  const last = cells.at(-1)!

  expect(last.date).toBe('2026-11-01')
  expect(last.week).toBe(25)
  expect(last.weekday).toBe(0)
  expect(cells[0]!.weekday).toBe(0)
  expect(cells.find(cell => cell.date === '2026-10-30')?.shade).toBe(4)
  expect(cells.find(cell => cell.date === '2026-10-29')?.shade).toBe(0)

  const older = { ...STATS, days: [{ ...STATS.days[0]!, date: '2026-01-07' }, ...STATS.days] }

  expect(heatCells(older).length).toBe(cells.length)
  expect(forRange(older, 'all').messages).toBe(500)
})

test('both drawings fit what an Svg may hold', () => {
  const old = { ...STATS, days: [{ ...STATS.days[0]!, date: '2026-01-07' }, ...STATS.days] }

  expect(overview(old, 'all').source.length).toBeLessThan(131_072)
  expect(models(old, 'all').source.length).toBeLessThan(131_072)
  expect(overview(STATS, 'all').alt).toContain('Favorite model: Opus 5.5')
  expect(models({ ...STATS, days: [] }, '7d').alt).toBe('No model usage in this range.')
})

function desktopSession(on: On, messages: readonly unknown[], entrypoint = 'claude-desktop') {
  const opened = { count: 0 }
  mock.env(on, { CLAUDE_CODE_ENTRYPOINT: entrypoint })
  on('command.register', () => ({ value: { command: 'stats-card' } }))
  on('session.messages', () => ({ value: messages as SessionMessage[] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => {
    opened.count += 1

    return { value: { isPlaced: true } }
  })

  return opened
}

test('a new desktop session opens the card, with no surface attached yet', async ($, on) => {
  mock.store(on, { stats: STATS })
  const clock = mock.clock(on)
  const opened = desktopSession(on, [])
  on('process.run', () => ({ value: SCANNED }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await clock.settle()

  expect(opened.count).toBe(1)
})

test('a resumed session stays closed', async ($, on) => {
  const row = { role: 'user', text: 'hi', toolUses: [] }
  mock.store(on, { stats: STATS })
  const clock = mock.clock(on)
  const opened = desktopSession(on, [row])
  on('process.run', () => ({ value: SCANNED }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await clock.settle()

  expect(opened.count).toBe(0)
})

test('the first load opens the card in a running session', async ($, on) => {
  const row = { role: 'user', text: 'hi', toolUses: [] }
  mock.store(on)
  const clock = mock.clock(on)
  const opened = desktopSession(on, [row])
  on('process.run', () => ({ value: SCANNED }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await clock.settle()

  expect(opened.count).toBe(1)
})

test('a terminal session waits for the command', async ($, on) => {
  mock.store(on, { stats: STATS })
  const clock = mock.clock(on)
  const opened = desktopSession(on, [], 'cli')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(opened.count).toBe(0)
})

for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
  test(`the buttons change the card on ${surface}`, async ($, on) => {
    mock.store(on, { stats: STATS })
    mock.clock(on)
    desktopSession(on, [])
    on('process.run', () => ({ value: SCANNED }))

    await $.session.start({ cwd: '/', surface: null, isInteractive: false })
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Messages: 400')
    await ui.press({ key: 'range-7d' })
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Messages: 300')
    await ui.press({ key: 'view-models' })
    expect((await ui.find({ type: 'Svg' }))?.props.alt).toContain('Opus 5.5')
    await ui.unmount()
  })
}

test('the terminal gets the same numbers as text', async ($, on) => {
  mock.store(on, { stats: STATS })
  mock.clock(on)
  mock.env(on, { CLAUDE_CODE_ENTRYPOINT: 'cli' })
  on('command.register', () => ({ value: { command: 'stats-card' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /400 messages/ }))?.text).toContain('peak hour 8 PM')
  await ui.unmount()
})

test('a scan that fails says why', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  desktopSession(on, [])
  on('process.run', () => ({
    value: { ...SCANNED, exitCode: 1, stdout: '', stderr: 'node was not found' },
  }))

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toContain('node was not found')
  await ui.unmount()
})
