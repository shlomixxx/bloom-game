(function() {
  // Board dimensions live behind getters so a future "Pro mode" (5 or 6
  // columns, sold as IAP) can swap them at runtime without touching every
  // callsite. Today they return the original 6×4 dimensions — pure refactor.
  function getBoardRows() { return 6; }
  function getBoardCols() { return 4; }

  const SVG = {
    circle:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/></svg>',
    leaf:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21c.5-4.5 2.5-8 7-10"/><path d="M9 18c6.218 0 10.5-3.288 11-12v-2h-4.014c-9 0-11.986 4-12 9c0 1 0 3 2 5h3z"/></svg>',
    flower:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><circle cx="12" cy="5.5" r="3"/><circle cx="12" cy="18.5" r="3"/><circle cx="5.5" cy="12" r="3"/><circle cx="18.5" cy="12" r="3"/></svg>',
    flame:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a5 5 0 0 0 10 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-2 2z"/></svg>',
    bolt:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3v7h6l-8 11v-7H5l8-11z"/></svg>',
    star:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17.75l-6.172 3.245 1.179-6.873-4.993-4.867 6.9-1.002L12 1.999l3.086 6.254 6.9 1.002-4.993 4.867 1.179 6.873z"/></svg>',
    diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5h12l3 5-9 11-9-11z"/><path d="M3 10h18M9 5l3 5-3 5M15 5l-3 5 3 5"/></svg>',
    crown:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l3.5 9h11l3.5-9-5 4-4-7-4 7z"/></svg>'
  };

  const TIERS = [
    null,
    { svg: SVG.circle,  bg: '#D3D1C7', fg: '#2C2C2A', name: 'אבן',    emoji: '⬜' },
    { svg: SVG.leaf,    bg: '#C0DD97', fg: '#173404', name: 'עלה',    emoji: '🟩' },
    { svg: SVG.flower,  bg: '#F4C0D1', fg: '#4B1528', name: 'פרח',    emoji: '🟧' },
    { svg: SVG.flame,   bg: '#F5C4B3', fg: '#4A1B0C', name: 'אש',     emoji: '🟥' },
    { svg: SVG.bolt,    bg: '#FAC775', fg: '#412402', name: 'ברק',    emoji: '🟨' },
    { svg: SVG.star,    bg: '#9FE1CB', fg: '#04342C', name: 'כוכב',   emoji: '🟦' },
    { svg: SVG.diamond, bg: '#B5D4F4', fg: '#042C53', name: 'יהלום',  emoji: '💎' },
    { svg: SVG.crown,   bg: '#CECBF6', fg: '#26215C', name: 'כתר',    emoji: '👑' }
  ];
  const MAX_TIER = TIERS.length - 1;
  const WEIGHTS = [0, 55, 28, 12, 5];

  // ============ SKIN PACKS ============
  const SKIN_PACKS = {
    classic: { id: 'classic', name: '🌸 קלאסי', price: 0, tiers: null }, // null = use TIERS
    ocean: { id: 'ocean', name: '🌊 אוקיינוס', price: 200, tiers: [
      null,
      { svg: SVG.circle, bg: '#B8D4E3', fg: '#1A3A4A', name: 'חול',   emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#7EC8E3', fg: '#0A2540', name: 'גל',    emoji: '🟦' },
      { svg: SVG.flower, bg: '#4CA1AF', fg: '#FFFFFF', name: 'אלמוג', emoji: '🟧' },
      { svg: SVG.flame,  bg: '#2C7DA0', fg: '#FFFFFF', name: 'דג',    emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#1B6B93', fg: '#FFFFFF', name: 'דולפין', emoji: '🟨' },
      { svg: SVG.star,   bg: '#14557B', fg: '#FFD700', name: 'כוכב ים', emoji: '⭐' },
      { svg: SVG.diamond,bg: '#0E3F5C', fg: '#7FDBFF', name: 'פנינה', emoji: '💎' },
      { svg: SVG.crown,  bg: '#072A40', fg: '#FFD700', name: 'פוסיידון', emoji: '👑' }
    ]},
    candy: { id: 'candy', name: '🍬 ממתקים', price: 200, tiers: [
      null,
      { svg: SVG.circle, bg: '#FFDEE9', fg: '#6B2043', name: 'סוכריה', emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#FF9AA2', fg: '#5C1A25', name: 'מסטיק', emoji: '🟩' },
      { svg: SVG.flower, bg: '#FFB7B2', fg: '#5C2A25', name: 'גומי',   emoji: '🟧' },
      { svg: SVG.flame,  bg: '#E2979C', fg: '#FFFFFF', name: 'שוקולד', emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#FFC8A2', fg: '#5C3A12', name: 'קרמל',  emoji: '🟨' },
      { svg: SVG.star,   bg: '#B5EAD7', fg: '#1A4A35', name: 'מנטה',  emoji: '🟦' },
      { svg: SVG.diamond,bg: '#C7CEEA', fg: '#2A2D5E', name: 'לביבה', emoji: '💎' },
      { svg: SVG.crown,  bg: '#E8D5B7', fg: '#5C3A12', name: 'עוגה',   emoji: '👑' }
    ]},
    space: { id: 'space', name: '🌙 חלל', price: 300, tiers: [
      null,
      { svg: SVG.circle, bg: '#2D283E', fg: '#B8B5C8', name: 'אבק',    emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#564F6F', fg: '#E0DFEE', name: 'סלע',    emoji: '🟩' },
      { svg: SVG.flower, bg: '#4A2A7A', fg: '#D4A5FF', name: 'ערפילית', emoji: '🟧' },
      { svg: SVG.flame,  bg: '#9B59B6', fg: '#FFFFFF', name: 'כוכב',   emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#E74C3C', fg: '#FFFFFF', name: 'סופרנובה', emoji: '🟨' },
      { svg: SVG.star,   bg: '#F39C12', fg: '#FFFFFF', name: 'שמש',    emoji: '🟦' },
      { svg: SVG.diamond,bg: '#3498DB', fg: '#FFFFFF', name: 'גלקסיה', emoji: '💎' },
      { svg: SVG.crown,  bg: '#1A1A2E', fg: '#FFD700', name: 'חור שחור', emoji: '👑' }
    ]},
    fire: { id: 'fire', name: '🔥 אש וקרח', price: 300, tiers: [
      null,
      { svg: SVG.circle, bg: '#E8E8E8', fg: '#333333', name: 'אפר',   emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#A8D8EA', fg: '#1A3A4A', name: 'קרח',   emoji: '🟩' },
      { svg: SVG.flower, bg: '#78C4D4', fg: '#0A2540', name: 'כפור',  emoji: '🟧' },
      { svg: SVG.flame,  bg: '#FFB347', fg: '#5C2A00', name: 'ניצוץ', emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#FF6B35', fg: '#FFFFFF', name: 'להבה',  emoji: '🟨' },
      { svg: SVG.star,   bg: '#E63946', fg: '#FFFFFF', name: 'אש',    emoji: '🟦' },
      { svg: SVG.diamond,bg: '#1D3557', fg: '#A8DADC', name: 'קריסטל', emoji: '💎' },
      { svg: SVG.crown,  bg: '#0D1B2A', fg: '#FFD700', name: 'דרקון',  emoji: '👑' }
    ]},
    gold: { id: 'gold', name: '✨ VIP זהב', price: 500, tiers: [
      null,
      { svg: SVG.circle, bg: '#F5F0E1', fg: '#7A6B4E', name: 'חול',    emoji: '⬜' },
      { svg: SVG.leaf,   bg: '#E8D9A0', fg: '#5C4A12', name: 'נחושת', emoji: '🟩' },
      { svg: SVG.flower, bg: '#D4AF37', fg: '#3A2A00', name: 'ברונזה', emoji: '🟧' },
      { svg: SVG.flame,  bg: '#C5A028', fg: '#FFFFFF', name: 'כסף',   emoji: '🟥' },
      { svg: SVG.bolt,   bg: '#B8941E', fg: '#FFFFFF', name: 'זהב',   emoji: '🟨' },
      { svg: SVG.star,   bg: '#A07818', fg: '#FFFFFF', name: 'פלטינה', emoji: '🟦' },
      { svg: SVG.diamond,bg: '#8B6914', fg: '#FFE4A0', name: 'יהלום',  emoji: '💎' },
      { svg: SVG.crown,  bg: '#6B4E0A', fg: '#FFD700', name: 'מלך',    emoji: '👑' }
    ]}
  };
  const ACTIVE_SKIN_KEY = 'bloom_active_skin';
  const OWNED_SKINS_KEY = 'bloom_owned_skins';
  var activeSkinId = localStorage.getItem(ACTIVE_SKIN_KEY) || 'classic';
  var ownedSkins = JSON.parse(localStorage.getItem(OWNED_SKINS_KEY) || '["classic"]');

  // ============ THEME / SKIN ABSTRACTION ============
  function getActiveTiers() {
    var pack = SKIN_PACKS[activeSkinId];
    if (pack && pack.tiers) return pack.tiers;
    return TIERS;
  }

  var skinTrialMode = false;
  var skinTrialId = null;
  var skinTrialOriginal = null;

  function showSkinShop() {
    var existing = document.getElementById('skin-shop-modal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'skin-shop-modal';
    modal.className = 'info-modal';
    modal.onclick = function(e) { if (e.target === modal) modal.remove(); };
    var html = '<div class="info-card" style="max-width:360px;direction:rtl">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<span style="font-size:16px;font-weight:700">🎨 חנות סקינים</span>' +
        '<span style="font-size:13px;font-weight:700;color:#BA7517">💎 ' + playerBalance + '</span>' +
      '</div>';
    Object.keys(SKIN_PACKS).forEach(function(id) {
      var s = SKIN_PACKS[id];
      var owned = ownedSkins.indexOf(id) >= 0;
      var active = activeSkinId === id;
      var tiers = s.tiers || TIERS;
      var preview = '';
      for (var t = 1; t <= Math.min(5, tiers.length - 1); t++) {
        preview += '<div style="width:28px;height:28px;border-radius:8px;background:' + tiers[t].bg + ';color:' + tiers[t].fg + ';display:flex;align-items:center;justify-content:center">' + tiers[t].svg + '</div>';
      }
      var btnsHtml = '';
      if (active) {
        btnsHtml = '<button class="btn sm" disabled style="opacity:0.5;min-width:60px">✓ פעיל</button>';
      } else if (owned) {
        btnsHtml = '<button class="btn sm skin-equip-btn" data-skin="' + id + '" style="min-width:60px">לבש</button>';
      } else {
        btnsHtml = '<div style="display:flex;gap:4px">' +
          '<button class="btn sm skin-try-btn" data-skin="' + id + '" style="min-width:50px;font-size:11px">נסה</button>' +
          '<button class="btn sm skin-buy-btn" data-skin="' + id + '" style="background:#BA7517;color:#FFF;min-width:60px">' + s.price + ' 💎</button>' +
        '</div>';
      }

      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,0.06)">' +
        '<div style="flex:1">' +
          '<div style="font-size:13px;font-weight:600">' + s.name + '</div>' +
          '<div style="display:flex;gap:3px;margin-top:4px">' + preview + '</div>' +
        '</div>' +
        btnsHtml +
      '</div>';
    });
    html += '<button class="btn secondary" id="skin-shop-close" style="margin-top:12px;width:100%">סגור</button></div>';
    modal.innerHTML = html;
    document.body.appendChild(modal);
    document.getElementById('skin-shop-close').onclick = function() { modal.remove(); };

    // Wire try buttons
    modal.querySelectorAll('.skin-try-btn').forEach(function(btn) {
      btn.onclick = function() {
        var skinId = this.getAttribute('data-skin');
        modal.remove();
        startSkinTrial(skinId);
      };
    });

    // Wire buy buttons
    modal.querySelectorAll('.skin-buy-btn').forEach(function(btn) {
      btn.onclick = function() {
        var skinId = this.getAttribute('data-skin');
        var pack = SKIN_PACKS[skinId];
        if (!pack) return;
        if (playerBalance < pack.price) {
          this.textContent = 'אין מספיק 💎';
          setTimeout(function() { showSkinShop(); }, 1200);
          return;
        }
        var self = this;
        self.disabled = true; self.textContent = '...';
        fetch(API_BASE + '/api/player/buy-skin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId, skinId: skinId, token: deviceToken })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d && d.ok) {
            playerBalance = d.newBalance;
            try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
            ownedSkins.push(skinId);
            try { localStorage.setItem(OWNED_SKINS_KEY, JSON.stringify(ownedSkins)); } catch(e) {}
            activeSkinId = skinId;
            try { localStorage.setItem(ACTIVE_SKIN_KEY, skinId); } catch(e) {}
            skinTrialMode = false; skinTrialId = null;
            removeSkinTrialBanner();
            showSkinShop();
            buildTierBar(true);
            render();
            trackEvent('purchase', { item: 'skin', skin: skinId, cost: d.cost | 0 });
          } else {
            self.textContent = d.reason || 'שגיאה';
          }
        }).catch(function() { self.textContent = 'שגיאה'; });
      };
    });

    // Wire equip buttons
    modal.querySelectorAll('.skin-equip-btn').forEach(function(btn) {
      btn.onclick = function() {
        var skinId = this.getAttribute('data-skin');
        activeSkinId = skinId;
        try { localStorage.setItem(ACTIVE_SKIN_KEY, skinId); } catch(e) {}
        showSkinShop();
        buildTierBar(true);
        render();
      };
    });
  }

  function startSkinTrial(skinId) {
    skinTrialOriginal = activeSkinId;
    skinTrialId = skinId;
    skinTrialMode = true;
    activeSkinId = skinId;
    buildTierBar(true);
    hideHome(); // close home screen → enter game directly
    init('practice', { fresh: true });
    showSkinTrialBanner(skinId);
  }

  function showSkinTrialBanner(skinId) {
    removeSkinTrialBanner();
    var pack = SKIN_PACKS[skinId];
    if (!pack) return;
    // Add bottom padding so last row isn't hidden behind banner
    document.body.style.paddingBottom = '56px';
    var banner = document.createElement('div');
    banner.id = 'skin-trial-banner';
    banner.className = 'skin-trial-banner';
    banner.innerHTML =
      '<div class="trial-info">' +
        '<div class="trial-title">🎨 ניסיון · ' + pack.name + '</div>' +
        '<div class="trial-sub">ניקוד לא נשמר</div>' +
      '</div>' +
      '<div class="trial-btns">' +
        '<button class="btn sm skin-trial-end-btn" style="font-size:11px;padding:6px 12px">סיים</button>' +
        '<button class="btn sm skin-trial-buy-btn" style="background:#BA7517;color:#FFF;font-size:11px;padding:6px 12px">' + pack.price + ' 💎</button>' +
      '</div>';
    document.body.appendChild(banner);

    banner.querySelector('.skin-trial-buy-btn').onclick = function() {
      if (playerBalance < pack.price) {
        this.textContent = 'אין מספיק 💎';
        return;
      }
      this.disabled = true; this.textContent = '...';
      fetch(API_BASE + '/api/player/buy-skin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId, skinId: skinId, token: deviceToken })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d && d.ok) {
          playerBalance = d.newBalance;
          try { localStorage.setItem(PLAYER_BALANCE_KEY, String(d.newBalance)); } catch(e) {}
          ownedSkins.push(skinId);
          try { localStorage.setItem(OWNED_SKINS_KEY, JSON.stringify(ownedSkins)); } catch(e) {}
          try { localStorage.setItem(ACTIVE_SKIN_KEY, skinId); } catch(e) {}
          skinTrialMode = false; skinTrialId = null;
          removeSkinTrialBanner();
          updateModeBar();
          showCreditToast(-pack.price, pack.name + ' נרכש!');
          trackEvent('purchase', { item: 'skin', skin: skinId, cost: pack.price });
        }
      }).catch(function() {});
    };

    banner.querySelector('.skin-trial-end-btn').onclick = function() {
      endSkinTrial();
    };
  }

  function endSkinTrial() {
    if (skinTrialOriginal) {
      activeSkinId = skinTrialOriginal;
      try { localStorage.setItem(ACTIVE_SKIN_KEY, skinTrialOriginal); } catch(e) {}
    }
    skinTrialMode = false;
    skinTrialId = null;
    skinTrialOriginal = null;
    removeSkinTrialBanner();
    buildTierBar(true);
    init('practice', { fresh: true }); // fresh game so trial score doesn't leak
    updateModeBar();
    showSkinShop();
  }

  function removeSkinTrialBanner() {
    var b = document.getElementById('skin-trial-banner');
    if (b) b.remove();
    document.body.style.paddingBottom = '';
  }
