/**
 * Where the classroom's portalled chrome goes when it is embedded in a shell.
 *
 * The RHINE archive mounts the classroom inside `.cinema-experience`, which is
 * `position: fixed; inset: 0; z-index: 65; isolation: isolate` with an opaque
 * background. Anything portalled to `document.body` therefore paints *below* it:
 * a body-portalled interactive iframe (`z-index: 1`) is simply not visible, and
 * the scene reads as a blank page even though its document loaded fine. The same
 * applies to a Radix dialog portalled to `<body>` at the app's usual `z-50`.
 *
 * The contract below lets a shell nominate one of its own nodes as the portal
 * host. Because that node lives inside the shell's stacking context, portalled
 * chrome stacks against the shell's own layers instead of losing to the shell
 * itself. Shells that mark nothing keep the previous body-portal behaviour, so
 * the Pro workspace and the standalone classroom are untouched.
 */

/** Marks the node a shell wants portalled classroom chrome to live inside. */
export const SHELL_PORTAL_ATTRIBUTE = 'data-classroom-portal';

/**
 * z-index for the interactive iframe host once it lives inside a shell.
 *
 * It has to clear the shell's own classroom frame (the archive layers that at
 * 30) while staying under the app's dialogs (`z-50`), which is where the
 * scene-switch confirmation lives.
 */
export const SHELLED_IFRAME_Z_INDEX = 35;

/** The shell's nominated portal host, if the shell marked one. */
export function findShellPortalHost(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${SHELL_PORTAL_ATTRIBUTE}]`);
}

/**
 * Resolve where a fixed-position portal should mount.
 *
 * Native fullscreen wins first: the browser only paints the fullscreened
 * element's own subtree, so a portal left outside it would vanish. A shell host
 * comes next, then `document.body` — the unchanged default.
 */
export function resolveShellPortalTarget(options: {
  readonly fullscreenElement: Element | null;
  readonly shellHost: HTMLElement | null;
  readonly body: HTMLElement;
}): Element {
  return options.fullscreenElement ?? options.shellHost ?? options.body;
}

/**
 * z-index the iframe host should carry for a given target. Only a shell host
 * needs to out-stack anything; `<body>` and the fullscreen element already do.
 */
export function iframeHostZIndex(options: {
  readonly target: Element | null;
  readonly fullscreenElement: Element | null;
  readonly body: HTMLElement;
}): number {
  const { target, fullscreenElement, body } = options;
  if (!target || target === body || target === fullscreenElement) return 1;
  return SHELLED_IFRAME_Z_INDEX;
}
