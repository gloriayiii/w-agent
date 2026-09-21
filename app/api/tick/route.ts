import { localNow } from '@/lib/persona/state'
import {
  QUIET_HOURS,
  DAILY_PROACTIVE_QUOTA,
  RECENT_CHAT_SUPPRESS_MIN,
} from '@/lib/persona/rules'

export const maxDuration = 300

/**
 * Heartbeat for proactive messages. cron-job.org hits this every 15 minutes.
 *
 * ⚠️ Week 1 leaves this empty on purpose. Wiring up proactive messages
 * before the persona is dialled in only amplifies whatever is wrong with it.
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
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('forbidden', { status: 403 })
  }

  const { hour } = localNow()
  const inQuietHours = hour < QUIET_HOURS.end && hour >= QUIET_HOURS.start - 1

  return Response.json({
    ok: true,
    hour,
    inQuietHours,
    quota: DAILY_PROACTIVE_QUOTA,
    suppressMin: RECENT_CHAT_SUPPRESS_MIN,
    note: 'Week 1: heartbeat is live, proactive engine not implemented yet',
  })
}
