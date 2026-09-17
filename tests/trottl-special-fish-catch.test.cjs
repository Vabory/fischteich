"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8").replace(/\r/g,"");
const baseMigration=read("supabase/migrations/20260915010000_polish_trottl_special_fish_catch_pattern.sql");
const migration=read("supabase/migrations/20260915020000_tune_trottl_special_fish_catch_difficulty.sql");
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const intro=100000,start=intro+5000;
function makePattern(count=34,variant=0){return Array.from({length:count},(_,i)=>{const lateCount=6,earlyCount=count-lateCount,late=i>=earlyCount,phaseIndex=late?i-earlyCount:i,phaseCount=late?lateCount:earlyCount;const t=late?8050+Math.floor(1450*phaseIndex/(phaseCount-1)):phaseIndex<3?200+phaseIndex*50:1200+Math.floor(6700*(phaseIndex-3)/Math.max(1,phaseCount-4));return{i,t,d:Math.min(400+(i%3)*100,10000-t),s:(i*3+variant)%10,a:(i+variant)%8+1};});}
function harness(role="player",lifecycle="alive",storage=new Map(),pattern=makePattern()){
 const doc=createDocument('<body><div id="root"></div></body>'),root=doc.querySelector("#root"),timers=new Set(),calls=[],preloaded=[];
 let now=intro,fail=false;
 function Image(){Object.defineProperty(this,"src",{set:value=>preloaded.push(value)});}
 const win={document:doc,Image,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:f=>{timers.add(f);return f;},clearInterval:f=>timers.delete(f),setTimeout:f=>{f();return f;}};
 for(const f of ["trottl-special-minigames.js","trottl-special-fish-catch.js","trottl-special-debug.js"])vm.runInNewContext(read(f),{window:win,Date,Number,Math,Object,Array,Set,Map,JSON,Promise});
 const runs={u0:{score:0,hits:[],completed:false},u1:{score:0,hits:[],completed:false}};
 const snapshot={membershipRole:role,identity:{userId:"u0"},players:[{userId:"u0",lifecycle},{userId:"u1",lifecycle:"alive"}],session:{id:"s1",status:"playing",hostUserId:"u0",gameState:{phase:"minigame_active",debug_test:{},minigame:{minigame_id:"r1",minigame_type:"special_minigame_02",title:"Fischfang",title_started_at:new Date(intro).toISOString(),title_ends_at:new Date(intro+2000).toISOString(),start_at:new Date(start).toISOString(),end_at:new Date(start+10000).toISOString(),pattern_version:1,pattern_seed:123,pattern,participants:[{player_id:"u0"},{player_id:"u1"}],runs}}}};
 const service={serverNow:()=>now,saveFishCatch:async(id,round,n,hits,final)=>{calls.push({id,round,n,hits:JSON.parse(JSON.stringify(hits)),final});if(fail)throw Error("offline");Object.assign(runs.u0,{score:n,hits:JSON.parse(JSON.stringify(hits)),completed:final});return snapshot;},setDebugNext:async(id,roll,minigame)=>{calls.push({debug:true,id,roll,minigame});snapshot.session.gameState.debug_test={next_roll:roll,next_minigame:minigame};return snapshot;}};
 let c=win.TrottlSpecialFishCatch.create({root,service,onSnapshot:s=>c.update(s),onError(){}});c.update(snapshot);
 const debug=win.TrottlSpecialDebug.create({root,service,onSnapshot:s=>debug.update(s)});debug.update(snapshot);
 const clock=t=>{now=t;for(const f of [...timers])f();};
 const fish=id=>root.querySelectorAll(".trottl-special-fish").find(node=>node.dataset.spawnId===String(id));
 const tap=id=>{const target=fish(id);for(const f of target?.listeners.pointerdown??[])f({isTrusted:true,pointerType:"touch",button:0,preventDefault(){}});};
 return{win,c,debug,root,snapshot,calls,clock,fish,tap,storage,preloaded,setFail:v=>{fail=v;},recreate:()=>{c.suspend();c=win.TrottlSpecialFishCatch.create({root,service,onSnapshot:s=>c.update(s),onError(){}});c.update(snapshot);return c;}};
}

test("Fischfang keeps the shared title/countdown/START sequence and reveals ten neutral slots during countdown",()=>{
 const h=harness(),m=h.snapshot.session.gameState.minigame;
 for(const [t,label]of [[intro,"Fischfang"],[intro+2000,"3"],[intro+3000,"2"],[intro+4000,"1"],[start,"START!"]])assert.equal(h.win.TrottlSpecialMinigames.sequence(m,t).label,label);
 h.clock(intro+2000);assert.equal(h.root.querySelectorAll(".trottl-special-fish-slot").length,10);assert.equal(h.root.querySelectorAll(".trottl-special-fish-hole").length,10);assert.equal(h.root.querySelectorAll(".trottl-special-fish").length,0);
});
test("the central asset pool preloads exactly normal fish 1 through 8",()=>{
 const h=harness(),assets=Array.from(h.win.TrottlSpecialFishCatch.FISH_CATCH_ASSETS);
 assert.deepEqual(assets,Array.from({length:8},(_,i)=>`./assets/mini-games/${i+1}-fish.png`));assert.deepEqual(h.preloaded,assets);
 assert.ok(assets.every(asset=>!/blue|red|yellow|green|gold|poison|lachs/.test(asset)));
});
test("pattern validation enforces count, ids, slots, assets, lifetimes and the ten-second boundary",()=>{
 const f=harness().win.TrottlSpecialFishCatch,p=makePattern();assert.equal(f.validatePattern(p),true);
 for(const bad of [[...p.slice(1)],p.map((x,i)=>i?x:{...x,s:10}),p.map((x,i)=>i?x:{...x,a:9}),p.map((x,i)=>i?x:{...x,d:100}),p.map((x,i)=>i?x:{...x,t:9800})])assert.equal(f.validatePattern(bad),false);
 assert.equal(f.validatePattern(makePattern(26)),true);assert.equal(f.validatePattern(makePattern(33)),false);
});
test("same round pattern is shared byte-for-byte by players and a later round can carry a different plan",()=>{
 const h=harness(),m=h.snapshot.session.gameState.minigame;assert.equal(m.pattern,h.snapshot.session.gameState.minigame.pattern);assert.notDeepEqual(makePattern(34,0),makePattern(35,1));
 assert.equal(m.runs.u0.seed,undefined);assert.equal(m.runs.u1.seed,undefined);
});
test("three simultaneous fish render in separated slots and can be caught independently",()=>{
 const h=harness();h.clock(start+300);assert.equal(h.root.querySelectorAll(".trottl-special-fish").length,3);
 assert.deepEqual(h.root.querySelectorAll(".trottl-special-fish").map(f=>f.dataset.slot),["0","3","6"]);h.tap(0);h.tap(1);
 assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/2 FISCHE/);assert.ok(h.fish(2));
});
test("one spawn scores once; double pointer and compatibility click cannot score twice",()=>{
 const h=harness();h.clock(start+300);const fish=h.fish(0);h.tap(0);h.tap(0);fish.click();assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/1 FISCH ·/);assert.equal(h.calls.length,0);
});
test("empty, future and expired slots never score",()=>{
 const h=harness();h.clock(start+100);h.root.querySelector(".trottl-special-fish-hole").click();assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/0 FISCHE/);
 h.clock(start+1100);assert.equal(h.root.querySelectorAll(".trottl-special-fish").length,0);h.clock(start+1200);assert.ok(h.fish(3));
});
test("visible-spawn helper excludes hits, future fish, expired fish and the deadline",()=>{
 const f=harness().win.TrottlSpecialFishCatch,p=makePattern();assert.deepEqual(Array.from(f.getVisibleSpawns(p,new Set(),300),x=>x.i),[0,1,2]);assert.deepEqual(Array.from(f.getVisibleSpawns(p,new Set([0,2]),300),x=>x.i),[1]);assert.deepEqual(Array.from(f.getVisibleSpawns(p,new Set(),10000)),[]);
});
test("exact ten-second cutoff removes fish, locks input and sends one final aggregate",async()=>{
 const h=harness();h.clock(start+300);h.tap(0);h.tap(1);assert.equal(h.calls.length,0);h.clock(start+10000);h.tap(2);await flush();
 assert.equal(h.root.querySelectorAll(".trottl-special-fish").length,0);assert.equal(h.calls.length,1);assert.equal(h.calls[0].final,true);assert.equal(h.calls[0].n,2);
});
test("batched checkpoint and final retry remain cumulative rather than request-per-fish",async()=>{
 const h=harness();h.clock(start+300);h.tap(0);h.tap(1);assert.equal(h.calls.length,0);h.clock(start+800);await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].final,false);
 h.setFail(true);h.clock(start+10000);await flush();h.setFail(false);h.clock(start+10750);await flush();assert.equal(h.calls.at(-1).final,true);assert.equal(h.calls.at(-1).n,2);
});
test("reconnect restores uncheckpointed spawn IDs from session cache without restarting time or pattern",()=>{
 const h=harness();h.clock(start+300);h.tap(0);h.recreate();h.clock(start+350);assert.match(h.root.querySelectorAll(".trottl-special-fish-score").at(-1).textContent,/1 FISCH/);assert.equal(h.fish(0),undefined);assert.equal(h.snapshot.session.gameState.minigame.start_at,new Date(start).toISOString());
});
test("server checkpoint restoration reconstructs visible fish from the same global pattern",()=>{
 const h=harness();h.snapshot.session.gameState.minigame.runs.u0.hits=[{index:0,at:300}];h.snapshot.session.gameState.minigame.runs.u0.score=1;h.c.update(h.snapshot);h.clock(start+350);assert.equal(h.fish(0),undefined);assert.ok(h.fish(1));assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/1 FISCH · 9.7 s/);
});
test("spectator sees ten slots, host hits and current global fish but cannot catch or submit",async()=>{
 const h=harness("spectator");h.snapshot.session.gameState.minigame.runs.u0.hits=[{index:0,at:300}];h.snapshot.session.gameState.minigame.runs.u0.score=1;h.c.update(h.snapshot);h.clock(start+350);h.tap(1);await flush();assert.equal(h.root.querySelectorAll(".trottl-special-fish-slot").length,10);assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/1 FISCH/);assert.equal(h.calls.length,0);assert.equal(h.fish(1).disabled,true);
});
for(const [life,allowed]of [["critical",true],["eliminated",false],["left",false]])test(`${life} Fischfang input eligibility is ${allowed}`,()=>{const h=harness("player",life);h.clock(start+300);h.tap(0);assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,new RegExp(`${allowed?1:0} FISCH`));});
test("background time never restarts and returning after deadline submits the saved result",async()=>{const h=harness();h.clock(start+300);h.tap(0);h.win.document.visibilityState="hidden";h.clock(start+12000);assert.equal(h.calls.length,0);h.win.document.visibilityState="visible";h.clock(start+12000);await flush();assert.equal(h.calls.at(-1).final,true);assert.equal(h.calls.at(-1).n,1);});
test("missing server clock disables guessed play and submission",()=>{const h=harness();h.clock(null);assert.equal(h.root.querySelectorAll(".trottl-special-fish").length,0);assert.equal(h.calls.length,0);});
test("CSS defines a mobile 2x5 grid, persistent holes, contained assets and quick pop animations",()=>{const css=read("trottl-special.css");assert.match(css,/grid-template-columns: repeat\(5/);assert.match(css,/grid-template-rows: repeat\(2/);assert.match(css,/trottl-special-fish-hole[^}]*border-radius: 50%/);assert.match(css,/trottl-special-fish img[^}]*object-fit: contain/);assert.match(css,/fish-pop var\(--fish-catch-pop-ms, 120ms\)/);assert.match(css,/overflow: hidden/);});
test("server generator is deterministic by seed and stores one compact shared plan per round",()=>{for(const r of [/special_fish_catch_pattern\(p_seed bigint\)/,/immutable security definer/,/jsonb_build_object\('i',spawn_id,'t',start_ms,'d',duration_ms,'s',chosen_slot,'a',asset_id\)/])assert.match(migration,r);assert.match(baseMigration,/'pattern_seed',pattern_seed,'pattern',pattern/);assert.doesNotMatch(baseMigration,/jsonb_build_object\(u::text,jsonb_build_object\('seed'/);});
test("server pattern constraints enforce 34..42 spawns, ten slots, eight normal assets and max four concurrent",()=>{for(const r of [/spawn_min constant integer:=34/,/spawn_max constant integer:=42/,/slot_count constant integer:=10/,/asset_count constant integer:=8/,/max_parallel constant integer:=4/,/life_min constant integer:=400/,/life_max constant integer:=650/,/previous_start\+spacing_min/,/\+slot_cooldown>start_ms/])assert.match(migration,r);});
test("late phase guarantees six to eight randomized starts through 9.4–9.6 seconds",()=>{for(const r of [/last_start_min constant integer:=9400/,/last_start_max constant integer:=9600/,/late_count_min constant integer:=6/,/late_count_max constant integer:=8/,/late_phase_min constant integer:=8000/,/phase_end:=last_start/,/duration_ms:=round_ms-start_ms/])assert.match(migration,r);const p=makePattern(),late=p.filter(x=>x.t>=8000);assert.equal(late.length,6);assert.ok(p.at(-1).t>=9400&&p.at(-1).t<=9600);assert.ok(p.at(-1).d>=400);});
test("server validates score against pattern length and every unique hit against its active window",()=>{for(const r of [/max_score:=jsonb_array_length\(pattern\)/,/p_score>max_score/,/i=any\(seen_ids\)/,/a<\(pattern_hit->>'t'\)::integer/,/a>=\(pattern_hit->>'t'\)::integer\+\(pattern_hit->>'d'\)::integer/,/p_score<>jsonb_array_length\(p_hits\)/])assert.match(migration,r);});
test("follow-up migration is additive and private while the applied base migration remains intact",()=>{assert.ok(migration.startsWith("begin;"));assert.ok(migration.endsWith("commit;\n"));assert.match(migration,/create or replace function public\.special_fish_catch_pattern/);assert.match(migration,/revoke all on function public.special_fish_catch_pattern/);assert.match(baseMigration,/not \(game_state->'minigame' \? 'pattern'\)/);assert.match(baseMigration,/max_score not between 26 and 32/);assert.match(read("supabase/migrations/20260914010000_add_trottl_special_fish_catch_and_test_controls.sql"),/'higher_is_better'/);});
test("cache keeps Fischfang v3 while shared Special assets advance for Fisch-Memory",()=>{const html=read("index.html");assert.match(html,/trottl-special-fish-catch\.js\?v=3/);assert.match(html,/trottl-special\.css\?v=20/);for(const [file,v]of [["trottl-special-minigames.js",5],["trottl-special-number-hunt.js",2],["trottl-special-panic.js",1],["trottl-special-roulette.js",3]])assert.ok(html.includes(`${file}?v=${v}`));});
