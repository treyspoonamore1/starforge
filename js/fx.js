/* STARFORGE — fx.js (fx owner)
 * Juice layer: canvas particle system, floating text, screen shake, procedural WebAudio sounds,
 * rarity beams and big celebration overlays. Everything is a safe no-op when the canvas or
 * AudioContext is missing, when particles are disabled, or while SF.core.headless is true.
 *
 * Public API: see docs/fx.md
 */
(function () {
  'use strict';
  const SF = window.SF;
  const U = SF.util;

  /* ------------------------------------------------------------ state --- */
  // Small slice: quick-mute (header button) + lifetime counters. Volume / particle quality live in
  // SF.state.settings (owned by core, edited by the Settings tab).
  SF.registerState('fx', () => ({ muted: false, sounds: 0, particles: 0, celebrations: 0, beams: 0 }));

  const settings = () => SF.state.settings || {};
  const headless = () => !!(SF.core && SF.core.headless);
  const QUALITY = {
    off: { cap: 0, mult: 0 },
    low: { cap: 360, mult: 0.4 },
    high: { cap: 1800, mult: 1 },
  };
  function quality() {
    const q = settings().particles;
    return QUALITY[q] || QUALITY.high;
  }

  /* --------------------------------------------------------- colours --- */
  const NAMED = {
    gold: '#ffcf5a', dust: '#ffd27a', shard: '#7fe3ff', echo: '#d38cff', epic: '#d38cff',
    good: '#6dffa8', bad: '#ff5f6d', warn: '#ffb347', white: '#ffffff',
    normal: '#c8c8c8', magic: '#6c8cff', rare: '#ffd84a', unique: '#ff8a2a',
    riftdust: '#5ef0c8', point: '#9ab8ff',
  };
  const colorCache = Object.create(null);
  /** Resolve 'var(--c-gold)', 'gold', '#fff', 'rgb(...)' to a concrete canvas colour string. */
  function resolveColor(c) {
    if (!c) return NAMED.gold;
    if (colorCache[c]) return colorCache[c];
    let out = c;
    if (NAMED[c]) out = NAMED[c];
    else if (typeof c === 'string' && c.indexOf('var(') === 0) {
      const name = c.slice(4, -1).trim();
      let v = '';
      try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { /* ignore */ }
      out = v || NAMED.gold;
    }
    colorCache[c] = out;
    return out;
  }
  /** Parse a concrete colour to [r,g,b] using a 1px canvas (cached). */
  const rgbCache = Object.create(null);
  let parseCtx = null;
  function toRGB(c) {
    c = resolveColor(c);
    if (rgbCache[c]) return rgbCache[c];
    let rgb = [255, 207, 90];
    try {
      if (!parseCtx) { const cv = document.createElement('canvas'); cv.width = cv.height = 1; parseCtx = cv.getContext('2d', { willReadFrequently: true }); }
      parseCtx.clearRect(0, 0, 1, 1);
      parseCtx.fillStyle = '#000';
      parseCtx.fillStyle = c;
      parseCtx.fillRect(0, 0, 1, 1);
      const d = parseCtx.getImageData(0, 0, 1, 1).data;
      rgb = [d[0], d[1], d[2]];
    } catch (e) { /* ignore */ }
    return (rgbCache[c] = rgb);
  }
  const rgba = (rgb, a) => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';

  /* ---------------------------------------------------------- canvas --- */
  let canvas = null, ctx = null, W = 0, H = 0, DPR = 1;
  let rafId = 0, lastFrame = 0;
  const parts = [];   // live particles
  const pool = [];    // recycled particle objects
  const texts = [];   // floating texts (drawn in a normal-blend pass)
  let curTag = null;  // owner tag stamped on new particles/texts/beams (see setTag / clearTag)
  const beams = [];   // rarity beams
  const sprites = Object.create(null); // colour -> glow sprite canvas
  const starSprites = Object.create(null);

  function initCanvas() {
    if (canvas) return true;
    canvas = document.getElementById('fx-canvas');
    if (!canvas || !canvas.getContext) { canvas = null; return false; }
    ctx = canvas.getContext('2d');
    if (!ctx) { canvas = null; return false; }
    resize();
    window.addEventListener('resize', resize);
    return true;
  }
  function resize() {
    if (!canvas) return;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.max(1, Math.round(W * DPR));
    canvas.height = Math.max(1, Math.round(H * DPR));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function glowSprite(color) {
    const c = resolveColor(color);
    if (sprites[c]) return sprites[c];
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const rgb = toRGB(c);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, rgba(rgb, 1));
    grd.addColorStop(0.45, rgba(rgb, 0.35));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return (sprites[c] = s);
  }
  function starSprite(color) {
    const c = resolveColor(color);
    if (starSprites[c]) return starSprites[c];
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const rgb = toRGB(c);
    g.translate(32, 32);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, rgba(rgb, 0.9));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 30 : 5;
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    return (starSprites[c] = s);
  }

  // particle kinds
  const K_GLOW = 0, K_STAR = 1, K_RING = 2, K_STREAK = 3, K_SHARD = 4;

  function spawn(o) {
    const q = quality();
    if (q.cap === 0 || !canvas) return null;
    if (parts.length >= q.cap) {
      // recycle the oldest particle instead of growing unbounded
      const old = parts.shift();
      pool.push(old);
    }
    const p = pool.pop() || {};
    p.kind = o.kind || K_GLOW;
    p.x = o.x; p.y = o.y;
    p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.g = o.g || 0;           // gravity px/s^2
    p.drag = o.drag == null ? 1.6 : o.drag;
    p.life = 0;
    p.max = o.life || 1;
    p.size = o.size || 6;
    p.size2 = o.size2 == null ? 0 : o.size2; // end size (rings: end radius)
    p.color = o.color || NAMED.gold;
    p.sprite = p.kind === K_STAR ? starSprite(p.color) : (p.kind === K_RING || p.kind === K_STREAK || p.kind === K_SHARD) ? null : glowSprite(p.color);
    p.rgb = (p.kind === K_RING || p.kind === K_STREAK || p.kind === K_SHARD) ? toRGB(p.color) : null;
    p.rot = o.rot || Math.random() * Math.PI * 2;
    p.vr = o.vr || 0;
    p.alpha = o.alpha == null ? 1 : o.alpha;
    p.twinkle = o.twinkle || 0;
    p.width = o.width || 2;
    p.delay = o.delay || 0;
    p.tag = curTag;
    parts.push(p);
    const st = SF.state.fx; if (st) st.particles++;
    wake();
    return p;
  }

  function wake() {
    if (rafId || !canvas) return;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function frame(now) {
    rafId = 0;
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    try { step(dt); draw(); } catch (e) { U.logOnce('fx:frame', '[SF] fx frame error', e); parts.length = 0; texts.length = 0; beams.length = 0; }
    updateShake(dt);
    if (parts.length || texts.length || beams.length || shakeT > 0) rafId = requestAnimationFrame(frame);
    else if (ctx) ctx.clearRect(0, 0, W, H);
  }

  function step(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.life += dt;
      if (p.life >= p.max) { parts.splice(i, 1); pool.push(p); continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life += dt;
      if (t.life >= t.max) { texts.splice(i, 1); continue; }
      t.vy *= Math.exp(-2.2 * dt);
      t.y += t.vy * dt; t.x += t.vx * dt;
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.life += dt;
      if (b.life >= b.max) { beams.splice(i, 1); continue; }
      b.acc += dt;
      // rising motes inside the beam
      while (b.acc > 0.045) {
        b.acc -= 0.045;
        if (b.life < b.max - 0.6) spawn({ kind: K_GLOW, x: b.x + U.rand(-b.w * 0.35, b.w * 0.35), y: b.y - U.rand(0, 30), vx: U.rand(-8, 8), vy: U.rand(-260, -120), drag: 0.4, life: U.rand(0.8, 1.6), size: U.rand(3, 7), color: b.color });
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // beams (under particles)
    if (beams.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const b of beams) {
        const t = b.life / b.max;
        const fadeIn = Math.min(1, b.life / 0.18);
        const fadeOut = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        const a = fadeIn * fadeOut;
        const pulse = 1 + Math.sin(b.life * 14) * 0.08;
        const w = b.w * pulse * (0.6 + 0.4 * fadeIn);
        const top = 0;
        const grd = ctx.createLinearGradient(b.x - w / 2, 0, b.x + w / 2, 0);
        grd.addColorStop(0, rgba(b.rgb, 0));
        grd.addColorStop(0.35, rgba(b.rgb, 0.35 * a));
        grd.addColorStop(0.5, 'rgba(255,255,255,' + (0.85 * a) + ')');
        grd.addColorStop(0.65, rgba(b.rgb, 0.35 * a));
        grd.addColorStop(1, rgba(b.rgb, 0));
        ctx.fillStyle = grd;
        ctx.fillRect(b.x - w / 2, top, w, b.y - top);
        // soft wide halo
        const grd2 = ctx.createLinearGradient(b.x - w * 2, 0, b.x + w * 2, 0);
        grd2.addColorStop(0, rgba(b.rgb, 0));
        grd2.addColorStop(0.5, rgba(b.rgb, 0.18 * a));
        grd2.addColorStop(1, rgba(b.rgb, 0));
        ctx.fillStyle = grd2;
        ctx.fillRect(b.x - w * 2, top, w * 4, b.y - top);
        // ground glow ellipse
        const gr = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, w * 2.2);
        gr.addColorStop(0, 'rgba(255,255,255,' + (0.7 * a) + ')');
        gr.addColorStop(0.3, rgba(b.rgb, 0.5 * a));
        gr.addColorStop(1, rgba(b.rgb, 0));
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(1, 0.35);
        ctx.translate(-b.x, -b.y);
        ctx.fillStyle = gr;
        ctx.fillRect(b.x - w * 2.2, b.y - w * 2.2, w * 4.4, w * 4.4);
        ctx.restore();
      }
    }
    // particles
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.delay > 0) continue;
      const t = p.life / p.max;
      let a = p.alpha * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      if (p.twinkle) a *= 0.55 + 0.45 * Math.sin(p.life * p.twinkle + p.rot * 3);
      if (a <= 0.01) continue;
      if (p.kind === K_RING) {
        const r = p.size + (p.size2 - p.size) * (1 - Math.pow(1 - t, 3));
        ctx.strokeStyle = rgba(p.rgb, a);
        ctx.lineWidth = p.width * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, r), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === K_STREAK) {
        const len = Math.min(0.06, 0.03 + p.size * 0.004);
        ctx.strokeStyle = rgba(p.rgb, a);
        ctx.lineWidth = p.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * len, p.y - p.vy * len);
        ctx.stroke();
      } else if (p.kind === K_SHARD) {
        // confetti-like spinning sliver
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.cos(p.rot * 2.3)) + 0.15);
        ctx.fillStyle = rgba(p.rgb, a);
        ctx.fillRect(-p.size / 2, -p.size / 5, p.size, p.size / 2.5);
        ctx.restore();
      } else {
        const s = p.size * (p.size2 ? 1 + (p.size2 - 1) * t : 1);
        ctx.globalAlpha = a;
        if (p.kind === K_STAR) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(p.sprite, -s, -s, s * 2, s * 2);
          ctx.restore();
        } else {
          ctx.drawImage(p.sprite, p.x - s, p.y - s, s * 2, s * 2);
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
    // floating texts
    ctx.globalCompositeOperation = 'source-over';
    if (texts.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of texts) {
        const k = t.life / t.max;
        const pop = t.life < 0.12 ? 0.6 + (t.life / 0.12) * 0.55 : t.life < 0.24 ? 1.15 - ((t.life - 0.12) / 0.12) * 0.15 : 1;
        const a = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
        const size = t.size * pop;
        ctx.globalAlpha = Math.max(0, a);
        ctx.font = (t.bold ? '800 ' : '700 ') + size.toFixed(1) + 'px ' + FONT;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, size * 0.18);
        ctx.strokeStyle = 'rgba(8,4,20,0.85)';
        ctx.strokeText(t.text, t.x, t.y);
        if (t.glow) { ctx.shadowColor = t.color; ctx.shadowBlur = 12; }
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }
  }
  const FONT = "'Segoe UI', Inter, system-ui, sans-serif";

  /* ------------------------------------------------------ emitters --- */
  function can() { return !!canvas && !headless(); }
  function n(count) { return Math.max(0, Math.round(count * quality().mult)); }

  /** Radial burst of glowing sparks. */
  function burst(x, y, color, count, opts) {
    if (!can()) return;
    opts = opts || {};
    count = n(count == null ? 14 : count);
    const speed = opts.speed || 260;
    const col = color || NAMED.gold;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.75);
      const kind = Math.random() < 0.3 ? K_STREAK : (Math.random() < 0.25 ? K_STAR : K_GLOW);
      spawn({
        kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up || 40),
        g: opts.gravity == null ? 420 : opts.gravity, drag: 2.2, life: U.rand(0.45, 0.95) * (opts.life || 1),
        size: kind === K_STAR ? U.rand(5, 9) : kind === K_STREAK ? 3 : U.rand(3, 7) * (opts.scale || 1),
        width: 2, color: Math.random() < 0.15 ? '#ffffff' : col, vr: U.rand(-6, 6),
      });
    }
  }
  /** Gentle twinkling sparkles in a small area (purchases, highlights). */
  function sparkle(x, y, color, count, radius) {
    if (!can()) return;
    count = n(count == null ? 8 : count);
    radius = radius || 26;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      spawn({ kind: K_STAR, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: U.rand(-20, 20), vy: U.rand(-70, -20), g: 0, drag: 1.5, life: U.rand(0.5, 1.0), size: U.rand(4, 9), color: color || NAMED.gold, vr: U.rand(-3, 3), twinkle: U.rand(14, 24), delay: Math.random() * 0.12 });
    }
  }
  /** Expanding shockwave ring. */
  function ring(x, y, color, radius, opts) {
    if (!can()) return;
    if (quality().cap === 0) return;
    opts = opts || {};
    spawn({ kind: K_RING, x, y, size: opts.from || 4, size2: radius || 80, life: opts.life || 0.6, width: opts.width || 4, color: color || NAMED.gold, drag: 0, delay: opts.delay || 0 });
  }
  /** One trail mote (call every frame for moving objects). */
  function trail(x, y, color, opts) {
    if (!can()) return;
    opts = opts || {};
    const q = quality();
    if (q.cap === 0 || (q.mult < 1 && Math.random() > q.mult)) return;
    spawn({ kind: Math.random() < 0.2 ? K_STAR : K_GLOW, x: x + U.rand(-3, 3), y: y + U.rand(-3, 3), vx: (opts.vx || 0) + U.rand(-25, 25), vy: (opts.vy || 0) + U.rand(-25, 25), drag: 2.5, g: opts.gravity || 0, life: opts.life || U.rand(0.35, 0.8), size: opts.size || U.rand(3, 8), size2: 0.2, color: color || NAMED.gold, twinkle: Math.random() < 0.3 ? 20 : 0 });
  }
  /** Confetti-ish falling slivers. */
  function confetti(x, y, colors, count) {
    if (!can()) return;
    count = n(count == null ? 40 : count);
    colors = colors && colors.length ? colors : [NAMED.gold, NAMED.shard, NAMED.echo, NAMED.good, '#ffffff'];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + U.rand(-1.1, 1.1);
      const v = U.rand(250, 650);
      spawn({ kind: K_SHARD, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 520, drag: 1.4, life: U.rand(1.4, 2.4), size: U.rand(6, 11), color: U.pick(colors), vr: U.rand(-12, 12) });
    }
  }
  /** Firework: a delayed burst + ring. */
  function firework(x, y, color, delay) {
    if (!can()) return;
    setTimeout(() => {
      if (!can()) return;
      burst(x, y, color, 34, { speed: 380, gravity: 160, life: 1.5 });
      ring(x, y, color, 90, { life: 0.7, width: 3 });
      sound('pop', { quiet: true });
    }, (delay || 0) * 1000);
  }

  /* ----------------------------------------------------- float text --- */
  /**
   * Floating text at screen coords. opts: {size, life, vy, bold, glow, spread}.
   * Honors settings.floatText (false = off).
   */
  function floatText(x, y, text, color, opts) {
    if (!canvas || headless()) return;
    if (settings().floatText === false) return;
    opts = opts || {};
    if (texts.length >= 70) texts.shift();
    const spread = opts.spread == null ? 14 : opts.spread;
    texts.push({
      x: x + U.rand(-spread, spread), y: y + U.rand(-4, 4),
      vx: U.rand(-12, 12), vy: opts.vy == null ? -110 : opts.vy,
      text: String(text), color: resolveColor(color || '#ffffff'),
      size: opts.size || 18, life: 0, max: opts.life || 1.1, bold: !!opts.bold, glow: opts.glow !== false, tag: curTag,
    });
    wake();
  }

  /* --------------------------------------------------------- shake --- */
  let shakeT = 0, trauma = 0, shakeEl = null;
  /** Screen shake. intensity ~0.1 (tap) .. 1 (huge). Honors settings.shake. */
  function shake(intensity) {
    if (headless() || settings().shake === false) return;
    trauma = Math.min(1, trauma + (intensity == null ? 0.3 : intensity));
    shakeT = 1;
    if (!canvas) { // still shake even without canvas: drive our own rAF
      if (!rafId) { lastFrame = performance.now(); rafId = requestAnimationFrame(function f(now) { rafId = 0; const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now; updateShake(dt); if (shakeT > 0) rafId = requestAnimationFrame(f); }); }
    } else wake();
  }
  function updateShake(dt) {
    if (shakeT <= 0) return;
    if (!shakeEl) shakeEl = document.getElementById('app');
    trauma = Math.max(0, trauma - dt * 1.6);
    if (!shakeEl) { shakeT = 0; return; }
    if (trauma <= 0) {
      shakeT = 0;
      shakeEl.style.transform = '';
      return;
    }
    const s = trauma * trauma;
    const tm = performance.now() / 1000;
    const dx = 14 * s * (Math.sin(tm * 61.3) * 0.6 + Math.sin(tm * 37.9) * 0.4);
    const dy = 10 * s * (Math.sin(tm * 53.1 + 1.7) * 0.6 + Math.sin(tm * 29.3) * 0.4);
    const rot = 0.6 * s * Math.sin(tm * 43.7);
    shakeEl.style.transform = 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) rotate(' + rot.toFixed(3) + 'deg)';
  }

  /* --------------------------------------------------------- beam --- */
  /** Rarity beam: a pillar of light from the sky down to (x,y). Used for unique drops. */
  function beam(x, y, color, opts) {
    if (!can()) return;
    opts = opts || {};
    const col = resolveColor(color || NAMED.unique);
    if (quality().cap > 0) {
      if (beams.length > 4) beams.shift();
      beams.push({ x, y, color: col, rgb: toRGB(col), w: opts.width || 46, life: 0, max: opts.life || 2.6, acc: 0, tag: curTag });
    }
    ring(x, y, col, 120, { life: 0.9, width: 5 });
    ring(x, y, '#ffffff', 70, { life: 0.5, width: 3, delay: 0.08 });
    burst(x, y, col, 30, { speed: 320, gravity: 300 });
    sparkle(x, y, col, 14, 40);
    const st = SF.state.fx; if (st) st.beams++;
    shake(opts.shake == null ? 0.35 : opts.shake);
    wake();
  }

  /* ---------------------------------------------------- celebrate --- */
  let lastCelebrate = -1e9, pendingAuto = 0;
  /**
   * Big celebratory moment for prestige events. text: headline. opts: {sub, color, sound ('ascend'),
   * shake (0.7), duration ms (2800)}. De-duplicated within 1.5s.
   */
  function celebrate(text, opts) {
    if (headless()) return;
    opts = opts || {};
    const now = performance.now();
    if (now - lastCelebrate < 1500 && !opts.force) return;
    lastCelebrate = now;
    if (pendingAuto) { clearTimeout(pendingAuto); pendingAuto = 0; }
    const st = SF.state.fx; if (st) st.celebrations++;
    const col = resolveColor(opts.color || NAMED.gold);
    const cx = window.innerWidth / 2, cy = window.innerHeight * 0.42;
    // DOM overlay (works even with particles off)
    try {
      const el = document.createElement('div');
      el.className = 'fx-celebrate';
      el.style.setProperty('--fx-c', col);
      const flash = document.createElement('div'); flash.className = 'fx-celebrate-flash';
      const rays = document.createElement('div'); rays.className = 'fx-celebrate-rays';
      const box = document.createElement('div'); box.className = 'fx-celebrate-box';
      const t = document.createElement('div'); t.className = 'fx-celebrate-text'; t.textContent = String(text || 'Ascension!');
      box.appendChild(t);
      if (opts.sub) { const s = document.createElement('div'); s.className = 'fx-celebrate-sub'; s.innerHTML = String(opts.sub); box.appendChild(s); }
      el.appendChild(flash); el.appendChild(rays); el.appendChild(box);
      document.body.appendChild(el);
      const dur = opts.duration || 2800;
      el.style.setProperty('--fx-dur', dur + 'ms');
      el.addEventListener('click', () => el.remove());
      setTimeout(() => el.remove(), dur + 100);
    } catch (e) { /* ignore */ }
    if (can()) {
      ring(cx, cy, '#ffffff', Math.max(W, H) * 0.7, { life: 1.1, width: 6 });
      ring(cx, cy, col, Math.max(W, H) * 0.5, { life: 1.3, width: 10, delay: 0.1 });
      ring(cx, cy, col, Math.max(W, H) * 0.35, { life: 1.4, width: 4, delay: 0.25 });
      burst(cx, cy, col, 90, { speed: 900, gravity: 120, life: 1.8, scale: 1.4 });
      sparkle(cx, cy, '#ffffff', 30, 220);
      confetti(cx, window.innerHeight + 10, null, 70);
      const fw = [NAMED.gold, NAMED.shard, NAMED.echo, NAMED.unique, NAMED.good];
      for (let i = 0; i < 7; i++) firework(U.rand(W * 0.12, W * 0.88), U.rand(H * 0.12, H * 0.55), U.pick(fw), 0.35 + i * 0.22);
    }
    shake(opts.shake == null ? 0.75 : opts.shake);
    sound(opts.sound || 'ascend');
  }

  /* ============================================================ AUDIO === */
  let AC = null, master = null, comp = null, reverb = null, reverbSend = null, audioOk = true;
  let voices = 0;
  const lastPlayed = Object.create(null);
  const MIN_GAP = { click: 0.028, buy: 0.035, hit: 0.03, pop: 0.05, drop: 0.06, coin: 0.04, tick: 0.05, kill: 0.05, craft: 0.08, upgrade: 0.06, error: 0.15, achievement: 0.4, dropRare: 0.15, dropUnique: 0.6, ascend: 1.2, transcend: 1.5, comet: 0.4, levelup: 0.3, powerup: 0.3, powerdown: 0.3, whoosh: 0.2, boss: 0.8 };
  const MAX_VOICES = 28;

  function ensureAudio() {
    if (AC || !audioOk) return AC;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { audioOk = false; return null; }
    try {
      AC = new Ctor();
      comp = AC.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master = AC.createGain();
      master.gain.value = targetVolume();
      master.connect(comp);
      comp.connect(AC.destination);
      // procedural reverb (decaying stereo noise impulse) for bells/pads
      reverb = AC.createConvolver();
      const len = Math.floor(AC.sampleRate * 1.8);
      const ir = AC.createBuffer(2, len, AC.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      reverb.buffer = ir;
      reverbSend = AC.createGain();
      reverbSend.gain.value = 0.28;
      reverbSend.connect(reverb);
      reverb.connect(master);
    } catch (e) { audioOk = false; AC = null; U.logOnce('fx:audio', '[SF] WebAudio unavailable', e); }
    return AC;
  }
  function targetVolume() {
    const s = settings();
    const st = SF.state.fx;
    if (s.sound === false || (st && st.muted)) return 0;
    const v = typeof s.volume === 'number' ? s.volume : 0.5;
    return U.clamp(v, 0, 1) * 0.7;
  }
  // Browsers require a gesture before audio can start.
  function unlockAudio() {
    const ac = ensureAudio();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlockAudio, { passive: true, capture: true }));

  let noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    const len = AC.sampleRate * 1;
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

  /** Oscillator voice with ADSR-ish envelope. */
  function tone(freq, o) {
    o = o || {};
    const t0 = AC.currentTime + (o.at || 0);
    const osc = AC.createOscillator();
    const g = AC.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + (o.glide || o.dur || 0.2));
    if (o.detune) osc.detune.value = o.detune;
    const atk = o.attack == null ? 0.004 : o.attack;
    const dur = o.dur || 0.2;
    const peak = o.gain == null ? 0.2 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + dur);
    let node = osc;
    if (o.filter) {
      const f = AC.createBiquadFilter();
      f.type = o.filter; f.frequency.setValueAtTime(o.ff || 2000, t0);
      if (o.ffTo) f.frequency.exponentialRampToValueAtTime(o.ffTo, t0 + atk + dur);
      f.Q.value = o.q || 0.7;
      osc.connect(f); node = f;
    }
    node.connect(g);
    g.connect(master);
    if (o.send) { const sg = AC.createGain(); sg.gain.value = o.send; g.connect(sg); sg.connect(reverbSend); }
    osc.start(t0);
    osc.stop(t0 + atk + dur + 0.05);
    voices++;
    osc.onended = () => { voices--; try { g.disconnect(); } catch (e) { /* */ } };
  }
  /** Inharmonic glassy bell. */
  function bell(freq, o) {
    o = o || {};
    const gain = o.gain == null ? 0.12 : o.gain;
    const dur = o.dur || 0.9;
    tone(freq, { at: o.at, dur, gain, attack: 0.002, send: o.send == null ? 0.6 : o.send });
    tone(freq * 2.0, { at: o.at, dur: dur * 0.5, gain: gain * 0.35, attack: 0.002, send: 0.4 });
    tone(freq * 2.76, { at: o.at, dur: dur * 0.3, gain: gain * 0.2, attack: 0.001, send: 0.4 });
    tone(freq * 5.4, { at: o.at, dur: dur * 0.12, gain: gain * 0.1, attack: 0.001 });
  }
  /** Filtered noise burst. */
  function noise(o) {
    o = o || {};
    const t0 = AC.currentTime + (o.at || 0);
    const src = AC.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const f = AC.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.ff || 1200, t0);
    if (o.ffTo) f.frequency.exponentialRampToValueAtTime(o.ffTo, t0 + (o.dur || 0.2));
    f.Q.value = o.q || 1;
    const g = AC.createGain();
    const atk = o.attack == null ? 0.005 : o.attack;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain == null ? 0.1 : o.gain, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + atk + (o.dur || 0.2));
    src.connect(f); f.connect(g); g.connect(master);
    if (o.send) { const sg = AC.createGain(); sg.gain.value = o.send; g.connect(sg); sg.connect(reverbSend); }
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + atk + (o.dur || 0.2) + 0.05);
    voices++;
    src.onended = () => { voices--; try { g.disconnect(); } catch (e) { /* */ } };
  }

  let buyCombo = 0, lastBuyAt = 0, clickBurst = 0, lastClickAt = 0;
  const SOUNDS = {
    click() {
      // soft "pop"; slightly quieter when spammed so autoclick/fast clicking isn't grating
      const now = AC.currentTime;
      clickBurst = now - lastClickAt < 0.15 ? Math.min(clickBurst + 1, 12) : 0;
      lastClickAt = now;
      const damp = 1 - clickBurst * 0.04;
      const f = U.rand(480, 600);
      tone(f, { to: f * 0.45, glide: 0.07, dur: 0.08, gain: 0.22 * damp });
      tone(f * 2, { to: f * 1.2, glide: 0.04, dur: 0.035, gain: 0.05 * damp, type: 'triangle' });
      noise({ ff: 4200, q: 0.8, filter: 'highpass', dur: 0.018, gain: 0.04 * damp });
    },
    buy() {
      const now = AC.currentTime;
      buyCombo = now - lastBuyAt < 0.6 ? Math.min(buyCombo + 1, PENTA.length - 1) : 0;
      lastBuyAt = now;
      const f = midi(72 + PENTA[buyCombo]);
      tone(f, { type: 'triangle', dur: 0.16, gain: 0.16, send: 0.25 });
      tone(f * 2, { dur: 0.09, gain: 0.05 });
      noise({ ff: 6000, filter: 'highpass', dur: 0.03, gain: 0.03 });
    },
    coin() {
      tone(midi(88), { type: 'square', dur: 0.05, gain: 0.04, filter: 'lowpass', ff: 3000 });
      tone(midi(95), { type: 'square', at: 0.05, dur: 0.12, gain: 0.04, filter: 'lowpass', ff: 3000, send: 0.2 });
    },
    upgrade() {
      [76, 79, 84].forEach((m, i) => bell(midi(m), { at: i * 0.055, dur: 0.5, gain: 0.09, send: 0.4 }));
      tone(midi(64), { type: 'triangle', dur: 0.25, gain: 0.08 });
    },
    ascend() {
      // swelling chord + rising shimmer + whoosh
      const chord = [48, 55, 60, 64, 67, 72];
      chord.forEach((m, i) => tone(midi(m), { type: i < 2 ? 'sawtooth' : 'triangle', attack: 0.35, dur: 2.4, gain: 0.05, filter: 'lowpass', ff: 300, ffTo: 4200, send: 0.7, detune: U.rand(-6, 6) }));
      [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => bell(midi(m), { at: 0.25 + i * 0.09, dur: 1.1, gain: 0.07 }));
      noise({ filter: 'bandpass', ff: 300, ffTo: 5000, q: 0.8, attack: 0.6, dur: 1.4, gain: 0.07, send: 0.5 });
      tone(55, { to: 40, dur: 1.6, attack: 0.02, gain: 0.2 });
    },
    transcend() {
      const chord = [41, 48, 53, 57, 60, 65, 69];
      chord.forEach((m, i) => tone(midi(m), { type: i < 2 ? 'sawtooth' : 'triangle', attack: 0.6, dur: 3.4, gain: 0.05, filter: 'lowpass', ff: 200, ffTo: 5000, send: 0.8, detune: U.rand(-8, 8) }));
      [77, 81, 84, 89, 93, 96, 101].forEach((m, i) => bell(midi(m), { at: 0.4 + i * 0.12, dur: 1.6, gain: 0.07 }));
      noise({ filter: 'bandpass', ff: 200, ffTo: 6000, q: 0.6, attack: 1.0, dur: 2.0, gain: 0.08, send: 0.6 });
      tone(44, { to: 30, dur: 2.5, attack: 0.05, gain: 0.25 });
    },
    drop() {
      tone(U.rand(300, 340), { to: 170, glide: 0.09, dur: 0.11, gain: 0.16 });
      noise({ ff: 1800, q: 2, dur: 0.04, gain: 0.04 });
    },
    dropRare() {
      bell(midi(81), { dur: 0.7, gain: 0.1 });
      bell(midi(88), { at: 0.08, dur: 0.9, gain: 0.1 });
    },
    dropUnique() {
      tone(110, { to: 46, dur: 0.9, attack: 0.005, gain: 0.32 });
      noise({ filter: 'lowpass', ff: 900, ffTo: 120, dur: 0.6, gain: 0.12 });
      [74, 78, 81, 86, 90].forEach((m, i) => bell(midi(m), { at: 0.12 + i * 0.07, dur: 1.4, gain: 0.08 }));
      noise({ filter: 'highpass', ff: 5000, at: 0.1, attack: 0.3, dur: 1.2, gain: 0.04, send: 0.6 });
    },
    craft() {
      const f = U.rand(1700, 1950);
      tone(f, { dur: 0.25, gain: 0.07, attack: 0.001, send: 0.4 });
      tone(f * 1.51, { dur: 0.18, gain: 0.05, attack: 0.001 });
      tone(f * 0.5, { type: 'triangle', dur: 0.08, gain: 0.08 });
      noise({ ff: 4200, q: 3, dur: 0.06, gain: 0.08 });
    },
    levelup() {
      [67, 71, 74, 79, 83].forEach((m, i) => tone(midi(m), { type: 'triangle', at: i * 0.06, dur: 0.18, gain: 0.1, send: 0.3 }));
      bell(midi(86), { at: 0.32, dur: 1.0, gain: 0.1 });
    },
    achievement() {
      [84, 88, 91].forEach((m, i) => bell(midi(m), { at: i * 0.07, dur: 1.3, gain: 0.08 }));
      tone(midi(60), { type: 'triangle', attack: 0.08, dur: 0.9, gain: 0.06, send: 0.5 });
      tone(midi(67), { type: 'triangle', attack: 0.08, dur: 0.9, gain: 0.05, send: 0.5 });
    },
    comet() {
      noise({ filter: 'bandpass', ff: 500, ffTo: 3500, q: 1.2, attack: 0.05, dur: 0.45, gain: 0.08, send: 0.3 });
      [91, 95, 98, 103].forEach((m, i) => bell(midi(m), { at: 0.08 + i * 0.05, dur: 0.8, gain: 0.06 }));
      tone(midi(67), { type: 'triangle', at: 0.05, dur: 0.4, gain: 0.08, send: 0.4 });
    },
    whoosh() {
      noise({ filter: 'bandpass', ff: 300, ffTo: 1800, q: 1.5, attack: 0.25, dur: 0.5, gain: 0.05, send: 0.3 });
    },
    powerup() {
      tone(midi(60), { type: 'sawtooth', to: midi(84), glide: 0.45, dur: 0.5, gain: 0.05, filter: 'lowpass', ff: 800, ffTo: 5000, send: 0.4 });
      [72, 79, 84].forEach((m, i) => bell(midi(m), { at: 0.35 + i * 0.05, dur: 0.8, gain: 0.07 }));
    },
    powerdown() {
      bell(midi(79), { dur: 0.6, gain: 0.06 });
      bell(midi(72), { at: 0.1, dur: 0.8, gain: 0.06 });
    },
    pop() {
      tone(U.rand(700, 900), { to: 200, glide: 0.12, dur: 0.12, gain: 0.08 });
      noise({ filter: 'highpass', ff: 3000, dur: 0.15, gain: 0.03 });
    },
    hit() {
      tone(U.rand(150, 190), { to: 70, glide: 0.06, dur: 0.07, gain: 0.12, type: 'triangle' });
      noise({ ff: 1400, q: 1, dur: 0.035, gain: 0.05 });
    },
    kill() {
      tone(U.rand(260, 300), { to: 90, glide: 0.15, dur: 0.16, gain: 0.12 });
      noise({ filter: 'lowpass', ff: 2000, ffTo: 300, dur: 0.18, gain: 0.07 });
    },
    boss() {
      tone(65, { to: 49, dur: 1.2, attack: 0.05, gain: 0.25, type: 'sawtooth', filter: 'lowpass', ff: 400 });
      tone(98, { to: 73, dur: 1.2, attack: 0.05, gain: 0.12, type: 'sawtooth', filter: 'lowpass', ff: 500 });
      noise({ filter: 'lowpass', ff: 600, dur: 1, attack: 0.1, gain: 0.08 });
    },
    tick() {
      tone(1800, { dur: 0.02, gain: 0.025 });
    },
    error() {
      tone(220, { type: 'square', dur: 0.08, gain: 0.05, filter: 'lowpass', ff: 1100 });
      tone(174, { type: 'square', at: 0.09, dur: 0.12, gain: 0.05, filter: 'lowpass', ff: 1000 });
    },
  };
  SOUNDS.prestige = SOUNDS.ascend;
  SOUNDS.unique = SOUNDS.dropUnique;
  SOUNDS.rare = SOUNDS.dropRare;

  /**
   * Play a named procedural sound. Unknown names are ignored. opts: {quiet:bool}.
   * Rate-limited per sound and globally (voice cap) so it never becomes noise.
   */
  function sound(name, opts) {
    if (headless()) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const vol = targetVolume();
    if (vol <= 0) return;
    const ac = ensureAudio();
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    const gap = MIN_GAP[name] || 0.05;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return;
    if (voices > MAX_VOICES && name !== 'ascend' && name !== 'transcend' && name !== 'dropUnique') return;
    lastPlayed[name] = now;
    try {
      master.gain.setTargetAtTime(vol * (opts && opts.quiet ? 0.6 : 1), now, 0.01);
      fn();
      const st = SF.state.fx; if (st) st.sounds++;
    } catch (e) { U.logOnce('fx:sound:' + name, '[SF] sound error', name, e); }
  }

  /* ======================================================== HELPERS === */
  const mouse = { x: -1, y: -1, t: 0 };
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  window.addEventListener('pointerdown', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now(); }, { passive: true, capture: true });

  /** Center of an element in screen coords, or null. */
  function centerOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  /** Last pointer position (and whether a click happened in the last `ms`). */
  function pointer(ms) {
    return { x: mouse.x, y: mouse.y, recent: performance.now() - mouse.t < (ms || 300) && mouse.x >= 0 };
  }

  /* =================================================== PUBLIC API === */
  SF.fx = {
    /** Suppress the automatic prestige celebration for the next reset (auto-prestige uses a quiet toast instead). */
    skipAutoCelebrate: () => { lastCelebrate = performance.now() + 100; },
    burst: (x, y, color, count, opts) => safe('burst', burst, x, y, color, count, opts),
    sparkle: (x, y, color, count, radius) => safe('sparkle', sparkle, x, y, color, count, radius),
    ring: (x, y, color, radius, opts) => safe('ring', ring, x, y, color, radius, opts),
    trail: (x, y, color, opts) => safe('trail', trail, x, y, color, opts),
    confetti: (x, y, colors, count) => safe('confetti', confetti, x, y, colors, count),
    firework: (x, y, color, delay) => safe('firework', firework, x, y, color, delay),
    floatText: (x, y, text, color, opts) => safe('floatText', floatText, x, y, text, color, opts),
    shake: (i) => safe('shake', shake, i),
    sound: (name, opts) => safe('sound', sound, name, opts),
    beam: (x, y, color, opts) => safe('beam', beam, x, y, color, opts),
    celebrate: (text, opts) => safe('celebrate', celebrate, text, opts),
    /** Convenience: burst + float text at an element's center. */
    atEl(el, text, color, count) {
      const c = centerOf(el); if (!c) return;
      if (count !== 0) SF.fx.burst(c.x, c.y, color, count == null ? 10 : count);
      if (text != null) SF.fx.floatText(c.x, c.y - 10, text, color);
    },
    /** Standard star-click juice for the forge: burst + gain number + pop. */
    clickFx(x, y, gain, opts) {
      opts = opts || {};
      SF.fx.burst(x, y, opts.color || 'gold', opts.count == null ? 7 : opts.count, { speed: 220 });
      if (gain != null) SF.fx.floatText(x, y - 14, '+' + (typeof gain === 'number' ? SF.fmt(gain) : gain), opts.color || 'gold', { size: opts.size || 17 });
      if (opts.sound !== false) SF.fx.sound('click');
    },
    centerOf, pointer,
    color: resolveColor,
    /** Effective volume 0..1 (0 when muted / sound off). */
    volume: () => targetVolume() / 0.7,
    setVolume(v) { if (SF.state.settings) SF.state.settings.volume = U.clamp(Number(v) || 0, 0, 1); },
    isMuted: () => targetVolume() === 0,
    toggleMute() {
      const st = SF.state.fx;
      const s = settings();
      if (s.sound === false) { s.sound = true; st.muted = false; }
      else st.muted = !st.muted;
      updateMuteBtn();
      if (!st.muted) setTimeout(() => sound('pop'), 30);
      return !st.muted;
    },
    unlockAudio,
    sounds: () => Object.keys(SOUNDS),
    /** Stamp effects spawned from now on with an owner tag (null to stop). */
    setTag: (tag) => { curTag = tag || null; },
    /** Remove every live particle / float text / beam with this owner tag (e.g. when a tab is hidden). */
    clearTag: (tag) => {
      if (!tag) return;
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].tag === tag) { pool.push(parts[i]); parts.splice(i, 1); }
      for (let i = texts.length - 1; i >= 0; i--) if (texts[i].tag === tag) texts.splice(i, 1);
      for (let i = beams.length - 1; i >= 0; i--) if (beams[i].tag === tag) beams.splice(i, 1);
    },
    stats: () => ({ particles: parts.length, texts: texts.length, beams: beams.length, voices, cap: quality().cap, audio: AC ? AC.state : 'none' }),
    clear() { parts.length = 0; texts.length = 0; beams.length = 0; if (ctx) ctx.clearRect(0, 0, W, H); },
    get ready() { return !!canvas; },
  };
  function safe(tag, fn, ...args) {
    try { return fn(...args); } catch (e) { U.logOnce('fx:' + tag, '[SF] fx.' + tag + ' error', e); return undefined; }
  }

  /* ============================================ AUTOMATIC JUICE ==== */
  // buy -> tiny sparkle at the pointer (only for user-initiated purchases, never for auto-buyers)
  SF.events.on('buy', (p) => {
    if (headless()) return;
    const m = pointer(250);
    if (!m.recent) return;
    sparkle(m.x, m.y, p && p.color ? p.color : 'gold', 5, 18);
  });
  // achievement -> chime + sparkles near the toast stack
  SF.events.on('achievement', () => {
    if (headless()) return;
    sound('achievement');
    const st = document.getElementById('toast-stack');
    const r = st && st.getBoundingClientRect();
    const x = r && r.width ? r.left + r.width / 2 : window.innerWidth - 160;
    const y = r && r.height ? r.bottom - 30 : window.innerHeight - 60;
    sparkle(x, y, 'epic', 14, 60);
  });
  // new feature unlocked -> level-up fanfare
  SF.events.on('unlock', () => { if (!headless()) { sound('levelup'); const b = document.querySelector('.tab-btn.is-new'); const c = centerOf(b); if (c) { sparkle(c.x, c.y, 'gold', 16, 50); ring(c.x, c.y, 'gold', 60); } } });
  // prestige resets -> auto celebration unless the prestige module celebrates itself right away
  SF.events.on('reset', (p) => {
    if (headless() || !p) return;
    const layer = p.layer;
    if (layer !== 'ascend' && layer !== 'transcend') return;
    if (pendingAuto) clearTimeout(pendingAuto);
    const at = performance.now();
    pendingAuto = setTimeout(() => {
      pendingAuto = 0;
      if (lastCelebrate >= at - 50) return; // a module already celebrated
      if (layer === 'transcend') celebrate('TRANSCENDENCE', { color: NAMED.echo, sound: 'transcend', sub: 'The cosmos is reborn', duration: 3400 });
      else celebrate('ASCENSION', { color: NAMED.shard, sub: 'Your stars collapse into shards', sound: 'ascend' });
    }, 60);
  });
  // settings change -> canvas cleanup when particles turned off
  SF.events.on('uiUpdate', () => {
    if (quality().cap === 0 && parts.length) { parts.length = 0; beams.length = 0; }
    const low = settings().particles === 'off' || settings().particles === 'low';
    if (document.body && document.body.classList.contains('fx-low') !== low) document.body.classList.toggle('fx-low', low);
    updateMuteBtn();
  });

  /* ------------------------------------------- header mute button --- */
  let muteBtn = null;
  function updateMuteBtn() {
    if (!muteBtn) return;
    const muted = targetVolume() === 0;
    const icon = muted ? '🔇' : '🔊';
    if (muteBtn.textContent !== icon) muteBtn.textContent = icon;
    muteBtn.classList.toggle('fx-muted', muted);
  }
  function buildMuteBtn() {
    const host = document.getElementById('header-actions');
    if (!host || muteBtn) return;
    muteBtn = document.createElement('button');
    muteBtn.className = 'btn btn-icon btn-ghost fx-mute-btn';
    muteBtn.setAttribute('aria-label', 'Toggle sound');
    muteBtn.setAttribute('data-tip', 'Toggle sound (M)');
    muteBtn.addEventListener('click', () => SF.fx.toggleMute());
    const save = document.getElementById('btn-save');
    host.insertBefore(muteBtn, save || null);
    updateMuteBtn();
  }
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      SF.fx.toggleMute();
    }
  });

  function init() { initCanvas(); buildMuteBtn(); }
  SF.events.on('uiReady', init);
  SF.events.on('boot', init);
  if (document.readyState !== 'loading') initCanvas();
  else document.addEventListener('DOMContentLoaded', initCanvas);
})();
