/* Browser-managed preference sync; no external service or polling. */
(() => {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const keys = ['settings', 'lastSpeed', 'compressionWanted'];
  const alarmName = 'save-preferences';
  const incoming = new Map();
  let queue = Promise.resolve();
  const enqueue = task => { queue = queue.then(task); };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Wake the event-driven context on browser startup so an alarm lost during a
  // restart is recreated from the pending values stored on disk.
  api.runtime.onStartup.addListener(() => {});
  api.runtime.onInstalled.addListener(() => {});
  async function schedule() {
    if (!await api.alarms.get(alarmName)) await api.alarms.create(alarmName, {delayInMinutes: 0.5});
  }
  async function applyRemote(values, pending) {
    const local = await api.storage.local.get(keys), patch = {};
    for (const key of keys) {
      if (values[key] !== undefined && !(key in pending) && !equal(local[key], values[key])) {
        patch[key] = values[key]; incoming.set(key, JSON.stringify(values[key]));
      }
    }
    if (Object.keys(patch).length) await api.storage.local.set(patch);
  }
  async function flush() {
    const {syncPending = {}} = await api.storage.local.get('syncPending');
    if (!Object.keys(syncPending).length) return;
    // Clear only after the browser accepts the write. Pending values remain on
    // disk if the worker exits or a write fails, and are retried on next startup.
    await api.storage.sync.set(syncPending);
    await api.storage.local.remove('syncPending');
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      const patch = {};
      for (const key of keys) {
        const change = changes[key];
        if (!change || equal(change.oldValue, change.newValue)) continue;
        if (incoming.get(key) === JSON.stringify(change.newValue)) { incoming.delete(key); continue; }
        if (change.newValue !== undefined) patch[key] = change.newValue;
      }
      if (Object.keys(patch).length) enqueue(async () => {
        const {syncPending = {}} = await api.storage.local.get('syncPending');
        await api.storage.local.set({syncPending: {...syncPending, ...patch}});
        await schedule();
      });
    } else if (area === 'sync') enqueue(async () => {
      const {syncPending = {}} = await api.storage.local.get('syncPending');
      const values = {};
      for (const key of keys) if (changes[key]) values[key] = changes[key].newValue;
      await applyRemote(values, syncPending);
    });
  });
  api.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName) enqueue(flush); });
  enqueue(async () => {
    const [local, remote] = await Promise.all([api.storage.local.get([...keys, 'syncPending']), api.storage.sync.get(keys)]);
    const pending = {...local.syncPending};
    // Existing cloud preferences win on a new installation. Upgrade an existing
    // local installation by uploading only values missing from cloud storage.
    for (const key of keys) if (remote[key] === undefined && local[key] !== undefined && !(key in pending)) pending[key] = local[key];
    if (Object.keys(pending).length) await api.storage.local.set({syncPending: pending});
    await applyRemote(remote, pending);
    if (Object.keys(pending).length) await schedule();
  });
})();
