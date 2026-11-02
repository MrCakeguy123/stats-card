import type { Range, Stats, Usage } from '../types'

// Sizes are the old card's, read off a screenshot of it. Everything is drawn from
// currentColor, which the desktop stamps on the svg as its own text color: the old
// tiles were 10% of the text color over the card, so this holds in light and dark.
const WIDTH = 416
const GAP = 4
const TILE_HEIGHT = 40
const HEAT_HEIGHT = 112
const LINE_HEIGHT = 18
const WEEKS = 26
const DAY_MS = 86_400_000
const MUTED = 'fill="currentColor" fill-opacity=".56"'
const TILE = 'fill="currentColor" fill-opacity=".1"'
const HEAT_COLORS = ['#85adea', '#6394e3', '#417cde', '#2366cf']
const MODEL_ROWS = 6
const CHART_HEIGHT = 96

const BOOKS: readonly { name: string; tokens: number }[] = [
  { name: 'The Little Prince', tokens: 22e3 },
  { name: 'The Old Man and the Sea', tokens: 35e3 },
  { name: 'A Christmas Carol', tokens: 37e3 },
  { name: 'Animal Farm', tokens: 39e3 },
  { name: 'Fahrenheit 451', tokens: 60e3 },
  { name: 'The Great Gatsby', tokens: 62e3 },
  { name: 'Slaughterhouse-Five', tokens: 64e3 },
  { name: 'Brave New World', tokens: 83e3 },
  { name: 'The Catcher in the Rye', tokens: 95e3 },
  { name: 'Harry Potter and the Philosopher’s Stone', tokens: 103e3 },
  { name: 'The Hobbit', tokens: 123e3 },
  { name: '1984', tokens: 123e3 },
  { name: 'To Kill a Mockingbird', tokens: 130e3 },
  { name: 'Pride and Prejudice', tokens: 156e3 },
  { name: 'Dune', tokens: 244e3 },
  { name: 'Moby-Dick', tokens: 268e3 },
  { name: 'Crime and Punishment', tokens: 274e3 },
  { name: 'A Game of Thrones', tokens: 381e3 },
  { name: 'Anna Karenina', tokens: 468e3 },
  { name: 'Don Quixote', tokens: 520e3 },
  { name: 'The Lord of the Rings', tokens: 576e3 },
  { name: 'The Count of Monte Cristo', tokens: 603e3 },
  { name: 'Les Misérables', tokens: 689e3 },
  { name: 'War and Peace', tokens: 730e3 },
]

export type ModelTotal = { model: string; tokens: number; usage: Usage }

export type Ranged = {
  sessions: number
  messages: number
  tokens: number
  activeDays: number
  peakHour: number | null
  models: readonly ModelTotal[]
  chart: readonly { date: string; models: Record<string, number> }[]
}

export type Drawing = { source: string; alt: string; width: number; height: number }

function dayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number)

  return Math.floor(Date.UTC(year!, month! - 1, day!) / DAY_MS)
}

function dayKey(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10)
}

function sum(usage: Usage): number {
  return usage[0] + usage[1] + usage[2] + usage[3]
}

function addUsage(totals: Map<string, Usage>, model: string, usage: Usage): void {
  const had = totals.get(model) ?? [0, 0, 0, 0]
  totals.set(model, [
    had[0] + usage[0],
    had[1] + usage[1],
    had[2] + usage[2],
    had[3] + usage[3],
  ])
}

function peakOf(hours: Map<number, number>): number | null {
  let peak: number | null = null
  let most = 0
  for (const [hour, count] of [...hours].sort((a, b) => a[0] - b[0])) {
    if (count > most) {
      most = count
      peak = hour
    }
  }

  return peak
}

export function forRange(stats: Stats, range: Range): Ranged {
  const span = range === 'all' ? null : range === '30d' ? 30 : 7
  const from = span === null ? null : dayKey(dayIndex(stats.today) - (span - 1))
  const days = stats.days.filter(day => from === null || day.date >= from)
  const usage = new Map<string, Usage>()
  const hours = new Map<number, number>()
  const addHours = (counts: Record<string, number>) => {
    for (const [hour, count] of Object.entries(counts)) {
      hours.set(Number(hour), (hours.get(Number(hour)) ?? 0) + count)
    }
  }

  for (const day of days) {
    addHours(day.hours)
    for (const [model, counted] of Object.entries(day.models)) {
      addUsage(usage, model, counted)
    }
  }
  if (span === null) {
    addHours(stats.earlierHours)
    for (const [model, counted] of Object.entries(stats.earlierModels)) {
      addUsage(usage, model, counted)
    }
  }

  const models = [...usage]
    .map(([model, counted]) => ({ model, tokens: sum(counted), usage: counted }))
    .filter(model => model.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)

  return {
    sessions: days.reduce((total, day) => total + day.sessions, 0),
    messages: days.reduce((total, day) => total + day.messages, 0),
    tokens: models.reduce((total, model) => total + model.tokens, 0),
    activeDays: days.filter(day => day.messages > 0).length,
    peakHour: peakOf(hours),
    models,
    chart: days
      .filter(day => Object.keys(day.models).length > 0)
      .map(day => ({
        date: day.date,
        models: Object.fromEntries(
          Object.entries(day.models).map(([model, counted]) => [model, sum(counted)]),
        ),
      })),
  }
}

export function shortCount(count: number): string {
  const units = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const
  for (const [size, unit] of units) {
    if (count >= size) {
      return `${(count / size).toFixed(1).replace(/\.0$/, '')}${unit}`
    }
  }

  return String(count)
}

export function groupedCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ',')
}

export function hourLabel(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`
}

export function modelName(model: string): string {
  const current = /^claude-([a-z]+)-(\d+(?:-\d{1,2})?)(?:-\d{8})?$/.exec(model)
  const older = /^claude-(\d+(?:-\d{1,2})?)-([a-z]+)(?:-\d{8})?$/.exec(model)
  const family = current?.[1] ?? older?.[2]
  const version = current?.[2] ?? older?.[1]
  if (family === undefined || version === undefined) return model

  return `${family[0]!.toUpperCase()}${family.slice(1)} ${version.replace('-', '.')}`
}

function shortDate(date: string): string {
  const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')

  return `${months[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}`
}

function escapeXml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function svg(height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
    `viewBox="0 0 ${WIDTH} ${height}">${body}</svg>`
  )
}

function tile(x: number, y: number, width: number, label: string, value: string): string {
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${TILE_HEIGHT}" rx="5" ${TILE}/>` +
    `<text x="${x + 8}" y="${y + 15}" font-size="11.5" ${MUTED}>${escapeXml(label)}</text>` +
    `<text x="${x + 8}" y="${y + 32}" font-size="13" font-weight="600" fill="currentColor">` +
    `${escapeXml(value)}</text>`
  )
}

// Weeks run Sunday to Saturday, the last column is this week, and the shades are the
// quartiles of the days that had any messages. Days older than the grid still count
// in the tiles.
export function heatCells(stats: Stats) {
  const counts = new Map(stats.days.map(day => [day.date, day.messages]))
  const active = stats.days
    .map(day => day.messages)
    .filter(count => count > 0)
    .sort((a, b) => a - b)
  const quartile = (share: number) => active[Math.floor(active.length * share)]!
  const shade = (count: number) => {
    if (count === 0) return 0
    if (count >= quartile(0.75)) return 4
    if (count >= quartile(0.5)) return 3

    return count >= quartile(0.25) ? 2 : 1
  }
  const today = dayIndex(stats.today)
  const saturday = today + (6 - ((today + 4) % 7))
  const first = saturday - WEEKS * 7 + 1
  const cells: { week: number; weekday: number; date: string; count: number; shade: number }[] = []
  for (let index = first; index <= today; index++) {
    const date = dayKey(index)
    const count = counts.get(date) ?? 0
    const offset = index - first
    cells.push({
      week: Math.floor(offset / 7),
      weekday: offset % 7,
      date,
      count,
      shade: shade(count),
    })
  }

  return cells
}

function heatmap(stats: Stats, top: number): string {
  const pitch = WIDTH / WEEKS
  const size = (pitch * 0.84).toFixed(2)

  return heatCells(stats)
    .map(cell => {
      const x = (cell.week * pitch).toFixed(2)
      const y = (top + cell.weekday * pitch).toFixed(2)
      const paint =
        cell.shade === 0 ? TILE : `fill="${HEAT_COLORS[cell.shade - 1]}"`
      const tip = `${shortDate(cell.date)} — ${groupedCount(cell.count)}`

      return (
        `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2.5" ${paint}>` +
        `<title>${tip}</title></rect>`
      )
    })
    .join('')
}

export function bookLine(tokens: number, seed: string): string | null {
  const reached = BOOKS.filter(book => tokens >= book.tokens)
  if (reached.length === 0) return null
  let hash = 0
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) % 1_000_003
  }
  const book = reached[hash % reached.length]!

  return `You’ve used ~${Math.floor(tokens / book.tokens)}× more tokens than ${book.name}.`
}

export function overview(stats: Stats, range: Range): Drawing {
  const ranged = forRange(stats, range)
  const favorite = ranged.models[0]
  const peak = ranged.peakHour === null ? '—' : hourLabel(ranged.peakHour)
  const tileWidth = (WIDTH - 2 * GAP) / 3
  const rows: readonly (readonly [string, string])[] = [
    ['Sessions', groupedCount(ranged.sessions)],
    ['Messages', groupedCount(ranged.messages)],
    ['Total tokens', shortCount(ranged.tokens)],
    ['Active days', groupedCount(ranged.activeDays)],
    ['Peak hour', peak],
    ['Favorite model', favorite ? modelName(favorite.model) : '—'],
  ]
  const tiles = rows
    .map(([label, value], index) =>
      tile(
        (index % 3) * (tileWidth + GAP),
        Math.floor(index / 3) * (TILE_HEIGHT + GAP),
        tileWidth,
        label,
        value,
      ),
    )
    .join('')
  const heatTop = 2 * TILE_HEIGHT + GAP + 8
  const line = bookLine(ranged.tokens, `${stats.today}${range}`)
  const lineTop = heatTop + HEAT_HEIGHT + 4
  const height = lineTop + LINE_HEIGHT
  const footer =
    line === null
      ? ''
      : `<text x="0" y="${lineTop + 13}" font-size="12" ${MUTED}>${escapeXml(line)}</text>`
  const alt =
    `${rows.map(([label, value]) => `${label}: ${value}`).join(', ')}.` +
    (line === null ? '' : ` ${line}`)

  return {
    source: svg(height, tiles + heatmap(stats, heatTop) + footer),
    alt,
    width: WIDTH,
    height,
  }
}

function modelColor(index: number): string {
  return `hsl(217 70% ${Math.min(88, 58 + index * 7)}%)`
}

function modelRow(model: ModelTotal, index: number, total: number, top: number): string {
  const share = total > 0 ? model.tokens / total : 0
  const [input, output, cacheRead, cacheWrite] = model.usage
  const split =
    `${shortCount(input)} in · ${shortCount(output)} out · ` +
    `${shortCount(cacheRead)} cache read · ${shortCount(cacheWrite)} cache write`

  return (
    `<rect x="0" y="${top + 3}" width="8" height="8" rx="2" fill="${modelColor(index)}"/>` +
    `<text x="14" y="${top + 11}" font-size="12.5" fill="currentColor">` +
    `${escapeXml(modelName(model.model))}</text>` +
    `<text x="${WIDTH}" y="${top + 11}" font-size="12" text-anchor="end" ${MUTED}>` +
    `${shortCount(model.tokens)} tokens · ${(share * 100).toFixed(1)}%</text>` +
    `<rect x="0" y="${top + 16}" width="${WIDTH}" height="4" rx="2" ${TILE}/>` +
    `<rect x="0" y="${top + 16}" width="${(WIDTH * share).toFixed(1)}" height="4" rx="2" ` +
    `fill="${modelColor(index)}"/>` +
    `<text x="0" y="${top + 33}" font-size="11" ${MUTED}>${escapeXml(split)}</text>`
  )
}

function tokenChart(ranged: Ranged, shown: readonly ModelTotal[], top: number): string {
  const days = ranged.chart
  if (days.length === 0) return ''
  const heights = days.map(day => Object.values(day.models).reduce((a, b) => a + b, 0))
  const tallest = Math.max(...heights, 1)
  const pitch = WIDTH / Math.max(days.length, 1)
  const barWidth = Math.max(1, Math.min(pitch * 0.72, 18))
  const bars = days
    .map((day, dayNumber) => {
      let stacked = 0
      const tip = shown
        .filter(model => (day.models[model.model] ?? 0) > 0)
        .map(model => `${modelName(model.model)}: ${shortCount(day.models[model.model]!)}`)
        .join(', ')

      return shown
        .map((model, index) => {
          const tokens = day.models[model.model] ?? 0
          if (tokens === 0) return ''
          const height = (tokens / tallest) * CHART_HEIGHT
          stacked += height
          const x = dayNumber * pitch + (pitch - barWidth) / 2

          return (
            `<rect x="${x.toFixed(2)}" y="${(top + CHART_HEIGHT - stacked).toFixed(2)}" ` +
            `width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}" ` +
            `fill="${modelColor(index)}"><title>${escapeXml(
              `${shortDate(day.date)} — ${tip}`,
            )}</title></rect>`
          )
        })
        .join('')
    })
    .join('')
  const first = days[0]!.date
  const last = days.at(-1)!.date
  const axisTop = top + CHART_HEIGHT + 13

  return (
    bars +
    `<text x="0" y="${axisTop}" font-size="11" ${MUTED}>${shortDate(first)}</text>` +
    `<text x="${WIDTH}" y="${axisTop}" font-size="11" text-anchor="end" ${MUTED}>` +
    `${shortDate(last)}</text>`
  )
}

export function models(stats: Stats, range: Range): Drawing {
  const ranged = forRange(stats, range)
  const shown = ranged.models.slice(0, MODEL_ROWS)
  const rowHeight = 42
  const hidden = ranged.models.length - shown.length
  const rows = shown
    .map((model, index) => modelRow(model, index, ranged.tokens, index * rowHeight))
    .join('')
  const listHeight = Math.max(shown.length, 1) * rowHeight
  const empty =
    shown.length === 0
      ? `<text x="0" y="14" font-size="12" ${MUTED}>No model usage in this range</text>`
      : ''
  const more =
    hidden > 0
      ? `<text x="0" y="${listHeight + 8}" font-size="11" ${MUTED}>and ${hidden} more</text>`
      : ''
  const chartLabelTop = listHeight + (hidden > 0 ? 28 : 12)
  const chartTop = chartLabelTop + 10
  const hasChart = ranged.chart.length > 0
  const chart = hasChart
    ? `<text x="0" y="${chartLabelTop + 2}" font-size="12.5" fill="currentColor">` +
      `Tokens per day</text>${tokenChart(ranged, shown, chartTop)}`
    : ''
  const height = hasChart ? chartTop + CHART_HEIGHT + 18 : chartLabelTop
  const alt =
    shown.length === 0
      ? 'No model usage in this range.'
      : shown
          .map(
            model =>
              `${modelName(model.model)}: ${shortCount(model.tokens)} tokens, ` +
              `${((model.tokens / ranged.tokens) * 100).toFixed(1)}%`,
          )
          .join('; ')

  return { source: svg(height, rows + empty + more + chart), alt, width: WIDTH, height }
}
