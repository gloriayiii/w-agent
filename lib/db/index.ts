import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/**
 * Lazily initialised.
 *
 * `neon()` throws immediately when DATABASE_URL is missing. Next.js
 * evaluates every route module during its "Collecting page data" build
 * step, so a top-level `neon(process.env.DATABASE_URL!)` turns a missing
 * env var into a BUILD failure — which is both confusing and wrong: the
 * build has no business needing a database.
 *
 * With the proxy below, the client is constructed on first actual query.
 * Builds never touch it, and a missing env var surfaces at request time
 * with a message that says which variable is missing.
 */
let instance: NeonHttpDatabase<typeof schema> | null = null

function getDb(): NeonHttpDatabase<typeof schema> {
  if (!instance) {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables (use the POOLED Neon connection string), then redeploy.'
      )
    }
    instance = drizzle(neon(url), { schema })
  }
  return instance
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>
    const value = real[prop]
    return typeof value === 'function' ? value.bind(real) : value
  },
})

export * from './schema'
