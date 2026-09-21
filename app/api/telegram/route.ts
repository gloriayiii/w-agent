import { after } from 'next/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import { db, messages, feedback } from '@/lib/db'
import { respond } from '@/lib/agent/respond'
import { sendMessage, sendTyping, sleep } from '@/lib/telegram/api'
import type { TgUpdate } from '@/lib/telegram/types'
import { trace } from '@/lib/trace'
import { classifyTurn } from '@/lib/memory/classify'

export const maxDuration = 300

/** Read per request. An unset value must not silently become `undefined`. */
function owner(): string {
  const o = process.env.TELEGRAM_OWNER_CHAT_ID
  if (!o) throw new Error('TELEGRAM_OWNER_CHAT_ID is not set')
  return o
}

/**
 * Merge window. Real people send "you there" -> "about that thing" ->
 * "what do you think" as three bubbles two seconds apart. Serverless would
 * spin up three concurrent instances and answer each one separately, which
 * instantly destroys the illusion.
 */
const MERGE_WINDOW_MS = 2500

export async function POST(req: Request) {
  // 1. Auth. Telegram echoes back the secret we registered with setWebhook.
  const secret = req.headers.get('x-telegram-bot-api-secret-token')
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 })
  }

  const update = (await req.json()) as TgUpdate

  // 2. Ack immediately. Waiting for the LLM before returning makes Telegram
  //    time out and re-deliver, and you get answered twice.
  after(() =>
    handle(update).catch((e) => trace({ kind: 'respond', error: String(e) }))
  )
  return new Response('ok')
}

async function handle(update: TgUpdate) {
  // --- Feedback: she reacted to one of W's messages ---
  if (update.message_reaction) {
    const r = update.message_reaction
    if (String(r.chat.id) !== owner()) return
    const emoji = r.new_reaction?.[0]?.emoji
    if (!emoji) return
    const signal = ['👍', '❤', '❤️', '🔥', '🥰'].includes(emoji)
      ? 1
      : ['👎', '💩', '🤨'].includes(emoji)
        ? -1
        : 0
    if (signal === 0) return

    const [row] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.tgMessageId, r.message_id))
      .limit(1)
    if (row) await db.insert(feedback).values({ messageId: row.id, signal })
    return
  }

  const msg = update.message
  if (!msg?.text) return
  // The only auth in the system: ignore everyone who isn't her.
  if (String(msg.chat.id) !== owner()) return

  // 3. Idempotency. A re-delivered update collides on tg_update_id and the
  //    insert returns nothing, so we bail.
  const inserted = await db
    .insert(messages)
    .values({
      role: 'user',
      content: msg.text,
      tgUpdateId: update.update_id,
      tgMessageId: msg.message_id,
      processed: false,
    })
    .onConflictDoNothing({ target: messages.tgUpdateId })
    .returning({ id: messages.id })

  if (inserted.length === 0) return // retry of an update we already handled
  const myId = inserted[0].id

  // 4. Merge window. When she sends three bubbles, the first two bail out
  //    here and the last one picks up all three at once.
  await sendTyping(msg.chat.id)
  await sleep(MERGE_WINDOW_MS)

  const newer = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.role, 'user'),
        eq(messages.processed, false),
        gt(messages.id, myId)
      )
    )
    .limit(1)

  if (newer.length > 0) return // a later message will handle the whole batch

  const pending = await db
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .where(and(eq(messages.role, 'user'), eq(messages.processed, false)))
    .orderBy(messages.id)

  if (pending.length === 0) return

  await db
    .update(messages)
    .set({ processed: true })
    .where(
      sql`${messages.id} in (${sql.join(
        pending.map((p) => sql`${p.id}`),
        sql`, `
      )})`
    )

  const merged = pending.map((p) => p.content).join('\n')

  // 5. Classify the turn BEFORE replying, while W's previous message is
  //    still the most recent assistant row. This tags that message and
  //    captures any correction she just made. Cheap model, and its result
  //    is not needed for the reply, so failure is harmless.
  const classified = classifyTurn(pending[pending.length - 1].id, merged)

  // 6. Generate and send.
  await sendTyping(msg.chat.id)
  const { parts } = await respond(merged)
  await classified.catch(() => {})

  for (const [i, part] of parts.entries()) {
    if (i > 0) {
      await sendTyping(msg.chat.id)
      // Space the bubbles out, the way a person typing would.
      await sleep(Math.min(1200, 300 + part.length * 25))
    }
    const sent = await sendMessage(msg.chat.id, part)
    await db.insert(messages).values({
      role: 'assistant',
      content: part,
      tgMessageId: sent.message_id,
      processed: true,
    })
  }
}
