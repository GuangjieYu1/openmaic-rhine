import { describe, expect, it } from 'vitest';
import { RHINE_SLIDE_BACKGROUND, RHINE_SLIDE_THEME, withRhineGeneratedSlide } from '@/lib/rhine/slide-theme';

describe('Rhine classroom palette', () => {
  it('uses sage and warm paper for generated default slides', () => {
    const source = { type: 'slide', content: { type: 'slide', canvas: { id: 'slide', theme: { themeColors: ['#5b9bd5'] }, elements: [], background: { type: 'solid', color: '#ffffff' } } } };
    const themed = withRhineGeneratedSlide(source);
    expect(themed.content.canvas.theme).toEqual(RHINE_SLIDE_THEME);
    expect(themed.content.canvas.background).toEqual({ type: 'solid', color: RHINE_SLIDE_BACKGROUND });
    expect(source.content.canvas.theme.themeColors).toEqual(['#5b9bd5']);
  });
  it('does not recolor an author-selected slide background or a different scene type', () => {
    const slide = { type: 'slide', content: { type: 'slide', canvas: { background: { type: 'solid', color: '#123456' } } } };
    expect(withRhineGeneratedSlide(slide).content.canvas.background).toEqual({ type: 'solid', color: '#123456' });
    const quiz = { type: 'quiz', content: { type: 'quiz', questions: [] } };
    expect(withRhineGeneratedSlide(quiz)).toBe(quiz);
  });
});
