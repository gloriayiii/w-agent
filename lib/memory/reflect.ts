import { generateText } from 'ai'
import { and, gte, lt, sql } from 'drizzle-orm'
import { db, messages, facts, episodes, openTopics } from '@/lib/db'
import { MODELS, MODEL_NAMES, estimateCost } from '@/lib/agent/router'
import { trace } from '@/lib/trace'

const TZ = process.env.TZ_NAME || 'Asia/Shanghai'

/**
 * Nightly compression.
 *
 * Turns one day of raw conversation into three durable things:
 *   - an episode: what happened, in a few lines
 *   - facts: structured, durable statements about her
 *   - open topics: things she raised and never closed
 *
 * The open topics are the point. They are what lets a proactive message be
 * "你上周说要决定的那件事定了吗" instead of "早上好" — and that difference
 * is the whole reason the proactive engine is worth building at all.
 *
 * Only the day's OWN messages are fed in, never the whole history: the cost
 * of this job must stay flat as the corpus grows.
 */

const PROMPT = `你在读 Gloria 和 W 一天的对话记录，输出 JSON，不要有任何其他文字。

抽取三样东西：

1. summary —— 这一天发生了什么，3-5 句。写事实，不写评价。
   她做了什么、说了什么、什么状态。没聊什么实质内容就如实写"没什么实质对话"。

2. facts —— 关于 Gloria 的、在今天之后依然成立的事实。
   只抽她**明确说过**的，不要推断，不要补充她没说的细节。
   会过期的东西不要（今天的心情、某个临时的 deadline）。
   格式：{"subject":"Gloria","predicate":"简短谓词","value":"值"}
   没有就给空数组。宁可少，不可编。

3. openTopics —— 她提起但没有下文的事。
   「我在考虑要不要…」「下周得决定…」「那个还没弄完」这类。
   用她自己的措辞，一句话。已经在对话里解决掉的不算。
   格式：["短语", ...]

4. salience —— 0 到 1，这一天以后值不值得回想。
   日常闲聊 0.2，有决定或情绪起伏的 0.7 以上。

输出格式：
{"summary":"...","facts":[],"openTopics":[],"salience":0.3}`

export type ReflectResult = {
  day: string
  written: boolean
  reason?: string
}

/** Local-date string for a given instant, e.g. "2026-09-21". */
function localDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export async function reflect(target?: Date): Promise<ReflectResult> {
  // Default to yesterday: today is not over yet.
  const d = target ?? new Date(Date.now() - 24 * 3600 * 1000)
  const day = localDay(d)

  const existing = await db
    .select({ day: episodes.day })
    .from(episodes)
    .where(sql`${episodes.day} = ${day}`)
    .limit(1)
  if (existing.length) return { day, written: false, reason: 'already done' }

  const start = new Date(`${day}T00:00:00`)
  const end = new Date(start.getTime() + 24 * 3600 * 1000)

  const rows = await db
    .select({ role: messages.role, content: messages.content, id: messages.id })
    .from(messages)
    .where(and(gte(messages.ts, start), lt(messages.ts, end)))
    .orderBy(messages.id)

  if (rows.length < 4) return { day, written: false, reason: 'too few messages' }

  const transcript = rows
    .map((r) => `${r.role === 'user' ? 'Gloria' : 'W'}: ${r.content}`)
    .join('\n')

  const started = Date.now()
  try {
    const r = await generateText({
      model: MODELS.reflect(),
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: transcript },
      ],
      maxOutputTokens: 1200,
    })

    const json = r.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) throw new Error('no JSON in reflection output')
    const out = JSON.parse(json) as {
      summary: string
      facts?: { subject: string; predicate: string; value: string }[]
      openTopics?: string[]
      salience?: number
    }

    await db.insert(episodes).values({
      day,
      summary: out.summary,
      salience: out.salience ?? 0.3,
    })

    if (out.facts?.length) {
      await db.insert(facts).values(
        out.facts.map((f) => ({
          subject: f.subject,
          predicate: f.predicate,
          value: f.value,
          sourceId: rows[rows.length - 1].id,
        }))
      )
    }

    if (out.openTopics?.length) {
      for (const topic of out.openTopics) {
        // Same wording twice just refreshes the timestamp.
        await db
          .insert(openTopics)
          .values({ topic, sourceId: rows[rows.length - 1].id })
          .onConflictDoUpdate({
            target: openTopics.topic,
            set: { lastMentioned: new Date(), status: 'open' },
          })
      }
    }

    await trace({
      kind: 'reflect',
      model: MODEL_NAMES.reflect,
      input: { day, messageCount: rows.length },
      output: json,
      latencyMs: Date.now() - started,
      costUsd: estimateCost(
        MODEL_NAMES.reflect,
        r.usage?.inputTokens ?? 0,
        r.usage?.outputTokens ?? 0
      ),
    })

    return { day, written: true }
  } catch (e) {
    await trace({ kind: 'reflect', error: `${day}: ${String(e)}` })
    return { day, written: false, reason: String(e) }
  }
}
