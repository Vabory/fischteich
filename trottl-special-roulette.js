"use strict";
(function installSpecialRoulette(global) {
  // Fisch Roulette's exact 1x presentation constants; no shared mutable state/statistics.
  const DURATION = 4700, EASING = "cubic-bezier(0.12, 0.7, 0.08, 1)", REDUCED = 650;
  const colors = { RED: "ROT", BLACK: "SCHWARZ", GREEN: "GRÜN" };
  const rewards = { attack: "Spieler angreifen", heal: "Leben wiederherstellen", transfer: "3er Trottl weitergeben" };
  function timing(r, now) {
    const start = Date.parse(r?.spin_started_at);
    return Number.isFinite(now) && Number.isFinite(start) ? Math.min(DURATION, Math.max(0, now - start)) : null;
  }
  function create({ root, service, onAction, onResolve, onPresentationChange = () => {} }) {
    const doc = global.document, panel = doc.createElement("section");
    panel.className = "trottl-special-roulette"; panel.hidden = true;
    panel.setAttribute("aria-label", "Risiko-Roulette");
    panel.innerHTML = '<div class="trottl-special-roulette-group"><div class="trottl-special-roulette-window"><div class="trottl-special-roulette-marker"></div><div class="trottl-special-roulette-strip"></div><div class="trottl-special-roulette-confetti" aria-hidden="true"></div></div><p aria-live="polite"></p><div class="trottl-special-roulette-colors"></div></div><div class="trottl-special-roulette-rewards"></div>';
    root.append(panel);
    const strip = panel.querySelector(".trottl-special-roulette-strip"), choices = panel.querySelector(".trottl-special-roulette-colors"), cards = panel.querySelector(".trottl-special-roulette-rewards");
    let snapshot = null, key = null, animation = null, timer = null, lastResolve = 0;
    const group = panel.querySelector(".trottl-special-roulette-group"), particles = panel.querySelector(".trottl-special-roulette-confetti");
    let round = null, stage = null, transition = null, previousPhase = null, lastBusy = false;
    const lifeEffects = new Map(), shotEffects = new Map();let targetImpact = null, confirmedAttack = null, effectTimer = null;
    const clock = () => global.performance?.now?.() ?? Date.now();
    const reducedMotion = () => global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    function after(ms, fn) { global.clearTimeout(transition);transition = global.setTimeout(() => { transition = null;fn();if(snapshot)update(snapshot,lastBusy);onPresentationChange(); }, reducedMotion() ? 80 : ms); }
    function destination() { const r=snapshot?.session.gameState.roulette;return r?.chosen_color===r?.result_color && !r?.reward ? "rewards_visible" : "action_visible"; }
    function prepare(next) {
      const old=snapshot, g=next.session.gameState, r=g.roulette, active=next.session.status==="playing" && g.phase?.startsWith("roulette_");
      if(old?.session.id===next.session.id && (old.session.gameState.phase?.startsWith("roulette_") || active)) for(const p of next.players) {
        const before=old.players.find(x=>x.userId===p.userId);
        if(before && before.lives!==p.lives) {
          lifeEffects.set(p.userId,{kind:p.lives>before.lives?"gain":"loss",index:Math.min(before.lives,p.lives),start:null});
          const oldR=old.session.gameState.roulette;
          if(before.lifecycle==="alive" && p.lives<before.lives && oldR?.reward==="attack" && oldR.target===p.userId && !oldR.reward_done) {
            confirmedAttack={id:p.userId,sessionId:next.session.id,start:clock()};
            global.clearTimeout(effectTimer);effectTimer=global.setTimeout(()=>{effectTimer=null;confirmedAttack=null;onPresentationChange();},350);
          }
        }
      }
      snapshot=next;
      if (old?.session.id===next.session.id && r?.target && old.session.gameState.roulette?.round_id===r.round_id && old.session.gameState.roulette.target!==r.target) targetImpact={id:r.target,start:clock()};
      if(!active || !r) { global.clearTimeout(transition);transition=null;stage=null;round=null;previousPhase=null;return {stage:null,actionVisible:true}; }
      const nextRound=`${next.session.id}:${r.round_id}`;
      if(round!==nextRound) { global.clearTimeout(transition);transition=null;round=nextRound;previousPhase=null;shotEffects.clear();
        stage=g.phase==="roulette_settlement"?destination():"roulette_visible";
      } else if(g.phase==="roulette_settlement" && previousPhase!=="roulette_settlement" && stage==="roulette_visible") {
        stage="result_flash";
        after(r.chosen_color==="GREEN" && r.result_color==="GREEN"?800:400,()=>{stage="roulette_fading";after(320,()=>{stage=destination();});});
      } else if(g.phase==="roulette_settlement" && stage==="rewards_visible" && r.reward) {
        stage="rewards_fading";after(320,()=>{stage=destination();});
      } else if(g.phase==="roulette_settlement" && stage==="action_visible" && destination()==="rewards_visible") stage="rewards_visible";
      previousPhase=g.phase;
      if(stage==="action_visible") for(const id of Object.keys(r.shots??{})) if(!shotEffects.has(id)) shotEffects.set(id,old && old.session.gameState.roulette?.round_id===r.round_id?clock():-Infinity);
      return {stage,actionVisible:stage==="action_visible"};
    }
    function lifeEffect(id) { const e=lifeEffects.get(id);if(!e)return null;if(stage && stage!=="action_visible")return null;e.start??=clock();return clock()-e.start<(e.kind==="gain"?800:700)?{...e,elapsed:clock()-e.start}:null; }
    function shotImpact(id) { return clock()-(shotEffects.get(id)??-Infinity)<260; }
    function pickImpact(id) { return targetImpact?.id===id && clock()-targetImpact.start<160; }
    function attackTarget() {
      const g=snapshot?.session.gameState,r=g?.roulette,p=snapshot?.players.find(x=>x.userId===r?.target);
      if(stage==="action_visible" && g.phase==="roulette_settlement" && r?.reward==="attack" && !r.reward_done && p?.lifecycle==="alive" && p.lives>0 && p.userId!==g.actor) return {id:p.userId,fading:false};
      if(confirmedAttack?.sessionId===snapshot?.session.id && clock()-confirmedAttack.start<350) return {id:confirmedAttack.id,fading:true,elapsed:clock()-confirmedAttack.start};
      return null;
    }
    const colorButtons = {}, rewardButtons = {};
    function add(parent, map, values, action) {
      for (const [value, label] of Object.entries(values)) {
        const b = doc.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.value = value;
        b.addEventListener("click", () => { if ((action === "color" && stage === "roulette_visible") || (action === "reward" && stage === "rewards_visible")) onAction(action, value); }); parent.append(b); map[value] = b;
      }
    }
    add(choices, colorButtons, colors, "color"); add(cards, rewardButtons, rewards, "reward");
    function cancelAnimation() { animation?.cancel(); animation = null; }
    function tick() {
      const g = snapshot?.session.gameState, r = g?.roulette;
      if (!r || !g.phase?.startsWith("roulette_")) return;
      const elapsed = timing(r, service.serverNow());
      const done = g.phase === "roulette_settlement" || elapsed === DURATION;
      panel.querySelector("p").textContent = !r.chosen_color ? "Farbe wählen" : elapsed === null && !done ? "Zeit wird synchronisiert …" : !done ? "Roulette dreht …" : `${colors[r.result_color]} · ${r.chosen_color === r.result_color ? "Gewonnen!" : "1 Shot"}`;
      if (!r.chosen_color) return;
      const reduced = global.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (done || reduced) {
        cancelAnimation(); strip.style.transform = `translateX(${r.end_offset}px)`;
      } else if (elapsed !== null && strip.animate) {
        if (!animation) {
          animation = strip.animate([{ transform: `translateX(${r.start_offset}px)` }, { transform: `translateX(${r.end_offset}px)` }], { duration: DURATION, easing: EASING, fill: "both" });
        }
        // Seek the ORIGINAL curve, never restart an easing curve on reconnect.
        animation.currentTime = elapsed;
      }
      // Reduced motion shows the stable result without moving the strip; server time is unchanged.
      if (g.phase === "roulette_spinning" && done && clock() - lastResolve > REDUCED) {
        lastResolve = clock(); onResolve();
      }
    }
    function update(next, busy = false) {
      lastBusy = busy;
      prepare(next);
      const g = next.session.gameState, r = g.roulette;
      panel.hidden = !stage || stage === "action_visible";
      if (!stage) { global.clearInterval(timer);timer=null;cancelAnimation();key=null;return; }
      // Keep target seats readable: after selecting a reward the finished strip folds away.
      // Result, color selection and all three reward cards remain public; no table geometry changes.
      panel.classList.toggle("has-reward-selection", g.phase === "roulette_settlement" && Boolean(r.reward));
      panel.dataset.stage=stage;
      group.hidden=!["roulette_visible","result_flash","roulette_fading"].includes(stage);
      group.classList.toggle("is-fading",stage==="roulette_fading");
      const own = next.players.find(p => p.userId === next.identity.userId);
      const actor = next.membershipRole === "player" && own?.lifecycle === "alive" && g.actor === own.userId;
      const nextKey = `${next.session.id}:${r.round_id}:${r.spin_id ?? "choice"}`;
      if (key !== nextKey) {
        key = nextKey; cancelAnimation(); lastResolve = -Infinity;
        strip.replaceChildren(...Array.from({ length: 50 }, (_, i) => {
          const tile = doc.createElement("span"); tile.className = "trottl-special-roulette-tile";
          const color = i === r.target_index ? r.result_color : i % 10 === 9 ? "GREEN" : i % 2 ? "BLACK" : "RED";
          tile.dataset.color = color; tile.setAttribute("aria-label",colors[color]); return tile;
        }));
        strip.style.transform = `translateX(${r.start_offset ?? -201}px)`;
      }
      const hit=stage==="result_flash", jackpot=hit && r.chosen_color==="GREEN" && r.result_color==="GREEN";
      for(const [i,tile] of [...strip.children].entries()) { tile.classList.toggle("is-hit",hit && i===r.target_index);tile.classList.toggle("is-jackpot",jackpot && i===r.target_index); }
      particles.hidden=!jackpot;
      if(jackpot && !particles.children.length) for(let i=0;i<12;i++){const p=doc.createElement("i");p.style.setProperty("--particle-x",`${(i-5.5)*11}px`);p.style.setProperty("--particle-y",`${-18-(i%4)*9}px`);particles.append(p);}
      if(!hit) particles.replaceChildren();
      for (const [value, b] of Object.entries(colorButtons)) {
        b.disabled = busy || !actor || g.phase !== "roulette_choose_color";
        b.classList.toggle("is-selected", r.chosen_color === value); b.classList.toggle("is-dimmed", Boolean(r.chosen_color) && r.chosen_color !== value);
        b.setAttribute("aria-pressed", String(r.chosen_color === value));
        b.classList.toggle("is-hit",hit && r.result_color===value);
      }
      cards.hidden = !["rewards_visible","rewards_fading"].includes(stage);
      cards.classList.toggle("is-fading",stage==="rewards_fading");
      for (const [value, b] of Object.entries(rewardButtons)) {
        b.disabled = busy || !actor || stage!=="rewards_visible" || r.reward_done || Boolean(r.reward) || !r.available?.[value];
        b.classList.toggle("is-selected", r.reward === value); b.setAttribute("aria-pressed", String(r.reward === value));
      }
      if (timer === null) timer = global.setInterval(tick, 100);
      tick();
    }
    function suspend() { global.clearInterval(timer); timer = null;cancelAnimation();global.clearTimeout(transition);global.clearTimeout(effectTimer);effectTimer=null;confirmedAttack=null;transition=null;round=null;stage=null;previousPhase=null;snapshot=null;lifeEffects.clear();shotEffects.clear();targetImpact=null; }
    return Object.freeze({ update, suspend, prepare, lifeEffect, shotImpact, pickImpact, attackTarget });
  }
  global.TrottlSpecialRoulette = Object.freeze({ create, timing, DURATION, EASING });
})(window);
