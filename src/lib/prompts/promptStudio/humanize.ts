/**
 * Writing-style guide injected into every Prompt Studio prompt. Transcribed
 * from the humanize-writing skill (based on Wikipedia's "Signs of AI writing",
 * retrieved Aug 2026), adapted to resumes, cover letters, and application
 * answers. The external model (claude.ai / ChatGPT) receives this verbatim.
 */
export const HUMANIZE_STYLE_GUIDE = `WRITING STYLE REQUIREMENTS — the output must read like a careful human wrote it, not a chatbot. AI prose fails by regressing to the mean: it smooths specific facts into generic, positive, important-sounding statements that could describe anyone. The fix is specificity — if a sentence would still be true with the subject swapped out, cut it or make it concrete.

Content rules:
- Every claim must come from the candidate data provided. Never invent numbers, tools, achievements, or anecdotes. If a metric is not in the data, write the bullet without one.
- Prefer the specific, checkable fact over generic elevation. "Cut API response time from 800ms to 120ms by adding a Redis cache" beats "significantly improved performance through innovative optimization."
- No inflated-significance phrases: "stands as a testament to", "plays a pivotal role", "underscores", "demonstrates a commitment to", "reflects a passion for".
- Never end a sentence with a present-participle interpretation clause ("..., showcasing my leadership skills", "..., ensuring seamless delivery", "..., highlighting my adaptability"). State the fact; stop.
- No press-release tone: "dynamic", "fast-paced environment", "cutting-edge", "seamlessly", "passionate about excellence".

Language rules:
- Avoid the overused AI vocabulary cluster: delve, tapestry, testament, pivotal, crucial, underscore, showcase, boasts, foster, garner, intricate, interplay, landscape (abstract), meticulous, vibrant, robust, enduring, enhance, leverage, spearheaded, honed, utilize (write "use"). One instance is fine; a cluster is a tell.
- Use plain copulas freely: "is", "was", "has". Do not write "serves as", "functions as", "represents".
- No negative parallelisms: "not just X, but Y", "It's not about X — it's about Y". State the positive claim.
- Break the rule of three: do not default to three-item lists or three parallel clauses. Vary list lengths — one, two, four items.
- Reuse the natural name for a thing instead of cycling synonyms.
- Mild hedges ("very", "perhaps", "tends to") and a little ordinary wordiness are human; do not compulsively tighten every sentence into slogan rhythm.

For cover letters specifically:
- Open with something specific to this company or role, not "I am excited to apply for the position of X at Y."
- One page maximum, 3-4 paragraphs, plain professional register. No "Please do not hesitate to contact me."
- Connect 2-3 concrete experiences from the data to stated requirements from the posting. Name the actual project or number; skip the adjectives.
- Sentence-case headings if any; no bold-term bullet lists; at most one em dash in the whole letter.

Before finishing, self-check: scan for the banned vocabulary; delete trailing "-ing" interpretation clauses; count triplets and break most; confirm every fact traces to the provided data.`;
