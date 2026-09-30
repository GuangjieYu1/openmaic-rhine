/**
 * One course document with media in every slot the export manifest must see.
 *
 * The export surface's media list is only as good as the traversal behind it,
 * so the fixture deliberately plants a reference in each place the DSL
 * enumerator looks — a stage-whiteboard background, two canvas images sharing
 * one ref, a video element whose `src` and `mediaRef` are the same url plus a
 * distinct poster, a slide audio element and a speech action sharing one ref,
 * and a stage video-manifest key nothing else names — and exports the refs by
 * role so a test asserts against the same strings the document holds.
 *
 * Casts are the repo's fixture convention (`tests/media/asset-manifest.test.ts`):
 * the enumerator reads only `type`/`src`/`mediaRef`/`poster` and
 * `background.type`/`background.image.src`, so the fixtures carry exactly those
 * and stand in for the rest of the DSL shapes.
 */
import type { MaicDocument } from '@openmaic/storage';

import type { AppStage } from '@/lib/document-store/persistence-types';
import type { AppScene } from '@/lib/types/stage';

export const COURSE_STAGE_ID = 'stage-thermo';
export const COURSE_NAME = 'Thermodynamics';
export const COURSE_DESCRIPTION = 'Heat, work and the second law';
export const COURSE_NOW = 1_700_000_000_000;

/** Every ref the fixture plants, by the role it plays. */
export const FIXTURE_REFS = {
  /** Canvas image, used twice on the same canvas. */
  image: 'ast_image_1',
  /** Stage-whiteboard background, repeated as a canvas image on scene 2. */
  background: 'https://cdn.example.com/bg.png',
  /** Speech narration, repeated as a slide audio element. */
  narration: 'ast_narration',
  /** Video element `src`/`mediaRef` (one logical owner). */
  video: 'https://cdn.example.com/lecture.mp4',
  poster: 'https://cdn.example.com/lecture.jpg',
  /** Named only by the stage video manifest. */
  generatedVideo: 'https://cdn.example.com/generated.mp4',
} as const;

function imageElement(id: string, src: string) {
  return { id, type: 'image', src, left: 0, top: 0, width: 10, height: 10 };
}

function videoElement(id: string, src: string, poster: string) {
  return { id, type: 'video', src, mediaRef: src, poster, left: 0, top: 0, width: 10, height: 10 };
}

function audioElement(id: string, src: string) {
  return { id, type: 'audio', src, left: 0, top: 0, width: 10, height: 10 };
}

function canvas(id: string, elements: unknown[]) {
  return {
    id,
    viewportSize: 1000,
    viewportRatio: 0.5625,
    theme: { backgroundColor: '#fff', themeColors: [], fontColor: '#000', fontName: 'Inter' },
    elements,
  };
}

function scene(index: number, canvasSlide: unknown, actions?: unknown[]): AppScene {
  return {
    id: `scene-${index}`,
    stageId: COURSE_STAGE_ID,
    title: `Scene ${index}`,
    order: index,
    type: 'slide',
    content: { type: 'slide', canvas: canvasSlide },
    ...(actions ? { actions } : {}),
  } as unknown as AppScene;
}

/** A whole course document: two scenes, a stage whiteboard and a video manifest. */
export function makeCourseDocument(): MaicDocument<AppScene, AppStage> {
  return {
    stage: {
      id: COURSE_STAGE_ID,
      name: COURSE_NAME,
      description: COURSE_DESCRIPTION,
      createdAt: COURSE_NOW,
      updatedAt: COURSE_NOW,
      whiteboard: [
        {
          id: 'wb-1',
          viewportSize: 1000,
          viewportRatio: 0.5625,
          elements: [],
          background: {
            type: 'image',
            image: { src: FIXTURE_REFS.background, size: 'cover' },
          },
        },
      ],
      videoManifest: {
        [FIXTURE_REFS.generatedVideo]: { type: 'video', prompt: 'a boiling kettle' },
      },
    } as unknown as AppStage,
    scenes: [
      scene(
        0,
        canvas('slide-0', [
          imageElement('img-0', FIXTURE_REFS.image),
          imageElement('img-1', FIXTURE_REFS.image),
          videoElement('vid-0', FIXTURE_REFS.video, FIXTURE_REFS.poster),
        ]),
        [{ id: 'a0', type: 'speech', text: 'Heat flows', audioId: FIXTURE_REFS.narration }],
      ),
      scene(
        1,
        canvas('slide-1', [
          audioElement('aud-0', FIXTURE_REFS.narration),
          imageElement('img-2', FIXTURE_REFS.background),
        ]),
      ),
    ],
    dslVersion: '1.0.0',
  };
}

/** The manifest the fixture must produce, in the order the contract sorts it. */
export const EXPECTED_MEDIA = [
  { url: FIXTURE_REFS.image, kind: 'image', count: 2 },
  { url: FIXTURE_REFS.background, kind: 'image', count: 2 },
  { url: FIXTURE_REFS.narration, kind: 'audio', count: 2 },
  { url: FIXTURE_REFS.generatedVideo, kind: 'video', count: 1 },
  { url: FIXTURE_REFS.video, kind: 'video', count: 1 },
  { url: FIXTURE_REFS.poster, kind: 'poster', count: 1 },
] as const;
