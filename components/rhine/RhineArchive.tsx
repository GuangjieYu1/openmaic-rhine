'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, ArrowUpRight, RefreshCw, Library, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import ArchiveField, { type ArchiveFieldHandle } from './ArchiveField';
import { DEFAULT_CELL, type Cell } from './timeline';
import { listStages, type StageListItem } from '@/lib/utils/stage-storage';
import { loadCurrentScene, saveCurrentScene } from '@/lib/document-store/current-scene';
import { useStageStore } from '@/lib/store';
import { ARCHIVE_PAGE_SIZE, archiveCell, classroomQuery, displayCourses } from '@/lib/rhine/catalog';
import { OPEN_CURRICULUM_EVENT } from './RhineCurriculumTransition';
import {
  APPROACH_DURATION,
  UNFOLD_DURATION,
  foldArchiveCover,
  retreatFromArchive,
  startArchiveApproach,
  unfoldArchiveCover,
} from './archive-morph';
import './cinematic.css';
import './cinematic-polish.css';
import './rhine-archive.css';
const Classroom = dynamic(() => import('@/components/classroom/ClassroomSurface').then(m => m.ClassroomSurface), { ssr: false });

type Course = StageListItem & { bookmark?: string; visitedAt?: string; source?: 'server' | 'device' };
type Phase = 'archive' | 'detail' | 'preparing' | 'opening' | 'classroom' | 'returning' | 'retreating' | 'departing';
const waitFor = (finished: Promise<unknown>, duration: number) =>
  Promise.race([finished, new Promise<void>(resolve => setTimeout(resolve, duration + 250))]);
export function RhineArchive() {
  const params = useSearchParams();
  const reduced = !!useReducedMotion();
  const [arrival, setArrival] = useState(() => params.get('entry') === 'rhine');
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [serverWarning, setServerWarning] = useState('');
  const [phase, setPhase] = useState<Phase>('archive');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [surface, setSurface] = useState<'loading' | 'not-found' | 'error' | 'stage'>('loading');
  const [timedOut, setTimedOut] = useState(false);
  const [size, setSize] = useState({ width: 1280, height: 720 });
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const classroomFrame = useRef<HTMLDivElement>(null);
  const classroomBody = useRef<HTMLDivElement>(null);
  const field = useRef<ArchiveFieldHandle>(null);
  const elapsed = useRef(0);
  const courseRef = useRef<string | null>(null);
  const sourceFace = useRef<HTMLElement | null>(null);
  const approachRef = useRef<ReturnType<typeof startArchiveApproach> | null>(null);
  const morphRef = useRef<ReturnType<typeof unfoldArchiveCover> | null>(null);
  const retreatRef = useRef<ReturnType<typeof retreatFromArchive> | null>(null);
  const loadingEpoch = useRef(0);
  const handledLink = useRef<string | null>(null);
  const visible = courses.slice(page * ARCHIVE_PAGE_SIZE, (page + 1) * ARCHIVE_PAGE_SIZE);
  const selected = visible.find(c => c.id === selectedId) ?? visible[0];
  const selectedIndex = Math.max(0, visible.findIndex(c => c.id === selected?.id));
  const selectedCell = selected ? archiveCell(selectedIndex) : DEFAULT_CELL;
  const labels = useMemo(() => Object.fromEntries(visible.map((course, i) => [`1:${archiveCell(i).row}`, course.name])), [visible]);

  const refresh = useCallback(async () => {
    const epoch = ++loadingEpoch.current;
    setLoading(true); setError(''); setServerWarning('');
    try {
      const localItems = await listStages();
      // Pro-created documents are owner-scoped on the server; legacy classrooms remain local.
      // Merge identities without changing the existing persistence backend or migrating data.
      const runtime = await fetch('/api/agent/runtime').then(r => r.ok ? r.json() : null).catch(() => null);
      let serverItems: StageListItem[] = [];
      if (runtime?.enabled) {
        try {
          const response = await fetch('/api/stages', { credentials: 'include' });
          if (!response.ok) throw new Error('Owner course index unavailable');
          const body = await response.json();
          if (!Array.isArray(body.stages)) throw new Error('Invalid owner course index');
          serverItems = body.stages;
        } catch {
          if (epoch === loadingEpoch.current) setServerWarning('云端课程暂时不可读取；下方仍保留本机课程。可稍后刷新重试。');
        }
      }
      const items = displayCourses<Course>([
        ...serverItems.map(item => ({ ...item, source: 'server' as const })),
        ...localItems.map(item => ({ ...item, source: 'device' as const })),
      ]);
      const hydrated = await Promise.all(items.map(async item => {
        const bookmark = await loadCurrentScene(item.id).catch(() => null);
        return { ...item, bookmark: bookmark?.sceneId ?? undefined, visitedAt: bookmark?.updatedAt };
      }));
      if (epoch !== loadingEpoch.current) return;
      setCourses(hydrated);
      setSelectedId(id => hydrated.some(c => c.id === id) ? id : hydrated[0]?.id ?? null);
      setPage(p => Math.min(p, Math.max(0, Math.ceil(hydrated.length / ARCHIVE_PAGE_SIZE) - 1)));
    } catch { if (epoch === loadingEpoch.current) setError('课程目录暂时不可读取。请重试或回到 OpenMAIC 检查课程；不会用示例课程替代。'); }
    finally { if (epoch === loadingEpoch.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => { loadingEpoch.current++; }; }, [refresh]);
  useEffect(() => {
    if (!arrival || loading) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('entry');
    window.history.replaceState(null, '', url.pathname + url.search);
    const timer = setTimeout(() => setArrival(false), reduced ? 80 : 1350);
    return () => clearTimeout(timer);
  }, [arrival, loading, reduced]);
  useEffect(() => {
    const node = root.current; if (!node) return;
    const resize = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    resize.observe(node); return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (phase === 'classroom' || phase === 'opening' || phase === 'returning') return;
    let id = 0, previous = performance.now();
    function frame(now: number) {
      const delta = Math.min(.05, (now - previous) / 1000); previous = now; elapsed.current += delta;
      const status = field.current?.update({ time: 26.56, elapsed: elapsed.current, delta, film: false, detail: phase !== 'archive', reduced, portrait: size.width < size.height * .8, visible: !document.hidden });
      if (status?.clarity && status.clarity > .8) setReady(true);
      id = requestAnimationFrame(frame);
    }
    id = requestAnimationFrame(frame); return () => cancelAnimationFrame(id);
  }, [phase, reduced, size.width, size.height]);
  const open = useCallback((id: string) => {
    if (courseRef.current) return;
    const node = viewport.current;
    const face = selected?.id === id ? node?.querySelector<HTMLElement>('.cine-cassette.selected .cassette-front') : null;
    sourceFace.current = face ?? null;
    if (!reduced && node && face) {
      const { x, y, width, height } = face.getBoundingClientRect();
      approachRef.current = startArchiveApproach(node, { x, y, width, height });
    }
    courseRef.current = id; setActiveId(id); setSurface('loading'); setTimedOut(false); setError('');
    setPhase('preparing');
    window.history.replaceState(null, '', classroomQuery(id));
  }, [reduced, selected?.id]);
  useEffect(() => {
    const id = params.get('course');
    if (!loading && id && handledLink.current !== id) {
      handledLink.current = id;
      const index = courses.findIndex(c => c.id === id);
      if (index >= 0) { setPage(Math.floor(index / ARCHIVE_PAGE_SIZE)); setSelectedId(id); }
      open(id); // Unknown ids use OpenMAIC's own not-found/access checks, not a fake archive.
    }
  }, [params, loading, courses, open]);
  const onSurfaceState = useCallback((state: typeof surface) => setSurface(state), []);
  useEffect(() => {
    if (phase !== 'preparing' || surface !== 'stage') return;
    let cancelled = false;
    void (async () => {
      const approach = approachRef.current;
      if (approach) {
        try { await waitFor(approach.finished, APPROACH_DURATION); } catch { /* A cancelled open does not advance. */ }
        if (cancelled) return;
        approach.settle();
        approachRef.current = null;
      }
      if (!cancelled) setPhase(reduced || !sourceFace.current ? 'classroom' : 'opening');
    })();
    return () => { cancelled = true; };
  }, [phase, surface, reduced]);
  useLayoutEffect(() => {
    if (phase !== 'opening') return;
    const node = root.current, view = viewport.current, frame = classroomFrame.current, body = classroomBody.current, face = sourceFace.current;
    if (!node || !view || !frame || !body || !face) { setPhase('classroom'); return; }
    const morph = unfoldArchiveCover({ root: node, viewport: view, frame, body, sourceFace: face });
    morphRef.current = morph;
    let cancelled = false;
    void waitFor(morph.finished, UNFOLD_DURATION).then(() => {
      if (cancelled) return;
      morph.settle();
      morphRef.current = null;
      setPhase('classroom');
    }).catch(() => {});
    return () => { cancelled = true; morph.cancel(); if (morphRef.current === morph) morphRef.current = null; };
  }, [phase]);
  useEffect(() => {
    if (phase !== 'preparing') return;
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, [phase]);
  const back = useCallback(() => {
    if (phase === 'returning' || phase === 'retreating') return;
    window.history.replaceState(null, '', '/reinlab');
    setTimedOut(false);
    if (phase === 'classroom' && !reduced && sourceFace.current) {
      setPhase('returning');
    } else {
      approachRef.current?.cancel(); approachRef.current = null;
      morphRef.current?.cancel(); morphRef.current = null;
      viewport.current?.style.removeProperty('transform');
      viewport.current?.style.removeProperty('transform-origin');
      viewport.current?.style.removeProperty('opacity');
      setActiveId(null); courseRef.current = null; handledLink.current = null; sourceFace.current = null;
      setPhase('detail'); void refresh();
    }
  }, [phase, reduced, refresh]);
  useLayoutEffect(() => {
    if (phase !== 'returning') return;
    const node = root.current, view = viewport.current, frame = classroomFrame.current, body = classroomBody.current, face = sourceFace.current;
    if (!node || !view || !frame || !body || !face) { setActiveId(null); setPhase('retreating'); return; }
    const morph = foldArchiveCover({ root: node, viewport: view, frame, body, sourceFace: face });
    morphRef.current = morph;
    let cancelled = false;
    void waitFor(morph.finished, UNFOLD_DURATION).then(() => {
      if (cancelled) return;
      morph.settle();
      morphRef.current = null;
      setActiveId(null);
      setPhase('retreating');
    }).catch(() => {});
    return () => { cancelled = true; morph.cancel(); if (morphRef.current === morph) morphRef.current = null; };
  }, [phase]);
  useEffect(() => {
    if (phase !== 'retreating') return;
    const view = viewport.current;
    if (!view) { courseRef.current = null; sourceFace.current = null; handledLink.current = null; setPhase('detail'); void refresh(); return; }
    const retreat = retreatFromArchive(view);
    retreatRef.current = retreat;
    let cancelled = false;
    void waitFor(retreat.finished, APPROACH_DURATION).then(() => {
      if (cancelled) return;
      retreat.settle();
      retreatRef.current = null;
      courseRef.current = null; sourceFace.current = null; handledLink.current = null;
      setPhase('detail'); void refresh();
    }).catch(() => {});
    return () => { cancelled = true; retreat.cancel(); if (retreatRef.current === retreat) retreatRef.current = null; };
  }, [phase, refresh]);
  useEffect(() => {
    if (activeId && !new URLSearchParams(window.location.search).has('course') && phase !== 'returning' && phase !== 'departing') back();
  }, [activeId, params, phase, back]);
  useEffect(() => { const handler = () => { if (!new URLSearchParams(location.search).has('course') && courseRef.current && phase !== 'returning') back(); }; window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler); }, [back, phase]);
  function choose(cell: Cell) {
    if (phase !== 'archive' && phase !== 'detail') return;
    const index = visible.findIndex((_, i) => archiveCell(i).row === cell.row);
    if (index >= 0) { setSelectedId(visible[index].id); setReady(false); setPhase('detail'); }
  }
  const leaveArchive = useCallback(() => {
    if (phase === 'departing') return;
    setPhase('departing');
    window.setTimeout(() => window.location.assign('http://127.0.0.1:5173/?return=archive'), reduced ? 80 : 1000);
  }, [phase, reduced]);
  const openCurriculum = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (reduced || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    window.dispatchEvent(new Event(OPEN_CURRICULUM_EVENT));
  };
  const failed = surface === 'error' || surface === 'not-found' || timedOut;
  const stageName = useStageStore(s => activeId && s.stage?.id === activeId ? s.stage.name : '');
  const currentSceneId = useStageStore(s => activeId && s.stage?.id === activeId ? s.currentSceneId : null);
  const isServerCourse = courses.find(course => course.id === activeId)?.source === 'server';
  useEffect(() => {
    if (phase === 'classroom' && activeId && isServerCourse && currentSceneId) {
      void saveCurrentScene(activeId, currentSceneId).catch(() => {});
    }
  }, [phase, activeId, isServerCourse, currentSceneId]);
  return <div className={`cinema-experience rhine-native ${reduced ? 'cine-reduced' : ''}`} ref={root} data-phase={phase} data-mode={phase === 'archive' ? 'archive' : 'detail'} onKeyDown={event => { if (event.key === 'Escape' && !['INPUT','TEXTAREA'].includes((event.target as HTMLElement).tagName)) { if (phase === 'opening' || phase === 'returning' || phase === 'retreating') return; if (activeId) back(); else setPhase('archive'); } }}>
    <div className="cine-scene-viewport" ref={viewport} inert={activeId !== null || phase === 'retreating'} aria-hidden={activeId !== null || phase === 'retreating'}>
      <div className="cine-fixed-stage cine-model-stage" style={{ transform: `translate(-50%, -50%) scale(${Math.min(size.width / 1920, size.height / 1080)})` }}>
        <ArchiveField ref={field} selected={selectedCell} courseLabels={labels} onSelect={choose} />
      </div>
    </div>
    {(!activeId || phase === 'preparing' || phase === 'retreating') && <>
      <header className="rhine-archive-header"><button onClick={leaveArchive} className="rhine-wordmark">RHINE LAB<span>LEARNING ARCHIVE / OPENMAIC</span></button><nav><button className="rhine-home-return" onClick={leaveArchive}><ArrowLeft size={13} /> 返回莱茵生命</button><Link href="/workspace">OpenMAIC · 聊天主页 <ArrowUpRight size={13} /></Link><Link href="/" onClick={openCurriculum}>课程创作 <ArrowUpRight size={13} /></Link></nav></header>
      <aside className="rhine-library-list"><div><Library size={13} /><span>已制作的课程 / {courses.length}</span><button aria-label="刷新课程目录" onClick={() => void refresh()} disabled={loading}><RefreshCw size={13} /></button></div>
        {serverWarning && <p role="alert" className="rhine-library-warning">{serverWarning}</p>}
        {loading ? <p>正在读取 OpenMAIC 课程…</p> : error ? <p role="alert">{error}</p> : !courses.length ? <p>这里还没有可学习的课程。<br />去 OpenMAIC 制作或导入课程，完成后会出现在档案库。<Link href="/">制作第一门课程 →</Link></p> : visible.map(course => <button key={course.id} className={selected?.id === course.id ? 'selected' : ''} onClick={() => { setSelectedId(course.id); setPhase('detail'); setReady(false); }}><span>{course.name}</span><small>{course.sceneCount} 个场景{course.bookmark ? ' · 已有阅读位置' : ''}</small></button>)}
        {courses.length > ARCHIVE_PAGE_SIZE && <div><button aria-label="上一页课程" disabled={!page} onClick={() => { setPage(p => p - 1); setPhase('archive'); }}><ChevronLeft size={13} /></button><span>{page + 1} / {Math.ceil(courses.length / ARCHIVE_PAGE_SIZE)}</span><button aria-label="下一页课程" disabled={(page + 1) * ARCHIVE_PAGE_SIZE >= courses.length} onClick={() => { setPage(p => p + 1); setPhase('archive'); }}><ChevronRight size={13} /></button></div>}
      </aside>
      {selected && <article className="rhine-course-cover"><span className="rhine-kicker">COURSE ARCHIVE / {String(courses.indexOf(selected) + 1).padStart(3,'0')}</span><h1>{selected.name}</h1><p>{selected.description || '已保存在 OpenMAIC 的课程。讲义、互动和课堂对话均由原生课堂提供。'}</p><dl><div><dt>来源</dt><dd>{selected.source === 'server' ? 'OpenMAIC Agent · 只读学习' : 'OpenMAIC · 本机课程'}</dd></div><div><dt>内容</dt><dd>{selected.sceneCount} 个真实场景</dd></div><div><dt>接续</dt><dd>{selected.bookmark ? '恢复上次有效的阅读位置' : '从课程起点开始'}</dd></div></dl>
        <button className="rhine-continue" disabled={loading || (phase === 'detail' && !ready && !reduced)} onClick={() => open(selected.id)}>{selected.bookmark ? '从书签继续' : '开始学习'}<ArrowRight size={17} /></button>
        <small>书签失效时由课堂恢复至有效场景；不虚构学习进度。</small>
      </article>}
      <footer className="rhine-archive-footer"><span>RHINE LAB · KNOWLEDGE DIVISION</span><span>真实课程 · 本地来源保持不变</span></footer>
    </>}
    {activeId && <div className="rhine-classroom-frame" ref={classroomFrame} data-visible={phase === 'classroom'} inert={phase !== 'classroom'}>
      <div className="rhine-classroom-top"><button onClick={back}><ArrowLeft size={14} />返回档案</button><span>{stageName || (selected?.id === activeId ? selected.name : 'OpenMAIC 课堂')}</span><Link href="/workspace">OpenMAIC <ArrowUpRight size={12} /></Link></div>
      {/* Marks the portal host for the classroom's own portalled chrome: the
          interactive-scene iframes and the scene-switch confirmation. Anything
          left on <body> paints under this archive's opaque fixed root. */}
      <div className="rhine-classroom-body" data-classroom-portal="" ref={classroomBody}><Classroom classroomId={activeId} variant="pane" allowBackgroundGeneration={false} serverCourse={isServerCourse} onSurfaceState={onSurfaceState} /></div>
    </div>}
    {activeId && phase === 'preparing' && <div className={`rhine-course-preparation ${failed ? 'is-failed' : ''}`} role="status">
      <span>{failed ? surface === 'not-found' ? '该课程不存在或当前身份不可访问。' : '课堂暂时无法就绪；原课程与书签未被替换。' : '正在调阅课程档案…'}</span>
      {failed && <button onClick={back}>返回档案</button>}
      {!failed && <button onClick={back} aria-label="取消打开课堂"><X size={14} /></button>}
    </div>}
    {(arrival || phase === 'departing') && <div className={`rhine-native-portal ${arrival ? loading ? 'is-loading' : 'is-arriving' : 'is-departing'}`} role="status">
      <div className="rhine-native-portal-folder" aria-hidden="true"><span>RHINE LAB / KNOWLEDGE DIVISION</span><i /></div>
      <div className="rhine-native-portal-leaf"><small>INTERNAL DATABASE / X—013</small><span>RHINE LAB</span><i /><b>{arrival ? 'OPENMAIC / LEARNING ARCHIVE' : 'RETURN / RHINE LAB'}</b></div>
      <p>{arrival ? loading ? '正在调阅真实课程…' : '档案库已就绪' : '正在归还莱茵生命档案…'}</p>
    </div>}
  </div>;
}
