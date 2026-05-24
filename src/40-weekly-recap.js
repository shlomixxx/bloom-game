// ============================================================
// A4 — BLOOM Wrapped (weekly recap, May 2026)
//
// Every Sunday afternoon (Asia/Jerusalem), the first time the player
// opens the home screen, a full-screen modal slides in showing their
// past-week stats Spotify Wrapped-style:
//
//   "🌟 השבוע שלך ב-BLOOM"
//   - 47 משחקים
//   - שיא 245,000
//   - 3 חברים שיחקו איתך
//   - +280 trophies
//   - דרגה: A
//
// Big share button → 720×1280 PNG ready for WhatsApp/Native/Copy/Save.
// Per-Sunday dedup via localStorage so we only fire once per week.
//
// This is the K-factor viral lever for retention: shared images get
// new players in via the BLOOM brand + URL footer.
// Standalone IIFE — pure window.* consumer.
// ============================================================
(function() {
  'use strict';
  var SEEN_PREFIX = 'bloom_wrapped_seen_';
  var MIN_GAMES_FOR_RECAP = 5; // don't fire if player barely played

  function getDeviceId() {
    try { return localStorage.getItem('bloom_device_id') || ''; } catch (e) { return ''; }
  }

  // Returns the current Sunday's date string in Asia/Jerusalem (YYYY-MM-DD).
  // The trigger fires on Sun afternoon (12:00+); this key identifies the
  // week regardless of when on Sunday the player opens the app.
  function thisWeekSundayKey() {
    try {
      var ilNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
      var day = ilNow.getDay(); // 0 = Sunday in JS
      // If today IS Sunday, use today. Else find the most-recent Sunday.
      if (day !== 0) return null; // not Sunday → no auto-fire
      // Only fire on Sunday afternoon (12:00 IL onwards) — gives the
      // weekend a chance to play before the wrap fires.
      if (ilNow.getHours() < 12) return null;
      var y = ilNow.getFullYear();
      var m = String(ilNow.getMonth() + 1).padStart(2, '0');
      var d = String(ilNow.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    } catch (e) { return null; }
  }

  function seenThisSunday(sundayKey) {
    if (!sundayKey) return true;
    try { return localStorage.getItem(SEEN_PREFIX + sundayKey) === '1'; }
    catch (e) { return false; }
  }
  function markSeenThisSunday(sundayKey) {
    try { localStorage.setItem(SEEN_PREFIX + sundayKey, '1'); } catch (e) {}
  }

  function fetchRecap() {
    var deviceId = getDeviceId();
    if (!deviceId) return Promise.resolve(null);
    return fetch('/api/weekly-recap?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  // Auto-fire on home mount. Only on Sunday-afternoon + per-week dedup +
  // min-games gate. The "open manually" path (via inbox or a future home
  // button) bypasses the auto-gate.
  function maybeAutoShow() {
    var key = thisWeekSundayKey();
    if (!key) return;
    if (seenThisSunday(key)) return;
    fetchRecap().then(function(d) {
      if (!d || !d.ok || !d.stats) return;
      if ((d.stats.games | 0) < MIN_GAMES_FOR_RECAP) {
        // Player barely played this week — skip the recap (would feel sad).
        // Mark as seen so we don't re-fetch on every navigation.
        markSeenThisSunday(key);
        return;
      }
      markSeenThisSunday(key);
      showRecapModal(d, { auto: true });
    });
  }

  function showRecapModal(d, opts) {
    opts = opts || {};
    var existing = document.getElementById('weekly-recap-modal');
    if (existing) existing.remove();
    var stats = d.stats;
    var player = d.player;
    var modal = document.createElement('div');
    modal.id = 'weekly-recap-modal';
    modal.className = 'wr-overlay';
    modal.innerHTML =
      '<div class="wr-card">' +
        '<button class="wr-close" aria-label="סגור">×</button>' +
        '<div class="wr-intro">השבוע שלך ב-BLOOM</div>' +
        '<div class="wr-brand">🌟 Wrapped</div>' +
        '<div class="wr-grade-row">' +
          '<div class="wr-grade-label">דרגת פעילות</div>' +
          '<div class="wr-grade wr-grade-' + escapeAttr(stats.grade) + '">' + escapeHtml(stats.grade) + '</div>' +
        '</div>' +
        '<div class="wr-stats-grid">' +
          renderStat('🎮', stats.games.toLocaleString(), 'משחקים השבוע') +
          renderStat('🏆', stats.bestScore.toLocaleString(), 'שיא ניקוד') +
          renderStat('💎', tierLabel(stats.topTier), 'דרגת אריח מירבית') +
          renderStat('⚡', (stats.trophiesGained > 0 ? '+' : '') + stats.trophiesGained.toLocaleString(), 'trophies') +
          renderStat('👥', stats.friendsPlayed.toLocaleString(), 'חברים שיחקו איתך') +
          renderStat('🏅', '#' + player.level, 'דרגה כללית') +
        '</div>' +
        '<div class="wr-share-buttons">' +
          '<button class="wr-share-btn wr-share-img" id="wr-build-image">📸 צור תמונה לשיתוף</button>' +
        '</div>' +
        '<div class="wr-footer">BLOOM · bloom-game.co.il</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.wr-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    document.getElementById('wr-build-image').onclick = function() {
      buildAndShareImage(d);
    };
    // Celebration sound + buzz on auto-fire.
    if (opts.auto) {
      try { if (typeof soundMilestone === 'function') soundMilestone(6); } catch (e) {}
      try { if (typeof buzz === 'function') buzz([60, 40, 80, 40, 100]); } catch (e) {}
    }
  }

  function renderStat(emoji, value, label) {
    return (
      '<div class="wr-stat-card">' +
        '<div class="wr-stat-emoji">' + emoji + '</div>' +
        '<div class="wr-stat-value">' + escapeHtml(String(value)) + '</div>' +
        '<div class="wr-stat-label">' + escapeHtml(label) + '</div>' +
      '</div>'
    );
  }

  function tierLabel(tier) {
    var labels = ['—', '🪨', '🍃', '🌸', '🔥', '⚡', '⭐', '💎', '👑'];
    return labels[tier | 0] || '—';
  }

  // Canvas-rendered share image — 720x1280 (9:16 mobile vertical).
  // Pink-purple-gold gradient backdrop, big stats, BLOOM brand + URL.
  function buildAndShareImage(d) {
    var stats = d.stats;
    var player = d.player;
    var canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    var ctx = canvas.getContext('2d');
    // Background gradient
    var grad = ctx.createLinearGradient(0, 0, 720, 1280);
    grad.addColorStop(0, '#3D1A78');
    grad.addColorStop(0.5, '#7A5FE0');
    grad.addColorStop(1, '#FF6B9D');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 720, 1280);
    // Scattered emoji decoration (random positions, low opacity)
    ctx.globalAlpha = 0.12;
    ctx.font = '60px serif';
    var deco = ['🌸', '🔥', '⭐', '💎', '👑', '🎮', '⚡'];
    for (var i = 0; i < 14; i++) {
      ctx.fillText(deco[i % deco.length], Math.random() * 660, 60 + Math.random() * 1180);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';

    // Header — "השבוע שלי ב-BLOOM"
    ctx.fillStyle = 'rgba(255, 217, 61, 0.85)';
    ctx.font = '700 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('השבוע שלי ב-BLOOM', 360, 110);
    ctx.fillStyle = '#FFD93D';
    ctx.font = '900 80px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('🌟 Wrapped', 360, 200);

    // Player name + code
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = '600 32px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(player.displayName || 'אנונימי', 360, 280);
    if (player.playerCode) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '600 22px ui-monospace, monospace';
      ctx.fillText('BLOOM-' + player.playerCode, 360, 320);
    }

    // Grade big
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(220, 380, 280, 200);
    ctx.fillStyle = '#FFD93D';
    ctx.font = '900 140px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(stats.grade, 360, 480);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '600 22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('דרגת פעילות השבוע', 360, 555);

    // 6 stats in a 2-column layout
    var statLines = [
      { e: '🎮', v: stats.games.toLocaleString(), l: 'משחקים' },
      { e: '🏆', v: stats.bestScore.toLocaleString(), l: 'שיא ניקוד' },
      { e: '💎', v: tierLabel(stats.topTier), l: 'דרגה מרבית' },
      { e: '⚡', v: (stats.trophiesGained > 0 ? '+' : '') + stats.trophiesGained.toLocaleString(), l: 'trophies' },
      { e: '👥', v: stats.friendsPlayed.toLocaleString(), l: 'חברים שיחקו' },
      { e: '🏅', v: '#' + player.level, l: 'דרגה כללית' }
    ];
    var startY = 660;
    for (var s = 0; s < statLines.length; s++) {
      var x = s % 2 === 0 ? 520 : 200;
      var y = startY + Math.floor(s / 2) * 130;
      // Stat card background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(x - 130, y - 50, 260, 110);
      ctx.fillStyle = '#FFD93D';
      ctx.font = '60px -apple-system';
      ctx.fillText(statLines[s].e, x, y - 10);
      ctx.fillStyle = '#FFF';
      ctx.font = '900 30px -apple-system';
      ctx.fillText(statLines[s].v, x, y + 28);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 16px -apple-system';
      ctx.fillText(statLines[s].l, x, y + 50);
    }

    // Footer brand + URL
    ctx.fillStyle = '#FFD93D';
    ctx.font = '900 38px -apple-system, sans-serif';
    ctx.fillText('🌸 BLOOM', 360, 1180);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '600 20px ui-monospace, monospace';
    ctx.fillText('שחק בעצמך — bloom-game.co.il', 360, 1220);

    // Convert canvas to blob + show share modal.
    canvas.toBlob(function(blob) {
      if (!blob) return;
      showShareImageModal(blob, stats);
    }, 'image/png', 0.95);
  }

  function showShareImageModal(blob, stats) {
    var url = URL.createObjectURL(blob);
    var existing = document.getElementById('wr-share-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'wr-share-modal';
    modal.className = 'wr-share-overlay';
    var shareText = '🌟 השבוע ב-BLOOM שיחקתי ' + stats.games + ' משחקים, שיא ' + stats.bestScore.toLocaleString() + '! ' +
                    'נסה לעבור אותי: ' + (location.origin || 'https://bloom-game.co.il');
    modal.innerHTML =
      '<div class="wr-share-card">' +
        '<button class="wr-share-close" aria-label="סגור">×</button>' +
        '<div class="wr-share-title">📸 תמונה מוכנה לשיתוף</div>' +
        '<img class="wr-share-preview" src="' + url + '" alt="BLOOM Wrapped" />' +
        '<div class="wr-share-actions">' +
          '<button class="wr-share-action wr-share-wa" id="wr-share-wa">💬 WhatsApp</button>' +
          '<button class="wr-share-action wr-share-native" id="wr-share-native">📤 שתף</button>' +
          '<button class="wr-share-action wr-share-copy" id="wr-share-copy">📋 העתק</button>' +
          '<button class="wr-share-action wr-share-save" id="wr-share-save">💾 שמור</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() {
      try { URL.revokeObjectURL(url); } catch (e) {}
      try { modal.remove(); } catch (e) {}
    };
    modal.querySelector('.wr-share-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    // WhatsApp web — opens with pre-filled text; user attaches manually
    // (no API for direct image attachment cross-platform).
    document.getElementById('wr-share-wa').onclick = function() {
      window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
    };
    document.getElementById('wr-share-native').onclick = function() {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'bloom-wrapped.png', { type: 'image/png' })] })) {
        var file = new File([blob], 'bloom-wrapped.png', { type: 'image/png' });
        navigator.share({ files: [file], text: shareText, title: 'BLOOM Wrapped' }).catch(function() {});
      } else if (navigator.share) {
        navigator.share({ text: shareText, title: 'BLOOM Wrapped' }).catch(function() {});
      } else {
        // Fallback: copy text.
        navigator.clipboard.writeText(shareText).catch(function() {});
        if (typeof showToast === 'function') showToast('הטקסט הועתק — הדבק ב-WhatsApp עם התמונה', 'info');
      }
    };
    document.getElementById('wr-share-copy').onclick = function() {
      navigator.clipboard.writeText(shareText).then(function() {
        if (typeof showToast === 'function') showToast('הטקסט הועתק ✓', 'success');
      }).catch(function() {});
    };
    document.getElementById('wr-share-save').onclick = function() {
      var a = document.createElement('a');
      a.href = url;
      a.download = 'bloom-wrapped-' + new Date().toISOString().slice(0, 10) + '.png';
      a.click();
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[^a-zA-Z0-9_+\-]/g, '');
  }

  try {
    window.__bloomWrapped = {
      maybeAutoShow: maybeAutoShow,
      // Manual open path — bypass Sunday gate, useful for "preview" button
      // or a future weekly-recap inbox notification.
      openNow: function() {
        fetchRecap().then(function(d) {
          if (d && d.ok && d.stats) showRecapModal(d, { auto: false });
        });
      }
    };
  } catch (e) {}
})();
