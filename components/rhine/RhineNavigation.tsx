'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
export function RhineNavigation() {
  const path = usePathname();
  if (path.startsWith('/reinlab') || path.startsWith('/classroom') || path.startsWith('/eval')) return null;
  return <Link className="rhine-global-link" href="/reinlab">← 莱茵生命 · 课程档案</Link>;
}
