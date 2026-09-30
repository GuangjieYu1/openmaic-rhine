'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import './curriculum-transition.css';

export const OPEN_CURRICULUM_EVENT = 'rhine:open-curriculum';

export function RhineCurriculumTransition() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const started = useRef(false);
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flight = useRef<HTMLImageElement>(null);
  const curtain = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finish = () => {
      document.documentElement.classList.remove('rhine-curriculum-in-flight');
      if (watchdog.current) clearTimeout(watchdog.current);
      started.current = false;
      setActive(false);
    };
    const open = () => {
      if (started.current) return;
      started.current = true;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        router.push('/');
        started.current = false;
        return;
      }
      // This class is set before navigation, so the destination never briefly
      // shows a second copy of the mark underneath the travelling one.
      document.documentElement.classList.add('rhine-curriculum-in-flight');
      setActive(true);
      introTimer.current = setTimeout(() => router.push('/'), 1550);
      watchdog.current = setTimeout(finish, 8000);
    };
    window.addEventListener(OPEN_CURRICULUM_EVENT, open);
    return () => {
      window.removeEventListener(OPEN_CURRICULUM_EVENT, open);
      if (introTimer.current) clearTimeout(introTimer.current);
      if (watchdog.current) clearTimeout(watchdog.current);
      document.documentElement.classList.remove('rhine-curriculum-in-flight');
    };
  }, [router]);

  useEffect(() => {
    if (!active || pathname !== '/') return;
    let cancelled = false;
    let frame = 0;
    const deadline = performance.now() + 4500;
    const land = () => {
      if (cancelled) return;
      const target = document.querySelector<HTMLImageElement>('[data-rhine-curriculum-target]');
      const mark = flight.current;
      if (!target || !mark || target.getBoundingClientRect().width < 1) {
        if (performance.now() < deadline) frame = requestAnimationFrame(land);
        return;
      }
      const from = mark.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      mark.classList.add('is-flying');
      Object.assign(mark.style, {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        transform: 'none',
        transformOrigin: 'top left',
      });
      curtain.current?.classList.add('is-departing');
      caption.current?.classList.add('is-departing');

      const animation = mark.animate(
        [
          { transform: 'translate3d(0, 0, 0) scale(1)' },
          {
            transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) scale(${to.width / from.width})`,
          },
        ],
        { duration: 920, easing: 'cubic-bezier(.22, 1, .24, 1)', fill: 'forwards' },
      );
      void animation.finished.then(async () => {
        if (cancelled) return;
        target.classList.add('is-revealed');
        await mark.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 260,
          easing: 'ease-out',
          fill: 'forwards',
        }).finished.catch(() => {});
        if (cancelled) return;
        document.documentElement.classList.remove('rhine-curriculum-in-flight');
        if (watchdog.current) clearTimeout(watchdog.current);
        started.current = false;
        setActive(false);
      }).catch(() => {
        if (!cancelled) {
          document.documentElement.classList.remove('rhine-curriculum-in-flight');
          started.current = false;
          setActive(false);
        }
      });
    };
    // Let the destination commit and its hero settle before measuring the slot.
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(land); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [active, pathname]);

  if (!active) return null;
  return (
    <div className="rhine-curriculum-flight" role="status" aria-label="正在进入学科课程工作室">
      <div className="rhine-curriculum-curtain" ref={curtain} aria-hidden="true">
        <span className="rhine-curriculum-corner rhine-curriculum-corner-tl" />
        <span className="rhine-curriculum-corner rhine-curriculum-corner-br" />
        <span className="rhine-curriculum-index">RHINE LAB / KNOWLEDGE DIVISION</span>
        <span className="rhine-curriculum-index rhine-curriculum-index-bottom">ACADEMIC SYSTEM / 01</span>
      </div>
      <img
        ref={flight}
        className="rhine-curriculum-flight-mark"
        src="/rhine/curriculum-studio.svg"
        alt=""
        aria-hidden="true"
      />
      <div className="rhine-curriculum-flight-caption" ref={caption}>
        <strong>学科课程工作室</strong>
        <span>CURRICULUM STUDIO</span>
      </div>
    </div>
  );
}
