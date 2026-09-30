/**
 * `/workspace` — the Pro workspace home.
 *
 * Pro mode used to be a `useState` on `app/page.tsx`, which meant the global
 * `SiteHeader` could not know about it and stacked a second navigation bar on
 * top of the workspace's own sidebar. As a route it is addressable instead:
 * `AppChrome` suppresses the header by path prefix, a refresh keeps you here,
 * and the workspace can be linked to.
 *
 * The gate is server-side and checks the pair of workbench flags:
 * `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` (build-time, client-visible) and
 * the server-only configured runtime truth. A workspace whose
 * every submit 404s is worse than no workspace, so either flag off redirects
 * to `/` rather than rendering. `/` hides its Pro badge behind the same pair,
 * learned through the `/api/agent/runtime` probe (the client cannot read the
 * server flag), so the entry and the destination agree.
 *
 * `force-dynamic` keeps the flags request-scoped instead of baking them into a
 * prerender.
 *
 * The Suspense boundary covers the route seam that reads the initial deep-link
 * snapshot from `useSearchParams`. Once mounted, the workspace owns pane state
 * locally and mirrors it with the History API, so ordinary pane changes do not
 * ask the server route to render again.
 *
 */
import { Suspense } from 'react';
import Link from 'next/link';
import { isWorkbenchEntryEnabled } from '@/lib/workbench/entry-gate';
import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { WorkspaceEntry } from '@/components/workbench/WorkspaceEntry';

export const dynamic = 'force-dynamic';

export default function WorkspacePage() {
  if (!isWorkbenchEntryEnabled()) return <main className="rhine-setup"><span>RHINE LAB / OPENMAIC</span><h1>课程创作工作区等待模型接入</h1><p>{isAgentRuntimeConfigured() ? '数据库与 Agent Runtime 已就绪；本地小模型无法稳定完成创课。请在本机 OpenMAIC 的 .env.local 配置 DEEPSEEK_API_KEY，再重新启动服务。不要在聊天中发送密钥。' : '聊天式创课需要 Agent Runtime、PostgreSQL 与可用的驱动模型。当前实例尚未满足启用条件；这里不会用模拟聊天替代。'}</p><p>已有课程仍可从档案库继续学习，也可使用 OpenMAIC 原有首页导入课程。</p><Link href="/reinlab">返回课程档案 →</Link><Link href="/">打开课程首页 →</Link></main>;

  return (
    <Suspense fallback={null}>
      <WorkspaceEntry />
    </Suspense>
  );
}
