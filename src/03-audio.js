  const API_BASE = '';

  // Game config fetched from server (admin-controlled).
  // merge_mode: 'anchor' (result near drop) | 'classic' (leftmost wins) |
  //             'smart' (engine picks the cell that gives the best follow-up).
  var gameConfig = { merge_mode: 'anchor' };
  (function loadGameConfig() {
    fetch(API_BASE + '/api/config').then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.config) gameConfig = d.config;
        // Aurora admin-gate. Default: enabled. Only the explicit string 'false'
        // disables it. When disabled: hide from shop and, if a player has it
        // active, revert them to classic so they don't keep showing gradients
        // that the admin can't see in their own account.
        try {
          if (gameConfig.aurora_skin_enabled === 'false') {
            if (typeof SKIN_PACKS !== 'undefined' && SKIN_PACKS.aurora) delete SKIN_PACKS.aurora;
            if (typeof activeSkinId !== 'undefined' && activeSkinId === 'aurora') {
              activeSkinId = 'classic';
              try { localStorage.setItem(ACTIVE_SKIN_KEY, 'classic'); } catch(e) {}
              if (typeof syncBodySkinClass === 'function') syncBodySkinClass();
              if (typeof buildTierBar === 'function') try { buildTierBar(true); } catch(e) {}
              if (typeof render === 'function') try { render(); } catch(e) {}
            }
          }
        } catch (e) {}
      })
      .catch(function() {});
  })();

  // Dynamic Boards (phase 2, redesigned May 2026) — boards are now OPT-IN.
  // The boot path only FETCHES the list of available boards so the home
  // screen can show a "🎯 לוחות דינמיים" mode button when at least one
  // exists. It does NOT apply any board automatically — applying happens
  // only when the player explicitly picks one from the picker, scoped to
  // a single play session. Daily / contest / duel / challenge / default
  // practice are never affected by admin board pushes.
  var _availableBoards = [];
  window._availableBoards = _availableBoards;
  function refreshAvailableBoards() {
    if (document.hidden) return;
    fetch(API_BASE + '/api/boards/available').then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.ok) return;
        _availableBoards = Array.isArray(d.boards) ? d.boards : [];
        window._availableBoards = _availableBoards;
        // Let the home screen show/hide its boards button if it's mounted.
        if (typeof updateDynamicBoardsButton === 'function') {
          try { updateDynamicBoardsButton(); } catch (e) {}
        }
      })
      .catch(function() {});
  }
  (function loadAvailableBoards() {
    refreshAvailableBoards();
    setInterval(refreshAvailableBoards, 90 * 1000);
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) refreshAvailableBoards();
    });
  })();

  // Per-game difficulty override. Populated by init() from the active
  // contest/duel row, or by practice mode from localStorage. When null,
  // getDropWeights() and gameSpeedScale() fall back to gameConfig (admin).
  // Shape: { label: 'hard', weights: '5,15,30,30,15,5,0,0', speed_pct: 100 }
  var sessionDifficulty = null;
  // Mirror of server's DIFFICULTY_PRESETS — kept in sync at the source.
  var DIFFICULTY_PRESETS = {
    default: { label: 'default', weights: null,                    speed_pct: null, name: 'ברירת מחדל', emoji: '📦' },
    easy:    { label: 'easy',    weights: '70,25,5,0,0,0,0,0',     speed_pct: 100,  name: 'קל',         emoji: '😊' },
    medium:  { label: 'medium',  weights: '30,35,25,10,0,0,0,0',   speed_pct: 100,  name: 'בינוני',     emoji: '🎯' },
    hard:    { label: 'hard',    weights: '5,15,30,30,15,5,0,0',   speed_pct: 100,  name: 'קשה',        emoji: '🔥' },
    insane:  { label: 'insane',  weights: '0,0,10,30,35,20,5,0',   speed_pct: 100,  name: 'גהינום',     emoji: '💀' }
  };
  var PRACTICE_DIFF_KEY = 'bloom_practice_difficulty';
  function readPracticeDifficulty() {
    try {
      var raw = localStorage.getItem(PRACTICE_DIFF_KEY);
      if (!raw) return null;
      var p = DIFFICULTY_PRESETS[raw];
      return p || null;
    } catch (e) { return null; }
  }
  function writePracticeDifficulty(label) {
    try {
      if (!label || label === 'default') localStorage.removeItem(PRACTICE_DIFF_KEY);
      else localStorage.setItem(PRACTICE_DIFF_KEY, label);
    } catch (e) {}
  }

  /* ============ AUDIO ============ */
  let audioCtx = null;
  // Channel volumes (0–1). Music drives the mp3 cross-fade target; sfx
  // multiplies every Web Audio tone()'s gain and gates haptic buzz.
  // Volume === 0 is the "muted" state; the speaker icon lights up red when
  // either channel is at zero.
  const MUSIC_VOL_KEY = 'bloom_music_volume';
  const SFX_VOL_KEY = 'bloom_sfx_volume';
  const DEFAULT_MUSIC_VOLUME = 0.28;
  const DEFAULT_SFX_VOLUME = 1.0;
  const VOL_MUTE_THRESHOLD = 0.005;
  function readVolumeKey(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw !== null && raw !== '') {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return fallback;
      return Math.max(0, Math.min(1, v));
    }
    // One-time migration from the old boolean mute keys. Only per-channel
    // mutes are honored — the legacy *unified* `bloom_muted` is intentionally
    // ignored, because users who tapped it once on an old version got stuck
    // permanently silent after the per-channel split (no UI affordance to
    // recover). Defaulting to audible is recoverable; defaulting to mute isn't.
    const oldKey = (key === 'bloom_music_volume') ? 'bloom_muted_music' : 'bloom_muted_sfx';
    const oldRaw = localStorage.getItem(oldKey);
    if (oldRaw === '1') return 0;
    return fallback;
  }
  let musicVolume = readVolumeKey(MUSIC_VOL_KEY, DEFAULT_MUSIC_VOLUME);
  let sfxVolume = readVolumeKey(SFX_VOL_KEY, DEFAULT_SFX_VOLUME);
  // Persist the resolved values immediately so the migration only runs once,
  // then clear the legacy keys so they can never re-mute on future loads.
  try {
    localStorage.setItem(MUSIC_VOL_KEY, String(musicVolume));
    localStorage.setItem(SFX_VOL_KEY, String(sfxVolume));
    localStorage.removeItem('bloom_muted');
    localStorage.removeItem('bloom_muted_music');
    localStorage.removeItem('bloom_muted_sfx');
  } catch (e) {}
  function isMusicMuted() { return musicVolume < VOL_MUTE_THRESHOLD; }
  function isSfxMuted() { return sfxVolume < VOL_MUTE_THRESHOLD; }
  function isAnyMuted() { return isMusicMuted() || isSfxMuted(); }
  function saveVolumeState() {
    try {
      localStorage.setItem(MUSIC_VOL_KEY, String(musicVolume));
      localStorage.setItem(SFX_VOL_KEY, String(sfxVolume));
    } catch (e) {}
  }

  function ensureAudio() {
    if (!audioCtx) try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(function() {
        // Browser autoplay policy: any playMusic() called before the first
        // user gesture left its BufferSource scheduled on a suspended ctx —
        // on Safari that source never recovers. Re-arm the current track
        // here, on the first successful resume, so music actually starts.
        if (currentTrack && !isMusicMuted()) {
          var t = MUSIC_TRACKS[currentTrack];
          if (!t || !t.source || currentTrackLevel(currentTrack) < 0.001) {
            fadeInTrack(currentTrack, MUSIC_FADE_MS, musicVolume);
          }
        }
      }).catch(function() {});
    }
    return audioCtx;
  }

  // Belt-and-suspenders: register a one-shot first-interaction listener so
  // audio unlocks even if no code path through ensureAudio() runs inside the
  // first click handler. Removes itself after the first successful resume.
  (function attachFirstGestureUnlock() {
    var unlocked = false;
    function tryUnlock() {
      if (unlocked) return;
      unlocked = true;
      ensureAudio();
      document.removeEventListener('pointerdown', tryUnlock, true);
      document.removeEventListener('touchstart', tryUnlock, true);
      document.removeEventListener('keydown', tryUnlock, true);
    }
    document.addEventListener('pointerdown', tryUnlock, true);
    document.addEventListener('touchstart', tryUnlock, true);
    document.addEventListener('keydown', tryUnlock, true);
  })();

  /* Music manager: 3 tracks (lobby/game/fail) with 0.5s cross-fade */
  const MUSIC_FADE_MS = 500;
  const MUSIC_FADE_STEPS = 20;
  // Music architecture: AudioBufferSourceNode per track. The previous design
  // routed an <audio loop> element through createMediaElementSource, but that
  // path can never produce a truly gapless loop — every browser inserts a
  // small silence at the end-of-file boundary, which on a 16-second track is
  // audible and feels like the music "stops". BufferSource.loop is gapless
  // by definition (it's a sample-accurate loop in the audio thread), so the
  // song plays uninterrupted for the entire session.
  const MUSIC_TRACKS = {
    lobby: { url: 'bloom-music-lobby.mp3', buffer: null, source: null, gain: null, fadeTimer: null, loadingPromise: null },
    game:  { url: 'bloom-music.mp3',       buffer: null, source: null, gain: null, fadeTimer: null, loadingPromise: null },
    fail:  { url: 'bloom-music-fail.mp3',  buffer: null, source: null, gain: null, fadeTimer: null, loadingPromise: null }
  };
  let currentTrack = null;

  function ensureTrackGain(name) {
    const t = MUSIC_TRACKS[name];
    if (!t) return null;
    if (t.gain) return t.gain;
    const ctx = ensureAudio();
    if (!ctx) return null;
    try {
      t.gain = ctx.createGain();
      t.gain.gain.value = 0;
      t.gain.connect(ctx.destination);
    } catch (e) { t.gain = null; }
    return t.gain;
  }

  function loadTrackBuffer(name) {
    const t = MUSIC_TRACKS[name];
    if (!t) return Promise.reject(new Error('no track'));
    if (t.buffer) return Promise.resolve(t.buffer);
    if (t.loadingPromise) return t.loadingPromise;
    const ctx = ensureAudio();
    if (!ctx) return Promise.reject(new Error('no AudioContext'));
    t.loadingPromise = fetch(t.url)
      .then(function(res) { return res.arrayBuffer(); })
      .then(function(arr) {
        // decodeAudioData has a callback form for older Safari support.
        return new Promise(function(resolve, reject) {
          ctx.decodeAudioData(arr, resolve, reject);
        });
      })
      .then(function(buffer) { t.buffer = buffer; return buffer; })
      .catch(function(e) { t.loadingPromise = null; throw e; });
    return t.loadingPromise;
  }

  function startTrackSource(name) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.buffer) return false;
    const gain = ensureTrackGain(name);
    if (!gain) return false;
    const ctx = ensureAudio();
    if (!ctx) return false;
    stopTrackSource(name);
    try {
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.loop = true;
      src.connect(gain);
      src.start(0);
      t.source = src;
      return true;
    } catch (e) { return false; }
  }

  function stopTrackSource(name) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.source) return;
    try { t.source.stop(); } catch (e) {}
    try { t.source.disconnect(); } catch (e) {}
    t.source = null;
  }

  function setTrackLevel(name, v) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.gain) return;
    try { t.gain.gain.value = Math.max(0, Math.min(1, v)); } catch (e) {}
  }
  function currentTrackLevel(name) {
    const t = MUSIC_TRACKS[name];
    if (!t || !t.gain) return 0;
    return Number(t.gain.gain.value) || 0;
  }

  function clearFade(name) {
    const t = MUSIC_TRACKS[name];
    if (t && t.fadeTimer) { clearInterval(t.fadeTimer); t.fadeTimer = null; }
  }
  function fadeOutTrack(name, ms, onDone) {
    const t = MUSIC_TRACKS[name];
    if (!t) { onDone && onDone(); return; }
    clearFade(name);
    const startLevel = currentTrackLevel(name);
    if (!t.source || startLevel <= 0.001) {
      setTrackLevel(name, 0);
      stopTrackSource(name);
      onDone && onDone();
      return;
    }
    const stepMs = ms / MUSIC_FADE_STEPS;
    let i = 0;
    t.fadeTimer = setInterval(function() {
      i++;
      setTrackLevel(name, Math.max(0, startLevel * (1 - i / MUSIC_FADE_STEPS)));
      if (i >= MUSIC_FADE_STEPS) {
        clearFade(name);
        setTrackLevel(name, 0);
        stopTrackSource(name);
        onDone && onDone();
      }
    }, stepMs);
  }
  function fadeInTrack(name, ms, target) {
    const t = MUSIC_TRACKS[name];
    if (!t) return;
    clearFade(name);
    target = (typeof target === 'number') ? target : musicVolume;
    ensureAudio();
    ensureTrackGain(name);
    setTrackLevel(name, 0);
    // Lazy-load the buffer on first playback. Once decoded, start the
    // source and tween the gain in.
    loadTrackBuffer(name).then(function() {
      if (currentTrack !== name || isMusicMuted()) return;
      if (!t.source) startTrackSource(name);
      const stepMs = ms / MUSIC_FADE_STEPS;
      let i = 0;
      clearFade(name);
      t.fadeTimer = setInterval(function() {
        i++;
        setTrackLevel(name, Math.min(target, target * (i / MUSIC_FADE_STEPS)));
        if (i >= MUSIC_FADE_STEPS) clearFade(name);
      }, stepMs);
    }).catch(function() { /* decode failed — silent */ });
  }
  function playMusic(name) {
    if (!MUSIC_TRACKS[name]) return;
    const t = MUSIC_TRACKS[name];
    const sameTrack = currentTrack === name;
    if (sameTrack && t.source && currentTrackLevel(name) > 0.001) return;
    const prev = currentTrack;
    currentTrack = name;
    if (isMusicMuted()) return;
    if (prev && prev !== name) {
      fadeOutTrack(prev, MUSIC_FADE_MS, function() {
        if (currentTrack === name) fadeInTrack(name, MUSIC_FADE_MS, musicVolume);
      });
    } else {
      fadeInTrack(name, MUSIC_FADE_MS, musicVolume);
    }
  }
  function stopAllMusic() {
    Object.keys(MUSIC_TRACKS).forEach(function(k) {
      fadeOutTrack(k, MUSIC_FADE_MS);
    });
    currentTrack = null;
  }
  function pauseAllMusic() {
    // BufferSource has no pause API — stop and recreate on resume. For
    // looping tracks restarting from the top is fine.
    Object.keys(MUSIC_TRACKS).forEach(function(k) {
      clearFade(k);
      setTrackLevel(k, 0);
      stopTrackSource(k);
    });
  }
  function resumeCurrentMusic() {
    if (!currentTrack || isMusicMuted()) return;
    fadeInTrack(currentTrack, MUSIC_FADE_MS, musicVolume);
  }
  // Apply a volume change to any currently-playing music immediately
  // (without restarting / fading). Used by the slider for live response.
  function applyMusicVolumeToActive() {
    if (!currentTrack) return;
    setTrackLevel(currentTrack, isMusicMuted() ? 0 : musicVolume);
  }
  // Tetris-style music tempo: speed up as board fills
  function updateMusicTempo(filledRows) {
    var t = MUSIC_TRACKS.game;
    if (!t || !t.source || !t.source.playbackRate) return;
    // 0 rows = ×1.0, 3 rows = ×1.1, 5 rows = ×1.25, 6 rows = ×1.35
    var maxRows = 6;
    var rate = 1.0 + (Math.min(filledRows, maxRows) / maxRows) * 0.35;
    try { t.source.playbackRate.value = rate; } catch(e) {}
  }
  function tone(opts) {
    if (isSfxMuted()) return;
    const c = ensureAudio();
    if (!c) return;
    const t0 = c.currentTime + (opts.delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    const filter = c.createBiquadFilter();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.bendTo) osc.frequency.exponentialRampToValueAtTime(opts.bendTo, t0 + opts.duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opts.filter || 5000, t0);
    gain.gain.setValueAtTime(0, t0);
    const peak = (opts.vol || 0.2) * sfxVolume;
    gain.gain.linearRampToValueAtTime(peak, t0 + (opts.attack || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.duration);
    osc.connect(filter); filter.connect(gain); gain.connect(c.destination);
    osc.start(t0); osc.stop(t0 + opts.duration + 0.05);
  }

  function soundDrop() {
    tone({ freq: 520, bendTo: 280, duration: 0.12, type: 'sine', vol: 0.14, filter: 3000 });
    tone({ freq: 260, bendTo: 140, duration: 0.15, type: 'sine', vol: 0.09, filter: 1500, delay: 0.005 });
  }

  function soundMerge(tier) {
    const baseFreqs = [0, 0, 330, 392, 466, 523, 622, 740, 880];
    const fundamental = baseFreqs[tier] || 330;
    tone({ freq: fundamental, duration: 0.25, type: 'triangle', vol: 0.18, filter: 5000 });
    tone({ freq: fundamental * 1.5, duration: 0.22, type: 'triangle', vol: 0.12, filter: 6000, delay: 0.025 });
    tone({ freq: fundamental * 2, duration: 0.18, type: 'sine', vol: 0.09, filter: 8000, delay: 0.05 });
    if (tier >= 6) tone({ freq: fundamental * 3, duration: 0.15, type: 'sine', vol: 0.06, filter: 9000, delay: 0.08 });
    if (tier >= 8) tone({ freq: fundamental * 4, duration: 0.2, type: 'sine', vol: 0.07, filter: 10000, delay: 0.12 });
  }

  function soundChain(chainCount) {
    const scale = [523, 587, 659, 784, 880, 1047, 1175];
    for (let i = 0; i < Math.min(chainCount + 1, scale.length); i++) {
      tone({ freq: scale[i], duration: 0.16, type: 'triangle', vol: 0.14, filter: 6000, delay: i * 0.07 });
      tone({ freq: scale[i] * 2, duration: 0.12, type: 'sine', vol: 0.06, filter: 8000, delay: i * 0.07 + 0.01 });
    }
  }

  function soundMilestone(tier) {
    const melody = [523, 659, 784, 1047, 1319];
    for (let i = 0; i < melody.length; i++) {
      tone({ freq: melody[i], duration: 0.22, type: 'triangle', vol: 0.16, filter: 6000, delay: i * 0.09 });
      tone({ freq: melody[i] * 2, duration: 0.18, type: 'sine', vol: 0.08, filter: 8000, delay: i * 0.09 + 0.01 });
    }
    if (tier >= MAX_TIER) {
      const sparkle = [2093, 2349, 2637, 3136];
      for (let i = 0; i < sparkle.length; i++) {
        tone({ freq: sparkle[i], duration: 0.1, type: 'sine', vol: 0.05, filter: 10000, delay: 0.55 + i * 0.04 });
      }
    }
  }

  function soundGameOver() {
    tone({ freq: 392, bendTo: 370, duration: 0.18, type: 'sawtooth', vol: 0.11, filter: 2500 });
    tone({ freq: 349, bendTo: 330, duration: 0.18, type: 'sawtooth', vol: 0.11, filter: 2500, delay: 0.18 });
    tone({ freq: 311, bendTo: 220, duration: 0.5, type: 'sawtooth', vol: 0.13, filter: 2200, delay: 0.36 });
    tone({ freq: 196, bendTo: 165, duration: 0.18, type: 'sine', vol: 0.08, filter: 1500 });
    tone({ freq: 175, bendTo: 165, duration: 0.18, type: 'sine', vol: 0.08, filter: 1500, delay: 0.18 });
    tone({ freq: 156, bendTo: 110, duration: 0.5, type: 'sine', vol: 0.09, filter: 1500, delay: 0.36 });
  }
  function buzz(pattern) {
    if (isSfxMuted()) return;
    if (navigator.vibrate) try { navigator.vibrate(pattern); } catch(e) {}
  }
  function setMuteIcon(btn, icon, mutedState) {
    if (!btn || !icon) return;
    if (mutedState) {
      btn.classList.add('muted');
      icon.innerHTML = '<path d="M15 8a5 5 0 0 1 1.7 3M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15M21 9l-6 6M15 9l6 6"/>';
    } else {
      btn.classList.remove('muted');
      icon.innerHTML = '<path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5L6 15"/>';
    }
  }
  function updateMuteUI() {
    setMuteIcon(document.getElementById('mute'), document.getElementById('mute-icon'), isAnyMuted());
    setMuteIcon(document.getElementById('home-mute'), document.getElementById('home-mute-icon'), isAnyMuted());
  }
  function setMusicVolume(next, opts) {
    opts = opts || {};
    const v = Math.max(0, Math.min(1, Number(next) || 0));
    const wasMuted = isMusicMuted();
    musicVolume = v;
    saveVolumeState();
    updateMuteUI();
    syncMuteMenuItems();
    if (isMusicMuted()) {
      pauseAllMusic();
    } else {
      // If we were silent and just turned on, resume the current track at the
      // new level. Otherwise patch the live element so the slider feels live.
      if (wasMuted) { ensureAudio(); resumeCurrentMusic(); }
      else applyMusicVolumeToActive();
    }
  }
  function setSfxVolume(next, opts) {
    opts = opts || {};
    const v = Math.max(0, Math.min(1, Number(next) || 0));
    const wasMuted = isSfxMuted();
    sfxVolume = v;
    saveVolumeState();
    updateMuteUI();
    syncMuteMenuItems();
    // Tiny confirm chirp when crossing zero → audible.
    if (wasMuted && !isSfxMuted() && !opts.silent) {
      ensureAudio(); tone({ freq: 523, duration: 0.08, type: 'sine', vol: 0.12 });
    }
  }
  function muteAll() { setMusicVolume(0); setSfxVolume(0, { silent: true }); }
  function unmuteAll() {
    setMusicVolume(musicVolume > 0 ? musicVolume : DEFAULT_MUSIC_VOLUME);
    setSfxVolume(sfxVolume > 0 ? sfxVolume : DEFAULT_SFX_VOLUME);
  }

  /* Mute popover menu — 3 choices: music, sfx, all */
  const SVG_MUSIC_NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const SVG_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';

  function volSliderHtml(kind, value) {
    const pct = Math.round(value * 100);
    const icon = (kind === 'music') ? SVG_MUSIC_NOTE : SVG_BELL;
    const label = (kind === 'music') ? 'מוזיקה' : 'אפקטי קול';
    return '<div class="mute-row" data-kind="' + kind + '">' +
      '<div class="mute-row-head">' +
        '<div class="mute-item-icon">' + icon + '</div>' +
        '<div class="mute-item-label">' + label + '</div>' +
        '<div class="mute-row-pct" data-pct="' + kind + '">' + pct + '%</div>' +
      '</div>' +
      '<input type="range" class="vol-slider" data-slider="' + kind + '" min="0" max="100" step="1" value="' + pct + '" aria-label="' + label + '" />' +
    '</div>';
  }

