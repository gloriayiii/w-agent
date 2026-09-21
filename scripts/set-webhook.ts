/**
 * Point the Telegram webhook at your deployment.
 * Re-run whenever the domain changes: npm run webhook:set
 */
// Load .env FIRST. Static imports are hoisted above every statement, so any
// module that reads process.env at load time would otherwise see nothing.
// The lazy accessors make this safe either way, but the order still matters
// for anything added later.
try {
  process.loadEnvFile('.env')
} catch {
  // noop
}

export {} // makes this a module, so top-level await is allowed

const { setWebhook } = await import('../lib/telegram/api')

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
