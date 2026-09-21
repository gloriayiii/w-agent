import { generateText } from 'ai'
import { desc, eq } from 'drizzle-orm'
import { db, messages, feedback } from '@/lib/db'
import { MODELS, MODEL_NAMES, estimateCost } from '@/lib/agent/router'
import { trace } from '@/lib/trace'

/**
 * One cheap call per turn that does two jobs at once.
 *
 * 1. Tags W's PREVIOUS reply (tone / emotion / principle / factual /
 *    bilingual). The tag decides whether that reply may ever be used as
 *    preference-learning data — `principle` and `factual` never can. Until
 *    this ran, messages.tags was always null and that safeguard was empty.
 *
 * 2. Detects whether her new message is CORRECTING that reply, and if so
 *    keeps her exact words.
 *
 * Both need the same two messages in context, so they share one call.
 * Runs on the cheap model, after the response has already been sent, so it
 * adds no latency and roughly $0.0003 per turn.
 */

export type Classification = {
  tag: string | null
  isCorrection: boolean
  correctionNote: string | null
  isPraise: boolean
}

const PROMPT = `你在分析一段对话，输出 JSON，不要有任何其他文字。

给你两条消息：W（一个有性格的伴侣型 agent）刚才的回复，和 Gloria 紧接着的回应。

判断两件事：

1. W 那条回复属于哪一类：
   - tone      日常语气、玩笑、损人、闲聊
   - emotion   在回应她的情绪状态
   - principle 在推回去、劝阻、指出模式、坚持立场
   - factual   在回答事实问题或执行任务
   - bilingual 主要用英文或明显的中英混杂

2. Gloria 的回应是不是在纠正 W 说话的方式？
   算纠正的：「这句太冲了」「别这么说话」「你没懂我意思」「语气奇怪」
   不算纠正的：单纯不同意某个观点、换话题、正常聊天、只是情绪低落

   如果是纠正，原样保留她的话，不要改写。

3. 她是不是在明确表示喜欢 W 刚才的说法（「这句说得好」「对，就是这个意思」）。

输出格式：
{"tag":"tone|emotion|principle|factual|bilingual","isCorrection":false,"correctionNote":null,"isPraise":false}`

export async function classifyTurn(
  userMessageId: number,
  userText: string
): Promise<Classification | null> {
  // W's most recent reply, i.e. the thing she might be reacting to.
  const [prev] = await db
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(eq(messages.role, 'assistant'))
    .orderBy(desc(messages.id))
    .limit(1)

  if (!prev) return null

  const started = Date.now()
  try {
    const r = await generateText({
      model: MODELS.internal(),
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: `W 说：${prev.content}\n\nGloria 说：${userText}`,
        },
      ],
      maxOutputTokens: 200,
    })

    const json = r.text.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null
    const c = JSON.parse(json) as Classification

    // Tag the reply so the learnability filter has something to filter on.
    if (c.tag) {
      await db
        .update(messages)
        .set({ tags: [c.tag] })
        .where(eq(messages.id, prev.id))
    }

    // A correction is the highest-value signal this system can collect:
    // it says what was wrong, in her words, attached to the exact message.
    if (c.isCorrection && c.correctionNote) {
      await db.insert(feedback).values({
        messageId: prev.id,
        signal: -1,
        kind: 'correction',
        note: c.correctionNote,
      })
    } else if (c.isPraise) {
      await db.insert(feedback).values({
        messageId: prev.id,
        signal: 1,
        kind: 'correction',
        note: userText.slice(0, 200),
      })
    }

    await trace({
      kind: 'tool',
      model: MODEL_NAMES.internal,
      input: { classify: { prevId: prev.id, userText } },
      output: JSON.stringify(c),
      latencyMs: Date.now() - started,
      costUsd: estimateCost(
        MODEL_NAMES.internal,
        r.usage?.inputTokens ?? 0,
        r.usage?.outputTokens ?? 0
      ),
    })

    return c
  } catch (e) {
    // Classification is best-effort. Never let it break a conversation.
    await trace({ kind: 'tool', error: `classify: ${String(e)}` })
    return null
  }
}
