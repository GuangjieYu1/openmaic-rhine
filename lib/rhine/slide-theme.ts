import type { SlideTheme } from '@openmaic/dsl';

export const RHINE_SLIDE_COLORS = ['#738b5f', '#a4b890', '#465d36', '#899f83', '#b4aa88'];
export const RHINE_SLIDE_BACKGROUND = '#f7f8f2';
export const RHINE_SLIDE_THEME: SlideTheme = {
  backgroundColor: RHINE_SLIDE_BACKGROUND,
  themeColors: RHINE_SLIDE_COLORS,
  fontColor: '#394632',
  fontName: 'Noto Sans SC',
  outline: { color: '#81996b', width: 2, style: 'solid' },
  shadow: { h: 0, v: 0, blur: 10, color: '#35472d' },
};

/** Skin newly generated default slides; leave authored/imported slide objects alone. */
export function withRhineGeneratedSlide<T>(scene: T): T {
  if (!scene || typeof scene !== 'object') return scene;
  const candidate = scene as { type?: unknown; content?: { type?: unknown; canvas?: Record<string, unknown> } };
  if (candidate.type !== 'slide' || candidate.content?.type !== 'slide' || !candidate.content.canvas) return scene;
  const canvas = candidate.content.canvas;
  const background = canvas.background as { type?: string; color?: string } | undefined;
  return {
    ...scene,
    content: {
      ...candidate.content,
      canvas: {
        ...canvas,
        theme: RHINE_SLIDE_THEME,
        background: !background || background.type === 'solid' && ['#fff', '#ffffff'].includes(background.color?.toLowerCase() ?? '')
          ? { type: 'solid', color: RHINE_SLIDE_BACKGROUND }
          : background,
      },
    },
  } as T;
}
