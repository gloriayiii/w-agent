/**
 * Read the token per call, never at module load.
 *
 * ES imports are evaluated before any statement in the importing file, so a
 * module-level `process.env.TELEGRAM_BOT_TOKEN` is read BEFORE
 * scripts/set-webhook.ts gets to call process.loadEnvFile('.env'). The URL
 * then becomes `/botundefined/setWebhook`, and Telegram answers 404
 * "Not Found" — which reads exactly like an invalid token and sends you
 * hunting for the wrong bug.
 */
function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN
  if (!t) throw new Error('TELEGRAM_BOT_TOKEN is not set')
  return t
}
const API = () => `https://api.telegram.org/bot${token()}`

async function call<T = unknown>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as {
    ok: boolean
    result: T
    description?: string
  }
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`)
  return json.result
}

export async function sendMessage(chatId: number | string, text: string) {
  return call<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    // No parse_mode on purpose. W sends chat messages, not formatted
    // documents, and a markdown parse failure drops the whole message.
    disable_notification: false,
  })
}

/**
 * The "typing…" indicator. Streaming is meaningless in IM (messages arrive
 * whole), so this is the only tool available for hiding generation latency.
 */
export async function sendTyping(chatId: number | string) {
  try {
    await call('sendChatAction', { chat_id: chatId, action: 'typing' })
  } catch {
    // Cosmetic. Not worth failing a turn over.
  }
}

export async function setWebhook(url: string, secret: string) {
  return call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'message_reaction'],
    drop_pending_updates: true,
  })
}

/** Real people don't reply instantly, and don't fire bubbles back to back. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
