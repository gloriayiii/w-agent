import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { localNow } from '@/lib/persona/state'
import {
  QUIET_HOURS,
  DAILY_PROACTIVE_QUOTA,
  RECENT_CHAT_SUPPRESS_MIN,
} from '@/lib/persona/rules'

export const maxDuration = 300

/**
 * Heartbeat for proactive messages, and the server-side health check.
 *
 * ⚠️ Week 1 does not send anything. Wiring up proactive messages before the
 * persona is dialled in only amplifies whatever is wrong with it.
 *
 * Week 3 fills in:
 *   1. collectTriggers()  gather candidates
 *   2. hardFilter()       quiet hours / daily quota / 24h dedupe / recent chat
 *   3. llmGate()          ask the model whether interrupting is worth it,
 *                         and let it answer "skip"
 *   4. generate + send
 *
 * Step 2 MUST run before step 3. Putting all 96 daily ticks through a model
 * adds double-digit dollars a month for nothing.
 *
 * The `env` and `db` fields below exist because every other check in this
 * project (the 403s, the webhook handshake) short-circuits before touching
 * the database — so a missing DATABASE_URL on the server looks exactly like
 * everything working. Booleans only; never echo a secret's value.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('forbidden', { status: 403 })
  }

  const { hour } = localNow()

  const present = (k: string) => Boolean(process.env[k])
  const env = {
    DATABASE_URL: present('DATABASE_URL'),
    ANTHROPIC_API_KEY: present('ANTHROPIC_API_KEY'),
    DEEPSEEK_API_KEY: present('DEEPSEEK_API_KEY'),
    TELEGRAM_BOT_TOKEN: present('TELEGRAM_BOT_TOKEN'),
    TELEGRAM_WEBHOOK_SECRET: present('TELEGRAM_WEBHOOK_SECRET'),
    TZ_NAME: process.env.TZ_NAME ?? null,
    // Not a secret — it is her own chat id, and she needs to compare it.
    TELEGRAM_OWNER_CHAT_ID: process.env.TELEGRAM_OWNER_CHAT_ID ?? null,
  }

  let database: { ok: boolean; messages?: number; error?: string }
  try {
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from messages`
    )
    const r =
      (rows as unknown as { rows?: { n: number }[] }).rows ??
      (rows as unknown as { n: number }[])
    database = { ok: true, messages: Number(r?.[0]?.n ?? 0) }
  } catch (e) {
    database = { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  return Response.json({
    ok: true,
    hour,
    inQuietHours: hour < QUIET_HOURS.end && hour >= QUIET_HOURS.start - 1,
    quota: DAILY_PROACTIVE_QUOTA,
    suppressMin: RECENT_CHAT_SUPPRESS_MIN,
    env,
    database,
    note: 'Week 1: heartbeat is live, proactive engine not implemented yet',
  })
}
