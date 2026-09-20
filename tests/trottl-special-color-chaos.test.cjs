"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8").replace(/\r/g,"");
const source=read("trottl-special-color-chaos.js"),migration=read("supabase/migrations/20260917010000_add_trottl_special_color_chaos.sql"),memoryMigration=read("supabase/migrations/20260918010000_add_trottl_special_fish_memory.sql");
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const intro=100000,start=intro+5000;

function harness({role="player",now=start,progress=0,index=0,completed=false,elapsed=null}={}){
 const doc=createDocument('<body><div id="root"></div></body>'),root=doc.querySelector("#root"),calls=[],images=[],intervals=new Set();
 function Image(){images.push(this);this.decode=()=>Promise.resolve();}
 const win={document:doc,Image,setTimeout:fn=>{queueMicrotask(fn);return fn;},setInterval:fn=>{intervals.add(fn);return fn;},clearInterval:fn=>intervals.delete(fn)};
 vm.runInNewContext(read("trottl-special-minigames.js"),{window:win,Date,Number,Math,Object,Array,Set,Map,JSON,Promise,BigInt});
 vm.runInNewContext(source,{window:win,Date,Number,Math,Object,Array,Set,Map,JSON,Promise,BigInt});
 const generated=indexValue=>win.TrottlSpecialColorChaos.generateChallenge(123456,indexValue);
 const view={player_id:"u0",progress,challenge_index:index,completed,elapsed_ms:elapsed,
  ...(completed?{}:{target_color:generated(index).targetColor,ink_color:generated(index).inkColor,fish_order:[...generated(index).fishOrder]})};
 const runs={u0:{progress,challenge_index:index,completed,elapsed_ms:elapsed},u1:{progress:0,challenge_index:0,completed:false,elapsed_ms:null}};
 const snapshot={membershipRole:role,identity:{userId:role==="spectator"?"watcher":"u0"},players:[{userId:"u0",lifecycle:"alive"},{userId:"u1",lifecycle:"critical"}],colorChaosView:view,
  session:{id:"s1",status:"playing",hostUserId:"u0",gameState:{phase:"minigame_active",minigame:{minigame_id:"r1",minigame_type:"special_minigame_04",title:"Farbenchaos",
   title_started_at:new Date(intro).toISOString(),title_ends_at:new Date(intro+2000).toISOString(),start_at:new Date(start).toISOString(),ranking_direction:"lower_is_better",
   participants:[{player_id:"u0"},{player_id:"u1"}],runs}}}};
 const service={serverNow:()=>now,answerColorChaos:async(id,round,challengeIndex,selectedColor,tapElapsed)=>{
  calls.push({id,round,challengeIndex,selectedColor,tapElapsed});if(challengeIndex!==view.challenge_index)throw Error("SPECIAL_STALE_COLOR_CHAOS_CHALLENGE");
  const correct=selectedColor===view.target_color;if(correct)view.progress+=1;view.challenge_index+=1;
  Object.assign(runs.u0,{progress:view.progress,challenge_index:view.challenge_index});
  if(view.progress===5){view.completed=true;view.elapsed_ms=tapElapsed;delete view.target_color;delete view.ink_color;delete view.fish_order;Object.assign(runs.u0,{completed:true,elapsed_ms:tapElapsed});}
  else{const next=generated(view.challenge_index);Object.assign(view,{target_color:next.targetColor,ink_color:next.inkColor,fish_order:[...next.fishOrder]});}
  return snapshot;
 }};
 let controller=win.TrottlSpecialColorChaos.create({root,service,onSnapshot:next=>controller.update(next),onError(){}});controller.update(snapshot);
 const tap=color=>{const button=root.querySelectorAll(".trottl-special-color-chaos-choice").filter(item=>item.dataset.color===color).at(-1);for(const fn of button.listeners.pointerdown??[])fn({isTrusted:true,pointerType:"touch",button:0,preventDefault(){}});};
 const clock=value=>{now=value;for(const fn of [...intervals])fn();};
 return{win,doc,root,snapshot,view,calls,images,controller,tap,clock,recreate(){controller.suspend();controller=win.TrottlSpecialColorChaos.create({root,service,onSnapshot:next=>controller.update(next),onError(){}});controller.update(snapshot);return controller;}};
}

test("generator always separates target and ink and returns one of every fish",()=>{
 const h=harness();for(let seed=1;seed<=20;seed++)for(let index=0;index<20;index++){
  const challenge=h.win.TrottlSpecialColorChaos.generateChallenge(seed,index);
  assert.ok(h.win.TrottlSpecialColorChaos.COLORS.includes(challenge.targetColor));
  assert.ok(h.win.TrottlSpecialColorChaos.COLORS.includes(challenge.inkColor));assert.notEqual(challenge.inkColor,challenge.targetColor);
  assert.deepEqual([...challenge.fishOrder].sort(),["BLUE","GREEN","RED","YELLOW"]);assert.equal(new Set(challenge.fishOrder).size,4);
 }
});
test("same seed and index reproduce exactly while another index can differ",()=>{const h=harness(),generate=h.win.TrottlSpecialColorChaos.generateChallenge;
 assert.deepEqual(JSON.parse(JSON.stringify(generate(92831,7))),JSON.parse(JSON.stringify(generate(92831,7))));
 assert.notDeepEqual(JSON.parse(JSON.stringify(generate(92831,7))),JSON.parse(JSON.stringify(generate(92831,8))));});
test("all four mapped PNG assets preload and decode before play",async()=>{const h=harness();await flush();assert.deepEqual(h.images.map(image=>image.src),[
 "./assets/mini-games/red-fish.png","./assets/mini-games/blue-fish.png","./assets/mini-games/green-fish.png","./assets/mini-games/yellow-fish.png"]);});
test("prompt colors only the written target word with a guaranteed conflicting ink",()=>{const h=harness(),meta=h.win.TrottlSpecialColorChaos.COLOR_META;
 assert.match(h.root.querySelector(".trottl-special-color-chaos-prompt").textContent,new RegExp(`TIPPE ${meta[h.view.target_color].label}!`));
 assert.equal(h.root.querySelector(".trottl-special-color-chaos-prompt").querySelector("strong").style.color,meta[h.view.ink_color].ink);assert.notEqual(h.view.target_color,h.view.ink_color);});
test("title, countdown 3 2 1 and START keep every gameplay zone hidden",()=>{const h=harness();for(const moment of [intro,intro+2000,intro+3000,intro+4000,start,start+399]){h.clock(moment);assert.equal(h.root.querySelector(".trottl-special-minigame-content").hidden,true);assert.equal(h.root.querySelector(".trottl-special-color-chaos-game").hidden,true);}
 h.clock(start+400);assert.equal(h.root.querySelector(".trottl-special-minigame-content").hidden,false);assert.equal(h.root.querySelector(".trottl-special-color-chaos-game").hidden,false);});
test("active layout keeps task, 2x2 grid and progress in three permanent ordered zones",()=>{const h=harness(),game=h.root.querySelector(".trottl-special-color-chaos-game"),task=h.root.querySelector(".trottl-special-color-chaos-task-zone"),gridZone=h.root.querySelector(".trottl-special-color-chaos-grid-zone"),progressZone=h.root.querySelector(".trottl-special-color-chaos-progress-zone");assert.deepEqual(game.children,[task,gridZone,progressZone]);assert.equal(task.querySelector(".trottl-special-color-chaos-prompt")!==null,true);assert.equal(gridZone.querySelector(".trottl-special-color-chaos-grid")!==null,true);assert.equal(progressZone.querySelector(".trottl-special-color-chaos-progress")!==null,true);assert.doesNotMatch(source,/Tippe den Fisch passend zum geschriebenen Farbwort/);assert.equal(h.root.querySelector(".trottl-special-minigame-copy").textContent,"");assert.equal(h.root.querySelector(".trottl-special-minigame-copy").hidden,true);});
test("target fish is correct, ink-colored fish is wrong, and each answer advances one challenge",async()=>{const correct=harness(),target=correct.view.target_color;correct.tap(target);await flush();assert.equal(correct.view.progress,1);assert.equal(correct.view.challenge_index,1);assert.equal(correct.calls.length,1);
 const wrong=harness(),ink=wrong.view.ink_color;wrong.tap(ink);await flush();assert.equal(wrong.view.progress,0);assert.equal(wrong.view.challenge_index,1);assert.equal(wrong.calls[0].selectedColor,ink);});
test("input locks immediately so two pointerdowns submit only once",async()=>{const h=harness(),target=h.view.target_color;h.tap(target);h.tap(target);await flush();assert.equal(h.calls.length,1);assert.equal(h.view.progress,1);});
test("challenge changes preserve zone nodes and progress placement without DOM reflow",async()=>{const h=harness(),game=h.root.querySelector(".trottl-special-color-chaos-game"),task=h.root.querySelector(".trottl-special-color-chaos-task-zone"),gridZone=h.root.querySelector(".trottl-special-color-chaos-grid-zone"),progressZone=h.root.querySelector(".trottl-special-color-chaos-progress-zone");h.tap(h.view.target_color);await flush();assert.equal(h.root.querySelector(".trottl-special-color-chaos-game"),game);assert.equal(h.root.querySelector(".trottl-special-color-chaos-task-zone"),task);assert.equal(h.root.querySelector(".trottl-special-color-chaos-grid-zone"),gridZone);assert.equal(h.root.querySelector(".trottl-special-color-chaos-progress-zone"),progressZone);assert.equal(progressZone.textContent,"Fortschritt: 1 / 5");});
test("fifth correct answer completes with frozen milliseconds and no sixth challenge",async()=>{const h=harness({progress:4,index:9});h.clock(start+8432);h.tap(h.view.target_color);await flush();assert.equal(h.view.completed,true);assert.equal(h.view.progress,5);assert.equal(h.view.challenge_index,10);assert.equal(h.view.target_color,undefined);assert.equal(h.root.querySelector(".trottl-special-color-chaos-result").textContent,"8.432 s");h.tap("RED");assert.equal(h.calls.length,1);});
test("wrong, correct and reconnect preserve the absolute START timer",async()=>{const h=harness();h.clock(start+1200);h.tap(h.view.ink_color);await flush();h.clock(start+3400);h.tap(h.view.target_color);await flush();assert.deepEqual(h.calls.map(call=>call.tapElapsed),[1200,3400]);const index=h.view.challenge_index;h.recreate();assert.equal(h.view.challenge_index,index);h.clock(start+5000);h.tap(h.view.target_color);await flush();assert.equal(h.calls.at(-1).tapElapsed,5000);});
test("spectator receives host challenge and progress but every fish remains inert",()=>{const h=harness({role:"spectator",progress:2,index:4}),meta=h.win.TrottlSpecialColorChaos.COLOR_META;assert.match(h.root.querySelector(".trottl-special-color-chaos-prompt").textContent,new RegExp(meta[h.view.target_color].label));assert.equal(h.root.querySelector(".trottl-special-color-chaos-progress").textContent,"Fortschritt: 2 / 5");h.tap(h.view.target_color);assert.equal(h.calls.length,0);assert.ok(h.root.querySelectorAll(".trottl-special-color-chaos-choice").every(button=>button.disabled));});
test("server owns seed, expected target, progress, stale guard, finish time and private host view",()=>{for(const pattern of [
 /create table public\.trottl_special_color_chaos_runs/,/seed bigint not null/,/revoke all on public\.trottl_special_color_chaos_runs from anon,authenticated/,
 /special_color_chaos_challenge\(r\.seed,r\.challenge_index\)/,/p_selected_color=challenge->>'target_color'/,/p_challenge_index is distinct from r\.challenge_index/,
 /next_progress:=r\.progress\+case when correct then 1 else 0 end/,/if next_progress=5 then final_elapsed:=server_elapsed/,/'correct',correct,'progress',next_progress/,
 /target:=auth\.uid\(\)/,/target:=s\.host_user_id/,/special_minigame_finalize_locked\(p_id,\(m->>'minigame_id'\)::uuid,inputs\)/
 ])assert.match(migration,pattern);assert.doesNotMatch(migration,/Math\.random|client.*correct/i);});
test("production pool, debug selector and routing contain exactly productive IDs 01 through 05",()=>{const h=harness(),active=Array.from(h.win.TrottlSpecialMinigames.registry.filter(entry=>entry.active),entry=>entry.id);assert.deepEqual(active,["special_minigame_01","special_minigame_02","special_minigame_03","special_minigame_04","special_minigame_05"]);assert.ok(h.win.TrottlSpecialMinigames.registry.slice(5).every(entry=>!entry.active&&!entry.implemented));
 for(const id of ["01","02","03","04","05"])assert.match(memoryMigration,new RegExp(`chosen='special_minigame_${id}'`));assert.doesNotMatch(memoryMigration,/chosen='special_minigame_0[6-9]'|chosen='special_minigame_10'/);assert.match(read("trottl-special-debug.js"),/registry\.filter\(r => r\.active && r\.implemented\)/);});
test("four-way controlled random boundaries are uniform and ranking remains lower-is-better with shared full-tie settlement",()=>{const pick=value=>1+Math.floor(value*4);for(const [value,id] of [[0,1],[.249999,1],[.25,2],[.499999,2],[.5,3],[.749999,3],[.75,4],[.999999,4]])assert.equal(pick(value),id);assert.match(migration,/special_minigame_begin_locked\(p_id,'special_minigame_04','lower_is_better'\)/);assert.match(read("supabase/migrations/20260913070000_add_trottl_special_number_hunt.sql"),/all_tied',true[\s\S]*'winners'/);});
test("CSS and wiring provide stable three-row geometry, a raised 2x2 grid and progress zone, fast opacity fades and reduced motion",()=>{const css=read("trottl-special.css"),html=read("index.html"),ui=read("trottl-special-ui.js"),service=read("trottl-special-service.js");assert.match(css,/color-chaos-game[^}]*height: clamp\(300px, 43dvh, 390px\)[^}]*grid-template-rows:/);assert.match(css,/color-chaos-grid-zone[^}]*top: -10px/);assert.match(css,/color-chaos-progress-zone[^}]*top: -10px[^}]*padding-bottom: 12px/);assert.match(css,/color-chaos-grid[^}]*height: 100%[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/);assert.match(css,/color-chaos-choice img[^}]*width: clamp\([^}]*object-fit: contain/);assert.match(css,/color-chaos-game\.is-leaving[^}]*opacity: 0/);assert.match(css,/prefers-reduced-motion: reduce[^}]*color-chaos-task-zone/);assert.doesNotMatch(css.match(/color-chaos-game\.is-leaving[\s\S]*?\}/)?.[0]??"",/display|height|margin/);assert.match(source,/correctDelayMs: 120, wrongDelayMs: 300, fadeOutMs: 150, fadeInMs: 150/);assert.match(source,/addEventListener\("pointerdown"/);assert.match(html,/trottl-special\.css\?v=21/);assert.match(html,/trottl-special-color-chaos\.js\?v=2/);assert.match(ui,/colorChaos\?\.update\(snapshot\)/);assert.match(service,/answerColorChaos: async/);});
test("dedicated SQL fixture covers deterministic challenge and exact five-game pool",()=>{const fixture=read("tests/fixtures/trottl-special-color-chaos.sql");assert.match(fixture,/Deterministic private challenge/);assert.match(fixture,/Five-way production pool/);assert.ok(fixture.trim().endsWith("rollback;"));});
test("migration is additive, transactional and does not modify Classic, PANIK, life or finale",()=>{assert.ok(migration.startsWith("begin;\n"));assert.ok(migration.endsWith("commit;\n"));assert.equal((migration.match(/\$\$/g)??[]).length%2,0);assert.doesNotMatch(migration,/trottl_classic|special_apply_life|panic|finale/i);});
