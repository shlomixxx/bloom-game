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

    // Find random empty cell
    var emptyCells = [];
    for (var r = 0; r < getBoardRows(); r++)
      for (var c = 0; c < getBoardCols(); c++)
        if (grid[r][c] === 0) emptyCells.push([r, c]);
    if (emptyCells.length === 0) return;

    var cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
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

    // Countdown
    activeEvent.interval = setInterval(function() {
      if (!activeEvent) return;
      var elapsed = (Date.now() - activeEvent.startTime) / 1000;
      activeEvent.timer = Math.max(0, activeEvent.maxTimer - elapsed);
      updateEventTimer(activeEvent);
      if (activeEvent.timer <= 0) {
        // Expired!
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

  // ── 💣 BOMB ──
  function triggerBomb(evt) {
    var radius = getEventNum('event_bomb_radius', 1);
    var ptsPerTile = getEventNum('event_bomb_points_per_tile', 2000);
    var destroyed = 0;

    for (var dr = -radius; dr <= radius; dr++) {
      for (var dc = -radius; dc <= radius; dc++) {
        if (dr === 0 && dc === 0) continue; // skip center (the placed tile stays)
        var r = evt.row + dr, c = evt.col + dc;
        if (r < 0 || r >= getBoardRows() || c < 0 || c >= getBoardCols()) continue;
        if (grid[r][c] !== 0) {
          grid[r][c] = 0;
          destroyed++;
          // Flash cell
          var gridEl = document.getElementById('grid');
          if (gridEl) {
            var idx = r * getBoardCols() + c;
            var cell = gridEl.children[idx];
            if (cell) {
              cell.style.transition = 'background 0.15s';
              cell.style.background = '#C8472F';
              (function(ce) { setTimeout(function() { ce.style.background = ''; ce.style.transition = ''; }, 400); })(cell);
            }
          }
        }
      }
    }

    var bonus = destroyed * ptsPerTile;
    score += bonus;
    showEventBanner('💣 BOOM!', '+' + bonus.toLocaleString(), 'bomb');
    buzz([100, 60, 100, 60, 100]);
    bumpScore();
    checkScoreMilestones();
    // Gravity will be applied by the merge loop
  }

  // ── ⭐ STAR ──
  function triggerStar(evt, landingRow) {
    var upgrade = getEventNum('event_star_upgrade', 1);
    var pts = getEventNum('event_star_points', 500);
    var tRow = (landingRow != null) ? landingRow : evt.row;
    var tile = grid[tRow][evt.col];
    if (tile > 0 && tile < MAX_TIER) {
      grid[tRow][evt.col] = Math.min(tile + upgrade, MAX_TIER);
      var newTier = grid[tRow][evt.col];
      var tierInfo = getActiveTiers()[newTier];
      score += pts;
      showEventBanner('⭐ Level Up!', tierInfo.name + '! +' + pts, 'star');
      bumpScore();
      checkScoreMilestones();
    } else if (tile === MAX_TIER) {
      score += pts * 5;
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
    } else {
      amount = minC + Math.floor(Math.random() * (maxC - minC + 1));
      showEventBanner('🎁 מתנה!', '+' + amount + ' 💎', 'gift');
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
    var cleared = 0;

    // Clear from top
    for (var r = 0; r < clearRows && r < getBoardRows(); r++) {
      for (var c = 0; c < getBoardCols(); c++) {
        if (grid[r][c] !== 0) { grid[r][c] = 0; cleared++; }
      }
      // Flash row blue
      var gridEl = document.getElementById('grid');
      if (gridEl) {
        for (var cc = 0; cc < getBoardCols(); cc++) {
          var idx = r * getBoardCols() + cc;
          var cell = gridEl.children[idx];
          if (cell) {
            cell.style.transition = 'background 0.15s';
            cell.style.background = '#4ECDC4';
            (function(ce) { setTimeout(function() { ce.style.background = ''; ce.style.transition = ''; }, 500); })(cell);
          }
        }
      }
    }

    score += pts;
    showEventBanner('❄️ הצלה!', 'שורה נמחקה! +' + pts.toLocaleString(), 'freeze');
    buzz([60, 40, 60]);
    bumpScore();
    checkScoreMilestones();
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
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;padding:20px 30px;border-radius:18px;text-align:center;direction:rtl;min-width:200px;pointer-events:none;background:#1C1A18;color:#FAC775;border:2px solid #FAC775;box-shadow:0 12px 36px rgba(0,0,0,0.5)';
    d.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:6px">' + title + '</div><div style="font-size:28px;font-weight:900">' + sub + '</div>';
    document.body.appendChild(d);
    // Fade out after 1.2s
    setTimeout(function() { d.style.transition = 'opacity 0.3s'; d.style.opacity = '0'; }, 1200);
    setTimeout(function() { d.remove(); }, 1600);
  }
