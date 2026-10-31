/* STARFORGE — state.js (core owner)
 * State slices, defaults registry, deep-merge load, sanitize, save/load/export/import/hard reset.
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;

  SF.state = {};
  const defaults = Object.create(null);
  let rawSave = null; // parsed save data (data object), kept so late-registered slices still load

  /**
   * In-place deep merge of saved values into a defaults object.
   * - plain objects recurse; arrays and primitives replace
   * - keys missing from defaults are kept (dynamic maps like {upgId:true})
   * - type mismatches keep the default (protects against corrupted / old-format saves)
   */
  function mergeInto(target, saved) {
    if (!U.isObj(target) || !U.isObj(saved)) return target;
    for (const k of Object.keys(saved)) {
      const sv = saved[k];
      const tv = target[k];
      if (U.isObj(tv) && U.isObj(sv)) { mergeInto(tv, sv); continue; }
      if (tv === undefined || tv === null) { target[k] = sv; continue; }
      if (sv === null || sv === undefined) continue; // e.g. Infinity serialized as null -> keep default
      if (Array.isArray(tv)) { if (Array.isArray(sv)) target[k] = sv; continue; }
      if (typeof tv === typeof sv) target[k] = sv;
    }
    return target;
  }
  U.mergeInto = mergeInto;

  /**
   * Register a state slice. defaultsFn() must return a fresh plain object (JSON-serializable).
   * Returns the live slice. Always access state via SF.state.<key> (never cache the object
   * across resets; reset fns typically replace it via SF.resetState).
   */
  SF.registerState = function (key, defaultsFn) {
    if (typeof defaultsFn !== 'function') throw new Error('registerState(' + key + '): defaultsFn must be a function');
    defaults[key] = defaultsFn;
    const fresh = defaultsFn();
    if (rawSave && U.isObj(rawSave[key])) mergeInto(fresh, U.clone(rawSave[key]));
    SF.state[key] = fresh;
    return fresh;
  };
  /** Fresh copy of a slice's defaults (or undefined). */
  SF.defaultState = (key) => (defaults[key] ? defaults[key]() : undefined);
  /** Replace a slice with its defaults; returns the new slice. */
  SF.resetState = function (key) {
    if (!defaults[key]) return undefined;
    SF.state[key] = defaults[key]();
    return SF.state[key];
  };
  SF.stateKeys = () => Object.keys(defaults);

  /* ------------------------------------------------------ core-owned slices */
  SF.registerState('core', () => ({
    time: 0,          // total played seconds (game time, incl. offline simulation)
    realTime: 0,      // seconds with the page open
    offlineTime: 0,   // seconds credited by offline progress
    created: Date.now(),
    lastSeen: Date.now(),
    activeTab: null,
    seenTabs: {},
    saves: 0,
    ticks: 0,
  }));
  SF.registerState('settings', () => ({
    notation: 'standard',  // standard | scientific | engineering | log
    autosave: true,
    autosaveInterval: 15,  // seconds
    offline: true,         // offline progress
    confirmations: true,   // confirm dialogs for resets etc.
    sound: true,
    volume: 0.5,           // 0..1
    music: false,
    particles: 'high',     // off | low | high
    shake: true,
    floatText: true,
    tween: true,           // header number tweening
    toasts: true,
  }));

  /* -------------------------------------------------------------- sanitize */
  /** Walk state: NaN -> 0, +-Infinity / >1e300 -> clamped. Logs offending paths once. */
  function sanitize(obj, path, depth) {
    if (depth > 14 || !obj || typeof obj !== 'object') return;
    const keys = Array.isArray(obj) ? obj.keys() : Object.keys(obj);
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'number') {
        if (v !== v || v === Infinity || v === -Infinity || v > 1e300 || v < -1e300) {
          const fixed = U.cap(v);
          if (v !== v || !isFinite(v)) U.logOnce('nan:' + path + '.' + k, '[SF] sanitized invalid number at state.' + path + '.' + k + ' (' + v + ' -> ' + fixed + ')');
          obj[k] = fixed;
        }
      } else if (v && typeof v === 'object') sanitize(v, path + '.' + k, depth + 1);
    }
  }
  SF.sanitizeState = () => { for (const k of Object.keys(SF.state)) sanitize(SF.state[k], k, 0); };

  /* ------------------------------------------------------------------ save */
  const KEY = 'starforge_save_v1';
  const replacer = (k, v) => (typeof v === 'number' && !isFinite(v) ? (v !== v ? 0 : v > 0 ? 1e300 : -1e300) : v);

  const Save = (SF.save = {
    KEY,
    lastSaved: 0,
    disabled: false, // set true during hard reset / import reload so beforeunload doesn't overwrite

    /** Full JSON string of the game (emits 'save' first so modules can flush). */
    serialize() {
      SF.events.emit('save');
      SF.sanitizeState();
      SF.state.core.lastSeen = Date.now();
      return JSON.stringify({ v: 1, version: SF.VERSION, ts: Date.now(), data: SF.state }, replacer);
    },

    /** Write to localStorage. Returns true on success. */
    save() {
      if (Save.disabled) return false;
      try {
        SF.state.core.saves++;
        localStorage.setItem(KEY, Save.serialize());
        Save.lastSaved = Date.now();
        return true;
      } catch (e) {
        U.logOnce('save-fail', '[SF] save failed', e);
        if (SF.ui && SF.ui.toast) SF.ui.toast('Save failed: ' + (e && e.message), 'warn');
        return false;
      }
    },

    /** Parse a JSON save string or object -> {ts, data} or throws. */
    parse(str) {
      const obj = typeof str === 'string' ? JSON.parse(str) : str;
      if (!obj || !U.isObj(obj.data)) throw new Error('Not a STARFORGE save');
      return obj;
    },

    /**
     * Apply a parsed save to state (deep-merge into registered defaults, in place).
     * Returns {ok, ts, fresh}.
     */
    apply(obj) {
      const parsed = Save.parse(obj);
      rawSave = parsed.data;
      for (const key of Object.keys(parsed.data)) {
        const sv = parsed.data[key];
        if (defaults[key]) {
          const fresh = defaults[key]();
          mergeInto(fresh, U.clone(sv));
          SF.state[key] = fresh;
        } else if (U.isObj(sv)) {
          SF.state[key] = U.clone(sv); // unknown slice: keep so data isn't lost
        }
      }
      SF.sanitizeState();
      return { ok: true, ts: parsed.ts || 0, fresh: false };
    },

    /** Load from localStorage. Returns {ok, ts, fresh, error?}. */
    load() {
      let str = null;
      try { str = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
      if (!str) return { ok: true, ts: 0, fresh: true };
      try {
        return Save.apply(str);
      } catch (e) {
        U.logOnce('load-fail', '[SF] failed to load save; starting fresh (backup kept)', e);
        try { localStorage.setItem(KEY + '_corrupt', str); } catch (e2) { /* ignore */ }
        return { ok: false, ts: 0, fresh: true, error: String(e && e.message) };
      }
    },

    /** Base64 export string. */
    export() { const str = U.b64encode(Save.serialize()); SF.events.emit('export', { length: str.length }); return str; },

    /**
     * Import a base64 (or raw JSON) save. Validates, backs up current save, stores and reloads.
     * Returns true if accepted (page reloads), false if invalid.
     * opts.reload === false: apply in place without reload (used by tests).
     */
    import(str, opts) {
      let json;
      try {
        const s = String(str || '').trim();
        json = s.startsWith('{') ? s : U.b64decode(s);
        Save.parse(json);
      } catch (e) {
        if (SF.ui && SF.ui.toast) SF.ui.toast('Invalid save data.', 'warn');
        return false;
      }
      // back up the LIVE game (not the last autosave, which may be up to an interval old)
      try { localStorage.setItem(KEY + '_backup', Save.serialize()); } catch (e) { /* ignore */ }
      if (opts && opts.reload === false) { Save.apply(json); SF.events.emit('load', { ok: true, imported: true }); return true; }
      try { localStorage.setItem(KEY, json); } catch (e) { return false; }
      Save.disabled = true;
      location.reload();
      return true;
    },

    /** Stored backups: {backup: {ts}|null, corrupt: bool}. 'backup' is written by import, 'corrupt' by a failed load. */
    backups() {
      const out = { backup: null, corrupt: false };
      try {
        const b = localStorage.getItem(KEY + '_backup');
        if (b) { let ts = 0; try { ts = JSON.parse(b).ts || 0; } catch (e) { /* ignore */ } out.backup = { ts }; }
        out.corrupt = !!localStorage.getItem(KEY + '_corrupt');
      } catch (e) { /* storage blocked */ }
      return out;
    },
    /** Restore a stored backup ('backup' | 'corrupt'). The current game becomes the new backup. */
    restoreBackup(kind) {
      let str = null;
      try { str = localStorage.getItem(KEY + '_' + (kind === 'corrupt' ? 'corrupt' : 'backup')); } catch (e) { /* ignore */ }
      if (!str) { if (SF.ui && SF.ui.toast) SF.ui.toast('No backup found.', 'warn'); return false; }
      return Save.import(str);
    },

    /** Wipe everything. Asks for confirmation (twice) unless force === true. */
    hardReset(force) {
      const doIt = () => {
        Save.disabled = true;
        try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '_backup'); localStorage.removeItem(KEY + '_corrupt'); } catch (e) { /* ignore */ }
        location.reload();
      };
      if (force === true) return doIt();
      if (SF.ui && SF.ui.confirm) {
        SF.ui.confirm('This will permanently erase ALL progress — every forge, shard, relic and echo. There is no undo.', () => {
          SF.ui.confirm('Are you absolutely sure? Last chance.', doIt, { title: 'Really erase everything?', yesText: 'Erase forever', danger: true, force: true });
        }, { title: 'Hard Reset', yesText: 'Erase my save', danger: true, force: true });
      } else if (window.confirm('Erase ALL progress?')) doIt();
    },
  });
})();
