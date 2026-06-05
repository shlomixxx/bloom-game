export const meta = {
  name: 'bloom-v2-launch-roles',
  description: 'Refine the v2 launch zone: ladder=current piece, box=NEXT-in-line (lookahead), box=hold/freeze — verify the piece data-flow, design, synthesize',
  phases: [
    { title: 'Verify' },
    { title: 'Design' },
    { title: 'Judge' },
  ],
}

const REPO = '/Users/shlomishemtov/Documents/Python/bloom-game'

const CONTEXT = [
  'PROJECT: BLOOM — Suika-style 4x6 merge puzzle, RTL Hebrew, vanilla JS IIFE. Repo: ' + REPO + '. Built by build.sh from src/*.js -> public/app.js + public/css/*.css -> public/styles.css (EDIT SOURCES).',
  '',
  'THE GAME v2 "BLOOM Spine" (gated body.bloom-v2; flag OFF = byte-identical classic, must stay that way): a single in-game strip = the relocated 8-tier LADDER (#tier-bar) + a launch zone (#v2-launch) below it. The launch zone currently has: a hero NEXT tile (#v2-cur-box, gold ring, label "⬇ הבא") + a HOLD chip (#v2-hold-box, label "החזקה") + a points readout (#v2-next-pts). The board below stays ~90px (width-bound). All this is in src/52-v2-board.js paintV2Launch() + public/css/v2-mechanics.css, scoped body.bloom-v2.',
  '',
  'THE USER FEEDBACK (the redesign target): "The LADDER at the top already shows the CURRENT tile (the highlighted rung). The box shows the current tile too — that is redundant. What is MISSING: the box should show WHAT IS NEXT IN LINE (the upcoming piece, so I can plan), and there should be a box for HOLD/FREEZE. So the three roles should be: (1) ladder = CURRENT piece [the one dropping now], (2) a box = NEXT-IN-LINE [the upcoming piece / lookahead], (3) a box = HOLD/FREEZE [stash a piece]." Implement THAT and refine it to be maximally clear + addictive.',
  '',
  'ENGINE PIECE VARIABLES (you must VERIFY these before designing — getting them wrong would make the box LIE about what drops): in the classic engine, `nextPiece` = the piece that drops on the next tap (the CURRENT piece in hand); `v2NextUp` = a v2 1-deep lookahead set in `rollNextPiece` (src/12-tour-info.js); `heldPiece` = the v2 hold/swap stash; `highlightNextTier(nextPiece)` highlights the ladder rung of the CURRENT piece; `v2SwapHold()` swaps nextPiece<->heldPiece. `pieceValue(tier)` = merge-pair points.',
  '',
  'HARD CONSTRAINTS: everything gated v2On() + scoped body.bloom-v2; do NOT touch the merge engine / 4x6 grid / scoring; the board must stay ~90px width-bound on iPhone 13 Pro 390x844 (the launch zone + ladder chrome budget is tight — the spine is ~94-98px now); flag OFF = pure classic. On-brand: warm cream bg, gold #C9923B accent, mint-green success, rounded ~14px tiles, RTL Hebrew. Prime directive: MAXIMALLY ADDICTIVE (planning depth via lookahead is a real skill/retention lever).',
].join('\n')

// ---------------- Phase 1: Verify the piece data-flow + audit current state ----------------
phase('Verify')
const verifyTasks = [
  {
    label: 'verify:dataflow',
    prompt: CONTEXT + '\n\nYOUR JOB (read-only, CRITICAL): trace the EXACT piece data-flow so the redesign labels are truthful. Read src/12-tour-info.js (rollNextPiece — how nextPiece + v2NextUp advance), src/52-v2-board.js (paintV2Launch, v2SwapHold, what #v2-cur-box / #v2-hold-box / #v2-next-pts are filled with), src/11-game.js (init reset of heldPiece/v2NextUp; drop() — when does the CURRENT piece drop + when does rollNextPiece run), and how highlightNextTier is called. ANSWER PRECISELY: (1) Is `v2NextUp` a TRUE 1-deep lookahead — i.e., is the piece shown as v2NextUp exactly the piece that becomes `nextPiece` (drops) on the NEXT tap? Quote the rollNextPiece code that proves it. (2) Does the ladder active-rung highlight `nextPiece` (the CURRENT/dropping piece)? (3) On v2SwapHold, what happens to nextPiece / heldPiece / v2NextUp — does the lookahead stay consistent? (4) Are v2NextUp + heldPiece reset on init()? (5) Any edge case where showing v2NextUp in the box would be WRONG/stale (e.g., first piece of a game, after hold-swap, gold-cell upgrades). Give file:line + code excerpts. This determines whether "box = next-in-line" is safe.',
  },
  {
    label: 'verify:ux-audit',
    prompt: CONTEXT + '\n\nYOUR JOB (read-only): audit the CURRENT launch zone against the user mental model (ladder=current, box=next-in-line, box=hold/freeze). Read src/52-v2-board.js paintV2Launch + public/css/v2-mechanics.css (the #v2-launch / .v2-slot / .v2-next-hero / .v2-hold-chip rules + the ladder .tier-cell.active highlight) + look at how the ladder marks the current piece. ANSWER: (1) Today the hero box shows `nextPiece` (current) AND the ladder highlights `nextPiece` (current) — confirm this duplication. (2) Is the ladder active-rung highlight strong/clear enough to serve as the SOLE "current piece" indicator if the box switches to showing the lookahead? What would make "this rung = your current piece, dropping now" unmistakable (e.g., a downward caret, a "נוכחי" micro-label, a stronger ring)? (3) The chrome height budget: list the current spine height breakdown (ladder zone + launch zone) and how much room exists before the board drops below 90px at 390x844 — any redesign must not grow the spine past ~98px. (4) What is genuinely MISSING per the user (a clear next-in-line box + a clear hold/freeze box with distinct roles). Be concrete.',
  },
]
const verifies = (await parallel(verifyTasks.map(function (t) { return function () { return agent(t.prompt, { label: t.label, phase: 'Verify', agentType: 'Explore' }) } }))).filter(Boolean)
const VERIFY = verifies.join('\n\n=====\n\n')
log('Verify complete (' + verifies.length + '). Designing the refined launch zone.')

// ---------------- Phase 2: Design the refined launch zone (3 lenses) ----------------
phase('Design')
const FORMAT = '\n\nReturn clearly-labeled PROSE sections (NOT JSON / NOT a tool call): ## NAME / ## CONCEPT / ## LADDER = CURRENT (how the active rung is made unmistakably "the piece dropping now") / ## BOX = NEXT-IN-LINE (what it shows = v2NextUp lookahead, label, visual) / ## BOX = HOLD-or-FREEZE (role, label, empty vs filled state, interaction) / ## POINTS (what the +N readout reflects now) / ## HEIGHT MATH (prove the spine stays <=~98px so the board stays ~90px at 390x844) / ## EXACT CHANGES (the precise paintV2Launch innerHTML + fill() targets, and the CSS deltas in public/css/v2-mechanics.css, all body.bloom-v2) / ## EDGE CASES (first piece, after hold-swap, reduced-motion) / ## ADDICTION RATIONALE. Be implementation-ready. The VERIFY findings above are authoritative ground truth — design on them, do not re-read everything.'
const LENSES = [
  { key: 'three-clear-roles', brief: 'THREE CLEAR ROLES (front-runner): make the three things visually + verbally distinct so a new player gets it in <2s. Ladder active rung = "current" (add a downward caret/▾ or a tiny "עכשיו"/"נוכחי" tag so it reads "this drops now"). The hero box = the NEXT-IN-LINE piece (v2NextUp) with a clear "הבא בתור" label. A separate HOLD/FREEZE box ("החזקה"/"הקפאה") clearly tap-to-stash, dashed when empty. Eliminate the current/box duplication.' },
  { key: 'queue-line', brief: 'THE QUEUE LINE: present it as a left-to-right (RTL) PIPELINE the eye reads as a sequence — [current on ladder] → [next-in-line box] → and the hold/freeze as a clearly-separate utility slot off to the side. Emphasize the "line/order" metaphor (small connectors/arrows) so "what comes after what" is obvious and planning feels natural. Keep it compact + on-brand.' },
  { key: 'planning-juice', brief: 'PLANNING-AS-DOPAMINE: lean into the lookahead as a skill/retention lever — seeing the next-in-line piece lets players set up chains, which triggers all the shipped chain/MEGA juice. Make the next-in-line box satisfying (subtle reveal pop when it advances), keep the hold/freeze as a "save it for the perfect moment" tool. Make sure the CURRENT (ladder) vs NEXT (box) distinction is crisp so the planning actually works. On-brand, compact.' },
]
const designs = (await parallel(LENSES.map(function (L) {
  return function () {
    return agent(
      CONTEXT + '\n\n===== VERIFY FINDINGS (authoritative) =====\n' + VERIFY + '\n\n===== YOUR DESIGN LENS: ' + L.key + ' =====\n' + L.brief + FORMAT,
      { label: 'design:' + L.key, phase: 'Design' }
    )
  }
}))).filter(Boolean)
const DESIGNS_TEXT = designs.map(function (d, i) { return '######## DESIGN ' + (i + 1) + ' (' + LENSES[i].key + ') ########\n' + d }).join('\n\n')
log(designs.length + '/3 designs in. Synthesizing the final spec.')

// ---------------- Phase 3: Judge + synthesize (feasibility baked in) ----------------
phase('Judge')
const winner = await agent(
  CONTEXT + '\n\n===== VERIFY FINDINGS =====\n' + VERIFY + '\n\n===== THE 3 DESIGNS =====\n' + DESIGNS_TEXT + '\n\nYou are the lead judge + synthesizer + feasibility reviewer. Score the 3 designs briefly, then synthesize ONE final, implementation-ready spec for the refined launch zone where: the LADDER active rung clearly = the CURRENT piece (dropping now), the hero box = the NEXT-IN-LINE piece (v2NextUp lookahead, verified safe by the Verify phase), and a clear HOLD/FREEZE box. Confirm against the Verify findings that showing v2NextUp is truthful (and handle the first-piece / post-swap / init edge cases). Then ADVERSARIALLY check: does the board stay ~90px at 390x844 (recompute the spine height)? Is everything gated body.bloom-v2 so flag OFF = byte-identical classic? Any leak or transform-collision with the ladder .active/.cycling scale or the climb thermometer classes?\n\nReturn clearly-labeled PROSE: ## SCORING / ## FINAL DESIGN / ## LADDER=CURRENT (exact marker) / ## BOX=NEXT-IN-LINE (exact: fill #v2-cur-box with v2NextUp, label, ensure v2NextUp is initialized so it is never empty) / ## BOX=HOLD-FREEZE / ## POINTS / ## EXACT CODE CHANGES (the precise new paintV2Launch innerHTML + fill() calls in src/52-v2-board.js, and the CSS deltas in public/css/v2-mechanics.css — body.bloom-v2 only) / ## HEIGHT MATH / ## EDGE CASES / ## GATING + CLASSIC SAFETY / ## FIVE-QUESTIONS CHECK. Specific enough to implement directly.',
  { label: 'judge:synthesize', phase: 'Judge' }
)

return { winner: winner, designSummaries: designs.map(function (d, i) { return LENSES[i].key + ': ' + d.slice(0, 180) }) }
