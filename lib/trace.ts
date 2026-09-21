import { db, traces } from '@/lib/db'

export type TraceInput = {
  kind: 'respond' | 'gate' | 'reflect' | 'tool'
  model?: string
  systemPrompt?: string
  input?: unknown
  output?: string
  rawOutput?: string
  latencyMs?: number
  costUsd?: number
  error?: string
}

/**
 * Store the full prompt, never a summary.
 *
 * This never throws — failing to write a log must not break a conversation.
 */
export async function trace(t: TraceInput) {
  try {
    await db.insert(traces).values({
      kind: t.kind,
      model: t.model,
      systemPrompt: t.systemPrompt,
      input: (t.input ?? null) as never,
      output: t.output,
      rawOutput: t.rawOutput,
      latencyMs: t.latencyMs,
      costUsd: t.costUsd != null ? String(t.costUsd) : undefined,
      error: t.error,
    })
  } catch (e) {
    console.error('[trace] failed', e)
  }
}
