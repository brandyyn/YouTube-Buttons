/* Original implementation. Copyright 2026 Brandyn. */
(() => {
  'use strict';
  const ids = ['compressor', 'slower', 'speed', 'faster', 'screenshot'];
  const labels = {slower: 'Slower', speed: 'Speed / reset', faster: 'Faster', screenshot: 'Screenshot', compressor: 'Audio compressor'};
  const eqBands = [60, 250, 1000, 4000, 12000];
  const defaults = () => ({order: ['slower', 'speed', 'faster', 'compressor', 'screenshot'], enabled: Object.fromEntries(ids.map(id => [id, true])), style: 'new', compressionColor: '#ff0000', customCompressionColor: '#4dff00', compressionColorChoice: 'red', eqEnabled: false, compressionEnabled: true, compressionAmount: 100, audioBoost: 1, eq: eqBands.map(() => 0), step: 0.1, speed: 1, compression: false, hideAutoplay: false, compactButtons: true});
  function normalize(raw) {
    const result = defaults();
    if (!raw || typeof raw !== 'object') return result;
    if (Array.isArray(raw.order)) result.order = [...new Set(raw.order.filter(id => ids.includes(id))), ...ids.filter(id => !raw.order.includes(id))];
    for (const id of ids) if (typeof raw.enabled?.[id] === 'boolean') result.enabled[id] = raw.enabled[id];
    if (Number.isFinite(raw.step)) result.step = Math.min(1, Math.max(0.05, raw.step));
    if (Number.isFinite(raw.speed)) result.speed = Math.min(4, Math.max(0.25, raw.speed));
    if (typeof raw.compressionColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.compressionColor)) result.compressionColor = raw.compressionColor.toLowerCase();
    if (raw.compressionColor === 'inverted') result.compressionColor = 'inverted';
    if (typeof raw.customCompressionColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.customCompressionColor)) result.customCompressionColor = raw.customCompressionColor.toLowerCase();
    else if (typeof raw.compressionColor === 'string') result.customCompressionColor = result.compressionColor === 'inverted' ? '#ff0000' : result.compressionColor;
    result.compressionColorChoice = ['red','blue','inverted','custom'].includes(raw.compressionColorChoice) ? raw.compressionColorChoice : ({'#ff0000':'red','#83d4ff':'blue',inverted:'inverted'}[result.compressionColor] || 'custom');

    result.eqEnabled = typeof raw.eqEnabled === 'boolean' ? raw.eqEnabled : raw.audioMode === 'eq';
    result.compressionEnabled = typeof raw.compressionEnabled === 'boolean' ? raw.compressionEnabled : raw.audioMode !== 'eq';
    if (Number.isFinite(raw.compressionAmount)) result.compressionAmount = Math.round(Math.min(100, Math.max(0, raw.compressionAmount)));
    const boost = Number.isFinite(raw.audioBoost) ? raw.audioBoost : Number.isFinite(raw.audioVolume) ? raw.audioVolume / 100 : 1;
    result.audioBoost = Math.round(Math.min(5, Math.max(0, boost)) * 100) / 100;
    if (Array.isArray(raw.eq)) result.eq = eqBands.map((_, index) => Number.isFinite(raw.eq[index]) ? Math.round(Math.min(12, Math.max(-12, raw.eq[index]))) : 0);
    if (raw.style === 'new' || raw.style === 'original') result.style = raw.style;
    result.compression = raw.compression === true;
    result.hideAutoplay = raw.hideAutoplay === true;
    if (typeof raw.compactButtons === 'boolean') result.compactButtons = raw.compactButtons;
    return result;
  }
  const api = globalThis.browser ?? globalThis.chrome;
  const read = async () => normalize((await api.storage.local.get('settings')).settings);
  // Callers write patches to individual keys inside settings via this single popup,
  // or content scripts use separate runtime state keys to avoid cross-tab clobbering.
  globalThis.YBSettings = {ids, labels, eqBands, defaults, normalize, api, read};
})();
