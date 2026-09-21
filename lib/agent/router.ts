import { anthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

/**
 * Model routing — rule-based, never an LLM call.
 * Spending an LLM call to decide which LLM to call is backwards.
 *
 *   Anything she reads        -> Sonnet (this is where the persona lives)
 *   Internal work (gating,    -> DeepSeek / Haiku (she never sees it, so a
 *   reflection, parsing)         dumber model costs nothing that matters)
 *
 * Note this is the OPPOSITE of the obvious split. Small talk is where the
 * persona matters most; tool-call argument parsing is where it matters
 * least. Routing small talk to the cheap model is how the agent ends up
 * feeling like two different people.
 */

const deepseek = createOpenAICompatible({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
})

export const MODELS = {
  /** Every reply Gloria actually reads. */
  voice: () => anthropic('claude-sonnet-5'),
  /** Proactive send/skip gating, intent classification, argument parsing. */
  internal: () => deepseek('deepseek-flash'),
  /** Daily reflection — needs slightly more of a brain. */
  reflect: () => anthropic('claude-haiku-4-5-20251001'),
} as const

export const MODEL_NAMES = {
  voice: 'claude-sonnet-5',
  internal: 'deepseek-flash',
  reflect: 'claude-haiku-4-5-20251001',
} as const

/** Rough cost estimate, written into traces so you can see where the bill goes. */
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-5': { in: 2 / 1e6, out: 10 / 1e6 },
  'claude-haiku-4-5-20251001': { in: 1 / 1e6, out: 5 / 1e6 },
  'deepseek-flash': { in: 0.3 / 1e6, out: 0.5 / 1e6 },
}

export function estimateCost(
  model: string,
  inputTokens = 0,
  outputTokens = 0
): number {
  const p = PRICING[model]
  if (!p) return 0
  return inputTokens * p.in + outputTokens * p.out
}
