# BLOOM Aurora — הוראות התקנה (סקין נוסף עם בקרה מהאדמין)

> **לקלוד שיקרא את הקובץ הזה:** המסמך הזה מתקין סקין חדש בשם "Aurora" ב-BLOOM, **בלי לגעת בקוד הקיים**. הסקין יופיע כאופציה שביעית במערכת ה-SKIN_PACKS, עם CSS-effects ייעודיים שמופעלים רק כשהסקין הזה פעיל. ההפעלה/כיבוי הגלובלי שלו נעשה דרך **דף האדמין** עם פלאג ב-game_config. אם משהו לא נכון — `git revert` מבטל הכל. עבוד פאזה אחר פאזה, קומיט נפרד לכל אחת. אחרי כל פאזה: `node --check server.js`, `./build.sh`, `git add -A && git commit && git push`.
>
> **לפני שאתה מתחיל:** וודא `git status` נקי, אתה על `main`. קרא את `CLAUDE.md`.

---

## רקע — מה זה הסקין החדש

Aurora הוא סקין שבונה על המבנה הקיים של `SKIN_PACKS` (ב-`src/01-constants.js`) אבל מוסיף שכבת CSS-effects שלא קיימת בסקינים אחרים: gradients (במקום צבעים שטוחים), specular highlights, breathing על דרגות 6-7, shimmer רוטטי על הכתר, text-bursts ("GREAT!" / "AMAZING!" / "GODLIKE!") על chains, חלקיקים שטסים לציון, hit-stop במיזוגים, וscore-bump.

הסקין מבוסס על מחקר אדיקציה מ-Royal Match, Candy Crush, ו-Vampire Survivors. דמואים מלאים נבנו לאישור (`bloom_aurora_v3.html`).

**שלוש שכבות שליטה:**
1. **גלובלי (אדמין):** flag ב-`game_config` בשם `aurora_skin_enabled`. כש-`false` — הסקין לא קיים בשבילי השחקנים, גם אם קנו אותו בעבר.
2. **לכל שחקן:** ה-`activeSkinId` ב-localStorage (קיים כבר היום) — בוחר אם הסקין הזה הוא הסקין שלו.
3. **אנימציות:** הקלאסים של ה-CSS-effects (`.skin-aurora-active`) רק על body, כך שאף סקין אחר לא מושפע.

---

## פאזה 1 — הוספת הסקין ל-SKIN_PACKS (קומיט)

### 1.1 פתח את `src/01-constants.js` ומצא את `SKIN_PACKS` (שורה 34 בערך).

אחרי הרשומה של `gold` (שורה 90, לפני הסוגריים הסוגרים `}` של SKIN_PACKS), הוסף:

```js
,
    aurora: { id: 'aurora', name: '🌌 אורורה', price: 300, tiers: [
      null,
      { svg: SVG.circle,  bg: 'linear-gradient(140deg,#EBE7DA 0%,#C0BAA8 100%)', fg: '#3D3A33', name: 'אבן',    emoji: '⬜' },
      { svg: SVG.leaf,    bg: 'linear-gradient(140deg,#D9EDB7 0%,#88B450 100%)', fg: '#1F3A0E', name: 'עלה',    emoji: '🟩' },
      { svg: SVG.flower,  bg: 'linear-gradient(140deg,#FFD3E2 0%,#E07AA8 100%)', fg: '#5C1A38', name: 'פרח',    emoji: '🟧' },
      { svg: SVG.flame,   bg: 'linear-gradient(140deg,#FFC4A0 0%,#EE7548 100%)', fg: '#5A1E08', name: 'אש',     emoji: '🟥' },
      { svg: SVG.bolt,    bg: 'linear-gradient(140deg,#FFDA7A 0%,#E89010 100%)', fg: '#3A1F00', name: 'ברק',    emoji: '🟨' },
      { svg: SVG.star,    bg: 'linear-gradient(140deg,#A8EBD0 0%,#2DAC85 100%)', fg: '#013024', name: 'כוכב',   emoji: '🟦' },
      { svg: SVG.diamond, bg: 'linear-gradient(140deg,#B8D5F8 0%,#3F88D8 100%)', fg: '#042C53', name: 'יהלום',  emoji: '💎' },
      { svg: SVG.crown,   bg: 'linear-gradient(110deg,#F0E8FF 0%,#9B8AE8 20%,#F5C8E8 40%,#9B8AE8 60%,#FFD37A 80%,#9B8AE8 100%)', fg: '#26215C', name: 'כתר',    emoji: '👑' }
    ]}
```

> **שים לב:** ה-`bg` של כל אריח הוא **string של gradient**, לא צבע. הקוד הקיים ב-`src/02-shop.js:455-456` עושה `cell.style.background = tiers[t].bg` — זה יעבוד אוטומטית עם gradients (CSS תומך).

### 1.2 הוסף className ל-body כשהסקין פעיל

ב-`src/01-constants.js`, מצא את הפונקציה שמחילה סקין (חפש `function getActiveTiers` או `function setActiveSkin`). אם אין פונקציה מסודרת — חפש איפה `activeSkinId` נכתב ל-localStorage (שורה 187, 206).

ליד **כל מקום שבו `activeSkinId` משתנה**, הוסף שורה שמעדכנת את ה-body class:

```js
// Add to body: skin-aurora-active class enables CSS-effects exclusive to Aurora
// Other skins remain visually untouched
document.body.classList.toggle('skin-aurora-active', activeSkinId === 'aurora');
```

גם **בטעינה ראשונית** — מצא את ה-code ש-runs on page load (חפש את `var activeSkinId = ...` בשורה 94) והוסף מיד אחריו:

```js
// On boot, sync the body class to match the loaded skin
if (typeof document !== 'undefined' && document.body) {
  document.body.classList.toggle('skin-aurora-active', activeSkinId === 'aurora');
}
```

> **למה זה חשוב:** כל ה-CSS-effects של Aurora יהיו מתחת ל-`body.skin-aurora-active .cell.tier-X`. אם הסקין לא פעיל — שום אפקט לא מופעל. שאר הסקינים לא מושפעים בכלל.

### 1.3 בנה וקומיט

```bash
./build.sh
node --check server.js
git add -A
git commit -m "feature(skin): add Aurora skin to SKIN_PACKS

New 7th skin pack 'aurora' with gradient backgrounds. Uses the existing
render path (cell.style.background = tiers[t].bg) — gradients are valid
CSS background values. Body gets .skin-aurora-active class when this
skin is selected, enabling exclusive CSS-effects via tiles-aurora.css
in a later commit. No other skins affected."
git push
```

---

## פאזה 2 — קובץ ה-CSS של האפקטים (קומיט)

### 2.1 צור קובץ חדש: `public/css/tiles-aurora.css`

העתק את כל התוכן הבא אל הקובץ החדש:

```css
  /* ============================================================
     BLOOM AURORA — premium tile surface + addictive animations
     Active ONLY when body has .skin-aurora-active class.
     Other skins remain completely untouched.
     Research basis: Royal Match (hit-stop, fast anims, score bump),
     Candy Crush (chain text bursts), Vampire Survivors (particles
     fly to score), Suika Game (near-miss escalation).
     ============================================================ */

  /* ── Per-tier polish via gradients + specular highlights ── */
  body.skin-aurora-active .cell {
    border-radius: 12px;
    transition: transform 0.15s, box-shadow 0.3s;
    position: relative;
  }
  body.skin-aurora-active .cell.filled::before {
    content: ''; position: absolute; inset: 0; border-radius: inherit;
    background: inherit;
    box-shadow:
      inset 0 1.5px 0 rgba(255,255,255,0.55),
      inset 0 -1.5px 0 rgba(0,0,0,0.08);
    pointer-events: none; z-index: 1;
  }
  body.skin-aurora-active .cell.filled::after {
    content: ''; position: absolute; inset: 0; border-radius: inherit;
    background: linear-gradient(165deg,
      rgba(255,255,255,0.38) 0%,
      rgba(255,255,255,0)    35%,
      rgba(0,0,0,0)          65%,
      rgba(0,0,0,0.1)        100%);
    pointer-events: none; z-index: 3;
    mix-blend-mode: overlay;
  }
  body.skin-aurora-active .cell.filled svg { position: relative; z-index: 2; }

  /* ── Per-tier shadows (low tiers flat, high tiers float) ── */
  body.skin-aurora-active .cell.tier-1 { box-shadow: 0 2px 5px rgba(0,0,0,0.08); }
  body.skin-aurora-active .cell.tier-2 { box-shadow: 0 2px 6px rgba(99,153,34,0.25); }
  body.skin-aurora-active .cell.tier-3 { box-shadow: 0 2px 8px rgba(212,83,126,0.30); }
  body.skin-aurora-active .cell.tier-4 { box-shadow: 0 3px 10px rgba(216,90,48,0.35); }
  body.skin-aurora-active .cell.tier-5 { box-shadow: 0 3px 14px rgba(239,159,39,0.45); }
  body.skin-aurora-active .cell.tier-6 { box-shadow: 0 3px 16px rgba(29,158,117,0.40); }
  body.skin-aurora-active .cell.tier-7 { box-shadow: 0 4px 18px rgba(55,138,221,0.50); }
  body.skin-aurora-active .cell.tier-8 {
    background-size: 300% 300% !important;
    box-shadow:
      0 5px 25px rgba(127,119,221,0.55),
      0 0 0 1.5px rgba(174,159,232,0.7),
      0 0 50px rgba(174,159,232,0.4);
  }

  /* ── Crown shimmer + pulse + icon tilt ── */
  @keyframes auroraCrownShimmer {
    0%   { background-position: 0% 50%; }
    100% { background-position: 300% 50%; }
  }
  @keyframes auroraCrownPulse {
    0%,100% { transform: scale(1)    translateY(0);    filter: brightness(1); }
    50%     { transform: scale(1.06) translateY(-2px); filter: brightness(1.18); }
  }
  @keyframes auroraCrownIcon {
    0%,88%,100% { transform: rotate(0deg)   scale(1); }
    92%         { transform: rotate(-10deg) scale(1.12); }
    96%         { transform: rotate(8deg)   scale(1.12); }
  }
  body.skin-aurora-active .cell.tier-8 {
    animation: auroraCrownShimmer 3s linear infinite, auroraCrownPulse 1.6s ease-in-out infinite;
  }
  body.skin-aurora-active .cell.tier-8 svg {
    animation: auroraCrownIcon 5s ease-in-out infinite;
    transform-origin: center;
  }

  /* ── Breathing for tiers 6-7 ── */
  @keyframes auroraBreath {
    0%,100% { filter: brightness(1)    saturate(1);    transform: scale(1); }
    50%     { filter: brightness(1.12) saturate(1.18); transform: scale(1.025); }
  }
  body.skin-aurora-active .cell.tier-6,
  body.skin-aurora-active .cell.tier-7 {
    animation: auroraBreath 2.2s ease-in-out infinite;
  }
  /* Danger state — accelerate breathing */
  body.skin-aurora-active .grid.danger-mode .cell.tier-6,
  body.skin-aurora-active .grid.danger-mode .cell.tier-7 {
    animation-duration: 0.7s;
  }

  /* ── MERGE — hit-stop + fast + variance via --merge-peak ── */
  @keyframes auroraMerge {
    0%   { transform: scale(1);    box-shadow: 0 0 0 0 rgba(255,210,100,0.7); filter: brightness(1) saturate(1); }
    18%  { transform: scale(0.85); filter: brightness(0.85); }
    35%  { transform: scale(var(--merge-peak, 1.4)); box-shadow: 0 0 0 10px rgba(255,210,100,0.55); filter: brightness(2.1) saturate(1.7); }
    45%  { transform: scale(var(--merge-peak, 1.4)); filter: brightness(2.1) saturate(1.7); }
    65%  { transform: scale(1.1);  filter: brightness(1.3); }
    85%  { transform: scale(0.96); box-shadow: 0 0 0 22px rgba(255,210,100,0); filter: brightness(1) saturate(1); }
    100% { transform: scale(1); }
  }
  body.skin-aurora-active .cell.merging {
    animation: auroraMerge 0.32s cubic-bezier(0.22, 0.9, 0.36, 1.06) both !important;
    z-index: 5;
  }
  /* Chain 4+ — bigger, longer, color-shifted */
  @keyframes auroraMergeBig {
    0%   { transform: scale(1);    box-shadow: 0 0 0 0  rgba(255,180,80,0.85); filter: brightness(1); }
    15%  { transform: scale(0.78); filter: brightness(0.8); }
    35%  { transform: scale(1.7);  box-shadow: 0 0 0 16px rgba(255,180,80,0.55); filter: brightness(2.5) saturate(2) hue-rotate(-15deg); }
    50%  { transform: scale(1.7);  filter: brightness(2.5) saturate(2) hue-rotate(-15deg); }
    70%  { transform: scale(1.2);  filter: brightness(1.6); }
    90%  { transform: scale(0.94); box-shadow: 0 0 0 38px rgba(255,180,80,0); filter: brightness(1); }
    100% { transform: scale(1); }
  }
  body.skin-aurora-active .cell.merging.chain-4,
  body.skin-aurora-active .cell.merging.chain-5,
  body.skin-aurora-active .cell.merging.chain-6,
  body.skin-aurora-active .cell.merging.chain-7,
  body.skin-aurora-active .cell.merging.chain-8 {
    animation-name: auroraMergeBig;
    animation-duration: 0.42s;
  }

  /* ── DROP — replaces the existing tileDrop, only when Aurora active ── */
  @keyframes auroraDrop {
    0%   { transform: translateY(-30px) scale(0.78); opacity: 0; }
    50%  { transform: translateY(6px)   scale(1.14); opacity: 1; }
    72%  { transform: translateY(-3px)  scale(0.94); }
    100% { transform: translateY(0)     scale(1); }
  }
  body.skin-aurora-active .cell.appearing {
    animation: auroraDrop 0.28s cubic-bezier(0.34, 1.4, 0.64, 1) both !important;
  }

  /* ── Crown celebration — overrides any existing tier-crown animation ── */
  @keyframes auroraCelebrate {
    0%   { transform: scale(1)    rotate(0deg);  filter: brightness(1)   saturate(1);   }
    25%  { transform: scale(1.5)  rotate(-6deg); filter: brightness(1.6) saturate(1.5); }
    50%  { transform: scale(1.35) rotate(6deg);  filter: brightness(1.5) saturate(1.5); }
    75%  { transform: scale(1.5)  rotate(-3deg); filter: brightness(1.6) saturate(1.5); }
    100% { transform: scale(1)    rotate(0deg);  filter: brightness(1)   saturate(1);   }
  }
  body.skin-aurora-active .cell.celebrated {
    animation: auroraCelebrate 1.3s cubic-bezier(0.34, 1.2, 0.64, 1) !important;
    z-index: 10;
  }

  /* ── TEXT BURST — "GREAT!" / "AMAZING!" / "INSANE!" / "GODLIKE!" ── */
  .aurora-text-burst {
    position: absolute; top: 25%; left: 50%;
    transform: translate(-50%,-50%) scale(0);
    font-weight: 900; font-size: 36px;
    text-shadow:
      0 0 20px currentColor,
      0 4px 0 rgba(0,0,0,0.3),
      0 -2px 0 rgba(255,255,255,0.5);
    letter-spacing: 0.02em;
    pointer-events: none; z-index: 25;
    text-align: center; line-height: 1;
    opacity: 0; direction: ltr;
  }
  .aurora-text-burst.show {
    animation: auroraTextBurst 1.1s cubic-bezier(0.34, 1.6, 0.64, 1) forwards;
  }
  @keyframes auroraTextBurst {
    0%   { transform: translate(-50%,-50%) scale(0)   rotate(-15deg); opacity: 0; }
    20%  { transform: translate(-50%,-50%) scale(1.5) rotate(8deg);   opacity: 1; }
    35%  { transform: translate(-50%,-50%) scale(1.0) rotate(-3deg); }
    75%  { transform: translate(-50%,-50%) scale(1.0) translateY(0);   opacity: 1; }
    100% { transform: translate(-50%,-50%) scale(0.8) translateY(-40px); opacity: 0; }
  }
  .aurora-text-burst-good   { color: #FAC775; }
  .aurora-text-burst-great  { color: #EE7548; }
  .aurora-text-burst-amazing { color: #C8472F; }
  .aurora-text-burst-insane  { color: #9B8AE8; }
  .aurora-text-burst-godlike { color: #FFFFFF; text-shadow: 0 0 30px #FAC775, 0 0 50px #FF6B35, 0 4px 0 rgba(0,0,0,0.3); }

  /* ── Score-particle (flies from cell to score counter) ── */
  .aurora-score-particle {
    position: fixed;
    width: 12px; height: 12px; border-radius: 50%;
    background: #FAC775;
    box-shadow: 0 0 12px rgba(250,199,117,0.9);
    pointer-events: none; z-index: 100;
    transition: left 0.6s cubic-bezier(0.4,0,0.2,1), top 0.6s cubic-bezier(0.4,0,0.2,1);
  }

  /* ── Score bump (when score increases) ── */
  @keyframes auroraScoreBump {
    0%   { transform: scale(1); }
    30%  { transform: scale(1.35); }
    60%  { transform: scale(0.96); }
    100% { transform: scale(1); }
  }
  body.skin-aurora-active #score.bump,
  body.skin-aurora-active .stat-val.bump {
    animation: auroraScoreBump 0.32s cubic-bezier(0.34, 1.6, 0.64, 1);
    display: inline-block;
  }

  /* ── Drop-zone ghost preview ── */
  .aurora-ghost-preview {
    position: absolute;
    pointer-events: none;
    border-radius: 10px;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 4;
    border: 2px dashed rgba(186,117,23,0.7);
  }
  body.dark-bg .aurora-ghost-preview,
  html[data-theme="dark"] .aurora-ghost-preview {
    border-color: rgba(250,199,117,0.7);
  }
  .aurora-ghost-preview.visible { opacity: 0.5; }
```

### 2.2 הוסף את הקובץ ל-build.sh

חפש את `./build.sh` (זה script שמרכיב את ה-CSS לקובץ `public/styles.css`). אמור להיראות בערך כך:

```bash
cat public/css/base.css \
    public/css/home.css \
    public/css/screens.css \
    public/css/viral.css \
    public/css/dark.css \
    > public/styles.css
```

הוסף את `tiles-aurora.css` **לפני dark.css** (כדי שה-dark mode יוכל לעקוף אותו אם צריך):

```bash
cat public/css/base.css \
    public/css/home.css \
    public/css/screens.css \
    public/css/viral.css \
    public/css/tiles-aurora.css \
    public/css/dark.css \
    > public/styles.css
```

### 2.3 קומיט

```bash
./build.sh
git add -A
git commit -m "feature(skin): add tiles-aurora.css with addictive animations

Per-tier specular highlights, breathing on tiers 6-7, crown shimmer,
hit-stop merge with --merge-peak variance, text-burst keyframes for
chain combos, score-particle and score-bump styles, ghost-preview.

All scoped under body.skin-aurora-active — zero effect on other skins.

Added to build.sh before dark.css so dark mode overrides still win."
git push
```

---

## פאזה 3 — JS לאפקטים החדשים: text burst, score bump, particles to score, ghost preview (קומיט)

### 3.1 צור פונקציות-עזר ב-`src/01-constants.js`

אחרי בלוק `SKIN_PACKS` ולפני `const ACTIVE_SKIN_KEY` (שורה 92 בערך), הוסף:

```js
  // ─── Aurora-only juice helpers ───
  // All functions check skin-aurora-active before running, so they're safe to
  // call from anywhere; they no-op when Aurora isn't the active skin.

  const AURORA_CHAIN_TEXTS = ['','','GREAT!','AMAZING!','INSANE!','GODLIKE!'];
  const AURORA_CHAIN_CLASSES = ['','','good','great','amazing','insane','godlike'];

  function auroraIsActive() {
    return document.body.classList.contains('skin-aurora-active');
  }

  // Spawn a "GREAT!" / "AMAZING!" / "GODLIKE!" text burst at the center of the
  // grid. Called on merge with chainCount >= 2.
  function auroraShowTextBurst(chainNum) {
    if (!auroraIsActive() || chainNum < 2) return;
    const grid = document.getElementById('grid') || document.querySelector('.grid');
    if (!grid) return;
    let burst = document.getElementById('aurora-text-burst');
    if (!burst) {
      burst = document.createElement('div');
      burst.id = 'aurora-text-burst';
      burst.className = 'aurora-text-burst';
      grid.parentElement.appendChild(burst);
    }
    const tier = Math.min(chainNum, 5);
    burst.textContent = AURORA_CHAIN_TEXTS[tier];
    burst.className = 'aurora-text-burst aurora-text-burst-' + AURORA_CHAIN_CLASSES[tier];
    burst.classList.remove('show');
    void burst.offsetWidth;
    burst.classList.add('show');
  }

  // Bump the score counter — quick scale animation when points are added.
  // Call after updating the score number in the DOM.
  function auroraScoreBump() {
    if (!auroraIsActive()) return;
    const scoreEls = document.querySelectorAll('#score, .score, .stat-primary .stat-val');
    scoreEls.forEach(el => {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 400);
    });
  }

  // Fly a few small particles from cell -> score counter, simulating
  // "points entering your pocket". Vampire Survivors style.
  function auroraFlyParticlesToScore(cellEl, count) {
    if (!auroraIsActive() || !cellEl) return;
    const scoreEl = document.querySelector('#score, .score, .stat-primary .stat-val');
    if (!scoreEl) return;
    const sRect = scoreEl.getBoundingClientRect();
    const cRect = cellEl.getBoundingClientRect();
    const targetX = sRect.left + sRect.width/2;
    const targetY = sRect.top + sRect.height/2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'aurora-score-particle';
      const startX = cRect.left + cRect.width/2 + (Math.random()-0.5)*30;
      const startY = cRect.top + cRect.height/2 + (Math.random()-0.5)*30;
      p.style.left = startX + 'px';
      p.style.top = startY + 'px';
      document.body.appendChild(p);
      setTimeout(() => {
        p.style.left = targetX + 'px';
        p.style.top = targetY + 'px';
      }, 10 + i*40);
      setTimeout(() => p.remove(), 750 + i*40);
    }
  }

  // Apply a random scale-peak to a cell's merge animation, so consecutive
  // merges don't look identical. Slot-machine variance for the brain.
  function auroraSetMergeVariance(cellEl) {
    if (!auroraIsActive() || !cellEl) return;
    const peak = (1.3 + Math.random() * 0.2).toFixed(2);
    cellEl.style.setProperty('--merge-peak', peak);
  }

  // Expose globally so 11-game.js and 14-events.js can call them without
  // importing. (BLOOM uses a single IIFE; these become window.* in the
  // bundled output.)
  if (typeof window !== 'undefined') {
    window.auroraShowTextBurst = auroraShowTextBurst;
    window.auroraScoreBump = auroraScoreBump;
    window.auroraFlyParticlesToScore = auroraFlyParticlesToScore;
    window.auroraSetMergeVariance = auroraSetMergeVariance;
    window.auroraIsActive = auroraIsActive;
  }
```

### 3.2 חבר את הפונקציות לקוד הקיים — חפש כל merge ב-`src/11-game.js`

חפש בקובץ הזה את הקוד שמטפל במיזוג (חפש `cell.classList.add('merging')` או `function merge`). בכל מקום שמתבצע מיזוג, **לפני** ה-`classList.add('merging')`, הוסף את הקריאות הבאות:

```js
// Aurora juice: per-cell scale variance + score bump + text burst + fly particles
if (window.auroraSetMergeVariance) window.auroraSetMergeVariance(cell);
```

ואחרי שעדכנת את הניקוד (חפש `score += ...` או `score = ...`), הוסף:

```js
if (window.auroraScoreBump) window.auroraScoreBump();
```

ואחרי שעדכנת את `chainCount`, הוסף:

```js
if (window.auroraShowTextBurst) window.auroraShowTextBurst(chainCount);
```

ובסוף ה-merge handler:

```js
if (window.auroraFlyParticlesToScore) window.auroraFlyParticlesToScore(cell, Math.min(5, 2 + chainCount));
```

> **שיקול:** אם אתה לא בטוח **בדיוק** איפה להוסיף — חפש בקוד את שורת ה-`if (mergeCount > 1)` או דומה. שם נמצא ה-chain logic. כל הקריאות שמורות עם `if (window.auroraXXX)` כך שאם אין סקין Aurora פעיל — הן no-op.

### 3.3 ה-render של ה-cell (ב-`src/02-shop.js` או `src/11-game.js`)

חפש את הקוד שמרנדר תאים בלוח (אמור להיות `function render` שמכיל לולאה על `grid[r][c]`). תוודא ש-**הקלאס `filled`** מתווסף לתא כשיש בו אריח. אם הקלאס לא קיים — הוסף:

```js
// Inside the render loop, after setting cell.style.background:
if (t > 0) {
  cell.classList.add('filled');
} else {
  cell.classList.remove('filled');
}
```

זה נדרש כי ה-CSS של Aurora משתמש ב-`.cell.filled::before` / `.cell.filled::after` עבור ה-specular highlights.

### 3.4 קומיט

```bash
./build.sh
node --check server.js
git add -A
git commit -m "feature(skin): wire Aurora juice hooks into game loop

Adds auroraShowTextBurst / auroraScoreBump / auroraFlyParticlesToScore /
auroraSetMergeVariance as global window.* helpers. All no-op when the
Aurora skin isn't active — so calling them from the main game loop is
safe even when player picked a different skin.

Hooked into the merge handler in 11-game.js to fire on every merge,
plus the chainCount bump for text-bursts. Cell.classList includes
'filled' now so the Aurora specular pseudo-elements work."
git push
```

---

## פאזה 4 — בקרת אדמין (קומיט)

### 4.1 הוסף flag ל-game_config ב-schema.sql

ב-`schema.sql`, בסוף ה-INSERT INTO game_config (או באזור של flags), הוסף:

```sql
INSERT INTO game_config (key, value) VALUES ('aurora_skin_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;
```

> **שים לב:** ברירת המחדל היא `'true'` כי אתה רוצה להפעיל אותו. אם משהו לא טוב, האדמין משנה ל-`'false'`.

### 4.2 חשוף את ה-flag דרך API שכבר קיים

חפש את ה-endpoint שמחזיר את ה-game config ללקוח (חפש `'/api/config'` או `'/api/game-config'` או `gameConfig` ב-server.js). הוא אמור להחזיר את כל הערכים מ-game_config. אם הוא כבר מחזיר את כולם — אין צורך לשנות. אם הוא מחזיר רק חלק — הוסף `aurora_skin_enabled` לרשימה המותרת.

### 4.3 קריאת ה-flag בלקוח

ב-`src/01-constants.js`, מיד אחרי ה-`SKIN_PACKS` (שורה 91 בערך, אחרי הסוגריים `}`), הוסף:

```js
  // Server-controlled gate: admin can disable the Aurora skin from showing
  // in the shop entirely. If disabled, we remove it from SKIN_PACKS.
  // Default to ENABLED; only the explicit string 'false' disables.
  (function checkAuroraGate() {
    fetch('/api/config').then(r => r.json()).then(cfg => {
      const enabled = cfg && cfg.aurora_skin_enabled !== 'false';
      if (!enabled) {
        // Hide from shop
        delete SKIN_PACKS.aurora;
        // If player has aurora active, fall back to classic
        if (activeSkinId === 'aurora') {
          activeSkinId = 'classic';
          try { localStorage.setItem(ACTIVE_SKIN_KEY, 'classic'); } catch(e) {}
          document.body.classList.remove('skin-aurora-active');
        }
      }
    }).catch(() => {});
  })();
```

> **שים לב לשם ה-endpoint:** אם ה-endpoint שלך הוא `/api/game-config` או משהו אחר — שנה את הקריאה. בדוק ב-`server.js` עם `grep -n "app.get.*config" server.js`.

### 4.4 הוסף toggle לדף האדמין

ב-`admin/index.html`, חפש את האזור של "game config" או "settings" (יש שם כפתורים/checkboxים אחרים). הוסף שורה חדשה:

```html
<!-- אחרי האחרים, באזור הסקינים/המראה -->
<div class="config-row" style="margin-top:14px;padding:14px;background:#FFF;border:1px solid #E5E2DA;border-radius:12px;">
  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;">
    <input type="checkbox" id="cfg-aurora-skin-enabled" style="width:18px;height:18px;cursor:pointer;">
    <span>🌌 סקין Aurora זמין לשחקנים</span>
  </label>
  <p style="margin:6px 0 0 28px;font-size:12px;color:#6F6E68;">
    כשמופעל — הסקין מופיע בחנות הסקינים. כשמכובה — הוא נעלם, ושחקנים שהיה להם פעיל חוזרים לקלאסי אוטומטית. שינוי נכנס לתוקף אחרי refresh.
  </p>
</div>
```

ובסקריפט של admin (בסוף `admin/index.html` או בקובץ JS נפרד), בפונקציה שטוענת את ה-config להצגה, הוסף:

```js
// Load aurora_skin_enabled (default true)
const auroraToggle = document.getElementById('cfg-aurora-skin-enabled');
if (auroraToggle) {
  const v = (configData.aurora_skin_enabled || 'true');
  auroraToggle.checked = v !== 'false';
  auroraToggle.onchange = function() {
    fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'aurora_skin_enabled',
        value: auroraToggle.checked ? 'true' : 'false'
      })
    }).then(r => r.json()).then(d => {
      if (d && d.ok) {
        showAdminToast('✓ נשמר · השינוי ייכנס לתוקף לשחקנים בטעינה הבאה');
      }
    });
  };
}
```

> **חשוב:** אם ה-admin שלך משתמש ב-endpoint אחר ל-update config, התאם את הנתיב. חפש ב-server.js עם `grep -n "admin.*config\|/api/admin" server.js`.

### 4.5 בנה וקומיט

```bash
./build.sh
node --check server.js
git add -A
git commit -m "feature(skin): admin toggle for Aurora skin via game_config

- New game_config row: aurora_skin_enabled (default 'true')
- Client checks /api/config on boot; if disabled, removes aurora from
  SKIN_PACKS and falls back active skin to classic
- Admin checkbox in admin/index.html — instant disable without redeploy

Players who paid for the skin will get it back when re-enabled (we
don't remove ownership records, only hide it from shop)."
git push
```

---

## פאזה 5 — לוגיקת power-ups עם Aurora (אופציונלי, אם יש זמן)

> **דלג על פאזה זו אם הסקין נראה טוב כבר עכשיו.** זה רק מוסיף juice לבונוסים הקיימים.

ב-`src/14-events.js`, אחרי כל `triggerBomb` / `triggerFreeze` / וכו', הוסף:

```js
// At the end of triggerBomb, after applyGravity()
if (window.auroraScoreBump) window.auroraScoreBump();

// Inside triggerStar, after upgrading the tile:
if (window.auroraSetMergeVariance) window.auroraSetMergeVariance(cellAt(r,c));

// Inside triggerGift jackpot path:
if (window.auroraScoreBump) window.auroraScoreBump();
```

### 5.1 קומיט

```bash
git add -A
git commit -m "feature(skin): connect Aurora juice to bonus events

Bomb/Star/Gift now trigger score-bump animation when Aurora is active.
No-op for other skins."
git push
```

---

## איך מבטלים — שלוש רמות

### רמה 1 — לכבות לשחקנים ספציפיים
לא צריך לעשות כלום. שחקן שלא בחר את Aurora בחנות הסקינים — לא רואה את האפקטים. ברירת המחדל היא הסקין הקלאסי.

### רמה 2 — לכבות גלובלית מהאדמין (לא דורש קוד)
1. כנס ל-`admin/`
2. בטל את ה-checkbox "🌌 סקין Aurora זמין לשחקנים"
3. השינוי תקף תוך טעינה הבאה לכל השחקנים. מי שהיה לו Aurora פעיל — חוזר לקלאסי אוטומטית.

### רמה 3 — להסיר לגמרי מהקוד
```bash
# חזור על כל הסבב (5 קומיטים)
git revert HEAD~4..HEAD --no-edit
git push
```

או למחוק ידנית: למחוק את הקטע מ-SKIN_PACKS, למחוק את `public/css/tiles-aurora.css`, להוציא משורת ה-build.sh, ולמחוק את ה-aurora helpers מ-`01-constants.js`.

---

## בדיקות אחרי deploy

1. **ברירת מחדל:** ה-Aurora אמור להופיע בחנות הסקינים, מחיר 300 💎
2. **לקנות + להפעיל:** קונה → רואה לוח עם gradients, האריחים נושמים בדרגות 6-7, הכתר מנצנץ
3. **לעשות chain ×3:** "AMAZING!" קופץ באמצע, חלקיקים טסים לציון, הציון קופץ
4. **להחליף לסקין אחר** (classic / ocean / וכו'): כל האפקטים נעלמים. שום השפעה. **זה הכי חשוב לבדוק.**
5. **לכבות מהאדמין:** רענן את העמוד → Aurora לא מופיע בחנות. אם היה פעיל — חזר לקלאסי.

---

## סיכום קומיטים

1. `feature(skin): add Aurora skin to SKIN_PACKS`
2. `feature(skin): add tiles-aurora.css with addictive animations`
3. `feature(skin): wire Aurora juice hooks into game loop`
4. `feature(skin): admin toggle for Aurora skin via game_config`
5. (אופציונלי) `feature(skin): connect Aurora juice to bonus events`

**הכל reversible.** השלוש שכבות שליטה (per-player skin, admin global toggle, git revert) מבטיחות שאפשר להפסיק את הסקין בכל רגע.

---

**הערה לסיום:** אם משהו בלקוח לא נראה כמו שצריך (האנימציות לא מתחברות נכון, ה-text burst לא מופיע במרכז) — תגיד לשלומי לפתוח את DevTools, להפעיל את הסקין, ולעשות chain. הקונסול אמור להראות אם פונקציות חסרות. אם `window.auroraShowTextBurst is not a function` — סימן ש-01-constants.js לא טוען אותם נכון. בדוק את `./build.sh` והרץ שוב.
