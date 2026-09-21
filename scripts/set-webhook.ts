/**
 * Point the Telegram webhook at your deployment.
 * Re-run whenever the domain changes: npm run webhook:set
 *
 * Note: no top-level await here. tsx compiles this to CJS, where top-level
 * await is unavailable. It isn't needed anyway — lib/telegram/api.ts reads
 * TELEGRAM_BOT_TOKEN per call rather than at module load, so the hoisting of
 * this import above loadEnvFile() is harmless.
 */
import { setWebhook } from '../lib/telegram/api'

try {
  process.loadEnvFile('.env')
} catch {
  // CI passes env vars directly.
}

const base = process.env.PUBLIC_BASE_URL
const secret = process.env.TELEGRAM_WEBHOOK_SECRET

if (!base || !secret) {
  console.error('missing PUBLIC_BASE_URL or TELEGRAM_WEBHOOK_SECRET in .env')
  process.exit(1)
}

const url = `${base.replace(/\/$/, '')}/api/telegram`

setWebhook(url, secret)
  .then(() => console.log('webhook set ->', url))
  .catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
