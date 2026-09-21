import { PERSONA_CARD } from './card'
import { EXAMPLES, renderExamples } from './examples'
import { renderState, type PersonaState } from './state'

/**
 * Assemble the system prompt.
 *
 * Order matters:
 *   [stable prefix  — cached]  persona card + few-shot
 *   [dynamic suffix — per-call] current state
 *
 * The cache breakpoint sits between the two. The stable half is ~2k tokens;
 * with caching, its per-turn cost drops 10x (cache reads bill at 0.1x input).
 *
 * ⚠️ Anthropic's minimum cacheable prefix is 1024 tokens. If you trim the
 * persona card heavily, caching silently stops working and costs jump.
 * Check the length before you cut.
 */
export function buildSystemPrompt(state: PersonaState) {
  const stable = `${PERSONA_CARD}

# 对话样例

下面是你应该怎么说话的例子。注意分寸，不要照抄内容。

${renderExamples(EXAMPLES)}`

  const dynamic = `# 现在的情况

${renderState(state)}`

  return { stable, dynamic }
}
