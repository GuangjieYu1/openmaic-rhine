import { describe, expect, it, vi } from 'vitest';
import { fetchOwnerCourse } from '@/lib/rhine/server-course';

describe('owner-scoped archive course loading', () => {
  it('loads a workbench document without using the legacy share endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stage: { id: 'stage-a', name: '群论' }, scenes: [{ id: 'scene-a' }] }),
    });
    const result = await fetchOwnerCourse('stage-a', fetcher);
    expect(fetcher).toHaveBeenCalledWith('/api/stages/stage-a', { credentials: 'include' });
    expect(result).toMatchObject({ outcome: 'found', classroom: { stage: { name: '群论' } } });
  });
  it('keeps transport failures retryable and only calls an explicit miss absent', async () => {
    expect(await fetchOwnerCourse('missing', vi.fn().mockResolvedValue({ ok: false, status: 404 }))).toEqual({ outcome: 'absent' });
    expect(await fetchOwnerCourse('blocked', vi.fn().mockResolvedValue({ ok: false, status: 503 }))).toEqual({ outcome: 'unavailable', status: 503 });
    expect(await fetchOwnerCourse('broken', vi.fn().mockRejectedValue(Error('network')))).toEqual({ outcome: 'unavailable' });
  });
  it('rejects malformed or mismatched owner documents', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stage: { id: 'other' }, scenes: [] }) });
    expect(await fetchOwnerCourse('stage-a', fetcher)).toEqual({ outcome: 'unavailable' });
  });
});
