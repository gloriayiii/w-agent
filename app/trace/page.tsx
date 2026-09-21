import { desc } from 'drizzle-orm'
import { db, traces } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TZ = process.env.TZ_NAME || 'Asia/Shanghai'

function fmt(d: Date | null) {
  if (!d) return ''
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

/**
 * Internal debugging view. Gated by CRON_SECRET in the query string —
 * crude, but this is a single-user system and a real auth layer would be
 * the kind of premature abstraction the README warns about.
 */
export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>
}) {
  const { key } = await searchParams
  if (key !== process.env.CRON_SECRET) {
    return (
      <main style={{ padding: 40, fontFamily: 'monospace' }}>
        Append ?key=&lt;CRON_SECRET&gt;
      </main>
    )
  }

  const rows = await db.select().from(traces).orderBy(desc(traces.id)).limit(50)

  return (
    <main
      style={{
        padding: '24px 32px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.6,
        maxWidth: 1000,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: 18, marginBottom: 20 }}>traces (last 50)</h1>
      {rows.map((r) => (
        <details
          key={r.id}
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 10,
          }}
        >
          <summary style={{ cursor: 'pointer' }}>
            <span style={{ opacity: 0.5 }}>{fmt(r.ts)}</span> <b>{r.kind}</b>{' '}
            <span style={{ opacity: 0.6 }}>{r.model}</span>{' '}
            <span style={{ opacity: 0.5 }}>{r.latencyMs}ms</span>{' '}
            <span style={{ opacity: 0.5 }}>
              ${Number(r.costUsd ?? 0).toFixed(5)}
            </span>
            {r.error ? <span style={{ color: 'crimson' }}> ERROR</span> : null}
            <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {(r.output ?? r.error ?? '').slice(0, 160)}
            </div>
          </summary>

          <Section title="final output" body={r.output} />
          {r.rawOutput && r.rawOutput !== r.output ? (
            <Section title="raw output (pre-guard)" body={r.rawOutput} />
          ) : null}
          <Section title="input" body={JSON.stringify(r.input, null, 2)} />
          <Section title="system prompt (full)" body={r.systemPrompt} />
          {r.error ? <Section title="error" body={r.error} /> : null}
        </details>
      ))}
    </main>
  )
}

function Section({ title, body }: { title: string; body?: string | null }) {
  if (!body) return null
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ opacity: 0.55, marginBottom: 4 }}>{title}</div>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#f6f6f6',
          padding: 10,
          borderRadius: 4,
          margin: 0,
          maxHeight: 400,
          overflow: 'auto',
        }}
      >
        {body}
      </pre>
    </div>
  )
}
