// ============================================================
// Phase 3 / T3.1 — In-Game Booster System (May 2026)
//
// 2 boosters in v1 (PICK + POP). Both are mid-game spends in 💎
// that alter the current run without touching the merge engine
// itself. Each is max-1-per-game on the client (server allows
// repeats so a player who paid double on accident isn't refunded
// confusingly). Available only in `practice` and `dynamic` modes
// — explicitly NOT in daily/contest/duel/challenge for fairness.
//
//   🎯 PICK — choose the next piece's tier (1..4). 50💎.
//             Sets nextPiece directly + re-rolls visual.
//   💥 POP  — tap any non-empty cell to clear it + gravity. 40💎.
//             No engine surgery — just mutates grid + calls the
//             existing applyGravity() + render().
//
// Lives INSIDE the main IIFE (no wrapper) so it can read `grid`,
// `mode`, `nextPiece`, and call applyGravity/render directly. The
// server endpoint /api/player/use-booster is the source of truth
// for price + balance check (atomic deduction). Client-side flag
// `_boostersUsedThisGame` prevents accidental double-spending.
// ============================================================

// Per-game booster usage flags. Reset by init() via clearBoostersThisGame().
let _boostersUsedThisGame = {};

function clearBoostersThisGame() { _boostersUsedThisGame = {}; }

function boostersAreEnabled() {
  // Master toggle from server config.
  if (gameConfig && gameConfig.booster_enabled === 'false') return false;
  // Mode gate: practice + dynamic only.
  if (mode !== 'practice' && mode !== 'dynamic') return false;
  // Duels run on practice mode; skip them too.
  if (window._duelMode) return false;
  // Skin trial games are throwaway — no spending.
  if (skinTrialMode) return false;
  // Bot games — no real player to spend.
  if (window.__bloomBotActive) return false;
  return true;
}

function getBoosterPrice(id) {
  if (!gameConfig) return 0;
  return parseInt(gameConfig['booster_' + id + '_price'], 10) || 0;
}

function maybeMountBoosterStrip() {
  // Tear down any previous strip so a mode-switch doesn't leave a stale one.
  var existing = document.getElementById('booster-strip');
  if (existing) existing.remove();
  if (!boostersAreEnabled()) return;
  // TB.1 — game-over guard. After game-over the strip would float over
  // the over screen, which (a) is useless (boosters need an in-progress
  // game) and (b) overlays the share / play-again CTAs. Bail early.
  if (window.__bloomGameOver) return;
  // TB.1 — bottom floating bar instead of an in-flow strip above the
  // grid. The old position cost ~73px from the grid height (margin +
  // padding + emoji + label + price), shrinking each cell ~20% on
  // average phones. Floating it at the bottom returns that real estate
  // to the playable board and matches the "tool tray" pattern of
  // Match Masters / Royal Match. We mount on document.body (not on
  // grid-wrap's parent) so it's never affected by .app's flex flow.
  var strip = document.createElement('div');
  strip.id = 'booster-strip';
  strip.className = 'booster-strip booster-strip-bottom';
  strip.innerHTML = renderBoosterStripInner();
  document.body.appendChild(strip);
  wireBoosterStrip(strip);
}

function renderBoosterStripInner() {
  var pickUsed = !!_boostersUsedThisGame.pick;
  var popUsed = !!_boostersUsedThisGame.pop;
  var pickPrice = getBoosterPrice('pick');
  var popPrice = getBoosterPrice('pop');
  return (
    boosterBtnHtml('pick', '🎯', 'בחר', pickPrice, pickUsed) +
    boosterBtnHtml('pop',  '💥', 'הסר', popPrice,  popUsed)
  );
}

function boosterBtnHtml(id, emoji, label, price, used) {
  var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
  var affordable = bal >= price;
  var disabled = used || !affordable || price <= 0;
  var stateClass = used ? 'booster-used' : (affordable ? '' : 'booster-cant-afford');
  return (
    '<button class="booster-btn ' + stateClass + '" data-booster="' + id + '"' +
      (disabled ? ' disabled' : '') + '>' +
      '<span class="booster-btn-emoji">' + emoji + '</span>' +
      '<span class="booster-btn-label">' + label + '</span>' +
      '<span class="booster-btn-price">' + (used ? '✓' : (price + '💎')) + '</span>' +
    '</button>'
  );
}

function wireBoosterStrip(strip) {
  strip.querySelectorAll('.booster-btn').forEach(function(btn) {
    btn.onclick = function() {
      if (btn.disabled) return;
      var id = btn.getAttribute('data-booster');
      if (!id) return;
      activateBooster(id, btn);
    };
  });
}

function refreshBoosterStrip() {
  var strip = document.getElementById('booster-strip');
  if (!strip) return;
  strip.innerHTML = renderBoosterStripInner();
  wireBoosterStrip(strip);
}

// Spend → apply effect. The server is the source of truth for price.
// On a successful spend we ALWAYS mark the booster as used on this game
// (even if the apply effect later fails) so the player can't double-spend.
function activateBooster(id, btnEl) {
  if (_boostersUsedThisGame[id]) return;
  if (btnEl) { btnEl.disabled = true; }
  fetch('/api/player/use-booster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId, token: deviceToken, boosterId: id })
  }).then(function(r) { return r.json(); })
    .catch(function() { return null; })
    .then(function(d) {
      if (!d || !d.ok) {
        if (btnEl) btnEl.disabled = false;
        var reason = (d && d.reason) || 'error';
        if (reason === 'insufficient') {
          showToast('💎 חסר ' + ((d.cost || 0) - (d.balance || 0)) + '💎', 'warning');
        } else if (reason === 'rate_limited') {
          showToast('⏰ נסה שוב בעוד דקה', 'warning');
        } else {
          showToast('שגיאה: ' + reason, 'error');
        }
        return;
      }
      // Persist new balance + animate widget.
      playerBalance = d.newBalance;
      try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch (e) {}
      try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
      try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, -d.cost); } catch (e) {}
      _boostersUsedThisGame[id] = true;
      refreshBoosterStrip();
      // Apply the effect.
      try {
        if (id === 'pick') applyPickBooster();
        else if (id === 'pop') applyPopBooster();
      } catch (e) {
        console.error('[booster] apply', id, e);
        showToast('שגיאה בהפעלת ה-Booster', 'error');
      }
    });
}

// ── 🎯 PICK BOOSTER ────────────────────────────────────────
// Modal with 4 tier buttons (1..4). Choosing one sets nextPiece + re-rolls.
function applyPickBooster() {
  var existing = document.getElementById('booster-pick-modal');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'booster-pick-modal';
  modal.className = 'booster-modal-overlay';
  var tiersList = getActiveTiers();
  var optionsHtml = '';
  for (var t = 1; t <= 4; t++) {
    var tier = tiersList[t];
    if (!tier) continue;
    optionsHtml +=
      '<button class="booster-pick-option" data-tier="' + t + '" style="background:' + tier.bg + ';color:' + tier.fg + '">' +
        '<span class="bp-tier-icon">' + tier.svg + '</span>' +
        '<span class="bp-tier-label">tier ' + t + '</span>' +
      '</button>';
  }
  modal.innerHTML =
    '<div class="booster-modal-card">' +
      '<button class="booster-modal-close" aria-label="סגור">×</button>' +
      '<div class="booster-modal-title">🎯 בחר את החלק הבא</div>' +
      '<div class="booster-modal-sub">הטיל הבא יהיה ה-tier שבחרת</div>' +
      '<div class="booster-pick-grid">' + optionsHtml + '</div>' +
    '</div>';
  document.body.appendChild(modal);
  var close = function() { try { modal.remove(); } catch (e) {} };
  modal.querySelector('.booster-modal-close').onclick = function() {
    // Refund-by-courtesy is NOT done — server already deducted. The booster
    // marker stays "used" so they don't get to retry for free either.
    close();
  };
  modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
  modal.querySelectorAll('.booster-pick-option').forEach(function(opt) {
    opt.onclick = function() {
      var t = parseInt(opt.getAttribute('data-tier'), 10) | 0;
      if (t < 1 || t > 8) { close(); return; }
      nextPiece = t;
      try { if (typeof highlightNextTier === 'function') highlightNextTier(t); } catch (e) {}
      try { if (typeof render === 'function') render(); } catch (e) {}
      try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([30, 20, 40]); } catch (e) {}
      close();
    };
  });
}

// ── 💥 POP BOOSTER ─────────────────────────────────────────
// Enters tap-mode. The next tap on any non-empty grid cell wipes it
// then runs gravity + render. Banner shows the prompt + cancel button.
function applyPopBooster() {
  var gridEl = document.getElementById('grid');
  if (!gridEl) return;
  // Mount a top-of-viewport banner so the player knows what to do.
  var banner = document.createElement('div');
  banner.id = 'booster-pop-banner';
  banner.className = 'booster-pop-banner';
  banner.innerHTML =
    '<span>💥 הקש על אריח כדי להסיר אותו</span>' +
    '<button class="booster-pop-cancel">ביטול</button>';
  document.body.appendChild(banner);
  gridEl.classList.add('booster-pop-mode');
  // Single-shot handler. We attach to the grid via capture so it fires
  // before any other click handler in the cell tree.
  var onCellClick = function(e) {
    var cellEl = e.target.closest('.cell');
    if (!cellEl) return;
    e.stopPropagation();
    e.preventDefault();
    var r = parseInt(cellEl.getAttribute('data-r'), 10);
    var c = parseInt(cellEl.getAttribute('data-c'), 10);
    if (!Number.isFinite(r) || !Number.isFinite(c)) { cleanup(); return; }
    // Empty cells can't be popped; locked/frozen/shape-void also skipped.
    if (!grid[r] || !grid[r][c]) {
      showToast('בחר אריח עם תוכן', 'warning');
      return;
    }
    try { if (typeof isLockedAt === 'function' && isLockedAt(r, c)) { showToast('לא ניתן להסיר אריח נעול', 'warning'); return; } } catch (e) {}
    try { if (typeof isFrozenAt === 'function' && isFrozenAt(r, c)) { showToast('לא ניתן להסיר אריח קפוא', 'warning'); return; } } catch (e) {}
    // Remove + gravity + render. Sounds + buzz for satisfying feedback.
    grid[r][c] = 0;
    try { if (typeof applyGravity === 'function') applyGravity(); } catch (e) {}
    try { if (typeof render === 'function') render(); } catch (e) {}
    try { if (typeof soundMerge === 'function') soundMerge(1); } catch (e) {}
    try { if (typeof buzz === 'function') buzz([20, 20, 40]); } catch (e) {}
    cleanup();
  };
  var cleanup = function() {
    gridEl.removeEventListener('click', onCellClick, true);
    gridEl.classList.remove('booster-pop-mode');
    try { banner.remove(); } catch (e) {}
  };
  banner.querySelector('.booster-pop-cancel').onclick = cleanup;
  gridEl.addEventListener('click', onCellClick, true);
}

// Expose to outside callers: init() resets per-game state; the mount
// hook is called from init() too after the grid is in place.
try {
  window.__bloomBoosters = {
    mount: maybeMountBoosterStrip,
    reset: clearBoostersThisGame
  };
} catch (e) {}
