# CLAUDE.md

Context and constraints for AI assistants working in this repo.
Read this before making any change.

## What this is

A personal companion agent named **W**, reachable over Telegram, built for a
single user (Gloria). It is not a product, not multi-tenant, and not a
general-purpose assistant.

The entire point of the project is that W has a **specific personality** —
dry, sardonic on the surface but never evasive, sensitive to her mood, with
principles it will not move for her comfort. Most of the code in `lib/persona/`
exists to protect that. Generic-assistant behaviour is the failure mode this
codebase is built to prevent.

Current state: **Week 1 skeleton.** Conversation loop only.

## Hard invariants

Violating any of these is a bug even if the code is objectively cleaner.

### 1. `rules.ts` and `examples.ts` must stay separate

```
lib/persona/examples.ts   learnable     — tone, calibration, bilingual mixing
lib/persona/rules.ts      NOT learnable — night policy, quiet hours, quotas
```

`examples.ts` will later be rewritten automatically by high-scoring
conversations. `rules.ts` never will.

Do **not** merge them, re-export one through the other, or move constants
between them "for cohesion". At 2am the user rewards "keep me company" and
punishes "go to sleep"; if the night policy ever enters the feedback loop,
three months of that teaches W to only ever keep her up. The separation is
the safeguard.

Anything tagged `principle` or `factual` (see `NON_LEARNABLE_TAGS`) is
likewise excluded from preference learning. Do not "simplify" that list away.

### 2. Persona text stays in Chinese

Every code comment, doc, and UI string in this repo is English. These are
the exceptions, and they are deliberate:

- `lib/persona/card.ts` — `PERSONA_CARD` body
- `lib/persona/examples.ts` — `user` / `w` / `note` fields
- `lib/persona/rules.ts` — `NIGHT_INSTRUCTIONS` values
- `lib/persona/state.ts` — `inferMood()` return values, `renderState()` labels
- `lib/persona/build.ts` — prompt section headers
- `lib/agent/guard.ts` — the regexes (they match Chinese assistant-speak)
- `lib/agent/respond.ts` — the regeneration instruction
- `fixtures/regression.json` — `user` fields

These are prompt content, read by the model, not documentation. Translating
them changes W's voice. Never "fix" them for consistency.

### 3. Do not add what is deliberately absent

Not built yet, on purpose:

- memory layer / vector retrieval / `episodes` table
- any tool (calendar, timers, maps)
- the proactive message engine (`/api/tick` is an intentional stub)
- learned sleep schedules
- provider abstractions, base classes, dependency injection
- ESLint config, test framework beyond `npm run eval`
- auth beyond the `TELEGRAM_OWNER_CHAT_ID` check

One user, one surface. Hard-coding is correct here. If a task seems to need
one of these, say so and ask before building it.

### 4. Time handling

All timestamps are `timestamptz` storing UTC. Convert to `TZ_NAME`
(Asia/Shanghai) in exactly two places: rendering for a human, and
quiet-hours / night-policy checks. A bare `new Date()` used in a date
comparison is always a bug.

### 5. Prompt cache prefix

`buildSystemPrompt()` returns `{ stable, dynamic }`. `stable` carries the
Anthropic `cacheControl` breakpoint and must not vary per request. It is
currently ~2,000 tokens against a 1,024-token minimum — only 2x headroom.

If you shorten `card.ts` or drop examples, caching **silently** stops working
and per-turn cost rises ~10x with no error. Check the length after any cut.

## Things that look like bugs but are not

- **`await sleep(2500)` in the Telegram handler.** The merge window. Removing
  it makes W answer each bubble of a three-bubble message separately.
- **The `after()` + immediate 200 pattern.** Waiting for the LLM before
  returning causes a Telegram timeout, a redelivery, and a double reply.
- **`onConflictDoNothing` on `tg_update_id`.** Idempotency for those
  redeliveries. Not dead code.
- **No `parse_mode` on `sendMessage`.** W sends chat messages, not formatted
  documents; a markdown parse failure drops the whole message.
- **`userId` hard-coded to `'gloria'`.** The column exists so a future
  migration is cheap. Do not build multi-tenant logic on top of it.
- **No `temperature` parameter.** claude-sonnet-5 ignores it. Voice
  variance comes from the few-shot examples. Do not re-add it.
- **`inferMood()` is crude and rule-based.** An LLM call here would double
  per-turn cost for marginal gain. Leave it until there is data to calibrate
  against.
- **`trace()` swallows all errors.** Logging must never break a conversation.

## Required workflow

After **any** edit to `card.ts`, `examples.ts`, `rules.ts`, or `guard.ts`:

```bash
npm run eval -- --against evals/<most-recent>.json
```

Report which fixtures changed. Persona tuning is
two-steps-forward-one-step-back: a change that makes W less agreeable often
makes it needle her on days she is not okay. The regression set is the only
thing that catches this.

Before finishing any task:

```bash
npx tsc --noEmit
```

Do not commit unless asked. Do not upgrade dependencies unprompted.

## Commands

| Command | Purpose |
|---|---|
| `npm run eval` | Run the 20-fixture regression set (no DB needed) |
| `npm run eval -- --against <file>` | Same, plus a diff against an earlier run |
| `npm run db:push` | Apply schema to Neon |
| `npm run webhook:set` | Point Telegram's webhook at `PUBLIC_BASE_URL` |
| `npx tsc --noEmit` | Typecheck |
| `npm run dev` | Local Next.js server |

## Layout

```
app/api/telegram/  webhook: auth, idempotency, merge window, send
app/api/tick/      proactive heartbeat (stub until week 3)
app/trace/         internal debugging view, ?key=<CRON_SECRET>
lib/persona/       card / examples / rules / state / build
lib/agent/         respond (main loop) / router (model choice) / guard (output filter)
lib/telegram/      thin Bot API wrapper
lib/db/            drizzle schema + neon-http client
scripts/eval.ts    regression runner
fixtures/          the 20 regression cases
```

## When in doubt

Ask before: adding a dependency, adding an abstraction, changing anything in
`lib/persona/`, or touching the merge-window / idempotency logic.

Prefer the smallest change that works. This codebase is intentionally
under-engineered.
