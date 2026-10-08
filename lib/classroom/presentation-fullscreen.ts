/**
 * Presentation mode that does not depend on the Fullscreen API.
 *
 * WebKit only implements `Element.requestFullscreen()` for <video>; on iPadOS a
 * plain <div> can neither enter nor report fullscreen (webkit.org/b/265438). The
 * REINLAB iPad shell opens the classroom through `@capacitor/browser`, which on
 * iOS is an SFSafariViewController sheet — an even more restricted web view. In
 * both, the stage's present button used to await `requestFullscreen()`, throw,
 * and do nothing at all, so the classroom could never be presented on a tablet.
 *
 * The fix keeps the native path where it exists and falls back to an in-page
 * overlay: the stage element is pinned to the viewport with CSS and the shell
 * chrome is hidden, which is the closest thing to fullscreen a sheet can offer.
 */

/** How the stage should enter presentation mode. */
export type PresentationEntry = 'native' | 'overlay';

export interface PresentationEnv {
  /** `stageElement.requestFullscreen`, read off the element (never a bound call). */
  readonly requestFullscreen: unknown;
  /** `document.fullscreenEnabled`; undefined on engines that never define it. */
  readonly fullscreenEnabled: boolean | undefined;
}

/**
 * Choose the entry path. Anything other than a usable, evidently enabled
 * Fullscreen API resolves to the overlay — an engine that defines
 * `requestFullscreen` but refuses it still lands here through the caller's catch.
 */
export function planPresentationEntry(env: PresentationEnv): PresentationEntry {
  if (typeof env.requestFullscreen !== 'function') return 'overlay';
  if (env.fullscreenEnabled === false) return 'overlay';
  return 'native';
}

/**
 * Classes the stage element carries while the CSS overlay stands in for
 * fullscreen. `fixed inset-0` escapes the shell's height chain, and the z-index
 * keeps it above the classroom chrome it replaces.
 */
export const PRESENTATION_OVERLAY_CLASSES = 'fixed inset-0 z-40';

/** Marker attribute so the overlay state is observable in tests and on-device. */
export const PRESENTATION_OVERLAY_ATTRIBUTE = 'data-presentation-overlay';
