/**
 * The REINLAB export surface — the read-only course API the iPad app reads.
 *
 * WHY this exists beside `/api/stages`: the workbench routes are browser
 * routes. They partition courses by the `anonymous_id` cookie, they are gated
 * by the agent runtime, and they answer with the app's own response envelope.
 * The iPad is not a browser on this origin: it sends no cookie, it cannot hold
 * the `ACCESS_CODE` cookie `middleware.ts` checks, and it must be able to
 * probe whether the Mac is reachable at all before it decides to run from its
 * offline cache. So this module owns the four things that differ — CORS, an
 * export token, an owner override, and a media manifest — while the reads
 * themselves go through the same owner-bound document store the workbench uses.
 *
 * Everything here is deliberately pure except the two seams that must not be:
 * `withReinlabRequest` resolves the owner, and the routes call the store. The
 * rest (origin decisions, token comparison, owner validation, manifest
 * building) is a function of its arguments and `process.env`, so the tests can
 * pin the whole contract without a database.
 */
import { timingSafeEqual } from 'node:crypto';

import { enumerateAssetManifest, type AssetKind } from '@openmaic/dsl';
import type { DocumentSummary, MaicDocument } from '@openmaic/storage';
import { NextResponse, type NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import type { AppStage } from '@/lib/document-store/persistence-types';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import type { AppScene } from '@/lib/types/stage';

/** The contract version this surface speaks. The client pins it against `health`. */
export const REINLAB_API_VERSION = 1;

/** Gates every route except the health probe. Unset means "no token required". */
const EXPORT_TOKEN_ENV = 'REINLAB_EXPORT_TOKEN';

/** Pins the export surface to one owner id. See {@link resolveReinlabOwnerOverride}. */
const OWNER_OVERRIDE_ENV = 'REINLAB_OWNER_ID';

/** Extra browser origins allowed to call this surface, comma-separated. */
const ALLOWED_ORIGINS_ENV = 'REINLAB_ALLOWED_ORIGINS';

/**
 * The two shapes `REINLAB_OWNER_ID` may take.
 *
 * A cookie-derived owner — the case this variable exists for — is NOT a plain
 * identifier: `resolveRequestOwnerId` returns `anon:<uuid-v4>`, and that is what
 * `document_stages.owner_id` actually holds. The `anon:` namespace is therefore
 * the *expected* input here, which is the opposite of
 * `lib/server/agent-runtime/shared-owner.ts`, where excluding it is the point
 * (a shared owner must not alias onto a cookie owner). Copying that pattern
 * verbatim made the one configuration this surface is documented to need fail
 * with a 500: `REINLAB_OWNER_ID=anon:<uuid>` was rejected as malformed.
 *
 * The plain-identifier branch is kept because a deployment that does set
 * `PERSISTENCE_SHARED_OWNER_ID` would pin the same value here.
 */
const ANON_OWNER_PATTERN =
  /^anon:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A shared-owner-style id: characters that survive the material object key path. */
const PLAIN_OWNER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Whether `value` names an owner this surface is willing to read as. */
export function isReinlabOwnerId(value: string): boolean {
  return ANON_OWNER_PATTERN.test(value) || PLAIN_OWNER_PATTERN.test(value);
}

/** The course id shape this surface accepts; validated before any store read. */
const COURSE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The Capacitor WebView origins (`ionic://` is its predecessor's scheme). */
const CAPACITOR_SCHEMES = new Set(['capacitor:', 'ionic:']);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

/**
 * Normalize one origin for comparison.
 *
 * `URL.origin` is the opaque string `"null"` for a non-special scheme, which
 * would make every `capacitor://…` entry collide with every other one — and
 * with any other non-special origin. Falling back to `protocol//host` keeps
 * those origins distinct.
 */
function normalizeOrigin(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.origin !== 'null') return parsed.origin;
  return parsed.host ? `${parsed.protocol}//${parsed.host}` : null;
}

/** The operator's extra origins, normalized. Unparseable entries grant nothing. */
function configuredReinlabOrigins(): ReadonlySet<string> {
  const configured = new Set<string>();
  for (const entry of (process.env[ALLOWED_ORIGINS_ENV] ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = normalizeOrigin(trimmed);
    if (normalized) configured.add(normalized);
  }
  return configured;
}

/**
 * Whether one IPv4 literal is loopback or private-LAN.
 *
 * The check runs on the hostname `new URL` produced, not on the raw header:
 * the parser has already collapsed the alternative IPv4 spellings
 * (`127.1`, `0x7f.1`) onto the dotted-quad form, so a comparison here cannot
 * be walked past the way a substring test on the header could.
 */
function isPrivateLanIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  if (octets.length !== 4) return false;
  const values: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    if (value > 255) return false;
    values.push(value);
  }
  const [first, second] = values as [number, number, number, number];
  if (first === 127) return true; // 127.0.0.0/8 — the loopback block.
  if (first === 10) return true; // 10.0.0.0/8
  if (first === 192 && second === 168) return true; // 192.168.0.0/16
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  return false;
}

/**
 * Whether a request's `Origin` may be echoed back in `Access-Control-Allow-Origin`.
 *
 * The rules are the ones a LAN-hosted iPad needs and nothing wider: the two
 * Capacitor WebView origins, `localhost` on http/https (the Mac's own browser,
 * for `whoami`), an IPv4 loopback or private-LAN literal, and whatever the
 * operator listed in `REINLAB_ALLOWED_ORIGINS` (exact origin match, so a listed
 * `http://localhost` does not silently cover every port of every host).
 *
 * An absent Origin is not allowed: it means a non-browser caller, which needs
 * no CORS grant at all. Comparison is `protocol`+`hostname` on the parsed URL,
 * never a substring test on the header — `http://localhost.evil.com` parses to
 * hostname `localhost.evil.com` and is refused.
 */
export function isReinlabOriginAllowed(origin: string | null | undefined): boolean {
  const raw = origin?.trim();
  if (!raw) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  const normalized = normalizeOrigin(raw);
  if (normalized && configuredReinlabOrigins().has(normalized)) return true;

  if (CAPACITOR_SCHEMES.has(parsed.protocol) && parsed.hostname === 'localhost') return true;

  // Every remaining rule is an http(s) origin; any port is allowed for them.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'localhost') return true;
  return isPrivateLanIpv4(parsed.hostname);
}

/**
 * The CORS headers for one request.
 *
 * `Access-Control-Allow-Origin` echoes the caller's own Origin rather than
 * `*`: the export surface may later need to accept credentials, and a browser
 * refuses a wildcard grant on a credentialed request. When the origin is not
 * allowed the header is omitted entirely — the response itself still answers,
 * a browser just cannot read it.
 */
export function reinlabCorsHeaders(req: Pick<Request, 'headers'>): Headers {
  const headers = new Headers();
  const origin = req.headers.get('origin');
  if (isReinlabOriginAllowed(origin)) {
    headers.set('Access-Control-Allow-Origin', origin!.trim());
  }
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Max-Age', '600');
  headers.set('Vary', 'Origin');
  return headers;
}

/** The CORS preflight every route answers. A preflight carries no token, so it is never gated. */
export function reinlabPreflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: reinlabCorsHeaders(req) });
}

/** A JSON body under fresh CORS headers, for the routes that resolve no owner. */
export function reinlabJson(req: NextRequest, body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: reinlabCorsHeaders(req) });
}

/** The error codes this surface's own envelope uses. */
export type ReinlabErrorCode = 'UNAUTHORIZED' | 'INVALID_REQUEST' | 'INTERNAL_ERROR';

/**
 * The frozen error envelope: `{ error: { code, message } }`.
 *
 * This is intentionally not the app's `apiError` envelope
 * (`{ success: false, errorCode, error }`): the iPad client is written against
 * this shape, and it is the only one the export contract promises.
 */
export function reinlabError(
  code: ReinlabErrorCode,
  status: number,
  message: string,
  headers: Headers,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

// ---------------------------------------------------------------------------
// Export token
// ---------------------------------------------------------------------------

/** The configured export token, or null when the gate is off. */
export function reinlabExportToken(): string | null {
  const raw = process.env[EXPORT_TOKEN_ENV]?.trim();
  return raw ? raw : null;
}

/** Every token the request presents, in the order the contract documents them. */
function readTokenCandidates(req: Pick<Request, 'url' | 'headers'>): string[] {
  const candidates: string[] = [];

  const authorization = req.headers.get('authorization')?.trim();
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    const token = bearer?.[1]?.trim();
    if (token) candidates.push(token);
  }

  try {
    const queryToken = new URL(req.url).searchParams.get('token')?.trim();
    if (queryToken) candidates.push(queryToken);
  } catch {
    // A request whose URL cannot be parsed simply carries no query token.
  }

  return candidates;
}

/** Constant-time string comparison that cannot throw on unequal lengths. */
function timingSafeEquals(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws unless both buffers are the same length, so the
  // guard has to come first.
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

/**
 * Whether the request may use the export surface.
 *
 * `REINLAB_EXPORT_TOKEN` unset (or blank) allows every request. That is the
 * documented local-development convenience: on a laptop on the same trusted
 * network, requiring a shared secret to read your own courses buys nothing,
 * and an operator who wants the gate sets the variable. A blank value is how
 * `KEY=` in an env file reads, so it is treated as unset rather than as an
 * empty token nobody could ever present.
 *
 * The token is accepted as `Authorization: Bearer <token>` or as the `token`
 * query parameter, because a Capacitor `fetch` can set headers but a media
 * element or a WebView navigation cannot.
 */
export function isReinlabExportTokenAccepted(req: Pick<Request, 'url' | 'headers'>): boolean {
  const expected = reinlabExportToken();
  if (!expected) return true;

  let accepted = false;
  // Every candidate is compared, with no early return: the work the request
  // performs must not depend on which parameter carried a matching token.
  for (const candidate of readTokenCandidates(req)) {
    if (timingSafeEquals(candidate, expected)) accepted = true;
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Owner override
// ---------------------------------------------------------------------------

/**
 * The owner id `REINLAB_OWNER_ID` pins this surface to, or null when unset.
 *
 * WHY an override exists at all: without `PERSISTENCE_SHARED_OWNER_ID` an owner
 * is a per-browser cookie, so the Mac's browser owns the courses and an iPad
 * sending no cookie would resolve to a fresh anonymous owner and see an empty
 * library. The operator discovers the Mac browser's id by opening
 * `/api/reinlab/whoami` there and pins it here, so the export surface reads
 * that one library regardless of what the caller's cookie says.
 *
 * A malformed value throws rather than falling back to the request-derived
 * owner: silently reading the wrong (usually empty) library is exactly the
 * confusion this setting exists to remove. `withReinlabRequest` maps the throw
 * onto a 500 that names the variable.
 *
 * WHY a comma-separated LIST and not one id: an owner is a per-browser cookie,
 * so a course library that has been used from more than one browser partition
 * is genuinely spread across several owner ids — this machine holds three
 * courses under three different `anon:` owners. Pinning one id would show one
 * third of the library with no explanation of where the rest went. Accepting a
 * list lets the operator name every partition the iPad should read, which is
 * the honest description of the situation rather than a single id pretending
 * to be the whole library.
 */
export function resolveReinlabOwnerOverrides(): string[] | null {
  const raw = process.env[OWNER_OVERRIDE_ENV]?.trim();
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (!isReinlabOwnerId(part)) {
      throw new Error(
        `${OWNER_OVERRIDE_ENV} entries must be an anonymous owner id ("anon:" + UUID v4, the ` +
          `value GET /api/reinlab/whoami reports) or 1-128 characters of [A-Za-z0-9._-], got ` +
          `${JSON.stringify(part)}. Separate several ids with commas.`,
      );
    }
  }
  // Duplicates would read the same store twice and emit each course twice.
  return [...new Set(parts)];
}

/**
 * The first configured owner id, or null when the override is unset.
 *
 * `whoami` reports it as the headline id and the route tests exercise the
 * single-id case through it; the routes themselves read
 * {@link resolveReinlabOwnerOverrides} so a multi-partition library works.
 */
export function resolveReinlabOwnerOverride(): string | null {
  return resolveReinlabOwnerOverrides()?.[0] ?? null;
}

/** Where the effective owner id came from, as `whoami` reports it. */
export type ReinlabOwnerSource = 'override' | 'shared' | 'cookie';

/** Classify the effective owner. The override wins over a shared owner. */
export function reinlabOwnerSource(configuredOwnerId: string | null): ReinlabOwnerSource {
  if (configuredOwnerId) return 'override';
  if (process.env.PERSISTENCE_SHARED_OWNER_ID?.trim()) return 'shared';
  return 'cookie';
}

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------

/** Everything one REINLAB route handler needs from the request envelope. */
export interface ReinlabRequestContext {
  /** What `withRequestOwnerId` resolved for THIS request (cookie or shared owner). */
  readonly requestOwnerId: string;
  /** The validated `REINLAB_OWNER_ID`, or null when the override is unset. */
  readonly configuredOwnerId: string | null;
  /** The first configured owner, for `whoami`'s headline answer. */
  readonly ownerId: string;
  /** The configured list exactly as the operator wrote it, or null when unset. */
  readonly configuredOwnerIds: readonly string[] | null;
  /**
   * Every owner whose courses this request may read: the configured list, else
   * just the request's own owner. Routes iterate this and merge the results.
   */
  readonly ownerIds: readonly string[];
  readonly source: ReinlabOwnerSource;
  /** The owner-resolution headers (a freshly minted Set-Cookie) plus the CORS headers. */
  readonly responseHeaders: Headers;
}

export interface ReinlabRouteOptions {
  /**
   * The route describes persisted courses, so it requires durable storage.
   * Off, it answers the repo's plain 404 instead of reaching a store that
   * cannot connect — see the gate in {@link withReinlabRequest}.
   */
  readonly requiresPersistence?: boolean;
}

/** A human-readable message for anything that can be thrown. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Run one export route handler under CORS, the token gate and owner resolution.
 *
 * Order matters and mirrors the repo's other owner-scoped routes: the request
 * is authenticated before an owner is resolved, because resolving an owner can
 * mint an anonymous cookie and a request that will not proceed must not create
 * a partition. Every exit path — including the 401, the 404 and both 500s —
 * carries the CORS headers, since a browser client cannot read an error it was
 * not allowed to see.
 *
 * @param options.requiresPersistence Courses routes only; see the option docs.
 */
export async function withReinlabRequest(
  req: NextRequest,
  handler: (context: ReinlabRequestContext) => Promise<Response>,
  options: ReinlabRouteOptions = {},
): Promise<Response> {
  const cors = reinlabCorsHeaders(req);

  if (!isReinlabExportTokenAccepted(req)) {
    return reinlabError(
      'UNAUTHORIZED',
      401,
      `a valid ${EXPORT_TOKEN_ENV} is required (Authorization: Bearer <token> or ?token=)`,
      cors,
    );
  }

  if (options.requiresPersistence && !isServerPersistenceConfigured()) {
    // The repo's posture for a course-describing route on a deployment with no
    // DATABASE_URL: the same plain 404 the agent-runtime routes answer, so a
    // process without storage never reaches a store that cannot connect. The
    // iPad learns the real reason from `/api/reinlab/health`, which reports
    // `persistence: false` — that probe is exactly what it is for.
    return new NextResponse('Not found', { status: 404, headers: cors });
  }

  let configuredOwnerIds: string[] | null;
  try {
    configuredOwnerIds = resolveReinlabOwnerOverrides();
  } catch (error) {
    return reinlabError('INTERNAL_ERROR', 500, errorMessage(error), cors);
  }
  const configuredOwnerId = configuredOwnerIds?.[0] ?? null;

  try {
    return await withRequestOwnerId(req, async (requestOwnerId, responseHeaders) => {
      // The CORS grant rides the same Headers object the owner seam hands the
      // handler, so every response built from it — JSON, 404, 4xx — carries it.
      for (const [name, value] of cors) responseHeaders.set(name, value);
      return handler({
        requestOwnerId,
        configuredOwnerId,
        ownerId: configuredOwnerId ?? requestOwnerId,
        configuredOwnerIds,
        ownerIds: configuredOwnerIds ?? [requestOwnerId],
        source: reinlabOwnerSource(configuredOwnerId),
        responseHeaders,
      });
    });
  } catch (error) {
    // Only owner resolution can throw past `withRequestOwnerId` (a malformed
    // PERSISTENCE_SHARED_OWNER_ID, or that setting without ACCESS_CODE); a
    // handler failure is already mapped to a plain 500 inside it. The contract
    // still wants a readable JSON body under the CORS headers.
    console.error('[reinlab] owner resolution failed', error);
    return reinlabError('INTERNAL_ERROR', 500, errorMessage(error), cors);
  }
}

/** Whether a course id has the shape this surface accepts. */
export function isReinlabCourseId(value: string): boolean {
  return COURSE_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Course metadata
// ---------------------------------------------------------------------------

/** One row of `GET /api/reinlab/courses`. */
export interface ReinlabCourseSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly sceneCount: number;
  /** Epoch milliseconds, exactly as the store returns them — never a Date. */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly folderId?: string;
}

/**
 * The course list, newest first.
 *
 * The store's summaries are mapped field by field rather than spread: the
 * summary also carries `interactiveMode` / `taskEngineMode`, which this
 * contract does not publish, and an absent `description`/`folderId` must be
 * omitted rather than sent as null.
 */
export function toReinlabCourseSummaries(
  summaries: readonly DocumentSummary[],
): ReinlabCourseSummary[] {
  return [...summaries]
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        // Ties break on id so two documents saved in the same millisecond still
        // come back in a stable order.
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .map((summary) => ({
      id: summary.id,
      name: summary.name,
      ...(summary.description !== undefined ? { description: summary.description } : {}),
      sceneCount: summary.sceneCount,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      ...(summary.folderId !== undefined ? { folderId: summary.folderId } : {}),
    }));
}

/** The `course` object of `GET /api/reinlab/courses/{id}`. */
export interface ReinlabCourseDetail {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sceneCount: number;
  readonly stage: AppStage;
  readonly scenes: AppScene[];
  readonly dslVersion?: string;
}

/**
 * One course, its list metadata and its document in a single object.
 *
 * The metadata comes from the matching summary so a client that listed courses
 * and then fetched one sees identical values; the stage, scenes and DSL version
 * come from the loaded document. A summary that is missing (a store whose
 * listing and load scopes disagree — it should not happen for an owner-bound
 * store) falls back to the document's own stage metadata rather than failing a
 * readable course.
 */
export function toReinlabCourseDetail(
  document: MaicDocument<AppScene, AppStage>,
  summary: DocumentSummary | undefined,
): ReinlabCourseDetail {
  const stage = document.stage;
  const description = summary?.description ?? stage.description;
  return {
    id: summary?.id ?? stage.id,
    name: summary?.name ?? stage.name,
    ...(description !== undefined ? { description } : {}),
    createdAt: summary?.createdAt ?? stage.createdAt,
    updatedAt: summary?.updatedAt ?? stage.updatedAt,
    sceneCount: summary?.sceneCount ?? document.scenes.length,
    stage,
    scenes: document.scenes,
    ...(document.dslVersion !== undefined ? { dslVersion: document.dslVersion } : {}),
  };
}

// ---------------------------------------------------------------------------
// Media manifest
// ---------------------------------------------------------------------------

/** The media roles the client's offline cache distinguishes. */
export type ReinlabMediaKind = 'image' | 'audio' | 'video' | 'poster';

/** One media reference of one course. */
export interface ReinlabMediaReference {
  /** The raw reference exactly as the document holds it (an asset id or a URL). */
  readonly url: string;
  readonly kind: ReinlabMediaKind;
  /** How many logical references point at this url. Never below 1. */
  readonly count: number;
}

/** The published order of `media`, and the tiebreak inside one kind. */
const MEDIA_KIND_ORDER: readonly ReinlabMediaKind[] = ['image', 'audio', 'video', 'poster'];

/**
 * Collapse the DSL's five asset roles onto the client's four.
 *
 * `background` is an image: a slide background is a background IMAGE, the
 * client's cache stores it in the same slot as any other image, and a
 * reference that is both a background and an element image therefore lands in
 * exactly one entry.
 */
function reinlabMediaKind(kind: AssetKind): ReinlabMediaKind {
  switch (kind) {
    case 'background':
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'poster':
      return 'poster';
  }
}

function compareMediaReferences(left: ReinlabMediaReference, right: ReinlabMediaReference): number {
  const kindDelta = MEDIA_KIND_ORDER.indexOf(left.kind) - MEDIA_KIND_ORDER.indexOf(right.kind);
  if (kindDelta !== 0) return kindDelta;
  // Code-unit order rather than `localeCompare`: the ordering must not depend
  // on the host's locale, and the client may diff two responses.
  if (left.url === right.url) return 0;
  return left.url < right.url ? -1 : 1;
}

/**
 * Every media reference one course holds, de-duplicated, classified and
 * counted — the client's offline media cache is built from this list.
 *
 * The traversal is the pure DSL enumerator, not a local walker: it already
 * covers the stage whiteboard, every scene's canvas and whiteboards, speech
 * action narration and the stage video manifest, and it is the same
 * enumeration ZIP / PPTX / video export consume, so the iPad caches what an
 * export would archive. (`lib/media/collect-stage-asset-refs.ts` would be the
 * other candidate, but it reaches the client zustand store and must never be
 * imported into a route handler.)
 *
 * `count` is the enumerator's own logical-owner accounting: a video element
 * that repeats one ref in both `src` and `mediaRef` is one reference, while
 * its poster is another. A ref named only by the stage video manifest has no
 * provable owner in that map, and the enumeration itself is its one reference.
 */
export function buildReinlabMediaManifest(
  document: Pick<MaicDocument<AppScene, AppStage>, 'stage' | 'scenes'>,
): ReinlabMediaReference[] {
  const manifest = enumerateAssetManifest(document);
  const byKindAndUrl = new Map<string, ReinlabMediaReference>();

  for (const entry of manifest.entries) {
    const kind = reinlabMediaKind(entry.kind);
    // A url under two roles is two entries (the client caches a poster and a
    // video separately); two roles that collapse onto one published kind are
    // one entry, because the enumeration is already per (ref, role).
    const key = `${kind}\u0000${entry.ref}`;
    if (byKindAndUrl.has(key)) continue;
    byKindAndUrl.set(key, {
      url: entry.ref,
      kind,
      count: manifest.referenceCounts.get(entry.ref) ?? 1,
    });
  }

  return [...byKindAndUrl.values()].sort(compareMediaReferences);
}
