/**
 * Output post-processing.
 *
 * The persona card lists forbidden phrases, but models drift back into
 * assistant-speak over long conversations. This is the last line of defense:
 * on a hit, regenerate once; on a second hit, delete the offending sentence.
 *
 * Only catch unambiguous assistant-speak. Over-filtering kills normal
 * expression, which is worse than the occasional slip.
 */

const BANNED_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /当然可以[！!]/, why: 'assistant-speak opener' },
  { re: /很高兴(能)?(帮|为你)/, why: 'assistant-speak' },
  { re: /希望(这|对你)?.{0,6}有(所)?帮助/, why: 'assistant-speak closer' },
  { re: /作为一个?\s*(AI|人工智能|语言模型|助手)/, why: 'breaks persona' },
  { re: /^总的来说/m, why: 'written-register connective' },
  { re: /需要我.{0,10}(吗|么)[？?]\s*$/m, why: 'question-tagging every message' },
  { re: /你还好吗/, why: 'banned emotional-probe opener' },
  { re: /不是[^。！？\n]{1,12}，而是[^。！？\n]{1,12}/, why: 'not-X-but-Y parallelism' },
  // The A-or-B closer. The dominant failure mode in the first eval run:
  // 14 of 20 replies ended in a question, most of them this shape. It reads
  // as engaged but is actually deference — handing the judgement back to her
  // instead of holding one.
  // The `m` flag matters: replies are multi-bubble, so a bad closer often
  // sits at the end of a LINE, not the end of the string.
  {
    re: /是[^。！？!?\n]{1,16}还是[^。！？!?\n]{1,24}[。？?]?\s*$/m,
    why: 'A-or-B question as closer',
  },
  {
    re: /，还是[^。！？!?\n]{1,24}[。？?]?\s*$/m,
    why: 'A-or-B question as closer',
  },
  // Chat app, not a document. Markdown leaks in whenever it answers a
  // technical question and starts writing docs instead of talking.
  { re: /```|`[^`\n]+`/, why: 'markdown code formatting' },
  { re: /\*\*[^*\n]+\*\*/, why: 'markdown bold' },
  { re: /^\s*[-*+]\s+\S/m, why: 'markdown bullet list' },
  { re: /^\s*\d+[.)]\s+\S/m, why: 'numbered list' },
  { re: /\n[ \t]*\n/, why: 'blank line inside a message' },
]

export type GuardResult = {
  clean: boolean
  hits: string[]
}

/** Split on the bubble separator without any of splitMessages' fallbacks. */
function bubbles(text: string): string[] {
  return text
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Checks each bubble separately, not the concatenated text. A reply is
 * several chat messages: an end-anchored pattern has to anchor to the end
 * of a bubble, and a "blank line inside a message" check must not trip on
 * the blank lines around the `---` separator.
 */
export function checkOutput(text: string): GuardResult {
  const parts = bubbles(text)
  const hits = new Set<string>()
  for (const part of parts) {
    for (const p of BANNED_PATTERNS) {
      if (p.re.test(part)) hits.add(p.why)
    }
  }
  return { clean: hits.size === 0, hits: [...hits] }
}

/**
 * Fallback: after two failed regenerations, drop the offending sentences.
 *
 * Limitation: this splits by sentence, so it only removes patterns that fit
 * inside one sentence. The structural patterns (markdown lists, blank lines)
 * span lines and survive it — they exist to trigger the regeneration, which
 * is where they actually get fixed.
 */
export function stripBanned(text: string): string {
  return text
    .split(/(?<=[。！？\n])/)
    .filter((s) => !BANNED_PATTERNS.some((p) => p.re.test(s)))
    .join('')
    .trim()
}

/**
 * Length constraint: 1-3 bubbles, each short.
 * The model separates bubbles with a lone `---` line; everything below is
 * the fallback for when it forgets.
 */
export function splitMessages(text: string): string[] {
  const parts = text
    .split(/\n\s*---\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  // One long blob with no separators — chop it by sentence, max 3 bubbles.
  // Thresholds are tuned for Chinese: 90 CJK chars is already a wall of text
  // in a chat window.
  if (parts.length === 1 && parts[0].length > 90) {
    const sentences = parts[0].split(/(?<=[。！？!?])/).filter(Boolean)
    const chunks: string[] = []
    let cur = ''
    for (const s of sentences) {
      if ((cur + s).length > 50 && cur) {
        chunks.push(cur.trim())
        cur = s
      } else {
        cur += s
      }
    }
    if (cur.trim()) chunks.push(cur.trim())
    return chunks.slice(0, 3)
  }

  return parts.slice(0, 3)
}
