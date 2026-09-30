import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_OVERLAY_ATTRIBUTE,
  PRESENTATION_OVERLAY_CLASSES,
  planPresentationEntry,
} from '@/lib/classroom/presentation-fullscreen';

describe('planPresentationEntry', () => {
  it('uses native fullscreen when the engine implements it', () => {
    expect(
      planPresentationEntry({ requestFullscreen: () => {}, fullscreenEnabled: true }),
    ).toBe('native');
  });

  it('falls back to the overlay when requestFullscreen is absent', () => {
    // SFSafariViewController (the REINLAB iPad shell's browser) and every
    // pre-16.4 WebKit engine land here: the property is simply undefined.
    expect(planPresentationEntry({ requestFullscreen: undefined, fullscreenEnabled: true })).toBe(
      'overlay',
    );
  });

  it('falls back to the overlay when requestFullscreen is not callable', () => {
    // A non-function truthy value would still throw on call, so a plain
    // truthiness check is not enough.
    expect(planPresentationEntry({ requestFullscreen: true, fullscreenEnabled: true })).toBe(
      'overlay',
    );
  });

  it('falls back to the overlay when the document reports fullscreen disabled', () => {
    // iOS Safari exposes the method but reports fullscreenEnabled === false for
    // non-video elements; calling it there is a no-op, not an escape hatch.
    expect(planPresentationEntry({ requestFullscreen: () => {}, fullscreenEnabled: false })).toBe(
      'overlay',
    );
  });

  it('treats an undefined fullscreenEnabled as enabled rather than guessing off', () => {
    // document.fullscreenEnabled is undefined in some embedded web views that do
    // implement the API; the call itself is the real test, and a throw lands in
    // the caller's catch, which enters the overlay anyway.
    expect(planPresentationEntry({ requestFullscreen: () => {}, fullscreenEnabled: undefined })).toBe(
      'native',
    );
  });
});

describe('overlay contract', () => {
  it('pins the stage to the viewport above the classroom chrome', () => {
    expect(PRESENTATION_OVERLAY_CLASSES).toContain('fixed');
    expect(PRESENTATION_OVERLAY_CLASSES).toContain('inset-0');
    expect(PRESENTATION_OVERLAY_CLASSES).toContain('z-40');
  });

  it('exposes a stable marker attribute', () => {
    expect(PRESENTATION_OVERLAY_ATTRIBUTE).toBe('data-presentation-overlay');
  });
});
