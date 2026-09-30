/**
 * Operator-configured provider headers.
 *
 * Some OpenAI-compatible gateways route by a per-request header the chat
 * completions protocol has no field for: the opencode gateway answers HTTP 400
 * `MissingSessionID` for `/v1/chat/completions` unless the request carries
 * `x-opencode-session`. There is no SDK option for an arbitrary provider
 * header, and the value is a secret-adjacent routing identifier that must stay
 * in `server-providers.yml` (never in the browser), so the server merges it
 * into the outbound request at the transport seam.
 */

/**
 * Merge operator-configured headers into a `fetch` init, preserving whatever
 * headers shape the SDK used — a `Headers` instance, an array of pairs, a
 * plain record, or nothing at all (`new Headers()` accepts all four) — so
 * nothing the SDK already set is dropped.
 *
 * A configured header WINS over one the SDK already set: it is an explicit
 * operator instruction, and a gateway that requires the header is unusable when
 * an SDK default of the same name shadows it. Returning the init untouched when
 * there is nothing to merge keeps callers cheap and preserves object identity
 * for existing tests/traces.
 */
export function withProviderHeadersInit<T extends RequestInit | undefined>(
  init: T,
  headers: Record<string, string> | undefined,
): T {
  if (!headers || Object.keys(headers).length === 0) return init;
  const merged = new Headers(init?.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return { ...init, headers: merged } as T;
}
