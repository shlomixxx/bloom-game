// ============================================================
// Stage 30 — Lifetime Progression (May 2026)
// Call of Duty Prestige pattern. NEVER resets across seasons.
// Levels 1-100 + Prestige stars (up to 10). The longest meta-arc
// in the game — encourages players to play for MONTHS to grind it.
// ============================================================
(function() {
  var _lifetimeCache = { data: null, fetchedAt: 0 };
  var _lifetimeInFlight = false;

  function fetchLifetimeState(force) {
    if (!force && _lifetimeCache.data && (Date.now() - _lifetimeCache.fetchedAt) < 60000) {
      return Promise.resolve(_lifetimeCache.data);
    }
    if (_lifetimeInFlight) return Promise.resolve(_lifetimeCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return Promise.resolve(null);
    _lifetimeInFlight = true;
    return fetch('/api/lifetime/state?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _lifetimeInFlight = false;
        if (d && d.ok) {
          _lifetimeCache.data = d;
          _lifetimeCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  // Render prestige stars ⭐ × N
  function prestigeStars(count) {
    if (!count || count <= 0) return '';
    var s = '';
    for (var i = 0; i < count; i++) s += '⭐';
    return s;
  }

  function tileInner(data) {
    var stars = prestigeStars(data.prestigeCount);
    var levelLabel = stars + ' ' + data.level;
    var canPrestigeBadge = data.canPrestige
      ? '<span class="lifetime-tile-prestige">⭐ פרסטיג\' זמין!</span>'
      : '';
    return (
      '<span class="lifetime-tile-icon">🏆</span>' +
      '<span class="lifetime-tile-body">' +
        '<span class="lifetime-tile-title">' + escapeHtml(data.title) + canPrestigeBadge + '</span>' +
        '<span class="lifetime-tile-bar"><span class="lifetime-tile-bar-fill" style="width:' + data.pct + '%"></span></span>' +
        '<span class="lifetime-tile-sub">דרגה ' + levelLabel + ' · ' + data.xpThisRun.toLocaleString() + ' XP חיים</span>' +
      '</span>' +
      '<span class="lifetime-tile-arrow">›</span>'
    );
  }

  function maybeShowLifetimeTile() {
    fetchLifetimeState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('lifetime-home-tile')) { updateLifetimeTile(d); return; }
      mountLifetimeTile(home, d);
    });
  }

  function mountLifetimeTile(homeEl, data) {
    var tile = document.createElement('button');
    tile.id = 'lifetime-home-tile';
    tile.className = 'lifetime-home-tile' + (data.canPrestige ? ' can-prestige' : '');
    tile.innerHTML = tileInner(data);
    homeEl.appendChild(tile);
    tile.onclick = function() { showLifetimeModal(); };
  }

  function updateLifetimeTile(data) {
    var tile = document.getElementById('lifetime-home-tile');
    if (!tile) return;
    tile.className = 'lifetime-home-tile' + (data.canPrestige ? ' can-prestige' : '');
    tile.innerHTML = tileInner(data);
  }

  function showLifetimeModal() {
    var ex = document.getElementById('lifetime-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'lifetime-modal';
    modal.className = 'lifetime-modal-overlay';
    modal.innerHTML =
      '<div class="lifetime-modal-card">' +
        '<button class="lifetime-modal-close" aria-label="סגור">×</button>' +
        '<div class="lifetime-modal-icon">🏆</div>' +
        '<div class="lifetime-modal-title">פרוגרס חיים</div>' +
        '<div class="lifetime-modal-sub">המסע הארוך — לעולם לא מתאפס</div>' +
        '<div class="lifetime-modal-body" id="lifetime-modal-body">' +
          '<div style="padding:30px;text-align:center;color:#999">⏳ טוען...</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.lifetime-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    fetchLifetimeState(true).then(function(d) { renderLifetimeBody(d); });
  }

  function renderLifetimeBody(data) {
    var host = document.getElementById('lifetime-modal-body');
    if (!host) return;
    if (!data || !data.ok || !data.enabled) {
      host.innerHTML = '<div style="padding:30px;text-align:center;color:#999">המערכת כבויה</div>';
      return;
    }
    var stars = prestigeStars(data.prestigeCount);
    var titleHtml = '<div class="lifetime-modal-title-row">' +
      '<div class="lifetime-modal-stars">' + (stars || '<span style="opacity:0.4">⭐</span>') + '</div>' +
      '<div class="lifetime-modal-level">' +
        '<div class="lifetime-modal-level-num">' + data.level + '</div>' +
        '<div class="lifetime-modal-level-lbl">דרגת חיים</div>' +
      '</div>' +
      '<div class="lifetime-modal-title-chip">' + escapeHtml(data.title) + '</div>' +
    '</div>';
    var barHtml =
      '<div class="lifetime-modal-bar-row">' +
        '<div class="lifetime-modal-bar"><div class="lifetime-modal-bar-fill" style="width:' + data.pct + '%"></div></div>' +
        '<div class="lifetime-modal-bar-text">' + data.xpIntoLevel.toLocaleString() + ' / ' + data.xpPerLevel.toLocaleString() + ' XP' +
          (data.level < data.maxLevel ? ' · עוד ' + data.xpToNext.toLocaleString() + ' לדרגה הבאה' : ' · ✓ MAX') +
        '</div>' +
      '</div>';
    // XP sources breakdown.
    var srcHtml =
      '<div class="lifetime-modal-section-title">📊 מה צובר XP חיים?</div>' +
      '<div class="lifetime-modal-sources">' +
        '<div class="lifetime-source">🎮 כל משחק שאתה משחק (×10)</div>' +
        '<div class="lifetime-source">🏅 כל הישג שאתה פותח (×75)</div>' +
        '<div class="lifetime-source">💎 על כל יהלום שצברת אי-פעם (÷2)</div>' +
        '<div class="lifetime-source">📔 כל תא באלבום (×25)</div>' +
        '<div class="lifetime-source">🎰 כל פול גאצ\'ה (×5)</div>' +
        '<div class="lifetime-source">🌱 דרגת הפרח שלך (×50)</div>' +
        '<div class="lifetime-source">🎖 דרגת Battle Pass (×100)</div>' +
        '<div class="lifetime-source">👥 כל חבר (×200)</div>' +
      '</div>';
    // Prestige section.
    var prestigeHtml;
    if (data.canPrestige) {
      prestigeHtml =
        '<div class="lifetime-modal-prestige-card lifetime-prestige-ready">' +
          '<div class="lifetime-prestige-icon">⭐</div>' +
          '<div class="lifetime-prestige-title">פרסטיג\' זמין!</div>' +
          '<div class="lifetime-prestige-sub">הגעת לדרגה 100. עכשיו אתה יכול לבצע פרסטיג\' — ⭐ ייוסף לפרופיל שלך לעולם, ותקבל ' + data.prestigeReward.toLocaleString() + '💎.</div>' +
          '<button class="lifetime-prestige-btn" id="lifetime-prestige-btn">⭐ בצע פרסטיג\' עכשיו</button>' +
        '</div>';
    } else if (data.prestigeCount >= data.maxPrestige) {
      prestigeHtml =
        '<div class="lifetime-modal-prestige-card">' +
          '<div class="lifetime-prestige-icon">🌟</div>' +
          '<div class="lifetime-prestige-title">אגדה!</div>' +
          '<div class="lifetime-prestige-sub">הגעת לפרסטיג\' המקסימלי (' + data.maxPrestige + ' כוכבים). אין שחקנים רבים שיגיעו לכאן.</div>' +
        '</div>';
    } else {
      prestigeHtml =
        '<div class="lifetime-modal-prestige-card">' +
          '<div class="lifetime-prestige-icon">⭐</div>' +
          '<div class="lifetime-prestige-title">פרסטיג\' כשתגיע לדרגה 100</div>' +
          '<div class="lifetime-prestige-sub">' +
            'יש לך ' + data.prestigeCount + ' / ' + data.maxPrestige + ' ⭐. כשתגיע לדרגה 100 תוכל לבצע פרסטיג\' — הדרגה תתחיל מחדש מ-1, תקבל ⭐ קבוע על הפרופיל + ' + data.prestigeReward.toLocaleString() + '💎.' +
          '</div>' +
        '</div>';
    }
    host.innerHTML = titleHtml + barHtml + srcHtml + prestigeHtml;
    var pBtn = document.getElementById('lifetime-prestige-btn');
    if (pBtn && data.canPrestige) {
      pBtn.onclick = function() { confirmAndPrestige(pBtn); };
    }
  }

  function confirmAndPrestige(btn) {
    var msg = '⭐ בצע פרסטיג\'?\n\n' +
              '• הדרגה שלך תתחיל מחדש מ-1\n' +
              '• ⭐ ייוסף לפרופיל לעולם\n' +
              '• תקבל ' + ((_lifetimeCache.data && _lifetimeCache.data.prestigeReward) || 5000).toLocaleString() + '💎\n\n' +
              'להמשיך?';
    if (!confirm(msg)) return;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ מעבד...'; }
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    fetch('/api/lifetime/prestige', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token })
    }).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
          }
          try { if (typeof soundMilestone === 'function') soundMilestone(7); } catch (e) {}
          try { if (typeof buzz === 'function') buzz([100, 80, 120, 80, 160, 80, 200]); } catch (e) {}
          _lifetimeCache.data = null;
          showPrestigeCelebration(d.newPrestige);
          fetchLifetimeState(true).then(function(fresh) {
            if (fresh) {
              renderLifetimeBody(fresh);
              updateLifetimeTile(fresh);
            }
          });
        } else {
          if (btn) { btn.disabled = false; btn.innerHTML = '⭐ בצע פרסטיג\' עכשיו'; }
          showToast(d && d.reason ? d.reason : 'שגיאה', 'error');
        }
      });
  }

  function showPrestigeCelebration(newPrestige) {
    var ov = document.createElement('div');
    ov.className = 'lifetime-prestige-celebration';
    ov.innerHTML =
      '<div class="lifetime-celeb-card">' +
        '<div class="lifetime-celeb-stars">' + prestigeStars(newPrestige) + '</div>' +
        '<div class="lifetime-celeb-title">פרסטיג\' ' + newPrestige + ' פתוח!</div>' +
        '<div class="lifetime-celeb-sub">המסע מתחיל מחדש — עם ⭐ קבוע על הפרופיל שלך</div>' +
        '<button class="lifetime-celeb-btn">המשך</button>' +
      '</div>';
    document.body.appendChild(ov);
    var dismiss = function() { try { ov.remove(); } catch (e) {} };
    ov.querySelector('.lifetime-celeb-btn').onclick = dismiss;
    ov.addEventListener('click', function(e) { if (e.target === ov) dismiss(); });
    setTimeout(dismiss, 12000);
  }

  window.maybeShowLifetimeTile = maybeShowLifetimeTile;
  window.showLifetimeModal = showLifetimeModal;
  window.fetchLifetimeState = fetchLifetimeState;
})();
