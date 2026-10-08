/**
 * The two shapes an operator-supplied owner id may take.
 *
 * A cookie-derived owner — the case every owner override exists for — is NOT a
 * plain identifier: `resolveRequestOwnerId` returns `anon:<uuid-v4>`, and that
 * is what `document_stages.owner_id` actually holds. The `anon:` namespace is
 * therefore the *expected* input here, which is the opposite of
 * `lib/server/agent-runtime/shared-owner.ts`, where excluding it is the point
 * (a shared owner must not alias onto a cookie owner).
 *
 * The plain-identifier branch is kept because a deployment that does set
 * `PERSISTENCE_SHARED_OWNER_ID` pins the same value everywhere.
 *
 * Shared by `REINLAB_OWNER_ID` (the export surface) and
 * `PERSISTENCE_OWNER_IDS` (the classroom surface) so the two cannot drift into
 * accepting different spellings of the same partition.
 */

export const ANON_OWNER_PATTERN =
  /^anon:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A shared-owner-style id: characters that survive the material object key path. */
export const PLAIN_OWNER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Whether `value` names an owner this server is willing to read as. */
export function isOwnerId(value: string): boolean {
  return ANON_OWNER_PATTERN.test(value) || PLAIN_OWNER_PATTERN.test(value);
}
