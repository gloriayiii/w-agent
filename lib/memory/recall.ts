import { desc, eq, gte } from 'drizzle-orm'
import { db, facts, episodes, openTopics } from '@/lib/db'

/**
 * What W is allowed to know, loaded fresh each turn.
 *
 * Everything here is injected into the DYNAMIC half of the system prompt —
 * never the cached prefix — because it changes constantly.
 *
 * This is also the only legitimate source of the concrete details the
 * persona card permits: if a date, a count or a name is not in here or in
 * the visible conversation, W is not allowed to say it.
 */

const RECENT_EPISODE_DAYS = 7
const MAX_FACTS = 40
const MAX_OPEN_TOPICS = 6

export type Recalled = {
  facts: string
  episodes: string
  openTopics: string
}

export async function recall(): Promise<Recalled> {
  const since = new Date(Date.now() - RECENT_EPISODE_DAYS * 864e5)

  const [f, e, t] = await Promise.all([
    db
      .select({
        predicate: facts.predicate,
        value: facts.value,
      })
      .from(facts)
      .orderBy(desc(facts.updatedAt))
      .limit(MAX_FACTS),
    db
      .select({ day: episodes.day, summary: episodes.summary })
      .from(episodes)
      .where(gte(episodes.ts, since))
      .orderBy(desc(episodes.day))
      .limit(RECENT_EPISODE_DAYS),
    db
      .select({ topic: openTopics.topic, lastMentioned: openTopics.lastMentioned })
      .from(openTopics)
      .where(eq(openTopics.status, 'open'))
      .orderBy(desc(openTopics.lastMentioned))
      .limit(MAX_OPEN_TOPICS),
  ])

  return {
    facts: f.length
      ? f.map((x) => `- ${x.predicate}：${x.value}`).join('\n')
      : '（还没攒下什么）',
    episodes: e.length
      ? e.map((x) => `【${x.day}】${x.summary}`).join('\n')
      : '（还没有）',
    openTopics: t.length
      ? t
          .map((x) => {
            const days = Math.floor(
              (Date.now() - new Date(x.lastMentioned!).getTime()) / 864e5
            )
            return `- ${x.topic}（${days === 0 ? '今天' : days + ' 天前'}提过）`
          })
          .join('\n')
      : '（暂无）',
  }
}
