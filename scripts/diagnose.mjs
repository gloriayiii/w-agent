/**
 * One-shot deployment diagnostic. Run with: node scripts/diagnose.mjs
 *
 * Answers, in order, the only four questions that matter when W goes quiet:
 *   1. Is a webhook registered, and is Telegram getting errors from it?
 *   2. Is the deployment alive and rejecting unauthenticated calls?
 *   3. Did any message actually reach the function (messages table)?
 *   4. Did the model get called (traces table)?
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

const ok = (s) => `\x1b[32m${s}\x1b[0m`
const bad = (s) => `\x1b[31m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

// ---- 1. Telegram webhook ----
console.log('\n=== 1. Telegram webhook ===')
try {
  const r = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`
  )
  const j = await r.json()
  if (!j.ok) {
    console.log(bad('  token rejected: ') + JSON.stringify(j))
  } else {
    const w = j.result
    console.log('  url                  ', w.url || bad('(NONE — run: npm run webhook:set)'))
    console.log('  pending updates      ', w.pending_update_count)
    console.log('  has secret token     ', w.has_custom_certificate === undefined ? '(n/a)' : '')
    if (w.last_error_message) {
      console.log(bad('  last error           ') + w.last_error_message)
      console.log(dim('  at                   ' + new Date(w.last_error_date * 1000).toISOString()))
    } else {
      console.log(ok('  no delivery errors'))
    }
    if (w.pending_update_count > 0) {
      console.log(bad('  >> Telegram is holding messages. Your endpoint is failing or unreachable.'))
    }
  }
} catch (e) {
  console.log(bad('  cannot reach api.telegram.org: ') + e.message + dim('  (proxy off?)'))
}

// ---- 2. Deployment reachable ----
console.log('\n=== 2. Deployment ===')
const base = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
for (const [path, expect] of [['/api/tick', 403], ['/api/telegram', 403]]) {
  try {
    const r = await fetch(base + path, {
      method: path === '/api/telegram' ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: path === '/api/telegram' ? '{}' : undefined,
    })
    const mark = r.status === expect ? ok('OK') : bad(`expected ${expect}`)
    console.log(`  ${path.padEnd(16)} ${r.status}  ${mark}`)
    if (r.status === 500) console.log(dim('    -> 500 means the function crashed. Check Vercel Logs.'))
    if (r.status === 404) console.log(dim('    -> 404 means the route is not deployed.'))
  } catch (e) {
    console.log(`  ${path.padEnd(16)} ` + bad('unreachable: ' + e.message))
  }
}

// ---- 2a. What does the SERVER see? ----
console.log('\n=== 2a. Server-side env + database ===')
try {
  const r = await fetch(base + '/api/tick', {
    headers: { authorization: `Bearer ${env.CRON_SECRET ?? ''}` },
  })
  if (r.status === 403) {
    console.log(bad('  403 — CRON_SECRET in .env differs from Vercel'))
  } else {
    const j = await r.json()
    for (const [k, v] of Object.entries(j.env ?? {})) {
      const mark = v === true ? ok('set') : v === false ? bad('MISSING') : String(v)
      console.log('  ' + k.padEnd(24) + mark)
    }
    if (j.env?.TELEGRAM_OWNER_CHAT_ID !== env.TELEGRAM_OWNER_CHAT_ID) {
      console.log(bad('  >> owner chat id differs from .env (' + env.TELEGRAM_OWNER_CHAT_ID + ')'))
    }
    if (j.database?.ok) {
      console.log(ok('  database                 reachable, ' + j.database.messages + ' messages'))
    } else {
      console.log(bad('  database                 FAILED: ') + j.database?.error)
    }
  }
} catch (e) {
  console.log(bad('  request failed: ') + e.message)
}

// ---- 2b. Does the secret actually match? ----
// Posts a synthetic update with the secret from .env and a chat id that is
// NOT the owner. A 200 proves the secret matches and the route runs; the
// non-owner id means handle() drops it, so nothing is written anywhere.
console.log('\n=== 2b. Webhook secret match ===')
try {
  const r = await fetch(base + '/api/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 1 },
        date: 0,
        text: 'diagnostic, ignored (non-owner chat id)',
      },
    }),
  })
  if (r.status === 200) {
    console.log(ok('  200 — secret in .env MATCHES the one on Vercel'))
  } else if (r.status === 403) {
    console.log(bad('  403 — secret MISMATCH'))
    console.log(dim("    .env and Vercel hold different values, or Vercel wasn't"))
    console.log(dim('    redeployed after you changed it. Saving alone does nothing.'))
  } else {
    console.log(bad('  unexpected status ' + r.status))
  }
} catch (e) {
  console.log(bad('  request failed: ') + e.message)
}

// ---- 2c. Is the owner id right on the server? ----
// Same request, but with the owner chat id from .env. If the server agrees
// it is the owner, it will try to handle it and write a row.
console.log('\n=== 2c. Owner id (this one WILL write a test row) ===')
console.log(dim('  skipped by default — run with --ping to execute'))
if (process.argv.includes('--ping')) {
  const r = await fetch(base + '/api/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify({
      update_id: Math.floor(Date.now() / 1000),
      message: {
        message_id: Math.floor(Date.now() / 1000),
        chat: { id: Number(env.TELEGRAM_OWNER_CHAT_ID) },
        date: Math.floor(Date.now() / 1000),
        text: 'ping',
      },
    }),
  })
  console.log('  status', r.status, dim('— now wait ~8s and check tables below'))
  await new Promise((res) => setTimeout(res, 9000))
}

// ---- 3 & 4. Database ----
console.log('\n=== 3. Did anything reach the function? ===')
try {
  const sql = neon(env.DATABASE_URL)
  const m = await sql`select role, left(content,50) as c, ts from messages order by id desc limit 8`
  if (!m.length) {
    console.log(bad('  messages table is EMPTY'))
    console.log(dim('  -> No message ever got past the webhook. Almost always a'))
    console.log(dim('     TELEGRAM_WEBHOOK_SECRET mismatch between .env and Vercel,'))
    console.log(dim('     or the webhook was never registered.'))
  } else {
    for (const r of m) console.log(' ', r.ts.toISOString?.() ?? r.ts, r.role.padEnd(9), '|', r.c)
  }

  console.log('\n=== 4. Did the model get called? ===')
  const t = await sql`select kind, model, latency_ms, left(coalesce(output, error),70) as o, error, ts from traces order by id desc limit 5`
  if (!t.length) {
    console.log(bad('  traces table is EMPTY'))
  } else {
    for (const r of t) {
      console.log(' ', r.error ? bad(r.kind) : ok(r.kind), r.model ?? '', (r.latency_ms ?? '?') + 'ms', '|', r.o)
    }
  }
} catch (e) {
  console.log(bad('  DB error: ') + e.message)
}

console.log('')
