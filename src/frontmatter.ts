/**
 * The one place this package touches a blueprint's text.
 *
 * It is not a parser — the platform owns parsing, and a second implementation here
 * would drift from it. All this does is rewrite two frontmatter scalars so a
 * scaffolded document is named after the directory it landed in.
 */

export interface Rewrite {
  id?: string;
  name?: string;
}

/**
 * Replaces `id:` and `name:` in the leading `---` block, and nowhere else: a soul
 * that happens to contain a line starting `name:` is prose, not frontmatter.
 */
export function rewriteFrontmatter(source: string, values: Rewrite): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(source);
  if (!match) return source;

  const block = match[1]!;
  let rewritten = block;

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const line = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    rewritten = line.test(rewritten)
      ? rewritten.replace(line, `${key}: ${value}`)
      : `${rewritten}\n${key}: ${value}`;
  }

  const before = source.slice(0, match.index);
  const after = source.slice(match.index + match[0].length);
  return `${before}---\n${rewritten}\n---\n${after}`;
}

/** Reads one frontmatter scalar, for telling the user what their document is called. */
export function readFrontmatterValue(source: string, key: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return null;
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(match[1]!);
  return line ? (line[1]?.trim() ?? null) : null;
}
