import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the package's own files live.
 *
 * `templates/` sits at the package root, one level above both `src/` and `dist/`,
 * so walking up to the directory that holds `package.json` finds it whether the
 * caller is running the compiled bin or vitest against the source.
 */
export function packageRoot(from: string = fileURLToPath(import.meta.url)): string {
  let dir = dirname(from);
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the package root from this module.');
}

export function templatePath(name: string): string {
  return join(packageRoot(), 'templates', `${name}.md`);
}

/**
 * A blueprint id and a directory name are the same shape of thing — lower case,
 * dashes, no leading digit-only mush — so one function makes both.
 */
export function toBlueprintId(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'my-agent';
}

/** `inbox-triage` → `Inbox Triage`, which is what belongs in `name:`. */
export function toDisplayName(id: string): string {
  return id
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function resolveTarget(cwd: string, target: string | undefined): string {
  return target === undefined || target === '.' ? cwd : resolve(cwd, target);
}
