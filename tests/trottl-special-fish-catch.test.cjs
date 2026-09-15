"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8").replace(/\r/g,"");
const sql=read("supabase/migrations/20260914010000_add_trottl_special_fish_catch_and_test_controls.sql");
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const intro=100000,start=intro+5000;
function harness(role="player",lifecycle="alive",storage=new Map()) {
 const doc=createDocument('<body><div id="root"></div></body>'),root=doc.querySelector("#root"),timers=new Set(),calls=[];
 let now=intro,fail=false;
 const win={document:doc,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:f=>{timers.add(f);return f;},clearInterval:f=>timers.delete(f)};
 for(const f of ["trottl-special-minigames.js","trottl-special-fish-catch.js","trottl-special-debug.js"])vm.runInNewContext(read(f),{window:win,Date,Number,Math,Object,Array,Map,JSON,Promise});
 const snapshot={membershipRole:role,identity:{userId:"u0"},players:[{userId:"u0",lifecycle},{userId:"u1",lifecycle:"alive"}],session:{id:"s1",status:"playing",hostUserId:"u0",gameState:{phase:"minigame_active",debug_test:{},minigame:{minigame_id:"r1",minigame_type:"special_minigame_02",title:"Fischfang",title_started_at:new Date(intro).toISOString(),title_ends_at:new Date(intro+2000).toISOString(),start_at:new Date(start).toISOString(),end_at:new Date(start+10000).toISOString(),participants:[{player_id:"u0"},{player_id:"u1"}],runs:{u0:{seed:123456,score:0,hits:[],completed:false},u1:{seed:42,score:0,hits:[],completed:false}}}}}};
 const service={serverNow:()=>now,saveFishCatch:async(id,round,n,hits,final)=>{calls.push({id,round,n,hits,final});if(fail)throw Error("offline");Object.assign(snapshot.session.gameState.minigame.runs.u0,{score:n,hits:JSON.parse(JSON.stringify(hits)),completed:final});return snapshot;},setDebugNext:async(id,roll,minigame)=>{calls.push({debug:true,id,roll,minigame});snapshot.session.gameState.debug_test={next_roll:roll,next_minigame:minigame};return snapshot;}};
 let c=win.TrottlSpecialFishCatch.create({root,service,onSnapshot:s=>c.update(s),onError(){}});c.update(snapshot);
 const debug=win.TrottlSpecialDebug.create({root,service,onSnapshot:s=>debug.update(s)});debug.update(snapshot);
 const clock=t=>{now=t;for(const f of [...timers])f();};
 const tap=()=>{const fish=root.querySelector(".trottl-special-fish");for(const f of fish.listeners.pointerdown??[])f({isTrusted:true,pointerType:"touch",preventDefault(){}});};
 return {win,c,debug,root,snapshot,calls,clock,tap,storage,setFail:v=>{fail=v;},recreate:()=>{c.suspend();c=win.TrottlSpecialFishCatch.create({root,service,onSnapshot:s=>c.update(s),onError(){}});c.update(snapshot);return c;}};
}
test("Fischfang uses shared title/countdown/START shell and only two implemented slots",()=>{
 const h=harness(),m=h.snapshot.session.gameState.minigame;
 for(const [t,label]of [[intro,"Fischfang"],[intro+2000,"3"],[intro+3000,"2"],[intro+4000,"1"],[start,"START!"]])assert.equal(h.win.TrottlSpecialMinigames.sequence(m,t).label,label);
 h.tap();assert.equal(h.calls.length,0);h.clock(start-1);h.tap();assert.equal(h.calls.length,0);
 assert.deepEqual(Array.from(h.win.TrottlSpecialMinigames.registry.filter(r=>r.active&&r.implemented),r=>r.id),["special_minigame_01","special_minigame_02"]);
});
test("direct catch gives one point immediately; double pointer and compatibility click cannot count twice",()=>{
 const h=harness();h.clock(start);h.tap();h.tap();h.root.querySelector(".trottl-special-fish").click();
 assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/1 FISCHE/);
 assert.equal(h.root.querySelector(".trottl-special-fish").hidden,true);assert.equal(h.calls.length,0);
});
test("field/outside taps give no points; missed fish expires, deterministic next spawn appears",()=>{
 const h=harness();h.clock(start);h.root.querySelector(".trottl-special-fish-field").click();assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/0 FISCHE/);
 h.clock(start+650);assert.equal(h.root.querySelector(".trottl-special-fish").hidden,true);
 h.clock(start+1000);assert.equal(h.root.querySelector(".trottl-special-fish").hidden,false);assert.equal(h.root.querySelector(".trottl-special-fish").dataset.index,"1");
});
test("caught fish advances after seeded short pause, always one fish, and bounds include full size",()=>{
 const h=harness();h.clock(start);const fish=h.root.querySelector(".trottl-special-fish");h.tap();h.clock(start+150);assert.equal(fish.hidden,true);
 h.clock(start+281);assert.equal(fish.hidden,false);assert.equal(fish.dataset.index,"1");assert.equal(h.root.querySelectorAll(".trottl-special-fish").length,1);
 assert.equal(fish.style.width,"72px");assert.ok(parseFloat(fish.style.left)>=0&&parseFloat(fish.style.left)<=390-72);assert.ok(parseFloat(fish.style.top)>=0&&parseFloat(fish.style.top)<=844-72);
});
test("exact 10s cutoff locks inputs and sends one final score, not a request per tap",async()=>{
 const h=harness();h.clock(start);h.tap();h.clock(start+281);h.tap();assert.equal(h.calls.length,0);
 h.clock(start+10000);h.tap();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].final,true);assert.equal(h.calls[0].n,2);
 h.clock(start+20000);await flush();assert.equal(h.calls.length,1);assert.equal(h.snapshot.session.gameState.minigame.runs.u0.completed,true);
});
test("live cumulative checkpoint is batched, final score survives network retry",async()=>{
 const h=harness();h.clock(start);h.tap();h.clock(start+500);await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].final,false);
 h.setFail(true);h.clock(start+10000);await flush();h.setFail(false);h.clock(start+10750);await flush();assert.equal(h.calls.at(-1).final,true);assert.equal(h.calls.at(-1).n,1);
 assert.equal(h.snapshot.session.gameState.minigame.runs.u0.completed,true);
});
test("reconnect restores uncheckpointed catches from session cache without reroll or new clock",()=>{
 const h=harness();h.clock(start);h.tap();h.recreate();h.clock(start+281);
 const scores=h.root.querySelectorAll(".trottl-special-fish-score");assert.match(scores.at(-1).textContent,/1 FISCHE/);
 assert.equal(h.root.querySelectorAll(".trottl-special-fish").at(-1).dataset.index,"1");assert.equal(h.snapshot.session.gameState.minigame.start_at,new Date(start).toISOString());
});
test("reconnect from accepted server hits reconstructs exact same seed spawn and remaining time",()=>{
 const h=harness();h.snapshot.session.gameState.minigame.runs.u0.hits=[{at:0,index:0}];h.snapshot.session.gameState.minigame.runs.u0.score=1;h.c.update(h.snapshot);h.clock(start+281);
 const a=h.win.TrottlSpecialFishCatch.spawn(123456,[{index:0,at:0}],281),b=h.win.TrottlSpecialFishCatch.spawn(123456,[{at:0,index:0}],281);assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
 assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/1 FISCHE · 9.7 s/);
});
test("spectator uses host seed/catches/score, cannot catch or submit, and sees host waiting state",async()=>{
 const h=harness("spectator");h.snapshot.session.gameState.minigame.runs.u0.hits=[{index:0,at:0}];h.snapshot.session.gameState.minigame.runs.u0.score=1;h.c.update(h.snapshot);h.clock(start+281);h.tap();await flush();
 assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/1 FISCHE/);assert.equal(h.root.querySelector(".trottl-special-fish").dataset.index,"1");assert.equal(h.calls.length,0);
 h.snapshot.session.gameState.minigame.runs.u0.completed=true;h.c.update(h.snapshot);assert.equal(h.root.querySelector(".trottl-special-minigame-shell").classList.contains("is-waiting"),true);
});
for(const [life,allowed]of [["critical",true],["eliminated",false],["left",false]])test(`${life} fish eligibility is ${allowed}`,()=>{
 const h=harness("player",life);h.clock(start);h.tap();assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,new RegExp(`${allowed?1:0} FISCHE`));
});
test("hidden/background time does not restart; return after deadline submits saved result",async()=>{
 const h=harness();h.clock(start);h.tap();h.win.document.visibilityState="hidden";h.clock(start+12000);assert.equal(h.calls.length,0);
 h.win.document.visibilityState="visible";h.clock(start+12000);await flush();assert.equal(h.calls.at(-1).final,true);assert.equal(h.calls.at(-1).n,1);
});
test("missing server clock disables guessed play and final submission",()=>{const h=harness();h.clock(null);h.tap();assert.equal(h.calls.length,0);});
test("seed timeline is stable across renders; perfect play is bounded by configured maximum",()=>{
 const h=harness(),f=h.win.TrottlSpecialFishCatch,hits=[];let last=-1;
 for(let ms=0;ms<10000;ms++){const s=f.spawn(42,hits,ms);if(s){assert.ok(s.x>=0&&s.x<1&&s.y>=0&&s.y<1);assert.ok(s.index>last);last=s.index;hits.push({index:s.index,at:ms});}}
 assert.ok(hits.length<=f.CONFIG.maxScore);assert.equal(f.spawn(42,hits,10000),null);
});
for(const [role,host,status,shown]of [["player","u0","playing",true],["player","u1","playing",false],["spectator","u0","playing",false],["player","u0","lobby",false],["player","u0","finished",false]])test(`TEST visibility ${role}/${host}/${status}`,()=>{
 const h=harness(role);h.snapshot.session.hostUserId=host;h.snapshot.session.status=status;h.debug.update(h.snapshot);assert.equal(h.root.querySelector(".trottl-special-test-button").hidden,!shown);
});
test("TEST selection only sets next overrides, reflects reconnect and consumption/host switch",async()=>{
 const h=harness(),button=h.root.querySelector(".trottl-special-test-button"),panel=h.root.querySelector(".trottl-special-test-panel");button.click();assert.equal(panel.hidden,false);
 const [roll,mini]=panel.querySelectorAll("select");roll.value="4";mini.value="special_minigame_02";panel.querySelector("button").click();await flush();
 assert.deepEqual(h.calls,[{debug:true,id:"s1",roll:4,minigame:"special_minigame_02"}]);assert.match(panel.querySelector("p").textContent,/Nächster Würfel: 4.*Fischfang/);
 h.snapshot.session.gameState.debug_test={};h.debug.update(h.snapshot);assert.equal(roll.value,"");assert.equal(mini.value,"");h.snapshot.session.hostUserId="u1";h.debug.update(h.snapshot);assert.equal(button.hidden,true);assert.equal(panel.hidden,true);
});
test("ordinary realtime rerenders do not discard unsaved TEST dropdown choices",()=>{
 const h=harness(),panel=h.root.querySelector(".trottl-special-test-panel");h.root.querySelector(".trottl-special-test-button").click();const [roll,mini]=panel.querySelectorAll("select");
 roll.value="6";mini.value="special_minigame_01";h.debug.update(h.snapshot);assert.equal(roll.value,"6");assert.equal(mini.value,"special_minigame_01");assert.match(panel.querySelector("p").textContent,/Nächster Würfel: Zufällig/);
});
test("new round discards local catches and old seed, leaving all unrelated state untouched",()=>{
 const h=harness();h.clock(start);h.tap();const m=h.snapshot.session.gameState.minigame;m.minigame_id="r2";m.runs.u0={seed:42,score:0,hits:[],completed:false};h.c.update(h.snapshot);
 assert.match(h.root.querySelector(".trottl-special-fish-score").textContent,/0 FISCHE/);assert.equal(h.root.querySelector(".trottl-special-fish").dataset.index,"0");
});
test("SQL: server only host overrides, previous gateway guards roll, selective one-shot consumption",()=>{
 assert.match(sql,/s.host_user_id is distinct from auth.uid\(\)/);assert.match(sql,/p_roll not between 1 and 6/);
 assert.match(sql,/perform public.act_trottl_special_before_test_controls/);assert.match(sql,/debug_test=debug_test-'next_roll'/);assert.match(sql,/debug_test=debug_test-'next_minigame'/);
 assert.match(sql,/s.game_state->>'phase' in \('awaiting_roll','rescue_roll'\)/);assert.match(sql,/case when override_value is null then pg_catalog.random\(\) else 0 end/);
 assert.doesNotMatch(read("trottl-special-debug.js"),/localStorage|sessionStorage|actGame|admin/);
});
test("SQL: fish timing/membership/score/monotonic history/final retry guards and no missing-score timeout",()=>{
 for(const r of [/interval '15 seconds'/,/interval '5 seconds'/,/'higher_is_better'/,/p_score>63/,/p_score<>jsonb_array_length\(p_hits\)/,/a>=10000/,/a-prev_at<160/,/t<\(m->>'end_at'\)/,/SPECIAL_FISH_CATCH_CONFLICT/,/SPECIAL_FISH_CATCH_ALREADY_SUBMITTED/,/p_final and p_score=\(r->>'score'\)/])assert.match(sql,r);
 assert.match(sql,/if exists\(select 1 from jsonb_array_elements\(m->'participants'\).*completed/s);assert.match(sql,/special_minigame_finalize_locked/);
 assert.doesNotMatch(sql,/delete.*panic|update.*lives=|timeout|p_tap_count/);
});
test("SQL pool uses only implemented/enabled slots and a uniform ordered boundary selector",()=>{
 assert.match(sql,/n<=2,n<=2 from generate_series\(1,10\)/);assert.match(sql,/where implemented and enabled/);assert.match(sql,/pool\[1\+floor\(p_random\*array_length\(pool,1\)\)/);assert.match(sql,/if not p_override=any\(pool\)/);
});
test("SQL transactions/private revokes and isolated overlay/CSS/hooks leave Classic geometry alone",()=>{
 assert.ok(sql.startsWith("begin;"));assert.ok(sql.endsWith("commit;\n"));assert.equal((sql.match(/\$\$/g)??[]).length,16);
 assert.match(sql,/revoke all on function public.special_minigame_pick/);assert.match(sql,/grant execute on function public.set_trottl_special_debug_next/);
 assert.match(read("trottl-special.css"),/\.trottl-special-test-button \{ position: fixed/);assert.match(read("trottl-special-ui.js"),/TrottlSpecialFishCatch\?\.create\(\{ root: game/);
 assert.ok(fs.existsSync(path.join(__dirname,"..","assets/avatars/turbo-lachs.png")));
});
test("native disposable PostgreSQL fixture covers pool boundaries, force 1..6, real four flow, final retries and tie settlement",()=>{
 const fixture=read("tests/fixtures/trottl-special-fish-catch.sql");
 for(const r of [/special_minigame_pick\(0.5\)/,/for n in 1..6 loop/,/Normal forced four flow/,/SPECIAL_DEBUG_HOST_REQUIRED/,/Premature ranking/,/Best\/worst ties/,/All tied: all winners/,/Existing drink settlement/])assert.match(fixture,r);
 assert.match(fixture,/rollback;\n$/);
});
test("versioned fish/debug load after shell before Special UI; unchanged Zahl/PANIK/Roulette assets retain cache",()=>{
 const html=read("index.html");for(const [file,v]of [["trottl-special-service.js",10],["trottl-special-ui.js",14],["trottl-special.css",14],["trottl-special-presentation.js",2],["trottl-special-minigames.js",2],["trottl-special-fish-catch.js",1],["trottl-special-debug.js",1],["trottl-special-number-hunt.js",2],["trottl-special-panic.js",1],["trottl-special-roulette.js",3]])assert.ok(html.includes(`${file}?v=${v}`));
 assert.ok(html.indexOf("trottl-special-minigames.js")<html.indexOf("trottl-special-fish-catch.js"));assert.ok(html.indexOf("trottl-special-debug.js")<html.indexOf("trottl-special-ui.js"));
});
