  // ============================================================
  // EVENT DROPS — special items that appear on the board
  // ============================================================
  window.__bloomEventsLoaded = true;

  var activeEvent = null;       // { type, row, col, timer, maxTimer, interval }
  var lastEventTime = 0;        // timestamp of last event end
  var eventSpawnTimer = null;    // setInterval handle
  var feverActive = false;       // is Fever mode on?
  var feverEndTime = 0;          // when Fever ends
  var feverMultiplier = 1;       // current multiplier (1 = normal)
  var targetTier = 0;            // which tier is targeted (🎯)
  var targetActive = false;

  var EVENT_TYPES = [
    { id: 'bomb',   emoji: '💣', label: 'פצצה' },
    { id: 'star',   emoji: '⭐', label: 'כוכב זהב' },
    { id: 'gift',   emoji: '🎁', label: 'מתנה' },
    { id: 'fever',  emoji: '🔥', label: 'טירוף' },
    { id: 'freeze', emoji: '❄️', label: 'הקפאה' },
    { id: 'target', emoji: '🎯', label: 'מטרה' }
  ];

  function getEventConfig(key, fallback) {
    if (gameConfig && gameConfig[key] !== undefined) return gameConfig[key];
    return fallback;
  }
  function getEventNum(key, fallback) {
    return parseInt(getEventConfig(key, fallback), 10) || fallback;
  }

  function eventsEnabled() {
    return getEventConfig('events_enabled', 'true') === 'true';
  }

  function startEventSystem() {
    stopEventSystem();
    if (!eventsEnabled()) return;
    lastEventTime = Date.now();
    eventSpawnTimer = setInterval(function() {
      try { trySpawnEvent(); } catch(e) { /* silent */ }
    }, 1000);
    // Force first event after 3 seconds
    setTimeout(function() {
      try {
        if (!activeEvent && !feverActive && !targetActive && grid) {
          spawnRandomEvent();
        }
      } catch(e) { /* silent */ }
    }, 3000);
  }

  function stopEventSystem() {
    if (eventSpawnTimer) { clearInterval(eventSpawnTimer); eventSpawnTimer = null; }
    clearActiveEvent();
    clearComboCounter();
    feverActive = false;
    feverMultiplier = 1;
    targetActive = false;
    targetTier = 0;
    var feverBar = document.getElementById('fever-bar');
    if (feverBar) feverBar.remove();
    var targetHL = document.querySelector('.tier-target-highlight');
    if (targetHL) targetHL.classList.remove('tier-target-highlight');
  }

  function clearActiveEvent() {
    if (activeEvent) {
      if (activeEvent.interval) clearInterval(activeEvent.interval);
      activeEvent = null;
    }
    var el = document.getElementById('event-drop-overlay');
    if (el) el.remove();
  }

  function repositionEventOverlay() {
    if (!activeEvent) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var idx = activeEvent.row * getBoardCols() + activeEvent.col;
    var cell = gridEl.children[idx];
    if (!cell) return;
    var overlay = document.getElementById('event-drop-overlay');
    if (!overlay) return;
    var rect = cell.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }

  function countEmptyCells() {
    var count = 0;
    for (var r = 0; r < getBoardRows(); r++)
      for (var c = 0; c < getBoardCols(); c++)
        if (grid[r][c] === 0) count++;
    return count;
  }

  function countFilledRows() {
    var count = 0;
    for (var r = 0; r < getBoardRows(); r++) {
      var full = true;
      for (var c = 0; c < getBoardCols(); c++) {
        if (grid[r][c] === 0) { full = false; break; }
      }
      if (full) count++;
    }
    return count;
  }

  function trySpawnEvent() {
    if (!eventsEnabled() || busy) return;
    if (activeEvent || feverActive || targetActive) return;

    var startDelay = getEventNum('events_start_delay', 15) * 1000;
    if (Date.now() - gameStartTime < startDelay) return;

    var minGap = getEventNum('events_min_gap', 15) * 1000;
    var maxGap = getEventNum('events_max_gap', 35) * 1000;
    var elapsed = Date.now() - lastEventTime;
    if (elapsed < minGap) return;

    var minEmpty = getEventNum('events_min_empty_cells', 4);
    if (countEmptyCells() < minEmpty) return;

    // Probability increases linearly from 0% at minGap to 100% at maxGap
    var prob = Math.min(1, (elapsed - minGap) / (maxGap - minGap));
    if (Math.random() > prob * 0.4) return; // ~40% check per second at max

    spawnRandomEvent();
  }

  function spawnRandomEvent() {
    if (!grid || !grid.length) return;
    // Build weighted list of enabled events
    var pool = [];
    var totalWeight = 0;
    EVENT_TYPES.forEach(function(et) {
      if (getEventConfig('event_' + et.id + '_enabled', 'true') !== 'true') return;
      // Freeze only when board is mostly full
      if (et.id === 'freeze') {
        var minFilled = getEventNum('event_freeze_min_filled_rows', 3);
        if (countFilledRows() < minFilled) return;
      }
      var w = getEventNum('event_' + et.id + '_weight', 15);
      if (w <= 0) return;
      totalWeight += w;
      pool.push({ type: et, weight: w, cumWeight: totalWeight });
    });
    if (pool.length === 0) return;

    // Weighted random pick
    var roll = Math.random() * totalWeight;
    var chosen = pool[0].type;
    for (var i = 0; i < pool.length; i++) {
      if (roll <= pool[i].cumWeight) { chosen = pool[i].type; break; }
    }

    // Target is special — doesn't go on a cell
    if (chosen.id === 'target') {
      spawnTargetEvent();
      return;
    }

    // Find columns with empty cells — pick the BOTTOM-MOST empty cell
    // (where the next tile would actually land)
    var candidates = [];
    for (var c = 0; c < getBoardCols(); c++) {
      for (var r = getBoardRows() - 1; r >= 0; r--) {
        if (grid[r][c] === 0) {
          candidates.push([r, c]);
          break; // only bottom-most empty per column
        }
      }
    }
    if (candidates.length === 0) return;

    var cell = candidates[Math.floor(Math.random() * candidates.length)];
    var timerSec = getEventNum('event_' + chosen.id + '_timer', 8);

    activeEvent = {
      type: chosen.id,
      emoji: chosen.emoji,
      label: chosen.label,
      row: cell[0],
      col: cell[1],
      maxTimer: timerSec,
      timer: timerSec,
      startTime: Date.now()
    };

    renderEventOnCell(activeEvent);
    // Sound: "ding!" when event appears
    if (!isSfxMuted()) {
      tone({ freq: 880, duration: 0.08, type: 'sine', vol: 0.06 });
      setTimeout(function() { tone({ freq: 1100, duration: 0.06, type: 'sine', vol: 0.05 }); }, 80);
    }

    // Countdown + near-expiry vibration
    var warnedExpiry = false;
    activeEvent.interval = setInterval(function() {
      if (!activeEvent) return;
      var elapsed = (Date.now() - activeEvent.startTime) / 1000;
      activeEvent.timer = Math.max(0, activeEvent.maxTimer - elapsed);
      updateEventTimer(activeEvent);
      // Vibrate warning at 25% time remaining
      if (!warnedExpiry && activeEvent.timer < activeEvent.maxTimer * 0.25 && activeEvent.timer > 0) {
        warnedExpiry = true;
        if (!isSfxMuted()) buzz([20, 30, 20]);
      }
      if (activeEvent.timer <= 0) {
        clearActiveEvent();
        lastEventTime = Date.now();
      }
    }, 100);
  }

  function renderEventOnCell(evt) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;

    // Remove existing overlay
    var old = document.getElementById('event-drop-overlay');
    if (old) old.remove();

    var idx = evt.row * getBoardCols() + evt.col;
    var cell = gridEl.children[idx];
    if (!cell) return;

    var rect = cell.getBoundingClientRect();
    if (rect.width === 0) return; // not laid out yet

    var overlay = document.createElement('div');
    overlay.id = 'event-drop-overlay';
    overlay.style.cssText = 'position:fixed;top:' + rect.top + 'px;left:' + rect.left + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;z-index:100;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12px;border:3px solid #FAC775;background:rgba(0,0,0,0.8);animation:eventAppear 0.3s ease-out';
    overlay.innerHTML =
      '<span style="font-size:28px;animation:eventBob 1s ease-in-out infinite">' + evt.emoji + '</span>' +
      '<svg width="40" height="40" viewBox="0 0 36 36" style="position:absolute">' +
        '<circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2.5"/>' +
        '<circle id="event-ring-fg" cx="18" cy="18" r="16" fill="none" stroke="#2E8B6F" stroke-width="2.5" stroke-dasharray="100.5" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 18 18)"/>' +
      '</svg>' +
      '<span id="event-timer-text" style="font-size:12px;font-weight:800;color:#FFF;margin-top:2px;text-shadow:0 1px 3px rgba(0,0,0,0.8)">' + evt.maxTimer + 's</span>';
    document.body.appendChild(overlay);
  }

  function updateEventTimer(evt) {
    var ring = document.getElementById('event-ring-fg');
    var text = document.getElementById('event-timer-text');
    if (!ring || !text) return;
    var pct = evt.timer / evt.maxTimer;
    var offset = 100.5 * (1 - pct);
    ring.style.strokeDashoffset = offset;
    if (pct > 0.5) ring.style.stroke = '#2E8B6F';
    else if (pct > 0.25) ring.style.stroke = '#FAC775';
    else ring.style.stroke = '#C8472F';
    text.textContent = evt.timer.toFixed(1) + 's';
    var overlay = document.getElementById('event-drop-overlay');
    if (overlay) {
      if (pct < 0.25) overlay.style.animation = 'eventUrgent 0.3s ease-in-out infinite';
    }
  }

  // Called when a tile is placed at (row, col)
  function checkEventTrigger(row, col) {
    if (!activeEvent) return false;
    // Trigger if tile dropped in the same COLUMN as the event
    // (not exact cell — tile falls to bottom, event can be anywhere)
    if (activeEvent.col === col) {
      triggerEvent(activeEvent, row);
      return true;
    }
    return false;
  }

  function triggerEvent(evt, landingRow) {
    var type = evt.type;
    clearActiveEvent();
    lastEventTime = Date.now();
    buzz([60, 40]);

    if (type === 'bomb') triggerBomb(evt);
    else if (type === 'star') triggerStar(evt, landingRow);
    else if (type === 'gift') triggerGift(evt);
    else if (type === 'fever') triggerFever(evt);
    else if (type === 'freeze') triggerFreeze(evt);
  }

  // Spawn an explosion overlay (position:fixed) over a cell's rect. Lives in
  // <body> so render() rebuilding <#grid> can't wipe it. Cleans itself up.
  // CSS classes: 'fx-explode' (orange bomb), 'fx-freeze' (blue freeze).
  function spawnFxOverlay(cellRect, klass, delayMs) {
    var el = document.createElement('div');
    el.className = 'fx-overlay ' + klass;
    var size = Math.max(cellRect.width, cellRect.height) * 1.6;
    el.style.cssText =
      'position:fixed;left:' + (cellRect.left + cellRect.width / 2 - size / 2) + 'px;' +
      'top:' + (cellRect.top + cellRect.height / 2 - size / 2) + 'px;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'pointer-events:none;z-index:9500;border-radius:50%';
    if (delayMs > 0) {
      setTimeout(function() {
        document.body.appendChild(el);
        setTimeout(function() { el.remove(); }, 720);
      }, delayMs);
    } else {
      document.body.appendChild(el);
      setTimeout(function() { el.remove(); }, 720);
    }
  }
  function fxAtCell(r, c, klass, delayMs) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var idx = r * getBoardCols() + c;
    var cell = gridEl.children[idx];
    if (!cell) return;
    var rect = cell.getBoundingClientRect();
    if (rect.width === 0) return;
    spawnFxOverlay(rect, klass, delayMs || 0);
  }

  // ── 💣 BOMB ──
  function triggerBomb(evt) {
    var radius = getEventNum('event_bomb_radius', 1);
    var ptsPerTile = getEventNum('event_bomb_points_per_tile', 2000);
    var destroyed = 0;
    var destroyedCells = []; // (r,c,tier) of every tile actually destroyed

    // Stage 1: capture cell rects BEFORE clearing the grid (so we know
    // where to spawn explosion overlays, independent of render()).
    var hitCells = [];
    for (var dr = -radius; dr <= radius; dr++) {
      for (var dc = -radius; dc <= radius; dc++) {
        var r = evt.row + dr, c = evt.col + dc;
        if (r < 0 || r >= getBoardRows() || c < 0 || c >= getBoardCols()) continue;
        var dist = Math.max(Math.abs(dr), Math.abs(dc));
        hitCells.push({ r: r, c: c, dist: dist, hadTile: grid[r][c] !== 0 });
        // Always show the explosion (even on empty cells inside the radius) —
        // the SHAPE of the blast is what tells the player what got hit.
        // But only destroy tiles that actually exist (don't bomb the center).
        if (grid[r][c] !== 0 && !(dr === 0 && dc === 0)) {
          destroyedCells.push({ r: r, c: c, tier: grid[r][c] });
          grid[r][c] = 0;
          destroyed++;
        }
      }
    }

    // Stage 2: spawn explosion overlays staggered by distance (center → out).
    // These live in <body> so render() can't destroy them, fixing the
    // "explosion never visible" bug where cell.style.background was wiped.
    for (var i = 0; i < hitCells.length; i++) {
      fxAtCell(hitCells[i].r, hitCells[i].c, 'fx-explode', hitCells[i].dist * 55);
    }

    var bonus = destroyed * ptsPerTile;
    score += bonus;
    // BONUS VERIFICATION — exactly which cells the bomb destroyed vs the
    // visual explosion (which scales to ~2.1× cell size and visually overflows).
    if (window.__bloomEngineLog) {
      console.log('[bomb] center=' + evt.row + ',' + evt.col,
        'radius=' + radius,
        'scanned=' + hitCells.length + 'cells',
        'destroyed=' + destroyed + 'tiles',
        '+' + bonus + 'pts',
        'cells=' + destroyedCells.map(function(d) { return d.r + ',' + d.c + '(t' + d.tier + ')'; }).join(' | ')
      );
    }
    showEventBanner('💣 BOOM!', '+' + bonus.toLocaleString(), 'bomb');
    var shakeInt = getEventNum('event_bomb_shake', 6);
    buzz([100, 60, 100, 60, 100]);
    if (shakeInt > 0) shakeGrid(shakeInt);
    bumpScore();
    checkScoreMilestones();
    // Apply gravity so tiles don't float after explosion
    applyGravity();
    render();
    // AFTER render() rebuilds the grid DOM — re-mark the cells that got hit
    // so the user sees exactly which squares were destroyed (separate signal
    // from the explosion visual). Lingers for 800ms.
    markBonusHitCells(destroyedCells, 'bonus-hit', 800);
  }

  // Mark a list of cells with a CSS class that lingers visually. Cleared by
  // a setTimeout, and self-resilient to render() rebuilds (we re-query the
  // grid's current children, not cached refs from before render).
  function markBonusHitCells(cells, klass, durationMs) {
    if (!cells || !cells.length) return;
    var gridEl = document.getElementById('grid');
    if (!gridEl) return;
    var COLS = getBoardCols();
    cells.forEach(function(c) {
      var idx = c.r * COLS + c.c;
      var cell = gridEl.children[idx];
      if (cell) cell.classList.add(klass);
    });
    setTimeout(function() {
      var g = document.getElementById('grid');
      if (!g) return;
      cells.forEach(function(c) {
        var idx = c.r * COLS + c.c;
        var cell = g.children[idx];
        if (cell) cell.classList.remove(klass);
      });
    }, durationMs || 800);
  }

  // ── ⭐ STAR ──
  function triggerStar(evt, landingRow) {
    var upgrade = getEventNum('event_star_upgrade', 1);
    var pts = getEventNum('event_star_points', 500);
    var tRow = (landingRow != null) ? landingRow : evt.row;
    var tile = grid[tRow][evt.col];
    if (tile > 0 && tile < MAX_TIER) {
      var oldTier = tile;
      grid[tRow][evt.col] = Math.min(tile + upgrade, MAX_TIER);
      var newTier = grid[tRow][evt.col];
      if (newTier > highestTier) highestTier = newTier;
      var tierInfo = getActiveTiers()[newTier];
      score += pts;
      if (window.__bloomEngineLog) {
        console.log('[star] cell=' + tRow + ',' + evt.col,
          't' + oldTier + ' → t' + newTier,
          '(' + tierInfo.name + ')',
          '+' + pts + 'pts');
      }
      showEventBanner('⭐ Level Up!', tierInfo.name + '! +' + pts, 'star');
      bumpScore();
      checkScoreMilestones();
      render();
      markBonusHitCells([{ r: tRow, c: evt.col }], 'bonus-star', 900);
    } else if (tile === MAX_TIER) {
      score += pts * 5;
      if (window.__bloomEngineLog) {
        console.log('[star] cell=' + tRow + ',' + evt.col,
          'CROWN ×5', '+' + (pts * 5) + 'pts');
      }
      showEventBanner('⭐ כתר מוזהב!', '+' + (pts * 5).toLocaleString(), 'star');
      bumpScore();
      checkScoreMilestones();
    }
  }

  // ── 🎁 GIFT ──
  function triggerGift(evt) {
    var minC = getEventNum('event_gift_credits_min', 5);
    var maxC = getEventNum('event_gift_credits_max', 50);
    var jpChance = getEventNum('event_gift_jackpot_chance', 5);
    var jpAmount = getEventNum('event_gift_jackpot_amount', 500);

    var isJackpot = Math.random() * 100 < jpChance;
    var amount;
    if (isJackpot) {
      amount = jpAmount;
      showEventBanner('🎁 JACKPOT!!!', '+' + amount + ' 💎', 'gift-jackpot');
      buzz([80, 40, 80, 40, 80, 40, 80]);
      showConfetti(35);
    } else {
      amount = minC + Math.floor(Math.random() * (maxC - minC + 1));
      showEventBanner('🎁 מתנה!', '+' + amount + ' 💎', 'gift');
    }
    if (window.__bloomEngineLog) {
      console.log('[gift] cell=' + evt.row + ',' + evt.col,
        (isJackpot ? 'JACKPOT' : 'normal'),
        '+' + amount + '💎',
        'roll=' + jpChance + '% chance');
    }
    // Send actual amount to server (not fixed config value)
    if (!window.__bloomBotActive && !skinTrialMode) {
      earnCredits('event_gift', { amount: amount });
    }
  }

  // ── 🔥 FEVER ──
  function triggerFever(evt) {
    var duration = getEventNum('event_fever_duration', 10);
    var mult = getEventNum('event_fever_multiplier', 3);
    feverActive = true;
    feverMultiplier = mult;
    feverEndTime = Date.now() + duration * 1000;

    if (window.__bloomEngineLog) {
      console.log('[fever] activated', 'multiplier=×' + mult, 'duration=' + duration + 's', 'ends_at=' + new Date(feverEndTime).toLocaleTimeString());
    }
    showEventBanner('🔥 FEVER MODE!', '×' + mult + ' ניקוד למשך ' + duration + 's', 'fever');
    buzz([80, 40, 80]);

    // Add fever bar
    var wrap = document.getElementById('grid-wrap');
    if (wrap) {
      var bar = document.createElement('div');
      bar.id = 'fever-bar';
      bar.className = 'fever-bar';
      bar.innerHTML = '<div class="fever-bar-fill" id="fever-bar-fill"></div><span class="fever-bar-text">🔥 ×' + mult + '</span>';
      wrap.appendChild(bar);
    }

    // Add fever border
    var gridEl = document.getElementById('grid');
    if (gridEl) gridEl.classList.add('fever-active');

    // Update fever countdown
    var feverInterval = setInterval(function() {
      var remaining = feverEndTime - Date.now();
      if (remaining <= 0) {
        feverActive = false;
        feverMultiplier = 1;
        clearInterval(feverInterval);
        var fb = document.getElementById('fever-bar');
        if (fb) fb.remove();
        if (gridEl) gridEl.classList.remove('fever-active');
        return;
      }
      var pct = remaining / (duration * 1000);
      var fill = document.getElementById('fever-bar-fill');
      if (fill) fill.style.width = (pct * 100) + '%';
    }, 50);
  }

  // ── ❄️ FREEZE ──
  function triggerFreeze(evt) {
    var clearRows = getEventNum('event_freeze_clear_rows', 1);
    var pts = getEventNum('event_freeze_points', 1000);
    var clearedCells = []; // for verification + lingering marker

    // Same fix as bomb: spawn overlays before render() wipes the grid.
    // Walk top rows left→right with staggered delays so the freeze "sweeps".
    for (var r = 0; r < clearRows && r < getBoardRows(); r++) {
      for (var c = 0; c < getBoardCols(); c++) {
        fxAtCell(r, c, 'fx-freeze', c * 45);
        if (grid[r][c] !== 0) {
          clearedCells.push({ r: r, c: c, tier: grid[r][c] });
          grid[r][c] = 0;
        }
      }
    }

    score += pts;
    if (window.__bloomEngineLog) {
      console.log('[freeze] rows_cleared=' + clearRows,
        'tiles_removed=' + clearedCells.length,
        '+' + pts + 'pts',
        'cells=' + clearedCells.map(function(d) { return d.r + ',' + d.c + '(t' + d.tier + ')'; }).join(' | '));
    }
    var shakeInt = getEventNum('event_freeze_shake', 4);
    showEventBanner('❄️ הצלה!', 'שורה נמחקה! +' + pts.toLocaleString(), 'freeze');
    buzz([60, 40, 60]);
    if (shakeInt > 0) shakeGrid(shakeInt);
    bumpScore();
    checkScoreMilestones();
    // Apply gravity so tiles above fall down
    applyGravity();
    render();
    markBonusHitCells(clearedCells, 'bonus-freeze', 900);
  }

  // ── 🎯 TARGET ──
  function spawnTargetEvent() {
    var timerSec = getEventNum('event_target_timer', 12);
    // Pick a random tier 2-6
    targetTier = 2 + Math.floor(Math.random() * 5);
    targetActive = true;

    // Highlight in tier bar
    var tierBar = document.getElementById('tier-bar');
    if (tierBar) {
      var items = tierBar.querySelectorAll('.tier-item');
      if (items[targetTier]) {
        items[targetTier].classList.add('tier-target-highlight');
      }
    }

    if (window.__bloomEngineLog) {
      console.log('[target] activated', 'target_tier=t' + targetTier, '(' + getActiveTiers()[targetTier].name + ')', 'duration=' + timerSec + 's');
    }
    showEventBanner('🎯 מטרה!', 'מזג ' + getActiveTiers()[targetTier].name + ' תוך ' + timerSec + 's!', 'target');
    lastEventTime = Date.now();

    // Timer
    setTimeout(function() {
      if (targetActive) {
        targetActive = false;
        targetTier = 0;
        var items2 = document.querySelectorAll('.tier-target-highlight');
        items2.forEach(function(el) { el.classList.remove('tier-target-highlight'); });
      }
    }, timerSec * 1000);
  }

  // Called when any merge happens — check if it matches target
  function checkTargetMerge(newTier) {
    if (!targetActive || newTier !== targetTier) return 1;
    // Hit!
    targetActive = false;
    var mult = getEventNum('event_target_multiplier', 5);
    var items = document.querySelectorAll('.tier-target-highlight');
    items.forEach(function(el) { el.classList.remove('tier-target-highlight'); });
    if (window.__bloomEngineLog) {
      console.log('[target] HIT', 'tier=t' + newTier, 'multiplier=×' + mult);
    }
    showEventBanner('🎯 פגיעה!', '×' + mult + ' בונוס!', 'target');
    buzz([60, 40, 60, 40, 60]);
    targetTier = 0;
    return mult;
  }

  // Get current fever multiplier
  function getFeverMultiplier() {
    if (!feverActive) return 1;
    if (Date.now() > feverEndTime) { feverActive = false; feverMultiplier = 1; return 1; }
    return feverMultiplier;
  }

  // Show event banner — exact same approach as the green diagnostic (which works!)
  function showEventBanner(title, sub, cssClass) {
    showTransientBanner({
      tag: 'event-' + (cssClass || 'generic'),
      holdMs: 1200, fadeMs: 400,
      style: 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;padding:20px 30px;border-radius:18px;text-align:center;direction:rtl;min-width:200px;pointer-events:auto;background:#1C1A18;color:#FAC775;border:2px solid #FAC775;box-shadow:0 12px 36px rgba(0,0,0,0.5)',
      html: '<div style="font-size:18px;font-weight:700;margin-bottom:6px">' + title + '</div><div style="font-size:28px;font-weight:900">' + sub + '</div>',
    });
  }

  // ============================================================
  // AD SYSTEM — simulate ad watching (replace with real SDK later)
  // ============================================================
  var lastAdWatchTime = 0;

  function simulateAdWatch(callback) {
    // Rate limit: 1 ad per 30 seconds
    if (Date.now() - lastAdWatchTime < 30000) {
      showEventBanner('⏰ המתן', 'פרסומת חדשה בעוד מעט', '');
      return;
    }
    // Show "ad" overlay (replace with real ad SDK integration)
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#FFF;font-family:inherit;direction:rtl';
    overlay.innerHTML =
      '<div style="font-size:14px;color:#888;margin-bottom:20px">פרסומת</div>' +
      '<div style="font-size:48px;font-weight:900" id="ad-countdown">3</div>' +
      '<div style="font-size:13px;color:#666;margin-top:20px">הפרסומת תסתיים בעוד מספר שניות...</div>' +
      '<div style="width:200px;height:4px;background:#333;border-radius:2px;margin-top:16px;overflow:hidden"><div id="ad-progress" style="width:0%;height:100%;background:#FAC775;transition:width 1s linear"></div></div>';
    document.body.appendChild(overlay);

    var sec = 3;
    var countEl = overlay.querySelector('#ad-countdown');
    var progEl = overlay.querySelector('#ad-progress');
    requestAnimationFrame(function() { progEl.style.width = '33%'; });

    var adInterval = setInterval(function() {
      sec--;
      if (countEl) countEl.textContent = sec > 0 ? sec : '✓';
      if (progEl) progEl.style.width = ((3 - sec) / 3 * 100) + '%';
      if (sec <= 0) {
        clearInterval(adInterval);
        lastAdWatchTime = Date.now();
        setTimeout(function() {
          overlay.remove();
          if (callback) callback();
        }, 500);
      }
    }, 1000);
  }

  // ============================================================
  // CONFETTI — CSS-only particles for celebrations
  // ============================================================
  var CONFETTI_COLORS = ['#FAC775','#EF9F27','#FF6B35','#C8472F','#9B8AE8','#2E8B6F','#4ECDC4','#F4C0D1'];

  function showConfetti(count) {
    count = count || 30;
    var host = document.createElement('div');
    host.className = 'confetti-host';
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = (Math.random() * 100) + '%';
      p.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.animationDuration = (1 + Math.random() * 1) + 's';
      p.style.width = (4 + Math.random() * 8) + 'px';
      p.style.height = (4 + Math.random() * 6) + 'px';
      host.appendChild(p);
    }
    document.body.appendChild(host);
    setTimeout(function() { host.remove(); }, 2500);
  }

  // ============================================================
  // COMBO COUNTER — persistent chain display during gameplay
  // ============================================================
  var comboEl = null;
  var comboTimeout = null;

  function showComboCounter(chainCount, multiplier) {
    if (chainCount < 2) return;
    if (comboTimeout) clearTimeout(comboTimeout);

    if (!comboEl) {
      comboEl = document.createElement('div');
      comboEl.className = 'combo-counter';
      document.body.appendChild(comboEl);
    }
    comboEl.innerHTML = '🔥 ×' + chainCount + '<span class="combo-mult">×' + multiplier.toFixed(1) + '</span>';
    comboEl.style.animation = 'none';
    comboEl.style.opacity = '1';
    void comboEl.offsetWidth;
    comboEl.style.animation = 'comboPop 0.2s ease-out';
    comboEl.style.fontSize = Math.min(20 + chainCount * 3, 36) + 'px';

    comboTimeout = setTimeout(function() {
      if (comboEl && comboEl.parentNode) {
        comboEl.style.transition = 'opacity 0.3s';
        comboEl.style.opacity = '0';
        setTimeout(function() { clearComboCounter(); }, 300);
      }
      comboTimeout = null;
    }, 3000);
  }

  function clearComboCounter() {
    if (comboTimeout) { clearTimeout(comboTimeout); comboTimeout = null; }
    if (comboEl && comboEl.parentNode) comboEl.remove();
    comboEl = null;
  }
