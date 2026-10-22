(() => {
  'use strict';
  const {api, read} = YBSettings;
  const list = document.querySelector('#buttons'), status = document.querySelector('#status');
  const groups = {compressor: {label: 'Audio Tweaks', ids: ['compressor']}, acceleration: {label: 'Acceleration Controls', ids: ['slower', 'speed', 'faster']}, screenshot: {label: 'Video Screenshot', ids: ['screenshot']}};
  let settings, order, dragged = null, saving = false, pendingSave = null;
  function save() {
    settings.order = order.flatMap(id => groups[id].ids);
    pendingSave = structuredClone(settings);
    void flushSave();
  }
  async function flushSave() {
    if (saving) return;
    saving = true;
    // A rapid slider drag retains at most one in-flight and one latest snapshot.
    while (pendingSave) {
      const snapshot = pendingSave; pendingSave = null;
      try { await api.storage.local.set({settings: snapshot}); }
      catch { status.hidden = false; status.textContent = 'Could not save. Reopen this panel.'; }
    }
    saving = false;
  }
  function move(id, target) {
    const index = order.indexOf(id);
    if (index === target || target < 0 || target >= order.length) return;
    order.splice(index, 1); order.splice(target, 0, id); render(); save();
  }
  function clearDropMarks() {
    list.classList.remove('drop-end');
    for (const row of list.children) row.classList.remove('drop-target','drop-after');
  }
  function dropPosition(row, clientY) {
    const rect=row.getBoundingClientRect();
    // Use the compact header even when an audio/settings panel is expanded.
    const header=row.querySelector('.toggle')?.getBoundingClientRect();
    const middle=header ? header.y+header.height/2 : rect.y+rect.height/2;
    const after=clientY>=middle;
    const insertion=order.indexOf(row.dataset.group)+(after?1:0);
    return {after,target:insertion-(order.indexOf(dragged)<insertion?1:0)};
  }
  document.addEventListener('dragover',event=>{
    if (!dragged || event.clientY<list.getBoundingClientRect().bottom || event.target.closest?.('li')) return;
    event.preventDefault();event.dataTransfer.dropEffect='move';clearDropMarks();list.classList.add('drop-end');
  });
  document.addEventListener('drop',event=>{
    if (!dragged || event.clientY<list.getBoundingClientRect().bottom || event.target.closest?.('li')) return;
    event.preventDefault();const id=dragged;dragged=null;clearDropMarks();move(id,order.length-1);
  });
  function speedSettings() {
    const details = document.createElement('details'), summary = document.createElement('summary');
    const stepValue=document.createElement('span');stepValue.className='step-value';stepValue.textContent=settings.step.toFixed(2)+'×';summary.append(stepValue);summary.title='Speed step settings';
    const panel = document.createElement('div'); panel.className = 'step-settings speed-panel';panel.hidden=true;details.settingsPanel=panel;
    details.addEventListener('toggle',()=>{panel.hidden=!details.open;});
    const label = document.createElement('label'); label.textContent = 'Speed step';
    const select = document.createElement('select'); select.id = 'step'; select.setAttribute('aria-label', 'Speed step');
    for (const value of [.05,.1,.2,.25,.5,1]) {const option = document.createElement('option'); option.value = value; option.textContent = value.toFixed(2) + '×'; select.append(option);}
    select.value = settings.step;
    select.addEventListener('change', () => {settings.step = Number(select.value); stepValue.textContent = settings.step.toFixed(2) + '×'; save();});
    label.append(select); const hint = document.createElement('small'); hint.textContent = 'Ctrl: ½ step · Shift: 2× step';
    panel.append(label, hint); details.append(summary); return details;
  }
  function paintRange(input) {
    const progress=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.setProperty('--range-fill',`${progress}%`);
  }
  function colourSettings() {
    const details = document.createElement('details'), summary = document.createElement('summary');
    summary.className = 'colour-swatch'; summary.title = 'Audio compression active colour'; summary.setAttribute('aria-label', summary.title);
    const swatch = colour => colour === 'inverted' ? 'linear-gradient(135deg, #333 50%, #fff 50%)' : colour;
    summary.style.setProperty('--swatch', swatch(settings.compressionColor));
    const panel = document.createElement('div'); panel.className = 'step-settings colour-settings';
    const label = document.createElement('label'); label.textContent = 'Active Colour';label.htmlFor='compression-colour';
    const input = document.createElement('input'); input.type = 'color'; input.id = 'compression-colour'; input.value = settings.customCompressionColor; input.setAttribute('aria-label', 'Audio compression active colour');
    input.title = 'Colour Picker'; input.setAttribute('aria-label', 'Colour Picker');
    input.addEventListener('input', () => summary.style.setProperty('--swatch', input.value));
    function markChoice() {
      input.dataset.selected = String(settings.compressionColorChoice === 'custom');
      for (const button of presets.children) button.setAttribute('aria-pressed', String(button.dataset.choice === settings.compressionColorChoice));
    }
    input.addEventListener('click', () => {
      if (settings.compressionColorChoice === 'custom') return;
      settings.compressionColor = settings.customCompressionColor; settings.compressionColorChoice = 'custom'; markChoice(); save();
    });
    input.addEventListener('change', () => {settings.compressionColor = settings.customCompressionColor = input.value; settings.compressionColorChoice = 'custom'; markChoice(); save();});

    panel.append(label,input);
    const presets = document.createElement('div'); presets.className = 'colour-presets';
    for (const [name, colour, choice] of [['YouTube Red','#ff0000','red'],["Brandyn's Blue",'#83d4ff','blue'],['Inverted','inverted','inverted']]) {
      const preset = document.createElement('button'); preset.type = 'button'; preset.textContent = name; preset.style.setProperty('--swatch', swatch(colour));
      preset.setAttribute('aria-label',name);preset.title=name;preset.dataset.choice=choice;
      preset.addEventListener('click', () => {settings.compressionColor = colour; settings.compressionColorChoice = choice; markChoice(); summary.style.setProperty('--swatch', swatch(colour)); save();});
      presets.append(preset);
    }
    markChoice(); panel.append(presets); details.append(summary, panel); return details;
  }
  function boostSetting() {
    const group=document.createElement('span');group.className='boost-setting';group.setAttribute('role','group');group.setAttribute('aria-label','Audio boost');
    const input=document.createElement('input');input.type='number';input.id='audio-boost';input.min='0';input.max='500';input.step='10';input.value=Math.round(settings.audioBoost*100);input.setAttribute('aria-label','Audio boost percent');input.title='Boost multiplies YouTube volume while Audio Tweaks is on.';
    const unit=document.createElement('span');unit.textContent='%';
    const fit=()=>{input.style.width=`${Math.max(1,input.value.length)}ch`;};fit();input.addEventListener('input',fit);
    function commit(value= input.valueAsNumber) {
      const percent=Number.isFinite(value)?Math.round(Math.max(0,Math.min(500,value))):Math.round(settings.audioBoost*100);
      input.value=percent;fit();settings.audioBoost=percent/100;save();
    }
    const minus=document.createElement('button');minus.type='button';minus.textContent='−';minus.setAttribute('aria-label','Decrease audio boost');minus.addEventListener('click',()=>commit((Number.isFinite(input.valueAsNumber)?input.valueAsNumber:settings.audioBoost*100)-10));
    const plus=document.createElement('button');plus.type='button';plus.textContent='+';plus.setAttribute('aria-label','Increase audio boost');plus.addEventListener('click',()=>commit((Number.isFinite(input.valueAsNumber)?input.valueAsNumber:settings.audioBoost*100)+10));
    for (const [button,path] of [[minus,'M2 4h5v1H2z'],[plus,'M2 4h5v1H2zM4 2h1v5H4z']]) {
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 9 9');svg.setAttribute('aria-hidden','true');svg.setAttribute('shape-rendering','crispEdges');
      const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',path);svg.append(shape);button.replaceChildren(svg);
    }
    input.addEventListener('change',()=>commit());input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit();}});
    const value=document.createElement('span');value.className='boost-value';value.append(input,unit);
    group.append(minus,value,plus);return group;
  }
  function audioSettings() {
    const details=document.createElement('details');details.className='audio-settings';
    const summary=document.createElement('summary');summary.className='audio-settings-cog';summary.title='Audio Tweaks settings';summary.setAttribute('aria-label',summary.title);
    const cog=document.createElementNS('http://www.w3.org/2000/svg','svg');cog.setAttribute('viewBox','0 0 24 24');cog.setAttribute('aria-hidden','true');
    const cogPath=document.createElementNS('http://www.w3.org/2000/svg','path');
    // A compact outlined gear, independent of platform emoji rendering.
    cogPath.setAttribute('d','M9.5 3h5l.5 2 1.7 1 2-.6 2.5 4.3-1.5 1.4v1.8l1.5 1.4-2.5 4.3-2-.6-1.7 1-.5 2h-5l-.5-2-1.7-1-2 .6-2.5-4.3 1.5-1.4v-1.8L2.8 9.7l2.5-4.3 2 .6 1.7-1 .5-2Z');
    const centre=document.createElementNS('http://www.w3.org/2000/svg','circle');centre.setAttribute('cx','12');centre.setAttribute('cy','12');centre.setAttribute('r','3');cog.append(cogPath,centre);summary.append(cog);
    const panel=document.createElement('div');panel.className='step-settings eq-settings audio-panel';panel.hidden=true;
    details.audioPanel=panel;
    details.addEventListener('toggle',()=>{panel.hidden=!details.open;});
    function toggle(text,key,callback) {
      const label=document.createElement('div');label.className='audio-feature-toggle';
      const input=document.createElement('input');input.type='checkbox';input.id=key;input.checked=settings[key];
      input.addEventListener('change',()=>{settings[key]=input.checked;callback(input.checked);save();});
      const caption=document.createElement('label');caption.htmlFor=key;caption.textContent=text;label.append(input,caption);panel.append(label);return input;
    }
    const eqPanel=document.createElement('div');eqPanel.className='eq-bands';eqPanel.hidden=!settings.eqEnabled;
    const amount=document.createElement('input');amount.type='range';amount.id='compression-amount';amount.min='0';amount.max='100';amount.step='1';amount.value=settings.compressionAmount;amount.setAttribute('aria-label','Compression amount');
    const amountValue=document.createElement('input');amountValue.type='number';amountValue.id='compression-percent';amountValue.min='0';amountValue.max='100';amountValue.step='1';amountValue.value=settings.compressionAmount;amountValue.setAttribute('aria-label','Compression percent');
    const fitAmount=()=>{amountValue.style.width=`${Math.max(1,amountValue.value.length)}ch`;};fitAmount();amountValue.addEventListener('input',fitAmount);
    const amountUnit=document.createElement('span');amountUnit.className='numeric-unit';const suffix=document.createElement('span');suffix.textContent='%';amountUnit.append(amountValue,suffix);
    const compression=toggle('Audio Compression','compressionEnabled',value=>{amount.disabled=!value;amountValue.disabled=!value;});
    compression.parentElement.classList.add('compression-row');compression.parentElement.append(amount,amountUnit);
    amount.disabled=amountValue.disabled=!settings.compressionEnabled;
    function compressionCommit(value) {
      const number=Number.isFinite(value)?Math.round(Math.max(0,Math.min(100,value))):settings.compressionAmount;
      settings.compressionAmount=number;amount.value=number;amountValue.value=number;fitAmount();paintRange(amount);save();
    }
    amount.addEventListener('input',()=>{amountValue.value=amount.value;fitAmount();paintRange(amount);});paintRange(amount);
    amount.addEventListener('change',()=>compressionCommit(Number(amount.value)));
    amountValue.addEventListener('change',()=>compressionCommit(amountValue.valueAsNumber));
    amountValue.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();compressionCommit(amountValue.valueAsNumber);}});
    const eqToggle=toggle('Equalizer','eqEnabled',value=>{eqPanel.hidden=!value;reset.hidden=!value;});
    const inputs = [];
    YBSettings.eqBands.forEach((frequency, index) => {
      const band = document.createElement('label'); band.className = 'eq-band';
      const text = frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
      const name = document.createElement('span'); name.className='eq-frequency'; name.textContent = text;
      const input = document.createElement('input'); input.type = 'range'; input.min = '-12'; input.max = '12'; input.step = '1'; input.value = settings.eq[index]; input.dataset.eqBand = index; input.setAttribute('aria-label', text);
      const output=document.createElement('span');output.className='numeric-unit eq-value';
      const numeric=document.createElement('input');numeric.type='number';numeric.min='-12';numeric.max='12';numeric.step='1';numeric.dataset.eqValue=index;numeric.setAttribute('aria-label',text+' gain (dB)');
      const suffix=document.createElement('span');suffix.textContent='dB';output.append(numeric,suffix);
      const update=()=>{numeric.value=input.value;paintRange(input);};update();
      function commit(value) {
        const gain=Number.isFinite(value)?Math.round(Math.min(12,Math.max(-12,value))):settings.eq[index];
        settings.eq[index]=gain;input.value=gain;update();save();
      }
      input.addEventListener('input',update);input.addEventListener('change',()=>commit(Number(input.value)));
      numeric.addEventListener('change',()=>commit(numeric.valueAsNumber));
      numeric.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit(numeric.valueAsNumber);}});
      inputs.push({input, update}); band.append(name, input, output); eqPanel.append(band);
    });
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset EQ';
    reset.addEventListener('click', () => {settings.eq.fill(0); for (const {input, update} of inputs) { input.value = '0'; update(); } save();});
    reset.className='reset-eq';reset.hidden=!settings.eqEnabled;eqPanel.append(reset);panel.append(eqPanel);
    const colour=colourSettings().querySelector('.colour-settings');colour.className='audio-colours';panel.append(colour);
    details.append(summary);return details;
  }
  function render() {
    list.replaceChildren();
    order.forEach((id, index) => {
      const definition = groups[id], row = document.createElement('li'); row.dataset.group = id;
      const handle = document.createElement('span'); handle.className = 'handle'; handle.textContent = '⠿'; handle.draggable = true; handle.title = 'Drag to reorder ' + definition.label;
      handle.addEventListener('dragstart', event => {dragged = id; event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging');});
      handle.addEventListener('dragend', () => {dragged = null; clearDropMarks();for(const item of list.children)item.classList.remove('dragging');});
      row.addEventListener('dragover', event => {
        if (!dragged) return;
        event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';clearDropMarks();
        row.classList.add(dropPosition(row,event.clientY).after?'drop-after':'drop-target');
      });
      row.addEventListener('dragleave', event => {if(!row.contains(event.relatedTarget))row.classList.remove('drop-target','drop-after');});
      row.addEventListener('drop', event => {
        if(!dragged)return;
        event.preventDefault();event.stopPropagation();const target=dropPosition(row,event.clientY).target,source=dragged;
        dragged=null;clearDropMarks();move(source,target);
      });
      const label = document.createElement('label'); label.className = 'toggle';
      const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.dataset.button = id;
      toggle.checked = definition.ids.every(key => settings.enabled[key]); toggle.indeterminate = !toggle.checked && definition.ids.some(key => settings.enabled[key]);
      toggle.addEventListener('change', () => {for (const key of definition.ids) settings.enabled[key] = toggle.checked; toggle.indeterminate = false; save();});
      label.append(toggle, document.createTextNode(definition.label)); row.append(handle, label);
      if (id === 'acceleration') {const speedDetails=speedSettings();row.append(speedDetails,speedDetails.settingsPanel);}
      if (id === 'compressor') {
        const audioDetails=audioSettings();
        row.append(boostSetting(), audioDetails, audioDetails.audioPanel);
        for (const details of row.querySelectorAll('details')) details.addEventListener('toggle', () => {
          if (details.open) for (const other of row.querySelectorAll('details')) if (other !== details) other.open = false;
        });
      }
      const moves = document.createElement('span'); moves.className = 'moves';
      for (const direction of [-1, 1]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = direction < 0 ? '↑' : '↓'; button.dataset.move = `${id}:${direction}`;
        button.title = `Move ${definition.label} ${direction < 0 ? 'left' : 'right'}`; button.setAttribute('aria-label', button.title);
        button.disabled = index + direction < 0 || index + direction >= order.length;
        button.addEventListener('click', () => {move(id, index + direction); list.querySelector(`[data-move="${id}:${direction}"]`)?.focus();});
        moves.append(button);
      }
      row.append(moves); list.append(row);
    });
  }
  const extra=document.querySelector('#extra-options');
  document.addEventListener('click',event=>{if(extra.open&&!extra.contains(event.target))extra.open=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&extra.open){extra.open=false;extra.querySelector('summary').focus();}});
  let autoplayTab=null;
  async function loadAutoplay() {
    const toggle=document.querySelector('#autoplay-enabled');toggle.disabled=true;
    try {
      const tabs=await api.tabs.query({active:true,currentWindow:true});autoplayTab=tabs[0]?.id;
      const state=await api.tabs.sendMessage(autoplayTab,{type:'yb-autoplay-get'},{frameId:0});
      if(!state?.available)throw new Error('Unavailable');toggle.checked=state.enabled;toggle.disabled=false;toggle.title='YouTube autoplay';
    }catch {toggle.title='Open a YouTube video to change autoplay';}
  }
  document.querySelector('#autoplay-enabled').addEventListener('change',async event=>{
    const toggle=event.target;toggle.disabled=true;
    try {const state=await api.tabs.sendMessage(autoplayTab,{type:'yb-autoplay-set',enabled:toggle.checked},{frameId:0});if(!state?.available)throw new Error('Unavailable');toggle.checked=state.enabled;toggle.disabled=false;}
    catch {void loadAutoplay();}
  });
  read().then(value => {
    settings = value;
    const compact=document.querySelector('#compact-buttons');compact.checked=settings.compactButtons;
    compact.addEventListener('change',()=>{settings.compactButtons=compact.checked;save();});
    const hide=document.querySelector('#autoplay-hide');hide.checked=settings.hideAutoplay;
    hide.addEventListener('change',()=>{settings.hideAutoplay=hide.checked;save();});
    void loadAutoplay();
    order = [...new Set(settings.order.map(id => id === 'slower' || id === 'speed' || id === 'faster' ? 'acceleration' : id))];
    render();
  }).catch(() => {status.hidden = false; status.textContent = 'Settings unavailable. Reopen the panel.';});
})();
