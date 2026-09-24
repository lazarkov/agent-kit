/**
 * The one place this package touches a blueprint's text.
 *
 * It is not a parser: the platform owns parsing, and a second implementation here
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

  const rewritten = rewriteScalars(match[1]!, values);
  const before = source.slice(0, match.index);
  const after = source.slice(match.index + match[0].length);
  return `${before}---\n${rewritten}\n---\n${after}`;
}

/**
 * The same rewrite on a bare YAML block, which is what a project's manifest is:
 * `agent.yaml` holds exactly what a document would put between the `---` lines.
 */
export function rewriteScalars(block: string, values: Rewrite): string {
  let rewritten = block;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const line = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    rewritten = line.test(rewritten)
      ? rewritten.replace(line, `${key}: ${value}`)
      : `${rewritten}\n${key}: ${value}`;
  }
  return rewritten;
}

/** One scalar out of a bare YAML block, for telling a reader what they just made. */
export function readScalar(block: string, key: string): string | null {
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(block);
  return line ? (line[1]?.trim() ?? null) : null;
}

/** Reads one frontmatter scalar, for telling the user what their document is called. */
export function readFrontmatterValue(source: string, key: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) return null;
  const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(match[1]!);
  return line ? (line[1]?.trim() ?? null) : null;
}
