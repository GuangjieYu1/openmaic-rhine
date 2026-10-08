/**
 * Which owner partitions this deployment serves.
 *
 * A course document belongs to exactly one anonymous owner — the browser cookie
 * that created it — and every workbench route is scoped to that owner. That is
 * the right default for a multi-tenant install and the wrong one for a personal
 * deployment, where one person's library is spread across several `anon:`
 * partitions because a cookie was cleared, a second browser was used, or an
 * earlier build minted a fresh id. The symptom is not an error: the website's
 * archive simply shows a different subset of courses than the app does, and a
 * course the app lists answers 404 when opened from the website.
 *
 * `PERSISTENCE_OWNER_IDS` declares that set. With it set the classroom surface
 * stops being per-browser:
 *
 *   - listings are the UNION of every listed partition;
 *   - a read or write of an existing course resolves to the partition that
 *     actually owns it — from the global `stage_meta` row, which is keyed by
 *     stage id alone — so a course from any partition opens and stays editable;
 *   - a NEW course is created under the FIRST listed partition, so work started
 *     in any browser lands somewhere every browser can see.
 *
 * Unset, every function here degenerates to today's single-owner behaviour: the
 * request's own cookie owner, fanned out over a one-element list.
 *
 * WHY an environment list rather than a database role or a data migration: this
 * is a statement about one installation, not a property of the documents, so it
 * has to be reversible by editing the environment rather than by rewriting rows
 * — and a migration would have to move asset ownership with it.
 */

import { isOwnerId } from './owner-id';

/** Names the owner partitions this deployment serves, comma-separated. */
export const OWNER_SCOPE_ENV = 'PERSISTENCE_OWNER_IDS';

/**
 * Parse the configured list.
 *
 * Malformed entries are dropped rather than fatal, which is the opposite of
 * `REINLAB_OWNER_ID`'s posture: that variable pins a *read* surface, where
 * silently reading the wrong library is the failure mode, while this one widens
 * a *listing*. Refusing to boot over one bad entry would take the whole
 * classroom down; ignoring it leaves that one partition out and says so in the
 * log the caller emits.
 */
export function parseOwnerScope(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id === '' || seen.has(id) || !isOwnerId(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The partitions a request may see.
 *
 * With nothing configured this is exactly the request's own owner, so every
 * caller below behaves as it did before this module existed.
 */
export function resolveOwnerScope(
  requestOwnerId: string,
  raw: string | undefined | null = process.env[OWNER_SCOPE_ENV],
): string[] {
  const configured = parseOwnerScope(raw);
  return configured.length > 0 ? configured : [requestOwnerId];
}

/** Whether the deployment declared a scope at all. */
export function hasConfiguredOwnerScope(
  raw: string | undefined | null = process.env[OWNER_SCOPE_ENV],
): boolean {
  return parseOwnerScope(raw).length > 0;
}

/**
 * The partition a request should act under.
 *
 * `stageOwnerId` is what `stage_meta` says owns the course, or null when no
 * such course exists yet.
 *
 * An existing course keeps its own partition — but only while that partition is
 * one this deployment declared. Anything else falls back to the caller's own
 * owner, which is what keeps the scope a boundary rather than a bypass: naming
 * three partitions must not turn the server into a reader of a fourth.
 *
 * With no course yet, new work lands in the first declared partition so every
 * browser sees it; with nothing declared that is the caller's own owner, which
 * is where it would have gone anyway.
 */
export function resolveScopeOwner(options: {
  readonly scope: readonly string[];
  readonly requestOwnerId: string;
  readonly stageOwnerId: string | null;
}): string {
  const { scope, requestOwnerId, stageOwnerId } = options;
  if (stageOwnerId !== null) {
    return scope.includes(stageOwnerId) ? stageOwnerId : requestOwnerId;
  }
  return scope[0] ?? requestOwnerId;
}
