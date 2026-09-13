"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8").replace(/\r/g,"");
const sql=read("supabase/migrations/20260913050000_add_trottl_special_panic_game.sql");
const start=Date.parse("2026-09-13T12:00:03Z");
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(role="player",lifecycle="alive") {
 const doc=createDocument('<body><div id="root"></div></body>'),root=doc.querySelector("#root"),timers=new Set(),submits=[],resolves=[],updates=[];
 let now=start-3000;
 const win={document:doc,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
 vm.runInNewContext(read("trottl-special-panic.js"),{window:win,Date,Promise,Math});
 const snapshot={session:{id:"special-1",gameState:{phase:"panic_active",minigame:{minigame_id:"panic-1",start_at:new Date(start).toISOString(),
  end_at:new Date(start+10000).toISOString(),submit_until:new Date(start+14000).toISOString(),participants:[{player_id:"u0"}]}}},identity:{userId:"u0"},membershipRole:role,players:[{userId:"u0",lifecycle}]};
 const service={serverNow:()=>now,submitPanic:async(...args)=>{submits.push(args);return snapshot;}};
 const controller=win.TrottlSpecialPanic.create({root,service,onSnapshot:s=>updates.push(s),onResolve:async()=>resolves.push(now)});
 const area=root.querySelector(".trottl-special-panic-area"),glow=root.querySelector(".trottl-special-panic-glow");
 function tap(event={}) {for(const fn of area.listeners.pointerdown??[])fn({isTrusted:true,pointerType:"touch",button:0,preventDefault(){},...event});}
 function clock(value) {now=value;for(const fn of [...timers])fn();}
 controller.update(snapshot);
 return {doc,root,area,glow,controller,snapshot,submits,resolves,updates,timers,tap,clock,getWindow:win.TrottlSpecialPanic.getWindow};
}
test("panic countdown and exactly ten seconds derive from absolute server timestamps",()=>{
 const h=harness(),r=h.snapshot.session.gameState.minigame;
 for(const [now,phase] of [[start-1,"countdown"],[start,"active"],[start+9999,"active"],[start+10000,"ended"]])assert.equal(h.getWindow(r,now).phase,phase);
 assert.equal(h.getWindow(r,null).phase,"sync");assert.equal(h.getWindow({...r,end_at:new Date(start+12000).toISOString()},start).phase,"sync");
});
test("pointer taps update only counter, never submit per tap; deadlines stop count and glow",async()=>{
 const h=harness();h.tap();assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,"0 TAPS");
 h.clock(start);for(let i=0;i<37;i++)h.tap();
 assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,"37 TAPS");assert.equal(h.submits.length,0);assert.equal(h.glow.hidden,false);
 h.clock(start+10000);h.tap();await flush();assert.equal(h.glow.hidden,true);assert.equal(h.submits.length,1);assert.equal(h.submits[0][2],37);
 h.clock(start+10500);await flush();assert.equal(h.submits.length,1);
});
for(const [role,lifecycle,allowed]of [["player","alive",true],["player","critical",true],["player","eliminated",false],["spectator","alive",false]])
 test(`panic participation ${role}/${lifecycle}`,()=>{
  const h=harness(role,lifecycle);h.clock(start);h.tap();assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,allowed?"1 TAPS":"0 TAPS");
  assert.equal(h.glow.hidden,false);
 });
test("hidden/background resumes only remaining time, retains memory count and never restarts the window",async()=>{
 const h=harness();h.clock(start);h.tap();h.doc.visibilityState="hidden";h.clock(start+1000);h.tap();assert.equal(h.timers.size,0);
 h.clock(start+8500);h.doc.visibilityState="visible";h.controller.update(h.snapshot);
 assert.equal(h.area.querySelector(".trottl-special-panic-time").textContent,"1.5 s");h.tap();
 h.clock(start+10000);await flush();assert.equal(h.submits[0][2],2);
});
test("resume after grace counts no late tap, submits no expired count and requests authoritative finalization",async()=>{
 const h=harness();h.clock(start);h.tap();h.controller.suspend();h.clock(start+15000);h.controller.update(h.snapshot);h.tap();await flush();
 assert.equal(h.submits.length,0);assert.ok(h.resolves.length>0);assert.equal(h.glow.hidden,true);
});
test("synthetic, non-primary mouse input rejected and integer count bounded",()=>{
 const h=harness();h.clock(start);h.tap({isTrusted:false});h.tap({pointerType:"mouse",button:2});assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,"0 TAPS");
 for(let i=0;i<500;i++)h.tap();assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,"400 TAPS");
});
test("round changes reset local state; non-active phase removes interactive overlay",()=>{
 const h=harness();h.clock(start);h.tap();h.snapshot.session.gameState.minigame.minigame_id="panic-2";h.controller.update(h.snapshot);
 assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,"0 TAPS");h.snapshot.session.gameState.phase="panic_results";h.controller.update(h.snapshot);
 assert.equal(h.area.hidden,true);assert.equal(h.glow.hidden,true);assert.equal(h.timers.size,0);
});
test("reconnect recovers an accepted own receipt and does not resubmit a different count",async()=>{
 const h=harness();h.controller.suspend();h.snapshot.panicSubmittedCount=37;h.clock(start+11000);h.controller.update(h.snapshot);await flush();
 assert.equal(h.area.querySelector(".trottl-special-panic-count").textContent,"37 TAPS");assert.equal(h.submits.length,0);assert.ok(h.resolves.length>0);
});
test("SQL: only resolved regular five enters panic; rescue, four and six retain prior delegation",()=>{
 assert.match(sql,/g->>'phase'='rolling' and \(g->>'result'\)::integer=5 and not coalesce\(\(g->>'rescue'\)::boolean,false\)/);
 assert.match(sql,/perform public.act_trottl_special_phase_two/);assert.match(sql,/if g->>'phase'='placeholder' then perform public.special_panic_begin_locked/);
 assert.match(sql,/interval '3 seconds'/);assert.match(sql,/v_start\+interval '10 seconds'/);assert.match(sql,/v_start\+interval '14 seconds'/);
});
test("SQL: submissions private, final only, correct round/member/count/time, duplicate protected",()=>{
 assert.match(sql,/enable row level security/);assert.match(sql,/using\(user_id=auth.uid\(\)/);assert.doesNotMatch(sql,/alter publication/);
 assert.match(sql,/primary key\(session_id,round_id,user_id\)/);assert.match(sql,/p_tap_count not between 0 and 400/);
 assert.match(sql,/is distinct from p_round_id/);assert.match(sql,/clock_timestamp\(\)<\(m->>'end_at'\)/);assert.match(sql,/clock_timestamp\(\)>\(m->>'submit_until'\)/);
 assert.match(sql,/SPECIAL_PANIC_ALREADY_SUBMITTED/);assert.match(sql,/user_id=auth.uid\(\) and lifecycle_status in \('alive','critical'\)/);
});
test("SQL: missing count zero, shared ranking handles ties/draw, each eligible loser uses central atomic engine",()=>{
 assert.match(sql,/coalesce\(t.tap_count,0\)/);assert.match(sql,/special_minigame_rank\(inputs,'higher_is_better'\)/);
 assert.match(sql,/for v_loser in select value::uuid from jsonb_array_elements_text\(ranked->'losers'\)/);
 assert.match(sql,/lifecycle_status='alive' and lives>0[\s\S]*special_lose_life_locked\(p_id,v_loser\)/);
 assert.doesNotMatch(sql,/set lives=|lives=lives-/);assert.match(sql,/pg_advisory_xact_lock\(337734/);assert.match(sql,/for update/);
 assert.match(sql,/Re-read after the central engine/);assert.doesNotMatch(sql,/special_minigame_settle_locked/);
});
test("SQL: leave removes snapshot, <2 draws; results ACK excludes eliminated and spectators",()=>{
 assert.match(sql,/p->>'player_id'<>auth.uid\(\)::text/);assert.match(sql,/jsonb_array_length\(participants\)<2/);
 assert.match(sql,/SPECIAL_INVALID_PANIC_ACK/);assert.match(sql,/p.lifecycle_status in \('alive','critical'\)[\s\S]*m->'result_seen'/);
 assert.doesNotMatch(sql,/public\.trottl_classic|roulette|winner_animation/);
});
test("CSS and wiring: fixed non-interactive reduced-motion glow and overlay-only input, versioned load",()=>{
 const css=read("trottl-special.css"),html=read("index.html");
 assert.match(css,/panic-glow \{ position: fixed;[\s\S]*pointer-events: none/);assert.match(css,/@media \(prefers-reduced-motion: reduce\)[^}]*panic-glow/);
 assert.match(css,/panic-area.is-tapping \{ pointer-events: auto; touch-action: none/);assert.match(html,/trottl-special-panic\.js\?v=1/);
});
