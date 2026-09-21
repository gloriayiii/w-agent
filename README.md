# W — Week 1 skeleton

Telegram in/out, persona card, dynamic state injection, full prompt tracing,
and a regression set.

**No memory layer, no tools, no proactive engine** — those are weeks 2–3.

The only goal this week: **make it not sound like an AI.**

---

## Step 0 — Local setup (10 min)

```bash
npm install
cp .env.example .env
```

Leave `.env` empty for now. Fill in one line each time you finish a step below.

---

## Step 1 — Neon database

1. Sign up at neon.tech, create a project. Pick **Singapore** or **US East**
   (close to Vercel's default `iad1` region).
2. In the connection string panel, **switch to "Pooled connection"** — the
   hostname must contain `-pooler`. A direct connection will exhaust Neon's
   connection limit under serverless within a day.
3. Paste it into `DATABASE_URL`.
4. Create the tables:

```bash
npm run db:push
```

`drizzle/0000_init.sql` is pre-generated if you'd rather paste it into Neon's
SQL editor directly.

---

## Step 2 — API keys

| Variable | Where |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys. $20 goes a long way |
| `DEEPSEEK_API_KEY` | platform.deepseek.com, top up ¥50 via Alipay |

Week 1 only uses Anthropic — DeepSeek is for the proactive gate and daily
reflection, neither of which exists yet. Set it up now anyway so you don't
have to context-switch later.

---

## Step 3 — Telegram bot

1. Message `@BotFather`, send `/newbot`, follow the prompts.
2. Copy the token into `TELEGRAM_BOT_TOKEN`.
3. Set an avatar and description while you're there (`/setuserpic`,
   `/setdescription`). It affects how the thing feels more than you'd expect.
4. Get your own chat id: message `@userinfobot` → `TELEGRAM_OWNER_CHAT_ID`.

   This is the **entire auth model**. Only this id gets processed; everything
   else is dropped on the floor.
5. Generate two secrets:

```bash
openssl rand -hex 32   # -> TELEGRAM_WEBHOOK_SECRET
openssl rand -hex 32   # -> CRON_SECRET
```

---

## Step 4 — Run the regression set (before deploying)

Do this **before** you deploy. The eval script never touches the database —
all it needs is `ANTHROPIC_API_KEY`:

```bash
npm run eval
```

It runs all 20 fixtures, prints each one, flags assistant-speak in red, and
saves the run to `evals/<timestamp>.json`.

After editing `lib/persona/card.ts` or `examples.ts`:

```bash
npm run eval -- --against evals/2026-09-20T....json
```

That prints **only** the fixtures whose output changed.

**This is the command you'll spend 90% of this week in.**

Why it has to exist up front: prompt tuning is two-steps-forward-one-step-
back. You add a line to make it less agreeable, and it starts needling you on
the days you're not okay. Without a regression set you won't catch that —
you'll find out the day it hurts.

---

## Step 5 — Deploy to Vercel

```bash
git init && git add -A && git commit -m "init"
gh repo create w-agent --private --source=. --push
```

Then vercel.com → Import Project → pick the repo.

**Copy every var from `.env` into Environment Variables** (except
`PUBLIC_BASE_URL`, which you won't know until the first deploy finishes).

Once deployed, put the domain into your local `.env` as `PUBLIC_BASE_URL` and:

```bash
npm run webhook:set
```

This points Telegram's webhook at `https://<domain>/api/telegram`. Re-run it
any time the domain changes.

---

## Step 6 — Say something

Message your bot in Telegram.

If nothing comes back, debug in this order:

```bash
# 1. Did the webhook register, and are errors piling up?
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

A non-empty `last_error_message` means your function threw — check
Vercel Dashboard → Deployments → Functions.

```
# 2. Read the traces
https://<your-domain>/trace?key=<CRON_SECRET>
```

Lists the last 50 calls. Expand one to see the **complete system prompt** that
was sent (including the injected `{mood}` and night-policy text), the raw
pre-guard output, latency, and cost.

You will ask "why did it suddenly say that". The answer is always in here.

---

## Step 7 — Cron heartbeat (not needed until week 3)

Sign up at cron-job.org → new job:

- URL: `https://<your-domain>/api/tick`
- Interval: every 15 minutes
- Header: `Authorization: Bearer <CRON_SECRET>`

`/api/tick` currently just returns a status JSON. Week 3 fills in the
proactive engine.

**Do not use Vercel Cron.** The Hobby plan caps cron jobs at once per day;
`*/15 * * * *` fails at deploy time with an explicit error.

---

## Then: the actual work

Loop on these three things until it feels like a person:

```
chat with it in Telegram  →  read /trace to see why it said that
        ↑                                 ↓
   npm run eval    ←    edit card.ts or examples.ts
```

### Where to edit what

| To change | Edit |
|---|---|
| Who it is, speech patterns, principles | `lib/persona/card.ts` |
| Specific calibration and tone | `lib/persona/examples.ts` ← **highest leverage** |
| Night policy, quiet hours, quotas | `lib/persona/rules.ts` ← **yours only, never learned** |
| Assistant-speak filters | `lib/agent/guard.ts` |
| Mood inference | `inferMood()` in `lib/persona/state.ts` |

`examples.ts` and `rules.ts` are kept apart on purpose. Once feedback data is
wired up, `examples.ts` gets rewritten by high-scoring conversations;
`rules.ts` never does.

That boundary is the agent's spine. At 2am you will reward "keep me company"
and punish "go to sleep" — without the separation, three months of that
teaches it to only ever keep you up.

---

## What's already handled

**Telegram redelivery.** The webhook returns 200 immediately and does the real
work in `after()`. `tg_update_id` has a unique constraint, so a redelivered
update is a no-op insert. Without this, slow generation causes a Telegram
timeout, a retry, and two replies to one message.

**Concurrent bubbles.** Real people send three messages two seconds apart;
serverless would answer each one separately with three concurrent instances.
So an incoming message waits 2.5s, checks whether a newer unprocessed message
exists, and bails if so. The last one picks up the whole batch. Side benefit:
it no longer replies instantly, which reads as more human, not less.

**Prompt caching.** Persona card + few-shot is a stable ~2,000-token prefix,
reused every turn at 0.1x input cost.
⚠️ Anthropic's minimum cacheable prefix is 1,024 tokens, so there's only 2x
headroom. Trim the persona card aggressively and caching **silently** stops
working and costs jump 10x. Check the length before you cut.

**Multi-bubble output.** The model separates bubbles with a lone `---` line.
They're sent with a pause and a fresh typing indicator between them, and
there's a sentence-level fallback for when the model forgets the separator.

**Guard with regeneration.** On an assistant-speak hit, it regenerates once
with the specific violation named; a second hit strips the offending
sentences. The original is preserved in `traces.raw_output`, so you can see
what it wanted to say.

---

## Deliberately not built (don't add these yet)

- **Memory layer / vector retrieval** — a retrieval system with no data in it
  cannot be tuned
- **Any tool** — until the persona works, tools just produce a competent AI
- **Proactive messages** — they amplify whatever is wrong with the persona
- **Learned sleep schedule** — quiet hours stay hard-coded
- **Any abstraction** — one user, one surface. Hard-code it.

---

## Cost

At ~80 turns/day with Sonnet only, roughly **$14/month**. Neon and Vercel stay
inside free tiers. This week your actual spend is a few dozen eval runs at
~$0.20 each.
