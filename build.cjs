const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
// Deterministic ZIP (stored entries): no packaging dependencies or shell tools.
function zip(directory, target) {
  const entries = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), name + '/');
      else entries.push({name, data: fs.readFileSync(path.join(dir, entry.name))});
    }
  }
  walk(directory);
  const parts = [], central = []; let offset = 0;
  for (const {name, data} of entries) {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i=0; i<8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const filename = Buffer.from(name), local = Buffer.alloc(30), header = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(0x800,6); local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc,14); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(filename.length,26);
    header.writeUInt32LE(0x02014b50); header.writeUInt16LE(20,4); header.writeUInt16LE(20,6); header.writeUInt16LE(0x800,8); header.writeUInt16LE(33,14);
    header.writeUInt32LE(crc,16); header.writeUInt32LE(data.length,20); header.writeUInt32LE(data.length,24); header.writeUInt16LE(filename.length,28); header.writeUInt32LE(offset,42);
    parts.push(local,filename,data); central.push(header,filename); offset += local.length+filename.length+data.length;
  }
  const directoryData = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directoryData.length,12); end.writeUInt32LE(offset,16);
  fs.writeFileSync(target, Buffer.concat([...parts,directoryData,end]));
}
for (const browser of ['chrome', 'firefox']) {
  const dir = path.join(root, browser);
  fs.mkdirSync(dir, {recursive: true});
  for (const name of ['src', 'icons']) fs.cpSync(path.join(root, name), path.join(dir, name), {recursive: true});
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.chrome.json')));
  if (browser === 'firefox') {
    delete manifest.minimum_chrome_version;
    manifest.background = {scripts: ['src/background.js']};
    manifest.browser_specific_settings = {gecko: {id: 'youtube-buttons@brandyn', strict_min_version: '142.0', data_collection_permissions: {required: ['none']}}};
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dir, 'LICENSE'));
  zip(dir, path.join(root, `Youtube-Buttons-${browser}-${manifest.version}.zip`));
}
console.log('Chrome and Firefox packages built.');
