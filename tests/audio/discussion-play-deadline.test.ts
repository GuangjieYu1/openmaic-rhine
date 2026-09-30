import { describe, expect, it } from 'vitest';
import {
  DISCUSSION_PLAY_DEADLINE_MS,
  hasProducedNothing,
} from '@/lib/audio/discussion-play-deadline';

describe('hasProducedNothing', () => {
  it('is true while the element has not advanced', () => {
    expect(hasProducedNothing({ currentTime: 0 })).toBe(true);
  });

  it('is false once a sample has played', () => {
    expect(hasProducedNothing({ currentTime: 0.05 })).toBe(false);
  });

  it('keeps a line that is mid-playback', () => {
    expect(hasProducedNothing({ currentTime: 12.5 })).toBe(false);
  });

  it('treats a negative clock as nothing played', () => {
    // Not reachable in a conforming engine, but a NaN/negative clock must not
    // read as "it played", which would leave the queue wedged.
    expect(hasProducedNothing({ currentTime: -1 })).toBe(true);
  });

  it('allows far longer than any real clip needs to start', () => {
    // The deadline exists to catch a promise that never settles, not to cap
    // playback: a lecture clip is tens of seconds long, not tens of seconds to
    // start.
    expect(DISCUSSION_PLAY_DEADLINE_MS).toBeGreaterThanOrEqual(15_000);
  });
});
