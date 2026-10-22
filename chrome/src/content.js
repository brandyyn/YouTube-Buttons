/* Original implementation. Copyright 2026 Brandyn. No third-party runtime. */
(() => {
  'use strict';
  const {api, normalize} = YBSettings;
  const icons = {
  "compressor": [
    [
      "path",
      {
        "d": "M60 96v64a12 12 0 0 1-24 0V96a12 12 0 0 1 24 0m28-76a12 12 0 0 0-12 12v192a12 12 0 0 0 24 0V32a12 12 0 0 0-12-12m40 32a12 12 0 0 0-12 12v128a12 12 0 0 0 24 0V64a12 12 0 0 0-12-12m40 32a12 12 0 0 0-12 12v64a12 12 0 0 0 24 0V96a12 12 0 0 0-12-12m40-16a12 12 0 0 0-12 12v96a12 12 0 0 0 24 0V80a12 12 0 0 0-12-12"
      }
    ]
  ],
  "compressorOff": [
    [
      "path",
      {
        "d": "M60 96v64a12 12 0 0 1-24 0V96a12 12 0 0 1 24 0m-3.12-64.07a12 12 0 1 0-17.76 16.14L76 88.64V224a12 12 0 0 0 24 0V115l16 17.6V192a12 12 0 0 0 24 0v-33l59.12 65a12 12 0 0 0 17.76-16.14ZM128 80.54a12 12 0 0 0 12-12V64a12 12 0 0 0-24 0v4.54a12 12 0 0 0 12 12m40 44a12 12 0 0 0 12-12V96a12 12 0 0 0-24 0v16.54a12 12 0 0 0 12 12M208 68a12 12 0 0 0-12 12v76.54a12 12 0 0 0 24 0V80a12 12 0 0 0-12-12"
      }
    ]
  ],
  "slower": [
    [
      "path",
      {
        "d": "M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M7,13H17V11H7"
      }
    ]
  ],
  "faster": [
    [
      "path",
      {
        "d": "M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M13,7H11V11H7V13H11V17H13V13H17V11H13V7Z"
      }
    ]
  ],
  "screenshot": [
    [
      "path",
      {
        "d": "M9.4 10.5l4.77-8.26C13.47 2.09 12.75 2 12 2c-2.4 0-4.6.85-6.32 2.25l3.66 6.35.06-.1zM21.54 9c-.92-2.92-3.15-5.26-6-6.34L11.88 9h9.66zm.26 1h-7.49l.29.5 4.76 8.25C21 16.97 22 14.61 22 12c0-.69-.07-1.35-.2-2zM8.54 12l-3.9-6.75C3.01 7.03 2 9.39 2 12c0 .69.07 1.35.2 2h7.49l-1.15-2zm-6.08 3c.92 2.92 3.15 5.26 6 6.34L12.12 15H2.46zm11.27 0l-3.9 6.76c.7.15 1.42.24 2.17.24 2.4 0 4.6-.85 6.32-2.25l-3.66-6.35-.93 1.6z"
      }
    ]
  ]
};
  const newIcons = {
    slower: [['circle', {cx:12,cy:12,r:9}], ['path', {d:'M8 12h8'}]],
    faster: [['circle', {cx:12,cy:12,r:9}], ['path', {d:'M8 12h8m-4-4v8'}]],
    screenshot: [['path', {d:'M3 7h4l2-3h6l2 3h4v13H3z'}], ['circle', {cx:12,cy:13,r:4}]],
    compressor: [['path', {d:'M4 9v6m4-10v14m4-11v8m4-13v18m4-12v6'}]]
  };
  function setIcon(button, id) {
    if (id === 'speed' || button.dataset.iconStyle === settings.style) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', settings.style === 'original' && id === 'compressor' ? (audio?.enabled ? '0 0 256 256' : '-0.04834 3.94681 256 256') : '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const key = id === 'compressor' && !audio?.enabled ? 'compressorOff' : id;
    const paths = settings.style === 'new' ? newIcons[id] : icons[key];
    for (const [tag, attrs] of paths) {
      const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [name,value] of Object.entries(attrs)) shape.setAttribute(name,String(value));
      svg.append(shape);
    }
    button.replaceChildren(svg); button.dataset.iconStyle = settings.style;
  }
  let settings, desiredSpeed = 1, speedOwner = 'extension', compressionWanted = false;
  let rememberedSpeed = 1, speedVideoKey = '', restoringSpeed = false;
  let speedRoute = '';
  let anyEnabled = true, displayedRate = NaN, resumePromise = null, hasAudioSource = false, layoutDirty = true;
  let player = null, controls = null, video = null, group = null, buttons = new Map();
  let discovery = null, playerObserver = null, parentObserver = null, frame = 0;
  let videoEvents = null, audio = null, audioContext = null, notice = null, noticeTimer = 0, downloadTimer = 0;
  // Weak keys allow detached media and their graphs to be collected. Reusing a
  // YouTube media element must reuse its source: Web Audio cannot attach it twice.
  const audioGraphs = new WeakMap();
  let tooltip = null, tooltipButton = null;
  let autoplayControl = null, autoplayIcon = null, autoplayDirty = true;
  let screenshotBusy = false, dead = false, generation = 0, nativeSpeedTimer = 0;
  const urls = new Set();
  const lifetime = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, {signal: lifetime.signal});
  const clampSpeed = value => Math.round(Math.min(4, Math.max(.25, value)) * 1000) / 1000;
  const playerRoute = /^\/(?:watch$|live\/|embed\/)/;
  const activeRoute = () => playerRoute.test(location.pathname);
  const isAd = () => player?.classList.contains('ad-showing');
  function report(message) {
    if (!player) return;
    clearTimeout(noticeTimer);
    notice?.remove();
    notice = document.createElement('div');
    notice.className = 'yb-notice'; notice.setAttribute('role', 'status'); notice.textContent = message;
    player.append(notice);
    noticeTimer = setTimeout(() => { notice?.remove(); notice = null; }, 3500);
  }
  function updateSpeed() {
    const button = buttons.get('speed');
    const rate = video?.playbackRate ?? desiredSpeed;
    if (button?.isConnected && rate !== displayedRate) {
      displayedRate = rate;
      button.firstElementChild.textContent = (Math.round(rate * 1000) % 10 === 0 ? rate.toFixed(2) : rate.toFixed(3));
    }
  }
  function setSpeed(value) {
    if (!video || isAd()) return;
    clearTimeout(nativeSpeedTimer); nativeSpeedTimer = 0;
    desiredSpeed = rememberedSpeed = clampSpeed(value); speedOwner = 'extension'; restoringSpeed = false;
    if (video.playbackRate !== desiredSpeed) video.playbackRate = desiredSpeed;
    // YouTube may use defaultPlaybackRate when replacing media. Only set on explicit action.
    if (video.defaultPlaybackRate !== desiredSpeed) video.defaultPlaybackRate = desiredSpeed;
    updateSpeed();
    void api.storage.local.set({lastSpeed: desiredSpeed}).catch(() => {});
  }
  function rateChanged() {
    if (!video || isAd()) return;
    // Observe, never fight the native GUI. Accept every external rate change.
    if (!restoringSpeed && Math.abs(video.playbackRate - desiredSpeed) > .001) {
      speedOwner = 'youtube'; desiredSpeed = video.playbackRate;
    }
    updateSpeed();
  }
  function nativeSpeedSelection(event) {
    if (!video || !settings?.enabled.speed || isAd()) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element) || !player?.contains(target)) return;
    const control = target.closest('.ytp-variable-speed-panel-preset-button, input.ytp-speedslider, .ytp-variable-speed-panel-increment-button, .ytp-menuitem[role="menuitemradio"]');
    if (!control || !player.contains(control)) return;
    const preset = control.classList.contains('ytp-variable-speed-panel-preset-button') ? control : null;
    const slider = control.localName === 'input' ? control : null;
    const legacy = control.classList.contains('ytp-menuitem') ? control : null;
    if (event.type === 'input' && !slider) return;
    if (event.type === 'keydown' && !legacy) return; // Buttons generate their own click.
    const panel = control.closest('.ytp-variable-speed-panel-content');
    const range = slider || panel?.querySelector('input.ytp-speedslider');
    let selected = null;
    if (preset) {
      selected = Number(preset.querySelector('span')?.textContent.trim());
      // Do not turn a Premium upsell into an available speed.
      if (!range || selected < Number(range.min) || selected > Number(range.max)) return;
    } else if (legacy) {
      const siblings = legacy.parentElement?.querySelectorAll('[role="menuitemradio"]');
      if (!siblings || !Array.from(siblings).some(item => /^0[.,]25$/.test(item.textContent.trim()))) return;
      const label = legacy.querySelector('.ytp-menuitem-label')?.textContent.trim() || legacy.textContent.trim();
      if (/^\d+(?:[.,]\d+)?x?$/.test(label)) selected = Number(label.replace(',', '.').replace(/x$/, ''));
      else {
        // The single nonnumeric entry in the old speed radio menu is localized Normal.
        selected = 1;
      }
    }
    const media = video, epoch = generation;
    // YouTube caches its selected speed separately from HTMLMediaElement. A
    // reselected preset may not write playbackRate or emit ratechange at all.
    // Read the native control after its handler, then honor this explicit action.
    clearTimeout(nativeSpeedTimer);
    nativeSpeedTimer = setTimeout(() => {
      nativeSpeedTimer = 0;
      if (dead || epoch !== generation || video !== media || isAd()) return;
      const rate = selected ?? Number(range?.value);
      if (!Number.isFinite(rate) || rate < .25 || rate > 4) return;
      restoringSpeed = false; speedOwner = 'youtube'; desiredSpeed = rate;
      if (media.playbackRate !== rate) media.playbackRate = rate;
      if (media.defaultPlaybackRate !== rate) media.defaultPlaybackRate = rate;
      updateSpeed();
    }, 0);
  }
  function initialRate() {
    if (!video || isAd()) return;
    if (speedOwner === 'extension') video.playbackRate = desiredSpeed;
    updateSpeed();
  }
  function beginVideoSpeed() {
    clearTimeout(nativeSpeedTimer); nativeSpeedTimer = 0;
    desiredSpeed = rememberedSpeed; speedOwner = 'extension'; restoringSpeed = true;
    initialRate();
  }
  function readyVideoSpeed() {
    // YouTube restores its cached GUI speed during loading. Apply once more at
    // readiness, then accept subsequent changes; never police playbackRate.
    if (restoringSpeed && !isAd()) { initialRate(); restoringSpeed = false; }
  }
  function updateCompression() {
    const button = buttons.get('compressor');
    if (button) {
      const enabled = Boolean(audio?.enabled);
      const compressorOnly = settings.compressionEnabled && !settings.eqEnabled && settings.audioBoost === 1;
      const label = `${enabled ? 'Disable' : 'Enable'} ${compressorOnly ? 'audio compressor' : 'audio tweaks'}`;
      if (button.dataset.tooltip !== label) {
        button.dataset.tooltip = label; button.setAttribute('aria-label', label);
        if (tooltipButton === button) { hideTooltip(); showTooltip({target:button}); }
      }
      const pressed = enabled ? 'true' : 'false';
      if (button.getAttribute('aria-pressed') !== pressed) {
        button.setAttribute('aria-pressed', pressed);

        if (settings.style === 'original') {
          const svg = button.firstElementChild;
          svg.firstElementChild.setAttribute('d', icons[enabled ? 'compressor' : 'compressorOff'][0][1].d);
          // The source slashed artwork has a different painted centre from its
          // 256-square canvas. Normalize the viewport, keeping the source path.
          svg.setAttribute('viewBox', enabled ? '0 0 256 256' : '-0.04834 3.94681 256 256');
        }
      }
    }
  }
  function wireAudio(enabled) {
    if (!audio) return;
    const mode = enabled ? `${settings.eqEnabled}:${settings.compressionEnabled}` : 'bypass';
    const now = audio.context.currentTime;
    if (enabled) {
      if (!audio.output) audio.output = audio.context.createGain();
      if (audio.boost !== settings.audioBoost) {
        audio.output.gain.setTargetAtTime(settings.audioBoost, now, .015); audio.boost = settings.audioBoost;
      }
      if (settings.eqEnabled) {
        if (!audio.eq) {
          const headroom = audio.context.createGain();
          const filters = YBSettings.eqBands.map((frequency, index) => {
            const filter = audio.context.createBiquadFilter();
            filter.type = index === 0 ? 'lowshelf' : index === 4 ? 'highshelf' : 'peaking';
            filter.frequency.value = frequency; filter.Q.value = .7; return filter;
          });
          audio.eq = {headroom, filters, gains: []};
        }
        const eq = audio.eq;
        if (settings.eq.some((gain,index) => eq.gains[index] !== gain)) {
          for (let i=0; i<eq.filters.length; i++) eq.filters[i].gain.setTargetAtTime(settings.eq[i], now, .015);
          const boost = settings.eq.reduce((sum,gain) => sum + Math.max(0,gain), 0);
          eq.headroom.gain.setTargetAtTime(Math.pow(10,-boost/20), now, .015);
          eq.gains = settings.eq.slice();
        }
      }
      if (settings.compressionEnabled) {
        if (!audio.compressor) {
          audio.compressor = audio.context.createDynamicsCompressor();
          audio.compressor.attack.value = 0; audio.compressor.release.value = .25;
        }
        if (audio.amount !== settings.compressionAmount) {
          const amount = settings.compressionAmount / 100;
          audio.compressor.threshold.setTargetAtTime(-50*amount,now,.015);
          audio.compressor.knee.setTargetAtTime(40*amount,now,.015);
          audio.compressor.ratio.setTargetAtTime(1+11*amount,now,.015);
          audio.amount = settings.compressionAmount;
        }
      }
    }
    if (audio.mode === mode) { updateCompression(); return; }
    disconnectAudio();
    if (enabled) {
      let previous = audio.source;
      if (settings.eqEnabled) {
        previous.connect(audio.eq.headroom); previous = audio.eq.headroom;
        for (const filter of audio.eq.filters) { previous.connect(filter); previous = filter; }
      }
      if (settings.compressionEnabled) { previous.connect(audio.compressor); previous = audio.compressor; }
      previous.connect(audio.output); audio.output.connect(audio.context.destination);
    } else audio.source.connect(audio.context.destination);
    audio.enabled = enabled; audio.mode = mode; updateCompression();
  }
  function disconnectAudio() {
    audio.source.disconnect(); audio.compressor?.disconnect(); audio.output?.disconnect();
    if (audio.eq) { audio.eq.headroom.disconnect(); for (const filter of audio.eq.filters) filter.disconnect(); }
  }
  function resumeAudio() {
    if (!audioContext || audioContext.state === 'running') return null;
    if (!resumePromise) resumePromise = audioContext.resume().finally(() => { resumePromise = null; });
    return resumePromise;
  }
  async function applyCompression(userGesture = false) {
    const target = video;
    if (!target) return;
    const enabled = compressionWanted && settings.enabled.compressor;
    if (!enabled) {
      // A media-element source cannot be undone. Keep a direct bypass after first use.
      if (audio) { wireAudio(false); if (!target.paused) resumeAudio()?.catch(() => {}); }
      return;
    }
    // Never intercept an untouched video's audio outside an explicit user gesture.
    if (!audio && !userGesture) { updateCompression(); return; }
    try {
      if (!audio) {
        const context = audioContext ??= new AudioContext({latencyHint: 'playback'});
        const source = context.createMediaElementSource(target);
        hasAudioSource = true;
        audio = {context, source, compressor: null, eq: null, enabled: false, mode: 'bypass'};
        audioGraphs.set(target, audio);
        source.connect(context.destination);
      }
      const current = audio;
      const pending = resumeAudio();
      if (pending) await pending;
      if (video !== target || audio !== current || dead) return;
      wireAudio(compressionWanted && settings.enabled.compressor);
    } catch {
      compressionWanted = false;
      if (audio) wireAudio(false);
      if (audioContext && !hasAudioSource) {
        const unused = audioContext; audioContext = null;
        void unused.close().catch(() => {});
      }
      updateCompression();
      report('Audio processing unavailable. Disable other audio extensions, then reload this page.');
    }
  }
  async function toggleCompression() {
    compressionWanted = !audio?.enabled;
    await applyCompression(true);
    void api.storage.local.set({compressionWanted}).catch(() => {});
  }
  function releaseAudio() {
    if (!audio) return;
    // Preserve normal sound if YouTube moves this element into its miniplayer.
    if (video?.isConnected) wireAudio(false);
    else {
      disconnectAudio();
      audio.enabled = false; audio.mode = 'disconnected';
      if (audio.context.state === 'running') void audio.context.suspend().catch(() => {});
    }
    audio = null;
  }
  function attachVideo(next) {
    if (video === next) return;
    videoEvents?.abort(); releaseAudio();
    video = next; videoEvents = null;
    if (!video) return;
    videoEvents = new AbortController();
    audio = audioGraphs.get(video) ?? null;
    const signal = videoEvents.signal;
    video.addEventListener('ratechange', rateChanged, {signal});
    video.addEventListener('loadedmetadata', initialRate, {signal});
    video.addEventListener('loadstart', beginVideoSpeed, {signal});
    video.addEventListener('canplay', readyVideoSpeed, {signal});
    video.addEventListener('playing', readyVideoSpeed, {signal});
    if (audio && (!compressionWanted || !settings.enabled.compressor)) wireAudio(false);
    beginVideoSpeed(); updateCompression();
    if (audio && compressionWanted && settings.enabled.compressor) void applyCompression();
  }
  function timestamp(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }
  function screenshotTitle() {
    // The watch-page heading is the actual video title; the tab title may have
    // YouTube's notification count prepended. Embeds need the tab-title fallback.
    const heading = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, ytd-watch-metadata h1');
    const title = heading?.textContent.trim();
    return title || document.title.replace(/^\(\d+\)\s+/, '').replace(/ - YouTube$/, '');
  }
  function safeTitle(title) {
    let result = title.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 140);
    if (!result || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(result)) result = 'YouTube screenshot';
    return result;
  }
  async function screenshot() {
    if (screenshotBusy || !video) return;
    if (!video.videoWidth || video.readyState < 2) { report('Wait for a video frame before taking a screenshot.'); return; }
    screenshotBusy = true;
    const button = buttons.get('screenshot'); if (button) button.disabled = true;
    const canvas = document.createElement('canvas');
    const name = `${safeTitle(screenshotTitle())} ${timestamp(new Date())}.png`;
    const token = generation;
    try {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d', {alpha: false}).drawImage(video, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (dead || token !== generation) return;
      if (!blob) throw new Error('No image');
      const url = URL.createObjectURL(blob); urls.add(url);
      const link = document.createElement('a'); link.href = url; link.download = name;
      document.body.append(link); link.click(); link.remove();
      // One bounded queue; only a few very recent downloads can hold blob URLs.
      if (urls.size > 3) { const oldest = urls.values().next().value; URL.revokeObjectURL(oldest); urls.delete(oldest); }
      clearTimeout(downloadTimer);
      downloadTimer = setTimeout(revokeDownloads, 10000);
    } catch { report('Screenshot unavailable for this video (it may be protected).'); }
    finally { canvas.width = canvas.height = 0; screenshotBusy = false; if (button) button.disabled = false; }
  }
  function revokeDownloads() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  const registry = {
    slower: {label: 'Decelerate', run: event => setSpeed(video.playbackRate - settings.step * (event.ctrlKey ? 0.5 : event.shiftKey ? 2 : 1))},
    speed: {label: 'Reset', run: () => setSpeed(1)},
    faster: {label: 'Accelerate', run: event => setSpeed(video.playbackRate + settings.step * (event.ctrlKey ? 0.5 : event.shiftKey ? 2 : 1))},
    screenshot: {label: 'Take a screenshot', run: screenshot},
    compressor: {label: 'Audio Tweaks', run: toggleCompression}
  };
  function hideTooltip() {
    if (tooltip) tooltip.hidden = true;
    tooltipButton?.removeAttribute('aria-describedby'); tooltipButton = null;
  }
  function showTooltip(event) {
    const button = event.target.closest?.('button[data-yb]');
    if (!button || !group?.contains(button) || button.disabled || !player || !controls) return;
    if (tooltipButton === button && tooltip && !tooltip.hidden) return;
    hideTooltip();
    if (!tooltip) {
      tooltip = document.createElement('div'); tooltip.className = 'yb-tooltip ytp-tooltip ytp-bottom';
      tooltip.id = 'yb-control-tooltip'; tooltip.setAttribute('role', 'tooltip');
      const wrapper = document.createElement('div'); wrapper.className = 'ytp-tooltip-text-wrapper';
      const bottom = document.createElement('div'); bottom.className = 'ytp-tooltip-bottom-text';
      const text = document.createElement('span'); text.className = 'ytp-tooltip-text';
      bottom.append(text);
      for (const key of ['V']) { const badge = document.createElement('div'); badge.className = 'ytp-tooltip-keyboard-shortcut'; badge.dataset.key = key; badge.hidden = true; bottom.append(badge); }
      wrapper.append(bottom); tooltip.append(wrapper);
      player.append(tooltip);
    }
    tooltip.firstElementChild.firstElementChild.firstElementChild.textContent = button.dataset.tooltip;
    for (const badge of tooltip.querySelectorAll('.ytp-tooltip-keyboard-shortcut')) {
      badge.hidden = button.dataset.yb !== 'compressor'; badge.textContent = badge.hidden ? '' : badge.dataset.key;
    }
    tooltip.hidden = false; tooltipButton = button;
    button.setAttribute('aria-describedby', tooltip.id);
    // Layout is read only on entering a button, never during playback.
    const root = player.getBoundingClientRect(), rect = button.getBoundingClientRect(), bar = controls.getBoundingClientRect();
    const half = tooltip.offsetWidth / 2;
    tooltip.style.left = `${Math.max(8, Math.min(root.width - half * 2 - 8, rect.x + rect.width / 2 - root.x - half))}px`;
    // Native CSS controls appearance. Anchor to the control bar: YouTube's own
    // hidden tooltip can retain a stale top/bottom from a different control.
    tooltip.style.bottom = `${root.bottom - bar.top + 22}px`;
  }
  function leaveTooltip(event) {
    if (tooltipButton?.contains(event.relatedTarget)) return;
    hideTooltip();
  }
  function render() {
    if (!controls) return;
    hideTooltip();
    if (!group) {
      group = document.createElement('span'); group.className = 'yb-controls'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Youtube Buttons');
      group.addEventListener('pointerover', showTooltip); group.addEventListener('focusin', showTooltip);
      group.addEventListener('pointerout', leaveTooltip); group.addEventListener('focusout', leaveTooltip);
    }
    if (group.dataset.style !== settings.style) group.dataset.style = settings.style;
    const compressionColor = settings.compressionColor === 'inverted' ? '#ffffff' : settings.compressionColor;
    group.dataset.compressionMode = settings.compressionColor === 'inverted' ? 'inverted' : 'colour';
    if (group.style.getPropertyValue('--yb-compression-color') !== compressionColor) group.style.setProperty('--yb-compression-color', compressionColor);
    let cursor = group.firstElementChild;
    for (let index = 0; index < settings.order.length; index++) {
      const id = settings.order[index];
      let button = buttons.get(id);
      if (!settings.enabled[id]) {
        if (button === cursor) cursor = button.nextElementSibling;
        if (button?.parentNode) button.remove();
        continue;
      }
      if (!button) {
        const definition = registry[id];
        button = document.createElement('button'); button.type = 'button'; button.className = `${id === 'speed' ? 'ytp-time-display' : 'ytp-button'} yb-button yb-${id}`;
        button.dataset.yb = id; button.dataset.tooltip = definition.label; button.setAttribute('aria-label', definition.label);
        if (id === 'compressor') button.setAttribute('aria-keyshortcuts', 'V');
        button.addEventListener('click', event => { event.stopPropagation(); if (video) void definition.run(event); });
        if (id === 'speed') { const value = document.createElement('span'); value.className = 'yb-speed-value'; button.append(value); }
        buttons.set(id, button);
        if (id === 'speed') displayedRate = NaN;
      }
      setIcon(button, id);
      if (button !== cursor) group.insertBefore(button, cursor);
      cursor = button.nextElementSibling;
    }
    if (group.parentElement !== controls) controls.prepend(group);
    layoutDirty = false;
    updateSpeed(); updateCompression();
  }
  function runScheduled() { frame = 0; reconcile(); }
  function schedule() { if (!frame && !dead) frame = requestAnimationFrame(runScheduled); }
  function relevant(node) {
    if (node.nodeType !== 1) return false;
    if (node.classList.contains('yb-autoplay-icon')) return false;
    if (node.classList.contains('ytp-autonav-toggle-button') || node.classList.contains('ytp-autonav-toggle')) { autoplayDirty = true; return true; }
    if (node.localName === 'video' || node.id === 'movie_player' || node.id === 'player' || node.classList.contains('ytp-right-controls') || node.classList.contains('html5-video-player')) return true;
    if (node.firstElementChild === null) return false;
    const found = node.querySelector('video, .ytp-right-controls, .ytp-autonav-toggle-button');
    if (found?.classList.contains('ytp-autonav-toggle-button')) autoplayDirty = true;
    return found !== null;
  }
  function syncAutoplayIcon() {
    if (!settings.compactButtons) {
      autoplayIcon?.remove(); autoplayIcon = autoplayControl = null; autoplayDirty = true; return;
    }
    if (!autoplayDirty && (!autoplayControl || (autoplayControl.isConnected && autoplayIcon?.parentNode === autoplayControl))) return;
    autoplayIcon?.remove(); autoplayIcon = null;
    autoplayControl = player.querySelector('.ytp-autonav-toggle-button'); autoplayDirty = false;
    if (!autoplayControl) return;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.classList.add('yb-autoplay-icon');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const circle = document.createElementNS(ns, 'circle');
    for (const [key,value] of Object.entries({cx:12,cy:12,r:9,fill:'none',stroke:'currentColor','stroke-width':2.2})) circle.setAttribute(key,String(value));
    svg.append(circle);
    for (const [name,d] of [['pause','M8.5 8h2.5v8H8.5zm4.5 0h2.5v8H13z'],['play','M9 7.5 16.5 12 9 16.5z']]) {
      const path = document.createElementNS(ns, 'path'); path.classList.add('yb-autoplay-'+name);
      path.setAttribute('d', d); path.setAttribute('fill','currentColor'); svg.append(path);
    }
    autoplayIcon = svg; autoplayControl.append(svg);
  }
  function observePlayer() {
    playerObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.target === autoplayControl && autoplayIcon?.parentNode !== autoplayControl) { autoplayDirty = true; schedule(); return; }
        if (record.removedNodes.length && (!player.isConnected || (video && !video.isConnected) || (controls && !controls.isConnected) || (group && !group.isConnected) || (autoplayControl && !autoplayControl.isConnected))) { schedule(); return; }
        // Our labels/icons cannot add video or native controls. Ignore our own writes.
        if (record.target === group || group?.contains(record.target)) continue;
        for (const node of record.addedNodes) if (node !== group && relevant(node)) { schedule(); return; }
      }
    });
    playerObserver.observe(player, {childList: true, subtree: true});
    if (player.parentElement) {
      parentObserver = new MutationObserver(() => { if (!player?.isConnected) schedule(); });
      parentObserver.observe(player.parentElement, {childList: true});
    }
  }
  function discover() {
    if (discovery || !document.body) return;
    discovery = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (relevant(node)) { schedule(); return; }
    });
    discovery.observe(document.body, {childList: true, subtree: true});
  }
  function detach() {
    generation++;
    clearTimeout(nativeSpeedTimer); nativeSpeedTimer = 0;
    hideTooltip(); tooltip?.remove(); tooltip = null;
    discovery?.disconnect(); discovery = null;
    playerObserver?.disconnect(); playerObserver = null;
    parentObserver?.disconnect(); parentObserver = null;
    videoEvents?.abort(); videoEvents = null;
    releaseAudio(); video = null;
    group?.remove(); group = null; buttons.clear();
    autoplayIcon?.remove(); autoplayIcon = autoplayControl = null; autoplayDirty = true;
    displayedRate = NaN;
    layoutDirty = true;
    player?.classList.remove('yb-hide-autoplay', 'yb-compact-buttons'); player = controls = null;
    clearTimeout(noticeTimer); notice?.remove(); notice = null;
    clearTimeout(downloadTimer); revokeDownloads();
  }
  function reconcile() {
    if (!settings || dead) return;
    if (!activeRoute() || (!anyEnabled && !settings.hideAutoplay && !settings.compactButtons)) { detach(); return; }
    const route = location.href;
    if (route !== speedRoute) {
      speedRoute = route;
      const key = location.pathname + (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : '');
      if (key !== speedVideoKey) { speedVideoKey = key; beginVideoSpeed(); }
    }
    const nextPlayer = player?.isConnected ? player : document.querySelector('#movie_player, .html5-video-player');
    if (nextPlayer !== player) {
      detach(); player = nextPlayer;
      if (player) { observePlayer(); }
    }
    if (!player) { discover(); return; }
    player.classList.toggle('yb-hide-autoplay', settings.hideAutoplay);
    player.classList.toggle('yb-compact-buttons', settings.compactButtons);
    discovery?.disconnect(); discovery = null;
    const nextControls = controls?.isConnected && player.contains(controls) ? controls : player.querySelector('.ytp-right-controls');
    if (controls !== nextControls) { layoutDirty = true; autoplayDirty = true; }
    controls = nextControls;
    syncAutoplayIcon();
    attachVideo(video?.isConnected && player.contains(video) ? video : player.querySelector('video'));
    if (controls && (layoutDirty || group?.parentElement !== controls)) render();
  }
  function storageChanged(changes, area) {
    if (area !== 'local' || !changes.settings) return;
    const next = normalize(changes.settings.newValue);
    if (settings?.style !== next.style || settings?.compressionColor !== next.compressionColor) layoutDirty = true;
    const audioChanged = settings?.enabled.compressor !== next.enabled.compressor || settings?.eqEnabled !== next.eqEnabled || settings?.compressionEnabled !== next.compressionEnabled || settings?.compressionAmount !== next.compressionAmount || settings?.audioBoost !== next.audioBoost || next.eq.some((gain,index) => gain !== settings?.eq[index]);
    if (!settings) layoutDirty = true;
    else for (let i = 0; i < next.order.length; i++) {
      const id = next.order[i];
      if (settings.order[i] !== id || settings.enabled[id] !== next.enabled[id]) { layoutDirty = true; break; }
    }
    settings = next;
    anyEnabled = settings.order.some(id => settings.enabled[id]);
    reconcile(); updateCompression(); if (audio && audioChanged) void applyCompression();
  }
  function destroy() {
    if (dead) return;
    dead = true; cancelAnimationFrame(frame); frame = 0; detach(); lifetime.abort();
    if (audioContext) { void audioContext.close().catch(() => {}); audioContext = null; }
    // These extension event subscriptions belong to this document. The browser
    // releases them with its context; accessing extension APIs during pagehide
    // can target an already-invalidated context after an extension reload.
  }
  function autoplayMessage(message, sender, reply) {
    if (dead || window !== window.top || (message?.type !== 'yb-autoplay-get' && message?.type !== 'yb-autoplay-set')) return false;
    const control = document.querySelector('#movie_player .ytp-autonav-toggle-button, .html5-video-player .ytp-autonav-toggle-button');
    if (!control || !['true','false'].includes(control.getAttribute('aria-checked'))) {reply({available:false});return false;}
    if (message.type === 'yb-autoplay-set' && typeof message.enabled === 'boolean' && message.enabled !== (control.getAttribute('aria-checked') === 'true')) {
      (control.closest('button') || control.closest('.ytp-autonav-toggle') || control).click();
    }
    reply({available:true,enabled:control.getAttribute('aria-checked') === 'true'});return false;
  }
  api.runtime?.onMessage.addListener(autoplayMessage);
  on(document, 'yt-navigate-finish', schedule);
  on(document, 'yt-player-updated', schedule);
  for (const type of ['click', 'input', 'keydown']) document.addEventListener(type, nativeSpeedSelection, {capture: true, signal: lifetime.signal});
  on(window, 'popstate', schedule);
  function audioShortcut(event) {
    if (!video || !settings.enabled.compressor || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== 'v') return;
    const target = event.target;
    if (target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'keydown' && !event.repeat) void toggleCompression();
  }
  // Capture on window before YouTube's document/player handlers. Reserve the
  // complete key sequence, including repeats, without toggling more than once.
  for (const type of ['keydown', 'keypress', 'keyup']) window.addEventListener(type, audioShortcut, {capture:true, signal:lifetime.signal});
  // Keep BFCache restoration functional; final navigations release everything.
  on(window, 'pagehide', event => { if (!event.persisted) destroy(); else { cancelAnimationFrame(frame); frame = 0; detach(); } });
  on(window, 'pageshow', schedule);
  // Media may continue in YouTube's miniplayer after the toolbar is detached.
  // Capture events without retaining media elements or running a polling timer.
  document.addEventListener('play', event => {
    if (event.target === video && audio) void applyCompression();
    else if (audioContext && audioGraphs.has(event.target)) resumeAudio()?.catch(() => {});
  }, {capture: true, signal: lifetime.signal});
  document.addEventListener('pause', event => {
    if (audioContext?.state === 'running' && audioGraphs.has(event.target)) void audioContext.suspend().catch(() => {});
  }, {capture: true, signal: lifetime.signal});
  api.storage.onChanged.addListener(storageChanged);
  api.storage.local.get(['settings', 'lastSpeed', 'compressionWanted']).then(state => {
    if (dead) return;
    settings = normalize(state.settings); desiredSpeed = rememberedSpeed = clampSpeed(Number.isFinite(state.lastSpeed) ? state.lastSpeed : settings.speed);
    anyEnabled = settings.order.some(id => settings.enabled[id]);
    compressionWanted = state.compressionWanted === true;
    reconcile();
  }).catch(() => { if (!dead) { settings = normalize(); reconcile(); } });
})();
