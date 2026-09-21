/**
 * Run the nightly reflection by hand, for testing or catching up.
 *   npm run reflect              -> yesterday
 *   npm run reflect -- 2026-09-20
 */
import { reflect } from '../lib/memory/reflect'

try {
  process.loadEnvFile('.env')
} catch {
  /* noop */
}

const arg = process.argv[2]
const target = arg ? new Date(`${arg}T12:00:00`) : undefined

reflect(target)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
