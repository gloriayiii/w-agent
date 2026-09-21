import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  jsonb,
  integer,
  smallint,
  real,
  boolean,
  numeric,
  index,
} from 'drizzle-orm/pg-core'

/**
 * Conventions:
 * - Every time column is timestamptz storing UTC. Convert to Asia/Shanghai
 *   in exactly two places: rendering for a human, and quiet-hours checks.
 *   A bare `new Date()` used in a date comparison is always a bug here.
 * - `userId` exists but is hard-coded to 'gloria'. Do NOT write multi-tenant
 *   logic — the column costs nothing, the abstraction costs everything.
 * - `episodes` / embeddings are deliberately absent. A retrieval system with
 *   no data in it cannot be tuned. Add them after a few weeks of real
 *   conversation.
 */

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id').notNull().default('gloria'),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    // Idempotency key. Telegram re-delivers updates on webhook timeout;
    // the unique constraint turns a retry into a no-op insert.
    tgUpdateId: bigint('tg_update_id', { mode: 'number' }).unique(),
    tgMessageId: bigint('tg_message_id', { mode: 'number' }),
    // Assistant messages only: tone / bilingual / emotion / principle / factual.
    // `principle` and `factual` never enter the preference-learning loop.
    tags: text('tags').array(),
    // Merge-window bookkeeping: has this turn been answered yet?
    processed: boolean('processed').notNull().default(false),
  },
  (t) => [index('messages_ts_idx').on(t.ts)]
)

/** Structured facts extracted from conversation. Populated in phase 2. */
export const facts = pgTable('facts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: text('user_id').notNull().default('gloria'),
  subject: text('subject').notNull(),
  predicate: text('predicate').notNull(),
  value: text('value').notNull(),
  confidence: real('confidence').default(0.8),
  sourceId: bigint('source_id', { mode: 'number' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

/**
 * Preference signal. Telegram message reactions are the labelling UI —
 * a thumbs-up on one of W's replies lands here. No frontend required.
 */
export const feedback = pgTable('feedback', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  messageId: bigint('message_id', { mode: 'number' }).notNull(),
  signal: smallint('signal').notNull(), // +1 / -1
  ts: timestamp('ts', { withTimezone: true }).defaultNow(),
})

export const proactiveLog = pgTable('proactive_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  type: text('type').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
  content: text('content'),
  replied: boolean('replied').default(false),
  latencyS: integer('latency_s'),
  sentiment: real('sentiment'),
})

export const triggerState = pgTable('trigger_state', {
  type: text('type').primaryKey(),
  score: real('score').notNull().default(1.0),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
})

/**
 * The debugging lifeline.
 *
 * Store the FULL prompt, not a summary. You will absolutely ask "why did it
 * suddenly say that", and answering it requires seeing the exact {mood} and
 * night-policy text that were injected at the time.
 *
 * This is also what makes Vercel Hobby's short log retention a non-issue.
 */
export const traces = pgTable(
  'traces',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).defaultNow(),
    kind: text('kind').notNull(), // respond | gate | reflect | tool
    model: text('model'),
    systemPrompt: text('system_prompt'),
    input: jsonb('input'),
    output: text('output'),
    rawOutput: text('raw_output'), // pre-guard text, so you can see what it wanted to say
    latencyMs: integer('latency_ms'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    error: text('error'),
  },
  (t) => [index('traces_ts_idx').on(t.ts)]
)
