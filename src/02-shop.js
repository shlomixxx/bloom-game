  // ============ 1v1 DUEL SYSTEM ============
  function showDuelModal() {
    var existing = document.getElementById('duel-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'duel-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div class="info-card" style="max-width:340px;direction:rtl">' +
      '<div style="font-size:16px;font-weight:700;margin-bottom:12px">⚔️ דו-קרב 1v1</div>' +
      '<div style="font-size:12px;color:#6F6E68;margin-bottom:12px">אתגר שחקן ספציפי! שניכם משחקים על אותו לוח — מי שמשיג יותר נקודות מנצח.</div>' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">קוד היריב</div>' +
      '<input id="duel-opponent" placeholder="BLOOM-XXXX" maxlength="10" style="width:100%;padding:8px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:14px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;text-align:center;box-sizing:border-box;margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:600;margin-bottom:4px">הימור (אופציונלי)</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<input type="number" id="duel-amount" value="0" min="0" style="width:80px;padding:6px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:14px;text-align:center;font-weight:700">' +
        '<span style="font-size:12px;color:#6F6E68">💎 · המנצח לוקח הכל (minus 5% עמלה)</span>' +
      '</div>' +
      '<button class="btn" id="duel-send" style="width:100%;margin-bottom:10px">שלח אתגר ⚔️</button>' +
      '<div id="duel-error" style="color:#C8472F;font-size:12px;text-align:center;min-height:18px"></div>' +
      '<div style="border-top:1px solid rgba(0,0,0,0.06);margin-top:10px;padding-top:10px">' +
        '<div style="font-size:12px;font-weight:600;margin-bottom:6px">הדו-קרבות שלי</div>' +
        '<div id="duel-list" style="font-size:12px;color:#6F6E68">טוען...</div>' +
      '</div>' +
      '<button class="btn secondary" style="width:100%;margin-top:10px" onclick="this.closest(\'.info-modal\').remove()">סגור</button>' +
    '</div>';
    document.body.appendChild(modal);

    // Load my duels
    loadMyDuels();

    // Send challenge
    document.getElementById('duel-send').onclick = async function() {
      var opp = (document.getElementById('duel-opponent').value || '').trim().toUpperCase();
      var amt = parseInt(document.getElementById('duel-amount').value, 10) || 0;
      var errEl = document.getElementById('duel-error');
      errEl.textContent = '';
      if (!opp || opp.length < 6) { errEl.textContent = 'נא להזין קוד שחקן (BLOOM-XXXX)'; return; }
      if (amt > 0 && playerBalance < amt) { errEl.textContent = '💎 אין מספיק קרדיטים (' + playerBalance + ')'; return; }
      this.disabled = true; this.textContent = '...';
      try {
        var r = await fetch(API_BASE + '/api/duels', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, opponentCode: opp, amount: amt })
        });
        var d = await r.json();
        this.disabled = false; this.textContent = 'שלח אתגר ⚔️';
        if (d && d.ok) {
          if (amt > 0) { playerBalance -= amt; updateBalanceDisplay(); }
          errEl.style.color = '#2E8B6F';
          errEl.textContent = '✅ אתגר נשלח! ממתין ליריב...';
          loadMyDuels();
        } else {
          var msgs = { self_duel: 'לא ניתן לאתגר את עצמך', opponent_not_found: 'שחקן לא נמצא', insufficient_balance: 'אין מספיק 💎', duels_disabled: 'דו-קרבות מושבתים' };
          errEl.textContent = msgs[d.reason] || 'שגיאה';
        }
      } catch(e) { this.disabled = false; this.textContent = 'שלח אתגר ⚔️'; errEl.textContent = 'שגיאת רשת'; }
    };
  }

  async function loadMyDuels() {
    var el = document.getElementById('duel-list');
    if (!el) return;
    try {
      var r = await fetch(API_BASE + '/api/duels/mine?deviceId=' + encodeURIComponent(deviceId));
      var d = await r.json();
      if (!d || !d.duels || !d.duels.length) { el.textContent = 'אין דו-קרבות'; return; }
      var html = '';
      d.duels.forEach(function(duel) {
        var isChallenger = duel.challenger_device === deviceId;
        var otherName = isChallenger ? (duel.opponent_name || duel.opponent_code) : (duel.challenger_name || duel.challenger_code);
        var statusMap = { pending: '⏳ ממתין', accepted: '🎮 משחקים', settled: '✅ הסתיים', tie: '🤝 תיקו', expired: '⏰ פג תוקף' };
        var statusText = statusMap[duel.status] || duel.status;
        var amtText = (duel.amount | 0) > 0 ? ' · ' + duel.amount + '💎' : '';
        var winText = '';
        if (duel.status === 'settled' && duel.winner_device) {
          winText = duel.winner_device === deviceId ? ' · <strong style="color:#2E8B6F">ניצחת!</strong>' : ' · <span style="color:#C8472F">הפסדת</span>';
        }
        var actionBtn = '';
        if (duel.status === 'pending' && !isChallenger) {
          actionBtn = '<button class="btn sm" style="font-size:10px;padding:3px 8px" onclick="acceptDuel(' + duel.id + ')">קבל ⚔️</button>';
        }
        html += '<div style="padding:6px 0;border-top:1px solid rgba(0,0,0,0.04)">' +
          '<span style="font-weight:600">vs ' + otherName + '</span>' + amtText + ' · ' + statusText + winText + ' ' + actionBtn +
        '</div>';
      });
      el.innerHTML = html;
    } catch(e) { el.textContent = 'שגיאה בטעינה'; }
  }

  window.acceptDuel = async function(id) {
    var r = await fetch(API_BASE + '/api/duels/' + id + '/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
    });
    var d = await r.json();
    if (d && d.ok) {
      fetchPlayerCode(); // refresh balance
      loadMyDuels();
    } else {
      alert((d && d.reason) || 'שגיאה');
    }
  };

  // ============ IN-GAME TILE SHOP ============
  var tilePrices = null; // fetched once from server

  var powerupPrices = null;

  async function loadTilePrices() {
    if (tilePrices) return;
    try {
      var r = await fetch(API_BASE + '/api/tile-prices');
      var d = await r.json();
      if (d && d.ok && d.enabled) tilePrices = d.prices;
      else tilePrices = null;
    } catch (e) { tilePrices = null; }
    // Load power-up prices from config
    try {
      var r2 = await fetch(API_BASE + '/api/tile-prices');
      // Power-up prices are in the config too — fetch them via the config endpoint fallback
      powerupPrices = {
        random_tile: 15, choose_tile: 40, random_row: 60, choose_row: 100 // defaults
      };
    } catch(e) {}
  }

  function updateBalanceDisplay() {
    var el = document.getElementById('balance-display');
    if (!el) return;
    var b = playerBalance;
    var text = b >= 100000 ? Math.round(b / 1000) + 'K'
      : b >= 10000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
      : b >= 1000 ? (b / 1000).toFixed(1).replace('.0', '') + 'K'
      : String(b);
    el.textContent = text;
  }

  // Active power-up mode
  var activePowerup = null;
  var activePowerupCost = 0;

  function showTileShop() {
    if (!tilePrices) { loadTilePrices().then(showTileShop); return; }
    if (busy) return;
    var existing = document.getElementById('tile-shop-modal');
    if (existing) { existing.remove(); return; }

    var modal = document.createElement('div');
    modal.id = 'tile-shop-modal';
    var html = '<div class="ts-header"><span>🛒 חנות משחק</span><span style="color:#BA7517;font-weight:700">💎 ' + playerBalance + '</span></div>';

    // Section 1: Buy tiles
    html += '<div class="ts-section-label">קנה אריח</div>';
    html += '<div class="ts-grid">';
    for (var t = 2; t <= MAX_TIER; t++) {
      var ti = getActiveTiers()[t];
      var price = tilePrices[t] || 0;
      var canBuy = playerBalance >= price;
      html += '<button class="ts-tile' + (!canBuy ? ' ts-locked' : '') + '" data-tier="' + t + '" data-price="' + price + '"' + (!canBuy ? ' disabled' : '') + '>' +
        '<div class="ts-icon" style="background:' + ti.bg + ';color:' + ti.fg + '">' + ti.svg + '</div>' +
        '<div class="ts-name">' + ti.name + '</div>' +
        '<div class="ts-price">' + price + ' 💎</div>' +
      '</button>';
    }
    html += '</div>';

    // Section 2: Power-ups
    var pp = powerupPrices || { random_tile: 15, choose_tile: 40, random_row: 60, choose_row: 100 };
    html += '<div class="ts-section-label" style="margin-top:10px">כלי עזר</div>';
    html += '<div class="ts-powerups">';
    html += '<button class="ts-power" data-power="random_tile"' + (playerBalance < pp.random_tile ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎲</span><span class="ts-power-name">מחק אריח רנדומלי</span><span class="ts-power-price">' + pp.random_tile + ' 💎</span></button>';
    html += '<button class="ts-power" data-power="choose_tile"' + (playerBalance < pp.choose_tile ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎯</span><span class="ts-power-name">מחק אריח לבחירה</span><span class="ts-power-price">' + pp.choose_tile + ' 💎</span></button>';
    html += '<button class="ts-power" data-power="random_row"' + (playerBalance < pp.random_row ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">🎲</span><span class="ts-power-name">פנה שורה רנדומלית</span><span class="ts-power-price">' + pp.random_row + ' 💎</span></button>';
    html += '<button class="ts-power ts-power-premium" data-power="choose_row"' + (playerBalance < pp.choose_row ? ' disabled' : '') + '>' +
      '<span class="ts-power-icon">👑</span><span class="ts-power-name">פנה שורה לבחירה</span><span class="ts-power-price">' + pp.choose_row + ' 💎</span></button>';
    html += '</div>';
    html += '<div class="ts-hint">🎲 זול = המערכת בוחרת מה לפנות · 🎯 יקר = אתה שולט בדיוק מה לפנות</div>';

    html += '<button class="ts-close" id="ts-close-btn">✕</button>';
    modal.innerHTML = html;
    document.getElementById('grid-wrap').appendChild(modal);

    document.getElementById('ts-close-btn').onclick = function() { modal.remove(); };
    modal.addEventListener('pointerdown', function(e) { if (e.target === modal) modal.remove(); });

    // Wire tile buy buttons
    modal.querySelectorAll('.ts-tile:not([disabled])').forEach(function(btn) {
      btn.onclick = function() {
        var tier = parseInt(this.getAttribute('data-tier'), 10);
        var self = this;
        self.style.opacity = '0.5';
        fetch(API_BASE + '/api/player/buy-tile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, tier: tier })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            updateBalanceDisplay();
            nextPiece = tier;
            render();
            modal.remove();
            showCreditToast(-d.cost, getActiveTiers()[tier].name);
            trackEvent('purchase', { item: 'tile', tier: tier, cost: d.cost });
          } else {
            self.style.opacity = '1';
            self.querySelector('.ts-price').textContent = d.reason === 'insufficient_balance' ? 'אין 💎' : 'שגיאה';
          }
        }).catch(function() { self.style.opacity = '1'; });
      };
    });

    // Wire power-up buttons
    modal.querySelectorAll('.ts-power:not([disabled])').forEach(function(btn) {
      btn.onclick = function() {
        // Block double-buy
        if (activePowerup) {
          modal.remove();
          return;
        }
        var power = this.getAttribute('data-power');
        var self = this;
        self.style.opacity = '0.5';
        var configKey = 'powerup_' + power;
        fetch(API_BASE + '/api/player/buy-powerup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, powerup: configKey })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            updateBalanceDisplay();
            modal.remove();
            executePowerup(power, d.cost);
            trackEvent('purchase', { item: 'powerup', type: power, cost: d.cost });
          } else {
            self.style.opacity = '1';
          }
        }).catch(function() { self.style.opacity = '1'; });
      };
    });
  }

  function executePowerup(type, cost) {
    if (type === 'random_tile') {
      var filled = [];
      for (var r = 0; r < getBoardRows(); r++)
        for (var c = 0; c < getBoardCols(); c++)
          if (grid[r][c] > 0) filled.push([r, c]);
      if (filled.length === 0) return;
      var pick = filled[Math.floor(Math.random() * filled.length)];
      // Roulette animation → then delete
      animateRouletteTile(filled, pick, function() {
        grid[pick[0]][pick[1]] = 0;
        applyGravity();
        render();
        showCreditToast(-cost, 'פינוי אריח 🎲');
        if (mode === 'practice') savePracticeGameState();
      });
    }
    else if (type === 'choose_tile') {
      activePowerup = 'choose_tile';
      activePowerupCost = cost;
      showPowerupHint('🎯 לחץ על האריח שרוצה לפנות');
      showCreditToast(-cost, 'בחר אריח לפינוי');
    }
    else if (type === 'random_row') {
      var filledRows = [];
      for (var r = 0; r < getBoardRows(); r++) {
        if (grid[r].some(function(c) { return c > 0; })) filledRows.push(r);
      }
      if (filledRows.length === 0) return;
      var rowIdx = filledRows[Math.floor(Math.random() * filledRows.length)];
      // Slot machine animation → then delete
      animateRouletteRow(filledRows, rowIdx, function() {
        for (var c = 0; c < getBoardCols(); c++) grid[rowIdx][c] = 0;
        applyGravity();
        render();
        showCreditToast(-cost, 'פינוי שורה 🎲');
        if (mode === 'practice') savePracticeGameState();
      });
    }
    else if (type === 'choose_row') {
      activePowerup = 'choose_row';
      activePowerupCost = cost;
      showPowerupHint('👑 לחץ על השורה שרוצה לפנות');
      showCreditToast(-cost, 'בחר שורה לפינוי');
    }
  }

  // Roulette animation for random tile: rapidly highlights tiles, slows down, explodes target
  function animateRouletteTile(candidates, target, onDone) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) { onDone(); return; }
    var COLS = getBoardCols();
    var steps = 18 + Math.floor(Math.random() * 6); // 18-24 flashes
    var step = 0;
    var prevCell = null;

    function tick() {
      // Remove previous highlight
      if (prevCell) { prevCell.classList.remove('roulette-flash'); prevCell.style.removeProperty('box-shadow'); }
      if (step >= steps) {
        // Land on target → explode!
        var targetCell = gridEl.children[target[0] * COLS + target[1]];
        if (targetCell) {
          targetCell.classList.add('roulette-hit');
          setTimeout(function() {
            targetCell.classList.remove('roulette-hit');
            onDone();
          }, 500);
        } else { onDone(); }
        return;
      }
      // Pick random candidate (last 4 steps → force closer to target)
      var pick = step >= steps - 3 ? target : candidates[Math.floor(Math.random() * candidates.length)];
      var cell = gridEl.children[pick[0] * COLS + pick[1]];
      if (cell) {
        cell.classList.add('roulette-flash');
        cell.style.boxShadow = '0 0 12px 4px rgba(250,199,117,0.7)';
        prevCell = cell;
      }
      step++;
      // Slow down: starts fast (60ms), ends slow (200ms)
      var delay = 60 + Math.pow(step / steps, 2.5) * 200;
      setTimeout(tick, delay);
    }
    tick();
  }

  // Slot machine animation for random row: cycles rows up/down, slows down, explodes target row
  function animateRouletteRow(candidateRows, targetRow, onDone) {
    var gridEl = document.getElementById('grid');
    if (!gridEl) { onDone(); return; }
    var COLS = getBoardCols();
    var steps = 12 + Math.floor(Math.random() * 4);
    var step = 0;
    var prevRow = -1;

    function clearRowHighlight(row) {
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl.children[row * COLS + c];
        if (cell) { cell.classList.remove('roulette-flash'); cell.style.removeProperty('box-shadow'); }
      }
    }
    function highlightRow(row) {
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl.children[row * COLS + c];
        if (cell) { cell.classList.add('roulette-flash'); cell.style.boxShadow = '0 0 12px 4px rgba(250,199,117,0.7)'; }
      }
    }

    function tick() {
      if (prevRow >= 0) clearRowHighlight(prevRow);
      if (step >= steps) {
        // Land on target row → explode all cells!
        highlightRow(targetRow);
        setTimeout(function() {
          for (var c = 0; c < COLS; c++) {
            var cell = gridEl.children[targetRow * COLS + c];
            if (cell) { cell.classList.remove('roulette-flash'); cell.classList.add('roulette-hit'); }
          }
          setTimeout(function() {
            for (var c = 0; c < COLS; c++) {
              var cell = gridEl.children[targetRow * COLS + c];
              if (cell) cell.classList.remove('roulette-hit');
            }
            onDone();
          }, 500);
        }, 300);
        return;
      }
      // Cycle through rows (last 3 steps → target)
      var row = step >= steps - 2 ? targetRow : candidateRows[step % candidateRows.length];
      highlightRow(row);
      prevRow = row;
      step++;
      var delay = 80 + Math.pow(step / steps, 2.5) * 250;
      setTimeout(tick, delay);
    }
    tick();
  }

  function showPowerupHint(text) {
    var existing = document.getElementById('powerup-hint');
    if (existing) existing.remove();
    var hint = document.createElement('div');
    hint.id = 'powerup-hint';
    hint.className = 'powerup-hint';
    hint.innerHTML = '<span>' + text + '</span><button id="powerup-cancel-btn" class="powerup-cancel">✕ ביטול</button>';
    var wrap = document.getElementById('grid-wrap');
    if (wrap) wrap.appendChild(hint);
    document.getElementById('powerup-cancel-btn').onclick = function(e) {
      e.stopPropagation();
      cancelPowerup();
    };
  }

  function cancelPowerup() {
    if (!activePowerup) return;
    // Refund credits
    if (activePowerupCost > 0) {
      playerBalance += activePowerupCost;
      try { localStorage.setItem(PLAYER_BALANCE_KEY, String(playerBalance)); } catch(e) {}
      updateBalanceDisplay();
      showCreditToast(activePowerupCost, 'ביטול — החזר 💎');
      // Server refund
      fetch(API_BASE + '/api/player/buy-powerup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, powerup: 'refund', refundAmount: activePowerupCost })
      }).catch(function() {});
    }
    activePowerup = null;
    activePowerupCost = 0;
    var hint = document.getElementById('powerup-hint');
    if (hint) hint.remove();
  }

  function handlePowerupClick(row, col) {
    if (!activePowerup) return false;
    if (activePowerup === 'choose_tile') {
      if (grid[row][col] > 0) {
        // Explosion animation then delete
        var gridEl = document.getElementById('grid');
        var COLS = getBoardCols();
        var cell = gridEl ? gridEl.children[row * COLS + col] : null;
        if (cell) {
          cell.classList.add('roulette-hit');
          setTimeout(function() {
            grid[row][col] = 0;
            applyGravity();
            render();
            if (mode === 'practice') savePracticeGameState();
          }, 450);
        } else {
          grid[row][col] = 0; applyGravity(); render();
          if (mode === 'practice') savePracticeGameState();
        }
      }
      activePowerup = null; activePowerupCost = 0;
      var hint = document.getElementById('powerup-hint');
      if (hint) hint.remove();
      return true;
    }
    if (activePowerup === 'choose_row') {
      var allMax = grid[row].every(function(c) { return c === MAX_TIER; });
      if (allMax) {
        showPowerupHint('❌ שורה מלאת כתרים! בחר שורה אחרת');
        return true;
      }
      // Explosion animation for entire row
      var gridEl = document.getElementById('grid');
      var COLS = getBoardCols();
      for (var c = 0; c < COLS; c++) {
        var cell = gridEl ? gridEl.children[row * COLS + c] : null;
        if (cell) cell.classList.add('roulette-hit');
      }
      setTimeout(function() {
        for (var c = 0; c < getBoardCols(); c++) grid[row][c] = 0;
        applyGravity();
        render();
        if (mode === 'practice') savePracticeGameState();
      }, 450);
      activePowerup = null; activePowerupCost = 0;
      var hint = document.getElementById('powerup-hint');
      if (hint) hint.remove();
      return true;
    }
    return false;
  }

  // Same idea for board dimensions (added in Step 2 below).
  const BEST_KEY = 'bloom_best_score';
  const NAME_KEY = 'bloom_player_name';
  const DEVICE_KEY = 'bloom_device_id';
  const DAILY_PLAYED_PREFIX = 'bloom_daily_';
  const MUTE_KEY = 'bloom_muted';
  const MUSIC_MUTE_KEY = 'bloom_muted_music';
  const SFX_MUTE_KEY = 'bloom_muted_sfx';
  const STREAK_KEY = 'bloom_streak';
  const ACH_KEY = 'bloom_achievements';
  const GAMES_COUNT_KEY = 'bloom_games_played';
  // Onboarding progress: 0=fresh, 1=saw "tap a column", 2=saw "merge!", 3=saw "chain!" / done.
  const ONBOARD_KEY = 'bloom_onboard_step';
  function getOnboardStep() { return parseInt(localStorage.getItem(ONBOARD_KEY) || '0', 10) || 0; }
  function setOnboardStep(n) { try { localStorage.setItem(ONBOARD_KEY, String(n | 0)); } catch (e) {} }
  // Lifetime "personal bests" — only ever grow.
  const BEST_TIER_KEY  = 'bloom_best_tier_ever';
  const BEST_CHAIN_KEY = 'bloom_best_chain_ever';
  const BEST_STREAK_KEY = 'bloom_best_streak_ever';
  const TOTAL_SCORE_KEY = 'bloom_total_lifetime_score';

  // Same-origin API. When the game is served from the Express backend, this
  // works as-is. When opened from file:// the leaderboard simply won't load.
