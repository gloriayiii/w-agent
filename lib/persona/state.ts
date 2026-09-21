import { db, messages } from '@/lib/db'
import { desc, sql as dsql } from 'drizzle-orm'
import { nightInstruction, type LateNightContext } from './rules'
import { recall } from '@/lib/memory/recall'

const TZ = process.env.TZ_NAME || 'Asia/Shanghai'

export type PersonaState = {
  now: string
  hour: number
  gap: string
  mood: string
  openTopics: string
  todaySchedule: string
  nightInstruction: string | null
  /** Durable statements she has made about herself. */
  facts: string
  /** Day-level summaries from the last week. */
  episodes: string
}

/** Local-time hour plus a human-readable timestamp. */
export function localNow(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  )
  return {
    text: `${parts.year}-${parts.month}-${parts.day} ${parts.weekday} ${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
  }
}

function humanGap(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 2) return '刚刚还在说话'
  if (min < 60) return `${min} 分钟`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} 小时`
  return `${Math.round(h / 24)} 天`
}

/**
 * Crude mood signal. Deliberately rule-based for v1 — spending another LLM
 * call on this would double the cost of every turn for very little gain.
 * Revisit once there is real conversation data to calibrate against.
 *
 * Return values are injected into the prompt, hence Chinese.
 */
function inferMood(recent: { role: string; content: string }[]): string {
  const userMsgs = recent.filter((m) => m.role === 'user').slice(0, 6)
  if (userMsgs.length === 0) return '未知（还没聊过）'

  const avgLen =
    userMsgs.reduce((a, m) => a + m.content.length, 0) / userMsgs.length
  const terse = avgLen < 12

  // Matches the OPENING, not the whole message. The old version required the
  // message to be exactly "没事" and so never fired on the thing people
  // actually type — "没事 就是有点累". Deflection alone is enough of a signal;
  // it does not also have to be terse.
  const deflecting = userMsgs.some((m) =>
    /^(没事|嗯+|还行|还好|无所谓|算了|不知道|随便)(?![^\s，,。.])/.test(
      m.content.trim()
    )
  )

  if (deflecting)
    return '回得很短，而且在敷衍 —— 大概率在硬撑，不要阴阳，把空间让出来'
  if (terse) return '回得比平时短'
  if (avgLen > 60) return '话比平时多'
  return '正常'
}

/**
 * How many distinct nights in the last week she was up past midnight.
 * The three-tier night policy in rules.ts keys off this number.
 *
 * Note the `- interval '5 hours'` before casting to date: 2am counts as
 * the previous night, not a new day.
 */
async function countLateNights(): Promise<number> {
  const rows = await db.execute<{ n: number }>(dsql`
    select count(distinct (((ts at time zone ${TZ}) - interval '5 hours')::date)) as n
    from messages
    where role = 'user'
      and ts > now() - interval '7 days'
      and extract(hour from ts at time zone ${TZ}) between 0 and 4
  `)
  const r =
    (rows as unknown as { rows?: { n: number }[] }).rows ??
    (rows as unknown as { n: number }[])
  return Number(r?.[0]?.n ?? 0)
}

export async function buildState(): Promise<PersonaState> {
  const { text: nowText, hour } = localNow()

  const recent = await db
    .select({ role: messages.role, content: messages.content, ts: messages.ts })
    .from(messages)
    .orderBy(desc(messages.ts))
    .limit(12)

  const lastUser = recent.find((m) => m.role === 'user')
  const gap = lastUser
    ? humanGap(Date.now() - new Date(lastUser.ts).getTime())
    : '第一次说话'

  const ctx: LateNightContext = {
    hour,
    lateNightsThisWeek: await countLateNights(),
    // TODO: replace with a real calendar lookup once CalDAV is wired up.
    // Assuming `true` is the conservative default here.
    hasEarlyCommitmentTomorrow: true,
  }

  const memory = await recall()

  return {
    now: nowText,
    hour,
    gap,
    mood: inferMood(recent),
    openTopics: memory.openTopics,
    todaySchedule: '（日历还没接，暂无）',
    nightInstruction: nightInstruction(ctx),
    facts: memory.facts,
    episodes: memory.episodes,
  }
}

/** Render the dynamic half of the system prompt. */
export function renderState(s: PersonaState): string {
  const lines = [
    `当前时间：${s.now}`,
    `今天日程：${s.todaySchedule}`,
    `距上次对话：${s.gap}`,
    `最近几轮她的状态：${s.mood}`,
    '',
    '# 你记得的事',
    '',
    '这些是她真的说过的。除了这里和上面的对话记录，',
    '你没有任何其他信息来源——具体的日期、次数、名字都必须出自这里。',
    '',
    '## 关于她',
    s.facts,
    '',
    '## 最近几天',
    s.episodes,
    '',
    '## 聊过但没聊完的',
    s.openTopics,
  ]
  if (s.nightInstruction) {
    lines.push('', '【此刻额外适用的规则】', s.nightInstruction)
  }
  return lines.join('\n')
}
