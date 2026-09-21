/**
 * Point the Telegram webhook at your deployment.
 * Re-run whenever the domain changes: npm run webhook:set
 */
import { setWebhook } from '../lib/telegram/api'

try {
  process.loadEnvFile('.env')
} catch {
  // noop
}

const base = process.env.PUBLIC_BASE_URL
const secret = process.env.TELEGRAM_WEBHOOK_SECRET

if (!base || !secret) {
  console.error('missing PUBLIC_BASE_URL or TELEGRAM_WEBHOOK_SECRET')
  process.exit(1)
}

const url = `${base.replace(/\/$/, '')}/api/telegram`

setWebhook(url, secret)
  .then(() => console.log('webhook set ->', url))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
