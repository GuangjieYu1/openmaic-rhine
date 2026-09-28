import { describe, expect, it } from 'vitest';
import {
  APPROACH_DURATION,
  UNFOLD_DURATION,
  coverTransform,
  openingApproachScale,
  openingTransform,
} from '@/components/rhine/archive-morph';

describe('Rhine cassette-to-classroom geometry', () => {
  it('keeps the old group-theory approach and unfold rhythm', () => {
    expect(APPROACH_DURATION).toBe(820);
    expect(UNFOLD_DURATION).toBe(680);
  });

  it('projects the real cassette face into the classroom rectangle', () => {
    const near = { x: 120, y: 90, width: 500, height: 370 };
    const lesson = { x: 0, y: 48, width: 1280, height: 672 };
    expect(openingTransform(near, lesson))
      .toBe('translate3d(120px,42px,0) scale(0.390625,0.5505952380952381)');
    expect(coverTransform(near, { x: 0, y: 0, width: 1280, height: 720 }))
      .toBe('translate3d(120px,90px,0) scale(1,1)');
  });

  it('bounds the dolly to avoid an excessive zoom on tiny or large windows', () => {
    expect(openingApproachScale(720, { x: 0, y: 0, width: 200, height: 200 })).toBe(2.2);
    expect(openingApproachScale(720, { x: 0, y: 0, width: 900, height: 900 })).toBe(1.3);
  });
});
