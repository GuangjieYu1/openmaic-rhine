type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** Mirror only validated action-resume records. Preserve original session records as a fallback. */
export function durableActionStorage(local?: Store, session?: Store): Store {
  return {
    getItem(key) {
      try { const value = local?.getItem(key); if (value !== null && value !== undefined) return value; } catch { /* storage may be denied */ }
      try { return session?.getItem(key) ?? null; } catch { return null; }
    },
    setItem(key, value) {
      try { local?.setItem(key, value); } catch { /* native session fallback remains usable */ }
      try { session?.setItem(key, value); } catch { /* storage is best effort, never stop playback */ }
    },
  };
}
export function browserActionStorage(): Store {
  let local: Store | undefined, session: Store | undefined;
  try { local = window.localStorage; } catch { /* denied */ }
  try { session = window.sessionStorage; } catch { /* denied */ }
  return durableActionStorage(local, session);
}
