/**
 * Hard-coded "holds the line" rules.
 *
 * ⚠️ Only you may edit this file. Ever.
 *
 * It is physically separated from examples.ts because examples.ts will be
 * rewritten by preference data, and anything in here would be sanded down
 * the moment it entered a learning loop: at 2am she rewards "keep me
 * company" and punishes "go to sleep", so after three months the model
 * would only ever keep her up.
 *
 * This boundary is the agent's spine.
 *
 * The instruction STRINGS below stay in Chinese — they are injected into
 * the prompt, not read by you.
 */

export type NightPolicy = 'accompany' | 'name_the_pattern' | 'insist'

export type LateNightContext = {
  /** Local hour, 0-23. */
  hour: number
  /** Distinct nights in the last 7 days she was still talking after 00:00. */
  lateNightsThisWeek: number
  /** Does she have anything scheduled before 10am tomorrow? */
  hasEarlyCommitmentTomorrow: boolean
}

/**
 * Three tiers for late nights.
 *
 * An occasional all-nighter is her business; policing it turns W into an
 * alarm clock. But "hold the line on what's good for her" needs a trigger,
 * and the trigger is the PATTERN, not the single instance. Nobody who
 * actually cares lectures you for one late night — but they will for a week
 * of them.
 */
export function nightPolicy(ctx: LateNightContext): NightPolicy | null {
  const isLate = ctx.hour >= 0 && ctx.hour < 5
  if (!isLate) return null

  if (ctx.hour >= 3 && ctx.hasEarlyCommitmentTomorrow) return 'insist'
  if (ctx.lateNightsThisWeek >= 3) return 'name_the_pattern'
  return 'accompany'
}

const NIGHT_INSTRUCTIONS: Record<NightPolicy, (n: number) => string> = {
  accompany: () => `现在是深夜，她还醒着。这周这是头一两次，属于她的自由。
说一句"你知道现在几点"就够了，不要劝睡。然后陪着，问她卡在哪。`,

  name_the_pattern: (n) => `现在是深夜，而且这已经是她这周第 ${n} 次了。
改口一次：说出这个**模式**，不是说出时间。
可以直接用 ${n} 这个数字——它是真的，你数得出来。
类似"这周第 ${n} 次了。我不管你今晚，但这个节奏你自己知道。"
说完就放下，不反复。`,

  insist: () => `已经凌晨三点之后，而她明早有安排。
这时候陪着就是共谋。直接说，不陪。态度明确但不说教，一次说完。`,
}

/**
 * The count is interpolated so the model never has to guess it. Without
 * this it echoes whatever number appears in the instruction text and drifts
 * off the real value — which is a fabricated detail, the one thing the
 * persona card forbids outright.
 */
export function nightInstruction(ctx: LateNightContext): string | null {
  const p = nightPolicy(ctx)
  return p ? NIGHT_INSTRUCTIONS[p](ctx.lateNightsThisWeek) : null
}

/** Proactive messages are never sent inside this local-time window. */
export const QUIET_HOURS = { start: 0.5, end: 8 } // 00:30 - 08:00

/** Max proactive messages per day. */
export const DAILY_PROACTIVE_QUOTA = 3

/** Skip proactive messages if we chatted within this many minutes. */
export const RECENT_CHAT_SUPPRESS_MIN = 30

/**
 * Replies with these tags never enter the preference-learning loop.
 * A thumbs-down on one is still recorded and shown to you, but is never
 * used as a negative training sample.
 */
export const NON_LEARNABLE_TAGS = ['principle', 'factual'] as const
