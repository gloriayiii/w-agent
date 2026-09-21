import { generateText, type ModelMessage } from 'ai'
import { desc } from 'drizzle-orm'
import { db, messages as messagesTable } from '@/lib/db'
import { buildState } from '@/lib/persona/state'
import { buildSystemPrompt } from '@/lib/persona/build'
import { MODELS, MODEL_NAMES, estimateCost } from './router'
import { checkOutput, stripBanned, splitMessages } from './guard'
import { trace } from '@/lib/trace'

/**
 * Context window, in turns. Without a cap, a single request is 30k tokens
 * by turn 200. Older context is the memory layer's job (phase 2), not this
 * array's.
 */
const CONTEXT_TURNS = 20

export type RespondResult = {
  parts: string[]
  raw: string
  guardHits: string[]
}

export async function respond(userText: string): Promise<RespondResult> {
  const started = Date.now()

  const state = await buildState()
  const { stable, dynamic } = buildSystemPrompt(state)

  const history = await db
    .select({ role: messagesTable.role, content: messagesTable.content })
    .from(messagesTable)
    .orderBy(desc(messagesTable.id))
    .limit(CONTEXT_TURNS)

  const convo: ModelMessage[] = history.reverse().map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  const msgs: ModelMessage[] = [
    {
      role: 'system',
      content: stable,
      // Cache breakpoint. Persona card + few-shot is a stable prefix that
      // every turn reuses; cache reads bill at 0.1x input.
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral' } },
      },
    },
    { role: 'system', content: dynamic },
    ...convo,
    { role: 'user', content: userText },
  ]

  async function once(extraNote?: string) {
    const m = extraNote
      ? ([...msgs, { role: 'system', content: extraNote }] as ModelMessage[])
      : msgs
    return generateText({
      model: MODELS.voice(),
      messages: m,
      // Two system blocks are required: the first carries the Anthropic cache
      // breakpoint, the second is per-call state. The SDK warns about system
      // messages in `messages` (prompt-injection risk when content is
      // user-supplied); here both blocks are ours, so this is safe.
      allowSystemInMessages: true,
      // No `temperature` — claude-sonnet-5 ignores it. Voice variance comes
      // from the few-shot examples, not from sampling.
      maxOutputTokens: 800,
    })
  }

  let result = await once()
  let guard = checkOutput(result.text)
  const rawFirst = result.text

  // Assistant-speak detected: regenerate once, telling it what went wrong.
  if (!guard.clean) {
    result = await once(
      `上一次你的回复出现了这些问题：${guard.hits.join('、')}。重写，去掉它们。`
    )
    guard = checkOutput(result.text)
  }

  const finalText = guard.clean ? result.text : stripBanned(result.text)
  const parts = splitMessages(finalText)

  await trace({
    kind: 'respond',
    model: MODEL_NAMES.voice,
    systemPrompt: `${stable}\n\n---\n\n${dynamic}`,
    input: { userText, historyLen: convo.length, state },
    output: parts.join('\n---\n'),
    rawOutput: rawFirst,
    latencyMs: Date.now() - started,
    costUsd: estimateCost(
      MODEL_NAMES.voice,
      result.usage?.inputTokens ?? 0,
      result.usage?.outputTokens ?? 0
    ),
  })

  return { parts, raw: rawFirst, guardHits: guard.hits }
}
