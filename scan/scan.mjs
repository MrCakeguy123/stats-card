// Reads every Claude Code transcript and prints, as JSON, the day-by-day usage
// the card draws. It counts the way the desktop app's own /stats does: a message
// is a user or assistant row of the main conversation, a session is a transcript
// with at least one, and subagents add tokens and tool calls but neither of those.
//
// The hooks module cannot do this itself: $.fs.read stops at 4 MiB and the largest
// transcripts run to hundreds of MB. Files that have not changed since the last run
// are taken from a cache, so only the first run reads everything.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CACHE_VERSION = 1
const CHUNK = 1 << 22
const SYNTHETIC_MODEL = '<synthetic>'

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const projectsDir = path.join(configDir, 'projects')
const cachePath = path.join(configDir, 'cache', 'stats-card.json')

function localDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function agentFiles(dir) {
  return listDir(dir)
    .filter(e => e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl'))
    .map(e => path.join(dir, e.name))
}

// A project holds <session>.jsonl, with subagents at <session>/subagents/agent-*.jsonl
// and subagents/workflows/<run>/agent-*.jsonl.
function transcriptFiles() {
  const files = []
  for (const project of listDir(projectsDir)) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(projectsDir, project.name)
    for (const entry of listDir(projectDir)) {
      const full = path.join(projectDir, entry.name)
      if (entry.isFile()) {
        if (entry.name.endsWith('.jsonl') && !entry.name.includes('.superseded-')) {
          files.push({ file: full, isSubagent: false })
        }
        continue
      }
      if (!entry.isDirectory()) continue
      const subagents = path.join(full, 'subagents')
      for (const file of agentFiles(subagents)) files.push({ file, isSubagent: true })
      const workflows = path.join(subagents, 'workflows')
      for (const run of listDir(workflows)) {
        if (!run.isDirectory()) continue
        for (const file of agentFiles(path.join(workflows, run.name))) {
          files.push({ file, isSubagent: true })
        }
      }
    }
  }

  return files
}

function eachLine(file, onLine) {
  const fd = fs.openSync(file, 'r')
  let buffer = Buffer.alloc(CHUNK)
  let held = 0
  try {
    for (;;) {
      if (held === buffer.length) {
        const bigger = Buffer.alloc(buffer.length * 2)
        buffer.copy(bigger, 0, 0, held)
        buffer = bigger
      }
      const read = fs.readSync(fd, buffer, held, buffer.length - held, null)
      if (read === 0) break
      const end = held + read
      let start = 0
      for (;;) {
        const newline = buffer.indexOf(10, start)
        if (newline < 0 || newline >= end) break
        if (newline > start) onLine(buffer.toString('utf8', start, newline))
        start = newline + 1
      }
      buffer.copy(buffer, 0, start, end)
      held = end - start
    }
    if (held > 0) onLine(buffer.toString('utf8', 0, held))
  } finally {
    fs.closeSync(fd)
  }
}

// A response is written as one row per content block, each repeating the usage, and
// the usage can grow between rows, so only what a row adds to its message counts.
function addUsage(totals, seen, id, usage) {
  const now = [
    usage.input_tokens ?? 0,
    usage.output_tokens ?? 0,
    usage.cache_read_input_tokens ?? 0,
    usage.cache_creation_input_tokens ?? 0,
  ]
  let before
  if (id !== undefined) {
    before = seen.get(id)
    if (before === undefined) {
      before = [0, 0, 0, 0]
      seen.set(id, before)
    }
  }
  now.forEach((value, i) => {
    const added = value - (before?.[i] ?? 0)
    if (added > 0) {
      totals[i] += added
      if (before) before[i] = value
    }
  })
}

function summarize(file, isSubagent) {
  const days = {}
  const seen = new Map()
  let first = null
  let last = null

  eachLine(file, line => {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      return
    }
    if (row === null || typeof row !== 'object') return
    if (row.type !== 'user' && row.type !== 'assistant') return
    if ((!isSubagent && row.isSidechain) || !row.timestamp) return
    const date = new Date(row.timestamp)
    if (Number.isNaN(date.getTime())) return

    first ??= row.timestamp
    last = row.timestamp
    const key = localDate(date)
    const day = (days[key] ??= { messages: 0, tools: 0, models: {} })
    day.messages++
    if (row.type !== 'assistant') return

    const content = row.message?.content
    if (Array.isArray(content)) {
      for (const block of content) if (block?.type === 'tool_use') day.tools++
    }
    const usage = row.message?.usage
    const model = row.message?.model ?? 'unknown'
    if (!usage || model === SYNTHETIC_MODEL) return
    day.models[model] ??= [0, 0, 0, 0]
    addUsage(day.models[model], seen, row.message?.id || row.uuid, usage)
  })

  return { first, last, days }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function loadCache() {
  const cache = readJson(cachePath)

  return cache?.version === CACHE_VERSION ? cache.files : {}
}

function saveCache(files) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    const temporary = `${cachePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ version: CACHE_VERSION, files }))
    fs.renameSync(temporary, cachePath)
  } catch {
    // The cache only saves time: without it the next run reads everything again.
  }
}

function scanAll() {
  const cached = loadCache()
  const next = {}
  const summaries = []
  let reread = 0

  for (const { file, isSubagent } of transcriptFiles()) {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      continue
    }
    let entry = cached[file]
    if (entry === undefined || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
      try {
        entry = { size: stat.size, mtimeMs: stat.mtimeMs, ...summarize(file, isSubagent) }
        reread++
      } catch {
        continue
      }
    }
    next[file] = entry
    summaries.push({ ...entry, isSubagent })
  }
  if (reread > 0) saveCache(next)

  return { summaries, reread }
}

function aggregate(summaries) {
  const byDate = new Map()
  const dayOf = date => {
    let day = byDate.get(date)
    if (day === undefined) {
      day = { date, messages: 0, sessions: 0, tools: 0, hours: {}, longestMs: 0, models: {} }
      byDate.set(date, day)
    }

    return day
  }

  for (const summary of summaries) {
    if (summary.first === null) continue
    if (!summary.isSubagent) {
      const started = new Date(summary.first)
      const day = dayOf(localDate(started))
      const hour = started.getHours()
      day.sessions++
      day.hours[hour] = (day.hours[hour] ?? 0) + 1
      const lasted = new Date(summary.last).getTime() - started.getTime()
      day.longestMs = Math.max(day.longestMs, lasted)
    }
    for (const [date, counted] of Object.entries(summary.days)) {
      const day = dayOf(date)
      if (!summary.isSubagent) day.messages += counted.messages
      day.tools += counted.tools
      for (const [model, usage] of Object.entries(counted.models)) {
        day.models[model] ??= [0, 0, 0, 0]
        usage.forEach((value, i) => {
          day.models[model][i] += value
        })
      }
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// stats-cache.json is what the CLI's /stats saved. Its days from before the oldest
// transcript still left on disk are the only record of them. It holds no tokens per
// day that can be compared, so its model totals are carried beside the days and only
// the all-time view adds them.
function earlierHistory(days) {
  const cache = readJson(path.join(configDir, 'stats-cache.json'))
  const oldest = days[0]?.date
  if (!cache || !Array.isArray(cache.dailyActivity) || oldest === undefined) return null
  const older = cache.dailyActivity.filter(day => day.date < oldest)
  if (older.length === 0) return null
  const models = {}
  if (cache.lastComputedDate < oldest) {
    for (const [model, usage] of Object.entries(cache.modelUsage ?? {})) {
      models[model] = [
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        usage.cacheReadInputTokens ?? 0,
        usage.cacheCreationInputTokens ?? 0,
      ]
    }
  }

  return {
    days: older.map(day => ({
      date: day.date,
      messages: day.messageCount ?? 0,
      sessions: day.sessionCount ?? 0,
      tools: day.toolCallCount ?? 0,
      hours: {},
      longestMs: 0,
      models: {},
    })),
    models,
    hours: cache.hourCounts ?? {},
    longestMs: cache.longestSession?.duration ?? 0,
  }
}

const startedAt = Date.now()
const { summaries, reread } = scanAll()
const days = aggregate(summaries)
const earlier = earlierHistory(days)

process.stdout.write(
  JSON.stringify({
    generatedAt: Date.now(),
    today: localDate(new Date()),
    days: earlier ? [...earlier.days, ...days] : days,
    earlierModels: earlier?.models ?? {},
    earlierHours: earlier?.hours ?? {},
    earlierLongestMs: earlier?.longestMs ?? 0,
    scan: { files: summaries.length, reread, ms: Date.now() - startedAt },
  }),
)
