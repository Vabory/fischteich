"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8").replace(/\r/g,"");
const sql=read("supabase/migrations/20260913070000_add_trottl_special_number_hunt.sql");
const intro=100000,start=intro+5000;
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function harness(role="player") {
 const doc=createDocument('<body><div id="root"></div></body>'),root=doc.querySelector("#root"),timers=new Set(),calls=[],updates=[];
 let now=intro,fail=false,hold=false,release,uid=0;
 const win={document:doc,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uid).padStart(12,"0")}`},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
 for(const f of ["trottl-special-minigames.js","trottl-special-number-hunt.js"])vm.runInNewContext(read(f),{window:win,Date,Number,Math,Object,Array,Map,JSON,Promise});
 const snapshot={session:{id:"s1",status:"playing",hostUserId:"u1",gameState:{phase:"minigame_active",minigame:{minigame_id:"r1",minigame_type:"special_minigame_01",title:"Zahlenjagd",
  title_started_at:new Date(intro).toISOString(),title_ends_at:new Date(intro+2000).toISOString(),start_at:new Date(start).toISOString(),participants:[{player_id:"u0"},{player_id:"u1"}],
  runs:{u0:{board:[9,8,7,6,5,4,3,2,1],progress:0,completed:false},u1:{board:[1,2,3,4,5,6,7,8,9],progress:4,completed:false}}}}},
  membershipRole:role,identity:{userId:"u0"},players:[{userId:"u0",lifecycle:"alive"},{userId:"u1",lifecycle:"alive"}]};
 const service={serverNow:()=>now,tapNumberHunt:async(id,round,n,elapsed,inputId,inputSeq)=>{
  calls.push({id,round,n,elapsed,inputId,inputSeq});if(hold)await new Promise(r=>{release=r;});if(fail)throw Error("offline");
  const r=snapshot.session.gameState.minigame.runs.u0;
  if(r.last_input_id!==inputId){r.input_seq=Number(r.input_seq??0)+1;r.last_input_id=inputId;
   const correct=n===r.progress+1;r.progress=correct?n:0;if(!correct){r.error_serial=r.input_seq;r.error_at=new Date(now).toISOString();}
   if(correct&&n===9){r.completed=true;r.elapsed_ms=elapsed;}}
  return snapshot;
 }};
 const c=win.TrottlSpecialNumberHunt.create({root,service,onSnapshot:s=>{updates.push(s);c.update(s);},onError(){}});c.update(snapshot);
 function clock(t){now=t;for(const fn of [...timers])fn();}
 function tap(n){const b=root.querySelector(".trottl-special-number-hunt-board").children.find(x=>x.dataset.number===String(n));for(const fn of b.listeners.pointerdown??[])fn({isTrusted:true,pointerType:"touch",button:0,preventDefault(){}});}
 return {c,root,snapshot,calls,updates,clock,tap,sequence:win.TrottlSpecialMinigames.sequence,registry:win.TrottlSpecialMinigames.registry,
  setFail:v=>{fail=v;},setHold:v=>{hold=v;},release:()=>release?.()};
}
test("fixed registry has ten stable IDs with the first four minigames playable",()=>{
 const h=harness();assert.equal(h.registry.length,10);assert.deepEqual(Array.from(h.registry.filter(r=>r.active),r=>r.id),["special_minigame_01","special_minigame_02","special_minigame_03","special_minigame_04"]);
 assert.ok(h.registry.slice(4).every(r=>r.title===null && !r.implemented));
});
test("title fades, then exact 3/2/1/START sequence; active timing cannot start early",()=>{
 const h=harness(),m=h.snapshot.session.gameState.minigame;
 for(const [t,phase,label] of [[intro,"title","Zahlenjagd"],[intro+2000,"countdown","3"],[intro+3000,"countdown","2"],[intro+4000,"countdown","1"],[start,"active","START!"],[start+400,"active",""]]) {
  const s=h.sequence(m,t);assert.equal(s.phase,phase);assert.equal(s.label,label);
 }
 assert.equal(h.sequence(m,intro+1600).opacity,.5);h.tap(1);assert.equal(h.calls.length,0);
 h.clock(start-1);h.tap(1);assert.equal(h.calls.length,0);h.clock(start);h.tap(1);assert.equal(h.calls.length,1);
});
test("wrong tap resets; ordered 1..9 queues serial intents and freezes exact last-tap measurement",async()=>{
 const h=harness();h.clock(start);h.tap(4);assert.equal(h.calls.length,1);
 for(let n=1;n<=9;n++){h.clock(start+n*100);h.tap(n);}h.clock(start+5000);await flush();
 assert.deepEqual(h.calls.map(c=>c.n),[4,1,2,3,4,5,6,7,8,9]);assert.equal(h.calls.at(-1).elapsed,900);
 assert.ok(h.calls.slice(0,9).every(c=>c.elapsed===null));assert.match(h.root.querySelector(".trottl-special-number-hunt-progress").textContent,/9 \/ 9 · 0.900 s/);
 assert.match(h.root.querySelector(".trottl-special-minigame-copy").textContent,/warte auf die anderen/);
 assert.ok(h.root.querySelector(".trottl-special-minigame-shell").classList.contains("is-waiting"));
 assert.equal(h.root.querySelector(".trottl-special-number-hunt-board").hidden,true);
 h.tap(9);assert.equal(h.calls.length,10);
});
test("spectator sees current host board/progress/completion, never own controls",async()=>{
 const h=harness("spectator");h.clock(start);h.tap(5);await flush();assert.equal(h.calls.length,0);
 const b=h.root.querySelector(".trottl-special-number-hunt-board").children;assert.deepEqual(b.map(x=>x.textContent),["1","2","3","4","5","6","7","8","9"]);
 assert.ok(b.every(x=>x.disabled));assert.match(h.root.querySelector(".trottl-special-number-hunt-progress").textContent,/4 \/ 9/);
 h.snapshot.session.gameState.minigame.runs.u1={...h.snapshot.session.gameState.minigame.runs.u1,progress:9,completed:true,elapsed_ms:1234};h.c.update(h.snapshot);
 assert.match(h.root.querySelector(".trottl-special-minigame-copy").textContent,/Host fertig/);
});
test("reconnect restores same board and progress, continues absolute timer without reset",async()=>{
 const h=harness();h.clock(start+1000);h.snapshot.session.gameState.minigame.runs.u0.progress=6;h.c.suspend();h.clock(start+10000);h.c.update(h.snapshot);
 assert.match(h.root.querySelector(".trottl-special-number-hunt-progress").textContent,/6 \/ 9 · 10.000 s/);
 h.tap(7);await flush();assert.equal(h.calls[0].n,7);assert.equal(h.snapshot.session.gameState.minigame.minigame_id,"r1");
});
test("offline retry keeps pending sequence and final measurement, with no round restart or timeout",async()=>{
 const h=harness();h.clock(start+100);h.setFail(true);h.tap(1);await flush();assert.equal(h.calls.length,1);
 h.clock(start+200);assert.equal(h.calls.length,1);h.setFail(false);h.clock(start+1000);await flush();
 assert.deepEqual(h.calls.map(c=>c.n),[1,1]);assert.equal(h.snapshot.session.gameState.minigame.runs.u0.progress,1);
});
test("missing clock and eliminated participant cannot play; late result hides shell",()=>{
 const h=harness();h.clock(null);h.tap(1);assert.equal(h.calls.length,0);h.snapshot.players[0].lifecycle="eliminated";h.clock(start);h.tap(1);assert.equal(h.calls.length,0);
 h.snapshot.session.gameState.phase="minigame_results";h.c.update(h.snapshot);assert.equal(h.root.querySelector(".trottl-special-minigame-shell").hidden,true);
});
test("round changes discard old queues and responses",async()=>{
 const h=harness();h.clock(start);h.setHold(true);h.tap(1);h.snapshot.session.gameState.minigame.minigame_id="r2";h.c.update(h.snapshot);h.release();await flush();
 assert.equal(h.updates.length,0);
});
test("SQL: normal four only, fixed game01, previous gateway preserved and no public arbitrary game start",()=>{
 assert.match(sql,/g->>'phase'='rolling' and \(g->>'result'\)::integer=4 and not coalesce\(\(g->>'rescue'\)::boolean,false\)/);
 assert.match(sql,/special_minigame_begin_locked\(p_id,'special_minigame_01','lower_is_better'\)/);assert.match(sql,/perform public.act_trottl_special_phase_four/);
 assert.match(sql,/interval '2 seconds'/);assert.match(sql,/interval '5 seconds'/);assert.doesNotMatch(sql,/special_minigame_pick_slot\(/);
});
test("SQL: stored per-player shuffle/progress, strict own round/start/order, bounded measured time and all-finished gate",()=>{
 for(const s of ["pg_advisory_xact_lock(337734","for update","is distinct from p_round_id","SPECIAL_INVALID_NUMBER_HUNT_TAP","SPECIAL_NUMBER_HUNT_NOT_STARTED","SPECIAL_INVALID_NUMBER_HUNT_TIME","p_number<>v_progress+1","jsonb_agg(n order by pg_catalog.random())"])assert.ok(sql.includes(s));
 assert.match(sql,/if exists\(select 1[\s\S]*completed[\s\S]*then return/);assert.match(sql,/special_minigame_finalize_locked\(p_id/);
});
test("SQL: all-tied drink results award everyone two drinks, reuse aggregation/ACK, PANIK rank unchanged",()=>{
 assert.match(sql,/special_minigame_finalize_original_locked/);assert.match(sql,/'all_tied',true/);assert.match(sql,/'is_winner',true,'is_loser',false/);
 assert.match(sql,/'automatic_drinks','\{\}'::jsonb,'distributions'/);assert.match(sql,/'confirmed',false,'cancelled',false/);
 assert.doesNotMatch(sql,/create or replace function public.special_minigame_rank\(/);assert.doesNotMatch(sql,/special_panic|special_roulette|set lives=/);
});
test("no layout math, timeout, persistence or global statistics; shell and controls mobile-scoped",()=>{
 for(const f of ["trottl-special-minigames.js","trottl-special-number-hunt.js"])assert.doesNotMatch(read(f),/localStorage|supabase|Math.random|SeatPreset|background|roulette_stats/);
 assert.doesNotMatch(sql,/submit_until|timeout|deadline.*interval/);
 assert.match(read("trottl-special.css"),/\.trottl-special-minigame-shell \{ position: absolute/);
 assert.match(read("trottl-special.css"),/min-height: 48px/);assert.match(read("index.html"),/trottl-special-number-hunt.js\?v=2/);
});
test("SQL structure and dedicated PostgreSQL fixture cover actual ranking, order, completion and drink ACKs",()=>{
 assert.ok(sql.startsWith("begin;"));assert.ok(sql.trim().endsWith("commit;"));assert.equal((sql.match(/\$\$/g)||[]).length,14);
 const fixture=read("tests/fixtures/trottl-special-number-hunt.sql");assert.ok(fixture.trim().endsWith("rollback;"));
 for(const text of ["Drink ranking tie regression","Productive four must start Zahlenjagd","Wrong tap advanced","Result before all finished","All equal must be winners without losers","Winner drink aggregation","Leave obligation stalled","SPECIAL_INVALID_NUMBER_HUNT_TAP"])assert.ok(fixture.includes(text));
});
test("wrong number resets persisted progress and marks back to zero without board/start/round changes",async()=>{
 const h=harness();h.clock(start+1000);for(const n of [1,2,3]){h.tap(n);await flush();}
 const r=h.snapshot.session.gameState.minigame.runs.u0,board=[...r.board],stamp=h.snapshot.session.gameState.minigame.start_at;
 assert.equal(r.progress,3);h.tap(7);await flush();assert.equal(r.progress,0);
 assert.deepEqual(r.board,board);assert.equal(h.snapshot.session.gameState.minigame.start_at,stamp);assert.equal(h.snapshot.session.gameState.minigame.minigame_id,"r1");
 assert.ok(h.root.querySelector(".trottl-special-number-hunt-board").classList.contains("is-error-flash"));
 assert.ok(h.root.querySelector(".trottl-special-number-hunt-board").children.every(b=>!b.classList.contains("is-done")));
 h.clock(start+2000);h.c.suspend();h.c.update(h.snapshot);assert.match(h.root.querySelector(".trottl-special-number-hunt-progress").textContent,/0 \/ 9 · 2.000 s/);
 h.tap(1);await flush();assert.equal(r.progress,1);
});
test("already completed digit is also a wrong input; repeated error restarts flash",async()=>{
 const h=harness();h.clock(start+1000);h.tap(1);await flush();h.tap(1);await flush();assert.equal(h.snapshot.session.gameState.minigame.runs.u0.progress,0);
 h.clock(start+1400);assert.equal(h.root.querySelector(".trottl-special-number-hunt-board").classList.contains("is-error-flash"),false);
 h.tap(7);await flush();assert.equal(h.root.querySelector(".trottl-special-number-hunt-board").classList.contains("is-error-flash"),true);
});
test("host reset propagates into readonly spectator board without changing its layout",()=>{
 const h=harness("spectator");h.clock(start+1000);const r=h.snapshot.session.gameState.minigame.runs.u1;
 r.progress=0;r.error_serial=5;r.error_at=new Date(start+1000).toISOString();h.c.update(h.snapshot);
 assert.match(h.root.querySelector(".trottl-special-number-hunt-progress").textContent,/0 \/ 9/);
 assert.ok(h.root.querySelector(".trottl-special-number-hunt-board").classList.contains("is-error-flash"));
});
test("network retries reuse input identity/version; pending wrong/correct taps remain ordered across reset",async()=>{
 const h=harness();h.clock(start+1000);h.setFail(true);h.tap(1);await flush();h.tap(7);h.tap(1);h.setFail(false);h.clock(start+2000);await flush();
 assert.deepEqual(h.calls.map(c=>c.n),[1,1,7,1]);assert.equal(h.calls[0].inputId,h.calls[1].inputId);
 assert.deepEqual(h.calls.map(c=>c.inputSeq),[0,0,1,2]);assert.equal(h.snapshot.session.gameState.minigame.runs.u0.progress,1);
});
test("follow-up SQL resets only progress, keeps guards, idempotent UUID/version and unchanged clock/ranking",()=>{
 const s=read("supabase/migrations/20260913080000_polish_trottl_special_number_hunt_inputs.sql");
 for(const x of ["p_input_seq<>v_seq","r->>'last_input_id'=p_input_id::text","'progress',0,'error_at'","is distinct from p_round_id","pg_advisory_xact_lock(337734"])assert.ok(s.includes(x));
 assert.doesNotMatch(s,/jsonb_agg|set lives=|start_at',|gen_random_uuid|special_minigame_rank/);
});
