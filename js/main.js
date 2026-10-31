/* STARFORGE — main.js (core owner)
 * Boot: load save (deep-merged into registered defaults), offline progress, UI, loop, autosave.
 * Loaded LAST so every module has registered its state/tabs/mods/resources.
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;

  function boot() {
    if (SF.booted) return;
    const info = SF.save.load();
    SF.loadInfo = info;
    SF.mods.invalidate();
    SF.events.emit('load', info);

    // Offline progress (headless) before first render.
    let summary = null;
    if (!info.fresh && info.ts) {
      const away = (Date.now() - info.ts) / 1000;
      if (away > 10) {
        try { summary = SF.core.offline(away, 'offline'); } catch (e) { U.logOnce('offline', '[SF] offline progress failed', e); }
      }
    }

    SF.ui.init();
    SF.core.start();
    SF.booted = true;
    SF.events.emit('boot', info);

    if (info.error) SF.ui.toast('Your save could not be read and a fresh game was started. The old data was kept as a backup.', 'warn', { duration: 10000 });
    if (summary && summary.away >= 60) SF.ui.showWelcomeBack(summary);
    else if (info.fresh) SF.events.emit('newGame');

    // Autosave
    setInterval(() => {
      const s = SF.state.settings;
      if (!s.autosave) return;
      const interval = Math.max(5, Number(s.autosaveInterval) || 15) * 1000;
      if (Date.now() - SF.save.lastSaved >= interval) SF.save.save();
    }, 1000);
    SF.save.lastSaved = Date.now();
    SF.save.save();
    window.addEventListener('beforeunload', () => { if (SF.state.settings.autosave) SF.save.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && SF.state.settings.autosave) SF.save.save(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
