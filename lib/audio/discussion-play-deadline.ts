/**
 * Deadline for a discussion line to produce its first audible sample.
 *
 * `HTMLMediaElement.play()` returns a promise that is allowed to stay **pending
 * forever**: iOS leaves it unresolved when the source never becomes playable,
 * and a refused autoplay on a reused element can behave the same way. Awaiting
 * that promise wedges the discussion queue — the line never reaches its `finish`,
 * `isPlayingRef` stays true, the discussion never ends and the roundtable never
 * returns to the lecture. On the iPad shell that reads as "the voice opened and
 * now nothing works, only quitting the app helps".
 *
 * Nothing here waits on the promise itself: the line is retired if no audio has
 * been produced by the deadline, which is the one condition that is true for
 * every stuck variant and false for every line that is merely still buffering a
 * slow network fetch AND has already started.
 */

/** How long a line may take to start before it is treated as dead. */
export const DISCUSSION_PLAY_DEADLINE_MS = 25_000;

/** The slice of an `HTMLAudioElement` this decision needs. */
export interface PlaybackLiveness {
  /** Seconds of audio already played. Zero until the first sample is audible. */
  readonly currentTime: number;
}

/**
 * Whether a line has produced no audio at all and should be retired.
 *
 * Deliberately keyed on `currentTime` alone, not on `paused`: invoking `play()`
 * clears `paused` synchronously even when playback never begins, so `paused`
 * cannot tell a dead line from a live one. It also ignores `readyState`, because
 * a line that is still fetching is not dead — it just has not started yet, and
 * the deadline is long enough that anything still at zero is not going to.
 */
export function hasProducedNothing(liveness: PlaybackLiveness): boolean {
  return !(liveness.currentTime > 0);
}
