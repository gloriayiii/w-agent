/**
 * Weekly backup of the irreplaceable tables.
 *
 *   node scripts/backup.mjs            -> backups/w-agent-<date>.json
 *
 * Neon's free tier keeps only 6 hours of point-in-time restore. `messages`
 * is the one table in this project that cannot be regenerated from anything
 * — it is the entire relationship. Everything else (traces, episodes) can be
 * rebuilt or lived without.
 *
 * Plain JSON rather than pg_dump so it needs no Postgres client installed,
 * and so a future you can read it without a database at all.
 */
import fs from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'

const env = {}
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const sql = neon(env.DATABASE_URL)

const dump = {
  exportedAt: new Date().toISOString(),
  messages: await sql`select * from messages order by id`,
  facts: await sql`select * from facts order by id`,
  feedback: await sql`select * from feedback order by id`,
  episodes: await sql`select * from episodes order by id`,
  open_topics: await sql`select * from open_topics order by id`,
}

fs.mkdirSync('backups', { recursive: true })
const day = new Date().toISOString().slice(0, 10)
const file = path.join('backups', `w-agent-${day}.json`)
fs.writeFileSync(file, JSON.stringify(dump, null, 2))

const kb = (fs.statSync(file).size / 1024).toFixed(1)
console.log(`${file}  (${kb} KB)`)
console.log(
  `  messages ${dump.messages.length}  facts ${dump.facts.length}  ` +
    `feedback ${dump.feedback.length}  episodes ${dump.episodes.length}  ` +
    `open_topics ${dump.open_topics.length}`
)
