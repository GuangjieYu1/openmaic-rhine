/**
 * The archive-to-lesson motion used by the earlier Rhine group-theory classroom:
 * approach the selected physical cassette, unfold that same cover into the
 * lesson, then perform the exact two movements in reverse on return.
 */
export type OpeningRect = { x: number; y: number; width: number; height: number };
export const APPROACH_DURATION = 820;
export const UNFOLD_DURATION = 680;
const approachEase = 'cubic-bezier(.32,.08,.2,1)';
const unfoldEase = 'cubic-bezier(.32,.08,.3,1)';
const COVER_WIDTH = 500;
const COVER_HEIGHT = 370;

export function openingApproachScale(height: number, source: OpeningRect) {
  return Math.max(1.3, Math.min(2.2, height * .82 / Math.max(1, source.height)));
}

export function openingTransform(from: OpeningRect, to: OpeningRect) {
  return `translate3d(${from.x - to.x}px,${from.y - to.y}px,0) scale(${from.width / Math.max(1, to.width)},${from.height / Math.max(1, to.height)})`;
}

export function coverTransform(rect: OpeningRect, frame: OpeningRect) {
  return `translate3d(${rect.x - frame.x}px,${rect.y - frame.y}px,0) scale(${rect.width / COVER_WIDTH},${rect.height / COVER_HEIGHT})`;
}

export function startArchiveApproach(viewport: HTMLElement, source: OpeningRect) {
  const frame = viewport.getBoundingClientRect();
  const scale = openingApproachScale(frame.height, source);
  viewport.style.transformOrigin = `${source.x + source.width / 2 - frame.x}px ${source.y + source.height / 2 - frame.y}px`;
  const animation = viewport.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})` }],
    { duration: APPROACH_DURATION, easing: approachEase, fill: 'forwards' },
  );
  return {
    finished: animation.finished,
    settle() {
      viewport.style.transform = `scale(${scale})`;
      animation.cancel();
    },
    cancel() {
      animation.cancel();
      viewport.style.transform = '';
      viewport.style.transformOrigin = '';
    },
  };
}

function asRect(element: HTMLElement): OpeningRect {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
}

function createCover(root: HTMLElement, sourceFace: HTMLElement) {
  const cover = document.createElement('div');
  cover.className = 'cine-cassette selected cine-opening-cover rhine-morph-cover';
  cover.setAttribute('aria-hidden', 'true');
  cover.inert = true;
  const cassette = sourceFace.closest<HTMLElement>('.cine-cassette');
  if (cassette) {
    const material = getComputedStyle(cassette);
    cover.style.setProperty('--cassette-clarity', material.getPropertyValue('--cassette-clarity'));
    cover.style.setProperty('--cassette-scan', material.getPropertyValue('--cassette-scan'));
    const mechanism = cassette.querySelector<HTMLElement>(':scope > .cassette-mechanism');
    if (mechanism) cover.append(mechanism.cloneNode(true));
  }
  cover.append(sourceFace.cloneNode(true));
  root.append(cover);
  return cover;
}

function runMorph({
  root, viewport, frame, body, sourceFace, direction,
}: {
  root: HTMLElement;
  viewport: HTMLElement;
  frame: HTMLElement;
  body: HTMLElement;
  sourceFace: HTMLElement;
  direction: 'opening' | 'returning';
}) {
  const rootRect = asRect(root);
  const near = asRect(sourceFace);
  const destination = asRect(body);
  const cover = createCover(root, sourceFace);
  const from = coverTransform(near, rootRect);
  const to = coverTransform(destination, rootRect);
  cover.style.transform = direction === 'opening' ? from : to;
  const top = frame.querySelector<HTMLElement>('.rhine-classroom-top');
  const animations: Animation[] = [];
  const startTime = document.timeline.currentTime;
  const animate = (element: HTMLElement, keyframes: Keyframe[]) => {
    const animation = element.animate(keyframes, { duration: UNFOLD_DURATION, fill: 'both' });
    if (startTime !== null) animation.startTime = startTime;
    animations.push(animation);
  };

  if (direction === 'opening') {
    animate(viewport, [
      { offset: 0, opacity: 1 },
      { offset: .03, opacity: 1, easing: unfoldEase },
      { offset: .26, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);
    animate(cover, [{ transform: from, easing: unfoldEase }, { transform: to }]);
    animate(cover, [
      { offset: 0, opacity: 1 },
      { offset: .32, opacity: 1, easing: unfoldEase },
      { offset: .8, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);
    animate(body, [
      { transformOrigin: '0 0', transform: openingTransform(near, destination), opacity: 0, easing: unfoldEase },
      { offset: .11, opacity: 0 },
      { offset: .69, opacity: 1 },
      { transformOrigin: '0 0', transform: 'translate3d(0,0,0) scale(1,1)', opacity: 1 },
    ]);
    animate(frame, [{ opacity: 0 }, { opacity: 1 }]);
    if (top) animate(top, [{ opacity: 0 }, { offset: .22, opacity: 0 }, { opacity: 1 }]);
  } else {
    animate(viewport, [{ opacity: 0 }, { offset: .72, opacity: 1 }, { opacity: 1 }]);
    animate(cover, [{ transform: to, easing: unfoldEase }, { transform: from }]);
    animate(cover, [{ opacity: 0 }, { offset: .22, opacity: 1 }, { opacity: 1 }]);
    animate(body, [
      { transformOrigin: '0 0', transform: 'translate3d(0,0,0) scale(1,1)', opacity: 1, easing: unfoldEase },
      { offset: .42, opacity: 1 },
      { transformOrigin: '0 0', transform: openingTransform(near, destination), opacity: 0 },
    ]);
    animate(frame, [{ opacity: 1 }, { offset: .7, opacity: 0 }, { opacity: 0 }]);
    if (top) animate(top, [{ opacity: 1 }, { offset: .3, opacity: 0 }, { opacity: 0 }]);
  }

  return {
    finished: Promise.all(animations.map(animation => animation.finished)),
    settle() {
      viewport.style.opacity = direction === 'opening' ? '0' : '1';
      frame.style.opacity = direction === 'opening' ? '1' : '0';
      body.style.transform = 'none';
      body.style.opacity = direction === 'opening' ? '1' : '0';
      if (top) top.style.opacity = direction === 'opening' ? '1' : '0';
      animations.forEach(animation => animation.cancel());
      cover.remove();
    },
    cancel() {
      animations.forEach(animation => animation.cancel());
      cover.remove();
    },
  };
}

export function unfoldArchiveCover(args: Omit<Parameters<typeof runMorph>[0], 'direction'>) {
  return runMorph({ ...args, direction: 'opening' });
}

export function foldArchiveCover(args: Omit<Parameters<typeof runMorph>[0], 'direction'>) {
  return runMorph({ ...args, direction: 'returning' });
}

export function retreatFromArchive(viewport: HTMLElement) {
  const from = viewport.style.transform || 'scale(1)';
  const animation = viewport.animate(
    [{ transform: from }, { transform: 'scale(1)' }],
    { duration: APPROACH_DURATION, easing: approachEase, fill: 'forwards' },
  );
  return {
    finished: animation.finished,
    settle() {
      viewport.style.transform = '';
      viewport.style.transformOrigin = '';
      viewport.style.opacity = '';
      animation.cancel();
    },
    cancel() {
      animation.cancel();
      viewport.style.transform = '';
      viewport.style.transformOrigin = '';
      viewport.style.opacity = '';
    },
  };
}
