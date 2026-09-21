/**
 * Weekly feedback review — the human-in-the-loop half of "self-learning".
 *
 *   node scripts/review.mjs
 *
 * Prints every correction and reaction from the last 7 days next to the
 * message that provoked it, so you can decide what becomes a rule.
 *
 * This step is deliberately manual. An agent that rewrites its own persona
 * from your reactions drifts toward whatever pleases you in the moment,
 * which is the opposite of the first thing written on its card. You are the
 * filter; the machine only collects.
 */
import fs from 'node:fs'
import { neon } from '@neondatabase/serverless'

const env = {}
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const sql = neon(env.DATABASE_URL)

const rows = await sql`
  select f.signal, f.kind, f.note, f.ts,
         m.content as reply, m.tags
  from feedback f
  join messages m on m.id = f.message_id
  where f.ts > now() - interval '7 days'
  order by f.ts desc
`

const NON_LEARNABLE = ['principle', 'factual']

console.log(`\n=== feedback, last 7 days (${rows.length}) ===\n`)
if (!rows.length) {
  console.log('  nothing yet. Tell W off in the chat when it gets something wrong;')
  console.log('  that is what fills this up.\n')
}

for (const r of rows) {
  const mark = r.signal > 0 ? '\x1b[32m+1\x1b[0m' : '\x1b[31m-1\x1b[0m'
  const tag = r.tags?.[0] ?? '?'
  const locked = NON_LEARNABLE.includes(tag)
  console.log(`${mark} [${tag}]${locked ? ' \x1b[33m(not learnable)\x1b[0m' : ''}  ${r.kind}`)
  console.log(`   W:  ${String(r.reply).replace(/\n/g, ' / ').slice(0, 90)}`)
  if (r.note) console.log(`   她: ${String(r.note).replace(/\n/g, ' ').slice(0, 90)}`)
  console.log()
}

const learnable = rows.filter((r) => !NON_LEARNABLE.includes(r.tags?.[0] ?? '?'))
console.log(`learnable: ${learnable.length} / ${rows.length}`)
console.log(
  `\x1b[2mThe rest were principle/factual replies. A thumbs-down on those is\n` +
    `recorded for you to read, never used as training signal — otherwise W\n` +
    `slowly learns to stop holding the line.\x1b[0m\n`
)
