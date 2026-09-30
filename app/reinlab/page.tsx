import { Suspense } from 'react';
import { RhineArchive } from '@/components/rhine/RhineArchive';
export default function RhineArchivePage() {
  return <Suspense fallback={<div className="rhine-loading"><span>RHINE LAB</span><small>正在调阅莱茵课程档案…</small></div>}><RhineArchive /></Suspense>;
}
