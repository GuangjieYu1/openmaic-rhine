import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHELL_PORTAL_ATTRIBUTE,
  SHELLED_IFRAME_Z_INDEX,
  findShellPortalHost,
  iframeHostZIndex,
  resolveShellPortalTarget,
} from '@/lib/rhine/shell-portal';

const body = { tagName: 'BODY' } as unknown as HTMLElement;
const shell = { tagName: 'DIV' } as unknown as HTMLElement;
const fullscreen = { tagName: 'DIV' } as unknown as HTMLElement;

describe('resolveShellPortalTarget', () => {
  it('prefers the fullscreen element, which the browser isolates', () => {
    expect(
      resolveShellPortalTarget({ fullscreenElement: fullscreen, shellHost: shell, body }),
    ).toBe(fullscreen);
  });

  it('uses the shell host when one is marked', () => {
    expect(resolveShellPortalTarget({ fullscreenElement: null, shellHost: shell, body })).toBe(shell);
  });

  it('falls back to <body> when nothing is marked', () => {
    // The standalone classroom and the Pro workspace never mark a host, so their
    // portal placement must not change.
    expect(resolveShellPortalTarget({ fullscreenElement: null, shellHost: null, body })).toBe(body);
  });
});

describe('iframeHostZIndex', () => {
  it('keeps 1 for a body portal', () => {
    expect(iframeHostZIndex({ target: body, fullscreenElement: null, body })).toBe(1);
  });

  it('keeps 1 inside the fullscreen element', () => {
    expect(iframeHostZIndex({ target: fullscreen, fullscreenElement: fullscreen, body })).toBe(1);
  });

  it('clears the shell frame but stays under the app dialogs', () => {
    expect(iframeHostZIndex({ target: shell, fullscreenElement: null, body })).toBe(
      SHELLED_IFRAME_Z_INDEX,
    );
    // The archive layers its classroom frame at 30 and dialogs at 50.
    expect(SHELLED_IFRAME_Z_INDEX).toBeGreaterThan(30);
    expect(SHELLED_IFRAME_Z_INDEX).toBeLessThan(50);
  });

  it('treats a missing target as unstacked', () => {
    expect(iframeHostZIndex({ target: null, fullscreenElement: null, body })).toBe(1);
  });
});

describe('findShellPortalHost', () => {
  it('reads the shell marker off the document', () => {
    const marked = { tagName: 'DIV' } as unknown as HTMLElement;
    const queried: string[] = [];
    const root = {
      querySelector: (selector: string) => {
        queried.push(selector);
        return marked;
      },
    } as unknown as ParentNode;
    expect(findShellPortalHost(root)).toBe(marked);
    expect(queried[0]).toBe(`[${SHELL_PORTAL_ATTRIBUTE}]`);
  });

  it('returns null when the shell marks nothing', () => {
    const root = { querySelector: () => null } as unknown as ParentNode;
    expect(findShellPortalHost(root)).toBeNull();
  });
});

/**
 * The helper only matters if the two ends are actually wired: the archive has to
 * mark a host, and the classroom's portalled chrome has to consult it. Pin both,
 * because either one silently reverting puts the interactive-scene iframe back
 * behind the archive's opaque layer with no other symptom.
 */
describe('shell portal wiring', () => {
  it('the RHINE archive marks its classroom body as the portal host', () => {
    const source = readFileSync(join(process.cwd(), 'components/rhine/RhineArchive.tsx'), 'utf8');
    expect(source).toContain(`${SHELL_PORTAL_ATTRIBUTE}=""`);
    // The marker has to sit on the node the classroom actually renders inside,
    // not on some unrelated wrapper the fixed-position portal would escape.
    expect(source).toContain(`<div className="rhine-classroom-body" ${SHELL_PORTAL_ATTRIBUTE}=""`);
  });

  it('the interactive iframe host resolves its target through the shell', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/scene-renderers/InteractiveIframeHost.tsx'),
      'utf8',
    );
    expect(source).toContain('resolveShellPortalTarget({');
    expect(source).toContain('findShellPortalHost(document)');
    expect(source).toContain('iframeHostZIndex({');
  });

  it('the scene-switch dialog follows the same host when the shell offers one', () => {
    const source = readFileSync(
      join(process.cwd(), 'components/edit/PlaybackChromeRoot.tsx'),
      'utf8',
    );
    expect(source).toContain('findShellPortalHost(document)');
    expect(source).toContain('container={isPresenting ? stageRef.current : (shellPortalHost ?? undefined)}');
  });
});
