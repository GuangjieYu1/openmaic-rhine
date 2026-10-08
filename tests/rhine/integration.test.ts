import { describe, it, expect } from 'vitest';
import { displayCourses, archiveCell, classroomQuery } from '@/lib/rhine/catalog';
import { durableActionStorage } from '@/lib/rhine/durable-action-storage';
const item = (id: string, count = 2) => ({ id, name: id, sceneCount: count, createdAt: 1, updatedAt: 2 });
const store = () => { const entries = new Map<string, string>(); return { getItem: (k:string) => entries.get(k) ?? null, setItem: (k:string,v:string) => { entries.set(k,v); } }; };
describe('Rhine native integration', () => {
 // `updatedAt` ties here, so the sort is stable and insertion order survives.
 it('lists each real course id once, not repeated decorative slots', () => expect(displayCourses([item('a'),item('a'),item('b',0)])).toEqual([item('a'),item('b',0)]));
 // The archive and the app read one library, so a course the app lists must not
 // be missing from the archive. A zero-scene course is still a course.
 it('keeps a course that has no scenes yet', () => expect(displayCourses([item('draft',0)])).toEqual([item('draft',0)]));
 it('still drops a row with no usable id or name', () => expect(displayCourses([item('',2),item('e',2)] as never)).toEqual([item('e',2)]));
 it('assigns all 32 page slots uniquely and encodes external ids safely', () => {expect(new Set(Array.from({length:32},(_,i)=>archiveCell(i).row)).size).toBe(32);expect(classroomQuery('a&b')).toBe('/reinlab?course=a%26b&from=reinlab');});
 it('falls back to existing session bookmarks and persists across new sessions', () => {const local=store(),session=store();session.setItem('course','old');const storage=durableActionStorage(local,session);expect(storage.getItem('course')).toBe('old');storage.setItem('course','new');expect(durableActionStorage(local,store()).getItem('course')).toBe('new');});
 it('keeps explicit clears authoritative instead of resurrecting old session entries',()=>{const local=store(),session=store();session.setItem('c','old');const s=durableActionStorage(local,session);s.setItem('c','{"version":1,"scenes":{}}');expect(s.getItem('c')).toBe('{"version":1,"scenes":{}}');expect(session.getItem('c')).toBe(s.getItem('c'));});
 it('does not throw when browser storage is unavailable', () => {const broken={getItem(){throw Error('denied');},setItem(){throw Error('full');}};expect(durableActionStorage(broken,broken).getItem('x')).toBeNull();expect(()=>durableActionStorage(broken,broken).setItem('x','y')).not.toThrow();});
});
