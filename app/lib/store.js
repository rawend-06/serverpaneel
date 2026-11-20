'use strict';
/* Kleine JSON-opslag: één bestand per onderwerp, veilig weggeschreven (eerst naar .tmp, dan hernoemen). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cache = new Map();
  function file(name) { return path.join(dir, `${name}.json`); }
  function read(name, def) {
    if (cache.has(name)) return cache.get(name);
    let v;
    try { v = JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { v = typeof def === 'function' ? def() : structuredClone(def); }
    cache.set(name, v);
    return v;
  }
  const timers = new Map();
  function write(name, v) {
    cache.set(name, v);
    clearTimeout(timers.get(name));
    timers.delete(name);
    const f = file(name), t = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 });
    fs.renameSync(t, f);
    return v;
  }
  function update(name, def, fn) { const v = read(name, def); const r = fn(v); write(name, v); return r === undefined ? v : r; }
  // lijst-collecties met id's
  function list(name) {
    const all = () => read(name, []);
    return {
      all,
      get: (id) => all().find((x) => x.id === id),
      add(item) { const it = { id: item.id || id(), createdAt: Date.now(), ...item }; update(name, [], (l) => { l.push(it); }); return it; },
      patch(idv, fields) { let out = null; update(name, [], (l) => { const x = l.find((y) => y.id === idv); if (x) { Object.assign(x, fields, { updatedAt: Date.now() }); out = x; } }); return out; },
      remove(idv) { let out = null; update(name, [], (l) => { const i = l.findIndex((y) => y.id === idv); if (i >= 0) [out] = l.splice(i, 1); }); return out; },
      replace(arr) { write(name, arr); },
    };
  }
  function id(n = 9) { return crypto.randomBytes(n).toString('base64url'); }
  return { read, write, update, list, id, dir };
};
