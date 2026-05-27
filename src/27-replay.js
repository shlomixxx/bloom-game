// ============================================================
// Stage 32 — Replay Sharing (May 2026)
// After high-score games, generates a beautiful PNG share card
// (rendered via canvas) and offers 4 share paths: 💬 WhatsApp /
// 📤 Native / 📋 Copy link / 💾 Save image. Tracks shares for
// viral telemetry. The strongest K-factor in mobile games.
// ============================================================
(function() {
  var _replayConfig = null;
  var _replayConfigFetched = 0;

  function fetchReplayConfig(force) {
    if (!force && _replayConfig && (Date.now() - _replayConfigFetched) < 5 * 60 * 1000) {
      return Promise.resolve(_replayConfig);
    }
    return fetch('/api/replay/config').then(function(r){return r.json();}).catch(function(){return null;})
      .then(function(d) {
        if (d && d.ok) {
          _replayConfig = d;
          _replayConfigFetched = Date.now();
        }
        return d;
      });
  }

  // Public: called from game-over branch after best-score is saved.
  // Returns true if a share prompt should be shown for this game.
  function shouldOfferReplayShare(score) {
    if (!_replayConfig) return false; // not loaded yet
    if (!_replayConfig.enabled) return false;
    return (score | 0) >= (_replayConfig.minScore | 0);
  }

  // Tier identity (mirror the in-game palette so the card looks right).
  var TIER_EMOJIS = ['', '🪨', '🍃', '🌸', '🔥', '⚡', '⭐', '💎', '👑'];

  function renderShareCard(opts) {
    // opts: { score, tier, playerName, isNewBest, mode, brandText, gameUrl }
    var W = 720, H = 1280; // 9:16 aspect — perfect for stories/WhatsApp
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    // Background gradient (pink → purple — eye-catching)
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#FCE7F3');
    bg.addColorStop(0.5, '#F3E8FF');
    bg.addColorStop(1, '#E0E7FF');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Decorative bloom petals (scattered)
    var petals = ['🌸', '🌺', '🌷', '💮'];
    ctx.save();
    ctx.globalAlpha = 0.25;
    for (var i = 0; i < 14; i++) {
      var p = petals[i % petals.length];
      var px = (i * 137) % W;
      var py = ((i * 211) % H);
      var size = 40 + (i % 4) * 12;
      ctx.font = size + 'px serif';
      ctx.fillText(p, px, py);
    }
    ctx.restore();
    // Top: BLOOM brand
    ctx.fillStyle = '#831843';
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🌸 BLOOM', W / 2, 110);
    // Player name (if known)
    if (opts.playerName) {
      ctx.fillStyle = '#6B7280';
      ctx.font = '32px sans-serif';
      ctx.direction = 'rtl';
      ctx.fillText(opts.playerName, W / 2, 175);
    }
    // "Achievement" badge (if new best)
    if (opts.isNewBest) {
      // Yellow ribbon
      ctx.fillStyle = '#FBBF24';
      var ribbonY = 230;
      ctx.fillRect(W / 2 - 200, ribbonY, 400, 60);
      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 36px sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillText('🏆 שיא חדש!', W / 2, ribbonY + 42);
    }
    // Big SCORE in the center
    var scoreText = (opts.score | 0).toLocaleString();
    ctx.fillStyle = '#831843';
    ctx.font = 'bold 200px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(scoreText, W / 2, H / 2 + 30);
    ctx.fillStyle = '#9D174D';
    ctx.font = '38px sans-serif';
    ctx.direction = 'rtl';
    ctx.fillText('נקודות', W / 2, H / 2 + 90);
    // Highest tier
    if (opts.tier && opts.tier > 0) {
      var tierEmoji = TIER_EMOJIS[opts.tier] || '🌸';
      ctx.font = '180px serif';
      ctx.textAlign = 'center';
      ctx.fillText(tierEmoji, W / 2, H / 2 + 320);
      ctx.fillStyle = '#7C3AED';
      ctx.font = 'bold 36px sans-serif';
      ctx.direction = 'rtl';
      ctx.fillText('הגעתי לדרגה ' + opts.tier, W / 2, H / 2 + 380);
    }
    // Challenge text
    ctx.fillStyle = '#7C2D92';
    ctx.font = 'bold 38px sans-serif';
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.fillText('🎯 אפשר לעקוף?', W / 2, H - 240);
    // Bottom: brand + URL
    ctx.fillStyle = '#6B7280';
    ctx.font = '32px sans-serif';
    ctx.direction = 'rtl';
    ctx.fillText(opts.brandText || 'BLOOM · משחק מיזוג ממכר', W / 2, H - 130);
    ctx.fillStyle = '#831843';
    ctx.font = 'bold 30px sans-serif';
    ctx.direction = 'ltr';
    ctx.fillText(opts.gameUrl || 'bloom-game.co.il', W / 2, H - 75);
    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise(function(resolve) {
      try { canvas.toBlob(function(b) { resolve(b); }, 'image/png', 0.95); }
      catch (e) { resolve(null); }
    });
  }

  function buildShareText(template, score, tier, url) {
    // Append the user's personal BLOOM code to the URL so this share
    // counts toward THEIR referral total. The admin-configured base URL
    // (`replay_share_game_url`) stays neutral — we append ?ref= at
    // share-time per the universal builder.
    var withRef = url || '';
    try {
      var code = (typeof window.__bloomGetShareCode === 'function') ? window.__bloomGetShareCode() : null;
      if (code) {
        var sep = withRef.indexOf('?') === -1 ? '?' : '&';
        withRef = withRef + sep + 'ref=' + encodeURIComponent(code);
      }
    } catch (e) {}
    return (template || '🌸 שברתי שיא ב-BLOOM! הגעתי ל-{score} נקודות. נסה לשבור אותי 👉 {url}')
      .replace('{score}', (score | 0).toLocaleString())
      .replace('{tier}', tier ? String(tier) : '')
      .replace('{url}', withRef);
  }

  function trackShare(via, opts) {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    if (!deviceId) return;
    fetch('/api/replay/track-share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId,
        token: token,
        score: opts.score,
        tier: opts.tier,
        mode: opts.mode,
        sharedVia: via,
        isNewBest: !!opts.isNewBest
      })
    }).catch(function() {});
    try { if (typeof trackEvent === 'function') trackEvent('share_replay', { via: via, score: opts.score }); } catch (e) {}
  }

  function showShareModal(opts) {
    // opts: { score, tier, mode, isNewBest, playerName }
    if (!_replayConfig || !_replayConfig.enabled) {
      // Refresh config and retry once
      fetchReplayConfig(true).then(function() { if (_replayConfig && _replayConfig.enabled) showShareModal(opts); });
      return;
    }
    var ex = document.getElementById('replay-share-modal');
    if (ex) ex.remove();
    var cfg = _replayConfig;
    var canvas = renderShareCard({
      score: opts.score,
      tier: opts.tier || 0,
      playerName: opts.playerName,
      isNewBest: !!opts.isNewBest,
      brandText: cfg.brandText,
      gameUrl: cfg.gameUrl
    });
    var pngUrl = null;
    try { pngUrl = canvas.toDataURL('image/png'); } catch (e) {}
    var shareText = buildShareText(cfg.shareText, opts.score, opts.tier, cfg.gameUrl);
    var modal = document.createElement('div');
    modal.id = 'replay-share-modal';
    modal.className = 'replay-share-overlay';
    modal.innerHTML =
      '<div class="replay-share-card">' +
        '<button class="replay-share-close" aria-label="סגור">×</button>' +
        '<div class="replay-share-title">📤 שתף את הניצחון שלך</div>' +
        '<div class="replay-share-sub">תן לחברים שלך לראות + נסה אותם לעקוף אותך</div>' +
        '<div class="replay-share-preview">' +
          (pngUrl
            ? '<img src="' + pngUrl + '" alt="ה-replay שלך" />'
            : '<div class="replay-share-fallback">תמונה לא זמינה — הטקסט עדיין יישלח</div>') +
        '</div>' +
        '<div class="replay-share-actions">' +
          '<button class="replay-share-btn replay-share-btn-whatsapp" id="replay-share-whatsapp">' +
            '<span class="replay-share-btn-icon">💬</span>' +
            '<span class="replay-share-btn-label">WhatsApp</span>' +
          '</button>' +
          '<button class="replay-share-btn replay-share-btn-native" id="replay-share-native">' +
            '<span class="replay-share-btn-icon">📤</span>' +
            '<span class="replay-share-btn-label">שתף</span>' +
          '</button>' +
          '<button class="replay-share-btn replay-share-btn-copy" id="replay-share-copy">' +
            '<span class="replay-share-btn-icon">📋</span>' +
            '<span class="replay-share-btn-label">העתק</span>' +
          '</button>' +
          '<button class="replay-share-btn replay-share-btn-save" id="replay-share-save">' +
            '<span class="replay-share-btn-icon">💾</span>' +
            '<span class="replay-share-btn-label">שמור</span>' +
          '</button>' +
        '</div>' +
        '<div class="replay-share-text-preview">' + escapeHtml(shareText) + '</div>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.replay-share-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });

    // WhatsApp share — works on mobile + desktop via web.whatsapp.com fallback.
    document.getElementById('replay-share-whatsapp').onclick = function() {
      trackShare('whatsapp', opts);
      var waUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
      window.open(waUrl, '_blank');
    };

    // Native share — uses navigator.share API with file when possible.
    document.getElementById('replay-share-native').onclick = function() {
      trackShare('native', opts);
      if (navigator.share) {
        var shareData = { text: shareText, title: 'BLOOM' };
        // Try to attach the image as a file if supported.
        canvasToBlob(canvas).then(function(blob) {
          if (blob && navigator.canShare) {
            var file = new File([blob], 'bloom-replay.png', { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              shareData.files = [file];
            }
          }
          navigator.share(shareData).catch(function() {});
        });
      } else {
        // Fallback: WhatsApp.
        var waUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
        window.open(waUrl, '_blank');
      }
    };

    // Copy link — text only.
    document.getElementById('replay-share-copy').onclick = function() {
      trackShare('copy_link', opts);
      var btn = document.getElementById('replay-share-copy');
      var oldHtml = btn.innerHTML;
      try {
        navigator.clipboard.writeText(shareText).then(function() {
          btn.innerHTML = '<span class="replay-share-btn-icon">✓</span><span class="replay-share-btn-label">הועתק!</span>';
          setTimeout(function() { btn.innerHTML = oldHtml; }, 1800);
        }).catch(function() {
          btn.innerHTML = '<span class="replay-share-btn-icon">⚠</span><span class="replay-share-btn-label">שגיאה</span>';
          setTimeout(function() { btn.innerHTML = oldHtml; }, 1800);
        });
      } catch (e) {
        btn.innerHTML = '<span class="replay-share-btn-icon">⚠</span><span class="replay-share-btn-label">לא תומך</span>';
        setTimeout(function() { btn.innerHTML = oldHtml; }, 1800);
      }
    };

    // Save image — triggers a download.
    document.getElementById('replay-share-save').onclick = function() {
      trackShare('save_image', opts);
      if (!pngUrl) return;
      var a = document.createElement('a');
      a.href = pngUrl;
      a.download = 'bloom-' + (opts.score | 0) + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  }

  // Mount on boot — pre-fetch config so the threshold check is ready.
  fetchReplayConfig(true);

  window.shouldOfferReplayShare = shouldOfferReplayShare;
  window.showReplayShareModal = showShareModal;
  window.fetchReplayConfig = fetchReplayConfig;
})();
