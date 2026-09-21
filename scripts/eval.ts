/**
 * Regression set. Run it after every edit to the persona card or few-shot
 * examples, and diff against the previous run.
 *
 *   npm run eval                       run all fixtures, save to evals/<ts>.json
 *   npm run eval -- --against <file>    also print a diff against an old run
 *
 * Why this has to exist before you write any feature code: prompt tuning is
 * a two-steps-forward-one-step-back process. You add a line to make it less
 * agreeable, and it starts needling you on the days you're not okay. Without
 * a regression set you won't catch that — you'll find out the day it hurts.
 *
 * This script never touches the database. All it needs is ANTHROPIC_API_KEY.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { generateText, type ModelMessage } from 'ai'
import { PERSONA_CARD } from '../lib/persona/card'
import { EXAMPLES, renderExamples } from '../lib/persona/examples'
import { nightInstruction } from '../lib/persona/rules'
import { checkOutput, splitMessages, stripBanned } from '../lib/agent/guard'
import { MODELS, MODEL_NAMES } from '../lib/agent/router'

try {
  process.loadEnvFile('.env')
} catch {
  // CI passes env vars directly.
}

type Fixture = {
  id: string
  note: string
  user: string
  /**
   * Prior turns, for fixtures that only make sense in context (e.g. "she
   * deflected once already, NOW name it"). Without this the model cannot
   * know it is round two, and the fixture measures nothing.
   */
  history?: { role: 'user' | 'assistant'; content: string }[]
  state?: {
    hour?: number
    mood?: string
    lateNightsThisWeek?: number
    hasEarlyCommitmentTomorrow?: boolean
  }
}

type Row = {
  id: string
  note: string
  user: string
  out: string[]
  hits: string[]
  /** First-pass text, when the guard forced a regeneration. */
  raw?: string
}

/** Synthesise the dynamic half of the prompt without hitting the DB. */
function fakeState(f: Fixture) {
  const hour = f.state?.hour ?? 15
  const hh = String(hour).padStart(2, '0')
  const ni = nightInstruction({
    hour,
    lateNightsThisWeek: f.state?.lateNightsThisWeek ?? 1,
    hasEarlyCommitmentTomorrow: f.state?.hasEarlyCommitmentTomorrow ?? false,
  })
  const lines = [
    `当前时间：2026-09-20 周六 ${hh}:30`,
    `今天日程：（日历还没接，暂无）`,
    `距上次对话：5 分钟`,
    `最近几轮她的状态：${f.state?.mood ?? '正常'}`,
    `聊过但没聊完的：（记忆层还没做，暂无）`,
  ]
  if (ni) lines.push('', '【此刻额外适用的规则】', ni)
  return lines.join('\n')
}

async function run() {
  const fixtures: Fixture[] = JSON.parse(
    readFileSync('fixtures/regression.json', 'utf8')
  )

  const stable = `${PERSONA_CARD}

# 对话样例

下面是你应该怎么说话的例子。注意分寸，不要照抄内容。

${renderExamples(EXAMPLES)}`

  const rows: Row[] = []

  for (const f of fixtures) {
    const msgs: ModelMessage[] = [
      { role: 'system', content: stable },
      { role: 'system', content: `# 现在的情况\n\n${fakeState(f)}` },
      ...(f.history ?? []),
      { role: 'user', content: f.user },
    ]

    const call = (note?: string) =>
      generateText({
        model: MODELS.voice(),
        messages: note
          ? ([...msgs, { role: 'system', content: note }] as ModelMessage[])
          : msgs,
        allowSystemInMessages: true,
        maxOutputTokens: 800,
      })

    // Mirror respond.ts: one regeneration on a guard hit, then strip.
    // Without this the eval reports first-pass text while production ships
    // the second pass, and every number here is a lie.
    let r = await call()
    let guard = checkOutput(r.text)
    const first = r.text

    if (!guard.clean) {
      r = await call(
        `上一次你的回复出现了这些问题：${guard.hits.join('、')}。重写，去掉它们。`
      )
      guard = checkOutput(r.text)
    }

    const finalText = guard.clean ? r.text : stripBanned(r.text)
    const row: Row = {
      id: f.id,
      note: f.note,
      user: f.user,
      out: splitMessages(finalText),
      hits: guard.hits,
      ...(first !== r.text ? { raw: first } : {}),
    }
    rows.push(row)
    print(row)
  }

  const s = stats(rows)
  printStats(s)

  mkdirSync('evals', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `evals/${stamp}.json`
  writeFileSync(
    path,
    JSON.stringify({ model: MODEL_NAMES.voice, stats: s, rows }, null, 2)
  )
  console.log(`\nwrote ${path}`)

  const againstIdx = process.argv.indexOf('--against')
  if (againstIdx > -1 && process.argv[againstIdx + 1]) {
    compare(
      JSON.parse(readFileSync(process.argv[againstIdx + 1], 'utf8')).rows,
      rows
    )
  }
}

/**
 * Is this bubble a question? The persona uses 。 even for questions, so an
 * end-punctuation check alone misses most of them.
 */
function isQuestion(b: string): boolean {
  const t = b.trim()
  if (/[？?]\s*$/.test(t)) return true
  if (/(吗|呢|吧)[。.，,]?\s*$/.test(t)) return true
  if (/^(什么|哪|怎么|为什么|要不要|是不是|有没有|多少|说说|讲讲)/.test(t))
    return true
  return false
}

type Stats = {
  total: number
  endsWithQuestion: number
  guardStillHit: number
  regenerated: number
  avgBubbles: number
  avgCharsPerBubble: number
  longestBubble: number
}

/**
 * The numbers that say whether a prompt change helped. Reading 25 replies by
 * eye and counting question marks is how a tuning session turns into an
 * afternoon; these four lines replace that.
 */
function stats(rows: Row[]): Stats {
  const bubbles = rows.flatMap((r) => r.out)
  const round = (n: number) => Math.round(n * 10) / 10
  return {
    total: rows.length,
    endsWithQuestion: rows.filter(
      (r) => r.out.length > 0 && isQuestion(r.out[r.out.length - 1])
    ).length,
    guardStillHit: rows.filter((r) => r.hits.length > 0).length,
    regenerated: rows.filter((r) => r.raw).length,
    avgBubbles: round(bubbles.length / Math.max(rows.length, 1)),
    avgCharsPerBubble: round(
      bubbles.reduce((a, b) => a + b.length, 0) / Math.max(bubbles.length, 1)
    ),
    longestBubble: bubbles.reduce((a, b) => Math.max(a, b.length), 0),
  }
}

function printStats(s: Stats) {
  const pct = (n: number) => `${Math.round((n / s.total) * 100)}%`
  console.log('\n\x1b[1m====== stats ======\x1b[0m')
  console.log(`  fixtures            ${s.total}`)
  console.log(
    `  ends with question  ${s.endsWithQuestion} (${pct(s.endsWithQuestion)})   <- target: under 25%`
  )
  console.log(`  regenerated         ${s.regenerated} (${pct(s.regenerated)})`)
  console.log(
    `  guard still hit     ${s.guardStillHit} (${pct(s.guardStillHit)})   <- target: 0`
  )
  console.log(`  avg bubbles/reply   ${s.avgBubbles}`)
  console.log(`  avg chars/bubble    ${s.avgCharsPerBubble}`)
  console.log(`  longest bubble      ${s.longestBubble}   <- over 90 is a wall of text`)
}

function print(r: Row) {
  console.log(`\n\x1b[2m-- ${r.id} : ${r.note}\x1b[0m`)
  console.log(`\x1b[36mher:\x1b[0m ${r.user.replace(/\n/g, ' / ')}`)
  if (r.raw) {
    console.log(
      `\x1b[2m(regenerated — first pass: ${r.raw.replace(/\n/g, ' / ').slice(0, 80)})\x1b[0m`
    )
  }
  for (const p of r.out) console.log(`\x1b[33mW:\x1b[0m   ${p}`)
  if (r.hits.length)
    console.log(`\x1b[31m! guard STILL hit after retry: ${r.hits.join(', ')}\x1b[0m`)
}

/** Only prints fixtures whose output actually changed. */
function compare(oldRows: Row[], newRows: Row[]) {
  const a = stats(oldRows)
  const b = stats(newRows)
  const delta = (k: keyof Stats) => {
    const d = (b[k] as number) - (a[k] as number)
    const arrow = d === 0 ? '=' : d > 0 ? `+${d}` : `${d}`
    return `${a[k]} -> ${b[k]}  (${arrow})`
  }
  console.log('\n\x1b[1m====== vs previous run ======\x1b[0m')
  console.log(`  ends with question  ${delta('endsWithQuestion')}`)
  console.log(`  guard still hit     ${delta('guardStillHit')}`)
  console.log(`  avg chars/bubble    ${delta('avgCharsPerBubble')}`)
  console.log(`  longest bubble      ${delta('longestBubble')}`)

  console.log('\n\n====== diff ======')
  for (const n of newRows) {
    const o = oldRows.find((x) => x.id === n.id)
    if (!o) continue
    if (o.out.join('|') === n.out.join('|')) continue
    console.log(`\n\x1b[1m${n.id}\x1b[0m ${n.note}`)
    console.log(`  \x1b[2mold: ${o.out.join(' / ')}\x1b[0m`)
    console.log(`  \x1b[32mnew: ${n.out.join(' / ')}\x1b[0m`)
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
