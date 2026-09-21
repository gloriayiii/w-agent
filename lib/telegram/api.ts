const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const API = () => `https://api.telegram.org/bot${TOKEN}`

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
