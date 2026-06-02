// ============================================================
// Stage 18 — Skin Gacha (May 2026)
// Variable-reward Skinner box. The Genshin/Apex pattern.
// 5 rarity tiers + pity system + daily free pull + 10x bundle.
// Animated reveal sequence drives the dopamine hit.
// ============================================================
(function() {
  var RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythic'];
  var RARITY_LABELS = {
    common:    { he: 'רגיל',    color: '#9CA3AF', bg: '#E5E7EB', glow: 'rgba(156,163,175,0.5)' },
    uncommon:  { he: 'לא רגיל', color: '#10B981', bg: '#D1FAE5', glow: 'rgba(16,185,129,0.55)' },
    rare:      { he: 'נדיר',    color: '#3B82F6', bg: '#DBEAFE', glow: 'rgba(59,130,246,0.6)' },
    legendary: { he: 'אגדי',    color: '#A855F7', bg: '#F3E8FF', glow: 'rgba(168,85,247,0.7)' },
    mythic:    { he: 'מיתי',    color: '#F59E0B', bg: '#FEF3C7', glow: 'rgba(245,158,11,0.85)' }
  };

  var _gachaCache = { data: null, fetchedAt: 0 };
  var _gachaInFlight = false;
  var _gachaPulling = false; // guards against a second pull firing before the first resolves

  function fetchGachaState(force) {
    if (!force && _gachaCache.data && (Date.now() - _gachaCache.fetchedAt) < 60000) {
      return Promise.resolve(_gachaCache.data);
    }
    if (_gachaInFlight) return Promise.resolve(_gachaCache.data);
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    _gachaInFlight = true;
    var url = '/api/gacha/state';
    if (deviceId) url += '?deviceId=' + encodeURIComponent(deviceId);
    return fetch(url).then(function(r) { return r.json(); }).catch(function() { return null; })
      .then(function(d) {
        _gachaInFlight = false;
        if (d && d.ok) {
          _gachaCache.data = d;
          _gachaCache.fetchedAt = Date.now();
        }
        return d;
      });
  }

  function maybeShowGachaBanner() {
    // T1.1 — Gacha unlocks at L18. Variable-reward gambling is a deep
    // mechanic — exposing it too early hits monetization but kills early retention.
    try { if (typeof getPlayerLevel === 'function' && getPlayerLevel() < 18) return; } catch (e) {}
    fetchGachaState(false).then(function(d) {
      if (!d || !d.ok || !d.enabled || !d.showOnHome) return;
      var home = document.getElementById('home-screen-v2') || document.getElementById('home-screen');
      if (!home) return;
      if (document.getElementById('gacha-home-banner')) return;
      mountGachaBanner(home, d);
    });
  }

  function mountGachaBanner(homeEl, data) {
    var banner = document.createElement('div');
    banner.id = 'gacha-home-banner';
    banner.className = 'gacha-home-banner';
    var freeBadge = data.freeAvailable
      ? '<span class="gacha-banner-free">🎁 פול חינם זמין!</span>'
      : '';
    var pityHint = data.pityRemaining <= 10
      ? '<span class="gacha-banner-pity">🔥 עוד ' + data.pityRemaining + ' לאגדי מובטח!</span>'
      : '';
    banner.innerHTML =
      '<div class="gacha-banner-icon">🎰</div>' +
      '<div class="gacha-banner-body">' +
        '<div class="gacha-banner-title">' + escapeHtml(data.name) + ' ' + freeBadge + '</div>' +
        '<div class="gacha-banner-sub">' +
          (pityHint || 'נדירים מובטחים כל ' + data.pityThreshold + ' פולים · יש סקינים בלעדיים') +
        '</div>' +
      '</div>' +
      '<button class="gacha-banner-cta">פתח →</button>' +
      '<button class="gacha-banner-close" aria-label="סגור">×</button>';
    // Position after starter/deals banners if present.
    var sp = document.getElementById('starter-pack-home-banner');
    var dd = document.getElementById('daily-deal-home-banner');
    var insertAfter = dd || sp;
    if (insertAfter && insertAfter.nextSibling) {
      homeEl.insertBefore(banner, insertAfter.nextSibling);
    } else {
      homeEl.insertBefore(banner, homeEl.firstChild);
    }
    banner.querySelector('.gacha-banner-cta').onclick = function() { showGachaModal(data); };
    banner.addEventListener('click', function(e) {
      if (e.target.classList.contains('gacha-banner-close')) {
        banner.remove();
      } else if (e.target === banner || e.target.classList.contains('gacha-banner-body') || e.target.classList.contains('gacha-banner-icon')) {
        showGachaModal(data);
      }
    });
  }

  function showGachaModal(data) {
    var ex = document.getElementById('gacha-modal');
    if (ex) ex.remove();
    var modal = document.createElement('div');
    modal.id = 'gacha-modal';
    modal.className = 'gacha-modal-overlay';
    var featuredHtml = '';
    if (data.featured) {
      var rar = RARITY_LABELS[data.featured.rarity] || RARITY_LABELS.rare;
      featuredHtml =
        '<div class="gacha-featured-banner" style="border-color:' + rar.color + ';background:linear-gradient(135deg,' + rar.bg + ',rgba(255,255,255,0.5))">' +
          '<div class="gacha-featured-label" style="color:' + rar.color + '">⭐ פיצ\'רד · ' + rar.he + '</div>' +
          '<div class="gacha-featured-row">' +
            '<div class="gacha-featured-emoji">' + (data.featured.emoji || '🎁') + '</div>' +
            '<div class="gacha-featured-name">' + escapeHtml(data.featured.displayName || '') + '</div>' +
            '<div class="gacha-featured-boost">+30% סיכוי</div>' +
          '</div>' +
        '</div>';
    }
    // Rates breakdown
    var ratesHtml = RARITY_ORDER.map(function(rar) {
      var pct = data.weights[rar] || 0;
      var label = RARITY_LABELS[rar];
      return '<div class="gacha-rate-row" style="background:' + label.bg + ';color:' + label.color + '">' +
        '<span class="gacha-rate-label">' + label.he + '</span>' +
        '<span class="gacha-rate-pct">' + pct + '%</span>' +
      '</div>';
    }).join('');
    // Pity bar
    var pityPct = Math.min(100, Math.round((data.pityCounter / data.pityThreshold) * 100));
    var pityHtml =
      '<div class="gacha-pity-card">' +
        '<div class="gacha-pity-label">' +
          '🔥 פיטי: ' + data.pityCounter + ' / ' + data.pityThreshold +
          (data.pityRemaining <= 10
            ? ' · <strong>עוד ' + data.pityRemaining + ' לאגדי מובטח!</strong>'
            : ' · אגדי מובטח בעוד ' + data.pityRemaining + ' פולים') +
        '</div>' +
        '<div class="gacha-pity-bar"><div class="gacha-pity-fill" style="width:' + pityPct + '%"></div></div>' +
      '</div>';
    // T3.4 — Collection progress card. Completionist drive — "12 / 17"
    // shows the player exactly how far they are from "I own them all".
    // Card hidden when totalSkins is unknown or zero (defensive).
    var collectionHtml = '';
    if (data.totalSkins && data.totalSkins > 0) {
      var collPct = Math.min(100, Math.round((data.ownedSkinsCount / data.totalSkins) * 100));
      var remaining = data.totalSkins - data.ownedSkinsCount;
      var hintText = remaining === 0
        ? '👑 איסוף מלא!'
        : (remaining <= 3
           ? '🔥 עוד ' + remaining + ' להשלמת האוסף!'
           : 'עוד ' + remaining + ' סקינים לאסוף');
      collectionHtml =
        '<div class="gacha-collection-card' + (remaining === 0 ? ' gacha-collection-complete' : '') + '">' +
          '<div class="gacha-collection-label">📚 אוסף: <strong>' + data.ownedSkinsCount + ' / ' + data.totalSkins + '</strong> · ' + hintText + '</div>' +
          '<div class="gacha-collection-bar"><div class="gacha-collection-fill" style="width:' + collPct + '%"></div></div>' +
        '</div>';
    }
    var bal = (typeof playerBalance !== 'undefined') ? playerBalance : 0;
    var singleAffordable = bal >= data.priceSingle;
    var tenAffordable = bal >= data.priceTen;
    var freeBtn = data.freeAvailable
      ? '<button class="gacha-pull-btn gacha-pull-free" id="gacha-pull-free">' +
          '<div class="gacha-pull-btn-emoji">🎁</div>' +
          '<div class="gacha-pull-btn-label">פול חינם</div>' +
          '<div class="gacha-pull-btn-price">יומי</div>' +
        '</button>'
      : '<div class="gacha-pull-btn gacha-pull-free disabled">' +
          '<div class="gacha-pull-btn-emoji">⏰</div>' +
          '<div class="gacha-pull-btn-label">פול חינם</div>' +
          '<div class="gacha-pull-btn-price">מחר</div>' +
        '</div>';
    var savedPct = data.priceSingle * 10 > data.priceTen
      ? Math.round((1 - data.priceTen / (data.priceSingle * 10)) * 100)
      : 0;
    var savedBadge = savedPct > 0
      ? '<div class="gacha-pull-btn-saved">חסכת ' + savedPct + '%</div>'
      : '';
    modal.innerHTML =
      '<div class="gacha-modal-card">' +
        '<button class="gacha-modal-close" aria-label="סגור">×</button>' +
        '<div class="gacha-modal-icon">🎰</div>' +
        '<div class="gacha-modal-title">' + escapeHtml(data.name) + '</div>' +
        '<div class="gacha-modal-sub">5 רמות נדירות · נדיר מובטח כל ' + data.pityThreshold + ' פולים</div>' +
        featuredHtml +
        pityHtml +
        collectionHtml +
        '<div class="gacha-rates-grid">' + ratesHtml + '</div>' +
        '<div class="gacha-pull-buttons">' +
          freeBtn +
          '<button class="gacha-pull-btn gacha-pull-single ' + (singleAffordable ? '' : 'disabled') + '" id="gacha-pull-single">' +
            '<div class="gacha-pull-btn-emoji">💎</div>' +
            '<div class="gacha-pull-btn-label">פול בודד</div>' +
            '<div class="gacha-pull-btn-price">' + data.priceSingle + '💎</div>' +
          '</button>' +
          '<button class="gacha-pull-btn gacha-pull-ten ' + (tenAffordable ? '' : 'disabled') + '" id="gacha-pull-ten">' +
            '<div class="gacha-pull-btn-emoji">💎×10</div>' +
            '<div class="gacha-pull-btn-label">10 פולים</div>' +
            '<div class="gacha-pull-btn-price">' + data.priceTen + '💎</div>' +
            savedBadge +
          '</button>' +
        '</div>' +
        '<button class="gacha-history-link" id="gacha-history-link">📜 צפה בהיסטוריה</button>' +
      '</div>';
    document.body.appendChild(modal);
    var close = function() { try { modal.remove(); } catch (e) {} };
    modal.querySelector('.gacha-modal-close').onclick = close;
    modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
    var freeEl = document.getElementById('gacha-pull-free');
    if (freeEl && data.freeAvailable) {
      freeEl.onclick = function() { doPull(1, true); };
    }
    var singleEl = document.getElementById('gacha-pull-single');
    if (singleEl && singleAffordable) {
      singleEl.onclick = function() { doPull(1, false); };
    }
    var tenEl = document.getElementById('gacha-pull-ten');
    if (tenEl && tenAffordable) {
      tenEl.onclick = function() { doPull(10, false); };
    }
    var histLink = document.getElementById('gacha-history-link');
    if (histLink) histLink.onclick = showGachaHistory;
  }

  function doPull(count, free) {
    // Prevent a second pull from firing before the first resolves — a fast
    // double-tap on "פול חינם" used to trigger the free pull, then a second
    // request that the server rejected with a confusing "already claimed"
    // error. One pull at a time.
    if (_gachaPulling) return;
    _gachaPulling = true;
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    var token    = (typeof deviceToken !== 'undefined') ? deviceToken : null;
    // Close the modal during the reveal — keep the screen clean.
    var modal = document.getElementById('gacha-modal');
    if (modal) modal.remove();
    // Show "rolling" overlay immediately.
    var rolling = document.createElement('div');
    rolling.id = 'gacha-rolling-overlay';
    rolling.className = 'gacha-rolling-overlay';
    rolling.innerHTML =
      '<div class="gacha-rolling-orb"></div>' +
      '<div class="gacha-rolling-text">פותח...</div>';
    document.body.appendChild(rolling);
    fetch('/api/gacha/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, token: token, count: count, free: free })
    })
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        _gachaPulling = false;
        if (d && d.ok) {
          if (typeof d.newBalance === 'number') {
            try { if (typeof playerBalance !== 'undefined') playerBalance = d.newBalance; } catch (e) {}
            try { if (typeof updateBalanceDisplay === 'function') updateBalanceDisplay(); } catch (e) {}
            // Gacha pull = spend (negative). Free pull = 0.
            try { if (typeof window.__bloomBumpBal === 'function') window.__bloomBumpBal(d.newBalance, -(d.cost || 0)); } catch (e) {}
          }
          // Update cache for the next modal render.
          if (_gachaCache.data) {
            _gachaCache.data.pityCounter = d.pityCounter;
            _gachaCache.data.pityRemaining = d.pityRemaining;
            _gachaCache.data.totalPulls = d.totalPulls;
            if (free) _gachaCache.data.freeAvailable = false;
          }
          // Sync owned skins.
          try {
            (d.results || []).forEach(function(res) {
              if (res.reward && res.reward.type === 'skin' && res.reward.skinId && typeof ownedSkins !== 'undefined') {
                if (ownedSkins.indexOf(res.reward.skinId) === -1) ownedSkins.push(res.reward.skinId);
              }
            });
          } catch (e) {}
          // Run the reveal sequence after the rolling animation finishes.
          setTimeout(function() {
            if (rolling) rolling.remove();
            revealSequence(d.results || []);
          }, 1400);
        } else {
          if (rolling) rolling.remove();
          var reason = (d && d.reason) || '';
          if (reason === 'insufficient_funds') {
            showToast('💎 חסר ביתרה. צריך ' + (d.price || 0) + '💎, יש לך ' + (d.balance || 0) + '💎', 'warning');
          } else if (reason === 'free_already_claimed') {
            // Not an error — the player already used today's free pull. Fix the
            // cached state so the button repaints as "מחר", and say so kindly.
            if (_gachaCache.data) _gachaCache.data.freeAvailable = false;
            showToast('🎁 כבר קיבלת היום את הפול החינם! פול חינם חדש מחכה לך מחר 🌅', 'info');
          } else {
            showToast('שגיאה: ' + (reason || 'unknown'), 'error');
          }
        }
      });
  }

  function revealSequence(results) {
    if (!results.length) return;
    var idx = 0;
    var ov = document.createElement('div');
    ov.id = 'gacha-reveal-overlay';
    ov.className = 'gacha-reveal-overlay';
    ov.innerHTML =
      '<div class="gacha-reveal-counter" id="gacha-reveal-counter"></div>' +
      '<div class="gacha-reveal-card" id="gacha-reveal-card"></div>' +
      '<div class="gacha-reveal-actions">' +
        '<button class="gacha-reveal-next" id="gacha-reveal-next">הבא ←</button>' +
        '<button class="gacha-reveal-skip" id="gacha-reveal-skip">דלג לסיכום</button>' +
      '</div>';
    document.body.appendChild(ov);
    var counter = document.getElementById('gacha-reveal-counter');
    var card = document.getElementById('gacha-reveal-card');
    var nextBtn = document.getElementById('gacha-reveal-next');
    var skipBtn = document.getElementById('gacha-reveal-skip');

    function renderCard(res) {
      var rar = RARITY_LABELS[res.rarity] || RARITY_LABELS.common;
      var reward = res.reward || {};
      var rewardType = reward.type || '';
      var pityBadge = res.wasPity ? '<div class="gacha-card-pity">🔥 פיטי!</div>' : '';
      var featBadge = res.wasFeatured ? '<div class="gacha-card-featured">⭐ פיצ\'רד!</div>' : '';
      // Reveal the concrete prize the player ACTUALLY received. Chest/freeze
      // rewards are credited as gems server-side, duplicate skins convert to
      // gems, and bp_tier advances the Battle Pass — none of which is obvious
      // from the item name. Without this the "🎁 תיבת הפתעה" card looked like an
      // unopened box ("לא רואים במה זכיתי"). Now every box visibly OPENS.
      var valueBadge = '';
      if (res.duplicateConverted) {
        valueBadge = '<div class="gacha-card-value gacha-card-value-dup">🔄 כבר היה לך — הומר ל-<strong>' + (res.gems || 0).toLocaleString() + '💎</strong></div>';
      } else if (typeof res.convertedToGems === 'number' && res.convertedToGems > 0) {
        valueBadge = '<div class="gacha-card-value gacha-card-value-open">🎉 נפתח! קיבלת <strong>+' + res.convertedToGems.toLocaleString() + '💎</strong></div>';
      } else if (rewardType === 'bp_tier' && typeof res.xpBoost === 'number' && res.xpBoost > 0) {
        valueBadge = '<div class="gacha-card-value gacha-card-value-bp">🎖 התקדמת <strong>+' + (reward.amount || 1) + ' דרגות</strong> ב-Battle Pass</div>';
      } else if (rewardType === 'skin') {
        valueBadge = '<div class="gacha-card-value gacha-card-value-skin">🎨 סקין חדש נפתח לך!</div>';
      }
      card.style.borderColor = rar.color;
      card.style.background = 'linear-gradient(135deg,' + rar.bg + ',rgba(255,255,255,0.6))';
      card.style.boxShadow = '0 12px 60px ' + rar.glow + ', 0 0 0 4px ' + rar.color + '30';
      card.innerHTML =
        '<div class="gacha-card-rarity" style="color:' + rar.color + '">' + rar.he + '</div>' +
        '<div class="gacha-card-emoji">' + (reward.emoji || '🎁') + '</div>' +
        '<div class="gacha-card-name">' + escapeHtml(reward.displayName || '') + '</div>' +
        valueBadge + pityBadge + featBadge;
      // Trigger CSS animation by re-adding the class.
      card.classList.remove('gacha-card-animate');
      void card.offsetWidth;
      card.classList.add('gacha-card-animate');
      // Sound + buzz scaled by rarity.
      var soundTier = RARITY_ORDER.indexOf(res.rarity) + 2;
      try { if (typeof soundMilestone === 'function') soundMilestone(soundTier); } catch (e) {}
      try {
        if (typeof buzz === 'function') {
          if (res.rarity === 'mythic')      buzz([60,40,80,40,120,40,180]);
          else if (res.rarity === 'legendary') buzz([60,40,100,60,140]);
          else if (res.rarity === 'rare')   buzz([40,40,80]);
          else                              buzz([30, 20]);
        }
      } catch (e) {}
    }

    function next() {
      if (idx >= results.length) {
        showSummary();
        return;
      }
      counter.textContent = (idx + 1) + ' / ' + results.length;
      renderCard(results[idx]);
      idx++;
    }

    function showSummary() {
      // Aggregate: count per rarity + total gems / skins / etc
      var counts = { common: 0, uncommon: 0, rare: 0, legendary: 0, mythic: 0 };
      var totalGems = 0;
      var skinsWon = [];
      var bpTiers = 0;
      results.forEach(function(r) {
        counts[r.rarity] = (counts[r.rarity] || 0) + 1;
        if (r.reward.type === 'gems') totalGems += r.reward.amount || 0;
        if (r.reward.type === 'skin' && !r.duplicateConverted) skinsWon.push(r.reward.displayName);
        if (r.reward.type === 'bp_tier') bpTiers += r.reward.amount || 0;
        if (r.gems) totalGems += r.gems; // duplicates converted
        if (r.convertedToGems) totalGems += r.convertedToGems;
      });
      var rarityRows = RARITY_ORDER.filter(function(r) { return counts[r]; }).map(function(r) {
        var rar = RARITY_LABELS[r];
        return '<div class="gacha-summary-row" style="background:' + rar.bg + ';color:' + rar.color + '">' +
          '<span>' + rar.he + '</span><span>×' + counts[r] + '</span></div>';
      }).join('');
      var summary = '<div class="gacha-summary-title">🎉 סיכום ' + results.length + ' פולים</div>' +
        '<div class="gacha-summary-rarities">' + rarityRows + '</div>' +
        '<div class="gacha-summary-totals">' +
          (totalGems ? '<div>💎 ' + totalGems.toLocaleString() + ' יהלומים</div>' : '') +
          (skinsWon.length ? '<div>🎨 ' + skinsWon.length + ' סקין' + (skinsWon.length > 1 ? 'ים' : '') + ' חדש' + (skinsWon.length > 1 ? 'ים' : '') + '</div>' : '') +
          (bpTiers ? '<div>🎖 ' + bpTiers + ' דרגות BP</div>' : '') +
        '</div>' +
        '<button class="gacha-summary-close" id="gacha-summary-close">סגור</button>' +
        '<button class="gacha-summary-again" id="gacha-summary-again">שוב!</button>';
      counter.textContent = '✓';
      card.innerHTML = summary;
      card.style.borderColor = '#A855F7';
      card.style.background = 'linear-gradient(135deg,#F3E8FF,#FFFFFF)';
      card.style.boxShadow = '0 12px 60px rgba(168,85,247,0.7)';
      nextBtn.style.display = 'none';
      skipBtn.style.display = 'none';
      document.getElementById('gacha-summary-close').onclick = closeOverlay;
      document.getElementById('gacha-summary-again').onclick = function() {
        closeOverlay();
        // Re-fetch + reopen modal so the player can chain pulls.
        fetchGachaState(true).then(function(d) {
          if (d && d.ok) showGachaModal(d);
        });
      };
    }

    function closeOverlay() { try { ov.remove(); } catch (e) {} }

    nextBtn.onclick = next;
    skipBtn.onclick = showSummary;
    next();
  }

  function showGachaHistory() {
    var deviceId = (typeof getDeviceId === 'function') ? getDeviceId() : '';
    if (!deviceId) return;
    fetch('/api/gacha/history?deviceId=' + encodeURIComponent(deviceId))
      .then(function(r) { return r.json(); })
      .catch(function() { return null; })
      .then(function(d) {
        var modal = document.createElement('div');
        modal.className = 'gacha-history-overlay';
        var rows = ((d && d.history) || []).map(function(h) {
          var rar = RARITY_LABELS[h.rarity] || RARITY_LABELS.common;
          var when = new Date(h.pulled_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
          var badges = [];
          if (h.was_pity) badges.push('🔥');
          if (h.was_featured) badges.push('⭐');
          if (h.was_free) badges.push('🎁');
          return '<div class="gacha-history-row" style="border-left-color:' + rar.color + '">' +
            '<div class="gacha-history-emoji">' + (h.emoji || '🎁') + '</div>' +
            '<div class="gacha-history-body">' +
              '<div class="gacha-history-name">' + escapeHtml(h.display_name || '') + ' ' + badges.join('') + '</div>' +
              '<div class="gacha-history-meta" style="color:' + rar.color + '">' + rar.he + ' · #' + h.pull_index + ' · ' + when + '</div>' +
            '</div>' +
          '</div>';
        }).join('') || '<div style="padding:20px;text-align:center;color:#999">עדיין לא ביצעת פולים</div>';
        modal.innerHTML =
          '<div class="gacha-history-card">' +
            '<button class="gacha-history-close" aria-label="סגור">×</button>' +
            '<div class="gacha-history-title">📜 50 הפולים האחרונים</div>' +
            '<div class="gacha-history-list">' + rows + '</div>' +
          '</div>';
        document.body.appendChild(modal);
        var close = function() { try { modal.remove(); } catch (e) {} };
        modal.querySelector('.gacha-history-close').onclick = close;
        modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
      });
  }

  window.maybeShowGachaBanner = maybeShowGachaBanner;
  window.showGachaModal = showGachaModal;
  window.fetchGachaState = fetchGachaState;
})();
