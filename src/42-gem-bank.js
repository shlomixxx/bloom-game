// ============================================================
// A10 — Compound Interest Gem Bank (May 2026)
//
// Player deposits 💎 → bank pays 1%/day compound interest.
// Withdrawal costs 5% fee. Pure behavioral economics:
// - Loss aversion (fee makes you not want to withdraw)
// - Compound dopamine (numbers grow daily)
// - Saver's pride (passive growth = social proof to self)
//
// Server cron at 03:00 IL credits interest. Player sees:
// "ריבית הבאה: בעוד 14ש" countdown that re-paints every minute.
//
// Standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';
  var _cache = { fetchedAt: 0, data: null };
  var CACHE_MS = 30 * 1000;
  var _countdownTicker = null;

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }
  function getToken() {
    try { return localStorage.getItem('bloom_device_token') || null; } catch (e) { return null; }
  }

  function fetchState(force) {
    if (!force && _cache.fetchedAt && Date.now() - _cache.fetchedAt < CACHE_MS) {
      return Promise.resolve(_cache.data);
    }
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/bank/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) { _cache.fetchedAt = Date.now(); _cache.data = d; }
        return d;
      });
  }

  function maybeShowTile() {
    // Level gate L8+ — same as daily-deal. Player needs some 💎 history
    // to find this useful; new players get other tiles first.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 8) return; } catch (e) {}
    var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
    if (!home) return;
    fetchState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var tile = document.getElementById('gem-bank-tile');
      if (!tile) {
        tile = document.createElement('button');
        tile.id = 'gem-bank-tile';
        tile.className = 'gem-bank-tile';
        tile.onclick = function() { showBankModal(); };
        home.appendChild(tile);
      }
      tile.innerHTML = renderTileInner(d);
      // Pulse if there's a meaningful deposit.
      tile.classList.toggle('has-deposit', (d.deposited | 0) >= 100);
    });
  }

  function renderTileInner(d) {
    var headline;
    if (d.deposited <= 0) {
      headline = '💰 הפקד וקבל ' + d.interestPctDaily + '% ריבית יומית';
    } else {
      var nextInterestText = formatMsLeft(d.msUntilNextInterest);
      headline = '🏦 בבנק: <strong>' + d.deposited.toLocaleString() + '💎</strong> · ⏰ ' + nextInterestText;
    }
    return (
      '<div class="gem-bank-tile-main">' +
        '<div class="gem-bank-tile-title">💰 הבנק</div>' +
        '<div class="gem-bank-tile-sub">' + headline + '</div>' +
        (d.totalInterestPaid > 0
          ? '<div class="gem-bank-tile-interest">📈 הרווחת ' + d.totalInterestPaid.toLocaleString() + '💎 בריבית</div>'
          : '') +
      '</div>' +
      '<div class="gem-bank-tile-arrow">›</div>'
    );
  }

  function showBankModal() {
    var existing = document.getElementById('gem-bank-modal');
    if (existing) { existing.remove(); return; }
    var modal = document.createElement('div');
    modal.id = 'gem-bank-modal';
    modal.className = 'gem-bank-overlay';
    modal.innerHTML =
      '<div class="gem-bank-card">' +
        '<button class="gem-bank-close" aria-label="סגור">×</button>' +
        '<div class="gem-bank-title">🏦 הבנק של BLOOM</div>' +
        '<div class="gem-bank-sub">הפקד 💎 → קבל ריבית יומית. משיכה עולה עמלה.</div>' +
        '<div class="gem-bank-body" id="gem-bank-body">' +
          '<div class="gem-bank-loading">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() {
      if (_countdownTicker) { clearInterval(_countdownTicker); _countdownTicker = null; }
      try { modal.remove(); } catch (e) {}
    };
    modal.querySelector('.gem-bank-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchState(true).then(renderModalBody);
  }

  function renderModalBody(d) {
    var host = document.getElementById('gem-bank-body');
    if (!host) return;
    if (!d || !d.ok || !d.enabled) {
      host.innerHTML = '<div class="gem-bank-empty">הבנק כבוי כרגע</div>';
      return;
    }
    var wallet = (typeof playerBalance !== 'undefined') ? (playerBalance | 0) : 0;
    var bankBal = d.deposited | 0;
    // Compute "next-day projection": if I deposit X today, I have X*(1+pct/100) tomorrow.
    host.innerHTML =
      '<div class="gem-bank-balances">' +
        '<div class="gem-bank-bal-row">' +
          '<span class="gem-bank-bal-label">💎 בארנק</span>' +
          '<span class="gem-bank-bal-val">' + wallet.toLocaleString() + '</span>' +
        '</div>' +
        '<div class="gem-bank-bal-row gem-bank-bal-bank">' +
          '<span class="gem-bank-bal-label">🏦 בבנק</span>' +
          '<span class="gem-bank-bal-val">' + bankBal.toLocaleString() + '</span>' +
        '</div>' +
        (d.totalInterestPaid > 0
          ? '<div class="gem-bank-bal-row gem-bank-bal-interest">' +
              '<span class="gem-bank-bal-label">📈 הרווח עד כה</span>' +
              '<span class="gem-bank-bal-val">+' + d.totalInterestPaid.toLocaleString() + '</span>' +
            '</div>'
          : '') +
      '</div>' +
      '<div class="gem-bank-rate-card">' +
        '<div class="gem-bank-rate-row">' +
          '<span>📊 ריבית יומית:</span>' +
          '<strong>' + d.interestPctDaily + '%</strong>' +
        '</div>' +
        '<div class="gem-bank-rate-row">' +
          '<span>⏰ ריבית הבאה:</span>' +
          '<strong id="gem-bank-countdown">' + formatMsLeft(d.msUntilNextInterest) + '</strong>' +
        '</div>' +
        (bankBal > 0
          ? '<div class="gem-bank-rate-row gem-bank-projection">' +
              '<span>💡 מחר תהיה לך:</span>' +
              '<strong>' + Math.floor(bankBal * (1 + d.interestPctDaily / 100)).toLocaleString() + '💎</strong>' +
            '</div>'
          : '') +
      '</div>' +
      // Deposit section
      '<div class="gem-bank-action-card">' +
        '<div class="gem-bank-action-title">⬇ הפקדה</div>' +
        '<div class="gem-bank-amount-row">' +
          '<input type="number" id="gem-bank-deposit-amount" min="' + d.minDeposit + '" step="100" placeholder="' + d.minDeposit + '" />' +
          '<button class="gem-bank-amount-btn" data-fill="deposit-25">25%</button>' +
          '<button class="gem-bank-amount-btn" data-fill="deposit-50">50%</button>' +
          '<button class="gem-bank-amount-btn" data-fill="deposit-max">הכל</button>' +
        '</div>' +
        '<button class="gem-bank-do-btn gem-bank-deposit-btn" id="gem-bank-deposit-btn">⬇ הפקד</button>' +
        '<div class="gem-bank-hint">מינימום: ' + d.minDeposit + '💎 · מקסימום בבנק: ' + d.maxBalance.toLocaleString() + '💎</div>' +
      '</div>' +
      // Withdraw section
      (bankBal > 0
        ? '<div class="gem-bank-action-card gem-bank-action-withdraw">' +
            '<div class="gem-bank-action-title">⬆ משיכה</div>' +
            '<div class="gem-bank-amount-row">' +
              '<input type="number" id="gem-bank-withdraw-amount" min="1" step="100" placeholder="כמה למשוך" />' +
              '<button class="gem-bank-amount-btn" data-fill="withdraw-25">25%</button>' +
              '<button class="gem-bank-amount-btn" data-fill="withdraw-50">50%</button>' +
              '<button class="gem-bank-amount-btn" data-fill="withdraw-max">הכל</button>' +
            '</div>' +
            '<button class="gem-bank-do-btn gem-bank-withdraw-btn" id="gem-bank-withdraw-btn">⬆ משוך</button>' +
            '<div class="gem-bank-hint gem-bank-hint-warn">⚠ עמלת משיכה: ' + d.withdrawalFeePct + '%</div>' +
          '</div>'
        : '') +
      '<div class="gem-bank-tip">💡 ה-' + d.interestPctDaily + '% ריבית מצטברת — אחרי 30 יום על 1,000💎 יהיו לך ' + Math.floor(1000 * Math.pow(1 + d.interestPctDaily/100, 30)).toLocaleString() + '💎.</div>';

    wireActionButtons(d);
    startCountdownTicker(new Date(Date.now() + d.msUntilNextInterest));
  }

  function wireActionButtons(d) {
    var wallet = (typeof playerBalance !== 'undefined') ? (playerBalance | 0) : 0;
    var bankBal = d.deposited | 0;

    document.querySelectorAll('.gem-bank-amount-btn').forEach(function(btn) {
      btn.onclick = function() {
        var fill = btn.getAttribute('data-fill');
        var target;
        var pct = 0;
        if (fill === 'deposit-25') { target = 'gem-bank-deposit-amount'; pct = 0.25; }
        else if (fill === 'deposit-50') { target = 'gem-bank-deposit-amount'; pct = 0.5; }
        else if (fill === 'deposit-max') { target = 'gem-bank-deposit-amount'; pct = 1.0; }
        else if (fill === 'withdraw-25') { target = 'gem-bank-withdraw-amount'; pct = 0.25; }
        else if (fill === 'withdraw-50') { target = 'gem-bank-withdraw-amount'; pct = 0.5; }
        else if (fill === 'withdraw-max') { target = 'gem-bank-withdraw-amount'; pct = 1.0; }
        if (!target) return;
        var source = target.indexOf('deposit') > -1 ? wallet : bankBal;
        var val = Math.floor(source * pct);
        var input = document.getElementById(target);
        if (input) input.value = val;
      };
    });

    var depBtn = document.getElementById('gem-bank-deposit-btn');
    if (depBtn) depBtn.onclick = function() {
      var amt = parseInt(document.getElementById('gem-bank-deposit-amount').value, 10) || 0;
      if (amt < d.minDeposit) {
        if (typeof showToast === 'function') showToast('מינימום הפקדה: ' + d.minDeposit + '💎', 'warning');
        return;
      }
      doDeposit(amt, depBtn);
    };
    var withBtn = document.getElementById('gem-bank-withdraw-btn');
    if (withBtn) withBtn.onclick = function() {
      var amt = parseInt(document.getElementById('gem-bank-withdraw-amount').value, 10) || 0;
      if (amt < 1) return;
      var fee = Math.ceil(amt * d.withdrawalFeePct / 100);
      var net = amt - fee;
      if (!confirm('למשוך ' + amt.toLocaleString() + '💎? עמלה: ' + fee + '💎. תקבל ' + net.toLocaleString() + '💎.')) return;
      doWithdraw(amt, withBtn);
    };
  }

  function doDeposit(amount, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    fetch('/api/bank/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken(), amount: amount })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) {
        if (btn) { btn.disabled = false; btn.textContent = '⬇ הפקד'; }
        var reason = (d && d.reason) || 'error';
        var msgs = {
          insufficient_balance: '💎 אין מספיק יהלומים בארנק',
          below_min: 'מינימום הפקדה: ' + (d.minDeposit || 100) + '💎',
          exceeds_max: 'חורג מהמקסימום בבנק (' + ((d.max || 0).toLocaleString()) + '💎)',
          bad_amount: 'סכום לא תקין',
          rate_limited: 'יותר מדי הפקדות — חכה דקה',
          disabled: 'הבנק כבוי'
        };
        if (typeof showToast === 'function') showToast(msgs[reason] || ('שגיאה: ' + reason), 'error');
        return;
      }
      // Update local balance.
      if (typeof d.newBalance === 'number') {
        try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
        try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
        try { if (window.__bloomBumpBal) window.__bloomBumpBal(d.newBalance, -amount); } catch (e) {}
      }
      if (typeof showToast === 'function') showToast('💰 הפקדת ' + amount.toLocaleString() + '💎 לבנק!', 'success');
      try { if (typeof soundMilestone === 'function') soundMilestone(3); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([30, 20, 40]); } catch (e) {}
      // Refresh both modal + tile.
      _cache.fetchedAt = 0;
      fetchState(true).then(function(fresh) { renderModalBody(fresh); maybeShowTile(); });
    });
  }

  function doWithdraw(amount, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
    fetch('/api/bank/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: getDeviceId(), token: getToken(), amount: amount })
    }).then(function(r) { return r.json(); }).catch(function() { return null; }).then(function(d) {
      if (!d || !d.ok) {
        if (btn) { btn.disabled = false; btn.textContent = '⬆ משוך'; }
        var reason = (d && d.reason) || 'error';
        var msgs = {
          insufficient_bank_balance: 'אין מספיק יהלומים בבנק',
          bad_amount: 'סכום לא תקין',
          rate_limited: 'יותר מדי משיכות — חכה דקה',
          disabled: 'הבנק כבוי'
        };
        if (typeof showToast === 'function') showToast(msgs[reason] || ('שגיאה: ' + reason), 'error');
        return;
      }
      if (typeof d.newBalance === 'number') {
        try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
        try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
        try { if (window.__bloomBumpBal) window.__bloomBumpBal(d.newBalance, d.netPayout); } catch (e) {}
      }
      if (typeof showToast === 'function') showToast('⬆ משכת ' + d.netPayout.toLocaleString() + '💎 (עמלה: ' + d.fee + '💎)', 'info');
      try { if (typeof soundMilestone === 'function') soundMilestone(2); } catch (e) {}
      _cache.fetchedAt = 0;
      fetchState(true).then(function(fresh) { renderModalBody(fresh); maybeShowTile(); });
    });
  }

  function startCountdownTicker(targetDate) {
    if (_countdownTicker) clearInterval(_countdownTicker);
    _countdownTicker = setInterval(function() {
      var el = document.getElementById('gem-bank-countdown');
      if (!el) {
        clearInterval(_countdownTicker);
        _countdownTicker = null;
        return;
      }
      var ms = targetDate.getTime() - Date.now();
      if (ms <= 0) {
        el.textContent = 'בקרוב מאוד!';
        clearInterval(_countdownTicker);
        _countdownTicker = null;
        // Auto-refresh once the countdown lapses.
        setTimeout(function() { _cache.fetchedAt = 0; fetchState(true).then(renderModalBody); }, 5000);
        return;
      }
      el.textContent = formatMsLeft(ms);
    }, 30 * 1000); // 30s ticks — minute resolution is enough
  }

  function formatMsLeft(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'בקרוב';
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0) return h + 'ש ' + m + 'ד';
    return m + ' דקות';
  }

  try {
    window.__bloomBank = {
      maybeShow: maybeShowTile,
      open: showBankModal,
      refresh: function() { _cache.fetchedAt = 0; return fetchState(true); }
    };
  } catch (e) {}
})();
