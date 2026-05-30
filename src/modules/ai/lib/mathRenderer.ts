import { invoke } from "@tauri-apps/api/core";

const MATH_BLOCK_RE = /\$\$([\s\S]*?)\$\$/g;
const MATH_INLINE_RE = /\$([^$]+)\$/g;

let renderCache = new Map<string, string>();

export function clearMathCache() {
  renderCache = new Map<string, string>();
}

/**
 * Normalize LaTeX math delimiters in a content string.
 * Converts \[...\] and \(...\) to $$...$$ and $...$ respectively.
 * Skips fenced and inline code spans to avoid mangling code examples.
 */
export function normalizeMathDelimiters(content: string | undefined): string | undefined {
  if (typeof content !== "string") return content;
  const parts = content.split(/(```[\s\S]*?```|`[^`]*`)/g);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$\n$1\n$$$$")
            .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$"),
    )
    .join("");
}

/**
 * Replace math blocks in content with rendered HTML.
 * Blocks not yet cached are rendered via the Tauri `render_latex` command.
 */
export async function renderMathInContent(content: string): Promise<string> {
  const normalized = normalizeMathDelimiters(content);
  if (!normalized) return content;

  // Split into code/non-code segments so regexes never touch fenced or
  // inline code spans. Segments at odd indices are verbatim code.
  const segments = normalized.split(/(```[\s\S]*?```|`[^`]*`)/g);

  // Collect math blocks only from non-code segments.
  const blocks: { raw: string; latex: string; display: boolean }[] = [];
  let m: RegExpExecArray | null;

  for (let si = 0; si < segments.length; si += 2) {
    const seg = segments[si];

    // Display math $$...$$
    MATH_BLOCK_RE.lastIndex = 0;
    while ((m = MATH_BLOCK_RE.exec(seg)) !== null) {
      blocks.push({ raw: m[0], latex: m[1].trim(), display: true });
    }

    // Inline math $...$ — mask display math first so inline regex
    // doesn't poke into $$ blocks.
    const withoutBlocks = seg.replace(MATH_BLOCK_RE, "\x00\x00\x00");
    MATH_INLINE_RE.lastIndex = 0;
    while ((m = MATH_INLINE_RE.exec(withoutBlocks)) !== null) {
      blocks.push({ raw: m[0], latex: m[1].trim(), display: false });
    }
  }
  // Bail early if no math blocks found
  if (blocks.length === 0) return normalized;

  // Render unique LaTeX strings via Tauri
  const uniqueLatex = [...new Set(blocks.map((b) => b.latex))];
  const cacheMisses = uniqueLatex.filter((l) => !renderCache.has(l));

  if (cacheMisses.length > 0) {
    await Promise.all(
      cacheMisses.map((latex) =>
        invoke<string>("render_latex", { latex, displayMode: false })
          .then((html) => renderCache.set(latex, html))
          .catch(() => {
            // On error, leave as raw text
            renderCache.set(latex, latex);
          }),
      ),
    );
  }

  // Replace blocks in reverse index order to preserve positions.
  // Replace each math block with a unique sentinel (left to right).
  // This handles duplicates correctly — each indexOf call finds the
  // next matching occurrence because prior ones have been replaced.
  let out = normalized;
  const sentinelMap: { marker: string; html: string }[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const rendered = renderCache.get(block.latex) ?? block.latex;
    const marker = `\x01KATEX_${i}\x01`;
    sentinelMap.push({
      marker,
      html: block.display
        ? `<div class="katex-display">${rendered}</div>`
        : rendered,
    });

    const idx = out.indexOf(block.raw);
    if (idx !== -1) {
      out = out.slice(0, idx) + marker + out.slice(idx + block.raw.length);
    }
  }

  // Replace sentinels with rendered HTML.
  for (const { marker, html } of sentinelMap) {
    out = out.split(marker).join(html);
  }

  return out;
}
