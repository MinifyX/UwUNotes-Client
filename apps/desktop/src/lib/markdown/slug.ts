/**
 * Heading anchors the way GitHub writes them.
 *
 * Lower case, punctuation dropped, spaces turned into hyphens, and a counter on
 * the second heading with the same text. Matching GitHub rather than inventing
 * a scheme is the whole point: a README's table of contents links to
 * `#installation` because that is what GitHub renders, and the preview has to
 * honour links that were written for GitHub.
 *
 * Letters and digits of every script survive, so `## Über uns` becomes
 * `über-uns` and not `ber-uns`.
 */

export function slugBase(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Hands out unique slugs for one document. A fresh one per render, because the
 * counters belong to the document and not to the app.
 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugBase(text);
    let slug = base;
    let count = seen.get(base) ?? 0;
    // `seen` also records the suffixed forms, so a heading literally called
    // "a-1" after two "a"s does not collide with the second "a".
    while (seen.has(slug)) {
      count += 1;
      slug = `${base}-${count}`;
    }
    seen.set(base, count);
    seen.set(slug, 0);
    return slug;
  };
}
