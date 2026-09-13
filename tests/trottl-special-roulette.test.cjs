"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8").replace(/\r/g,"");
const sql=read("supabase/migrations/20260913060000_add_trottl_special_risk_roulette.sql");
function harness(reduced=false) {
 const doc=createDocument('<body><div id="root"></div></body>'),root=doc.querySelector("#root"),timers=new Set(),animations=[],resolves=[],actions=[];
 let now=100000;
 const win={document:doc,performance:{now:()=>now},matchMedia:()=>({matches:reduced}),setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
 vm.runInNewContext(read("trottl-special-roulette.js"),{window:win,Date,Math,Number,Object,Array});
 const c=win.TrottlSpecialRoulette.create({root,service:{serverNow:()=>now},onAction:(...a)=>actions.push(a),onResolve:()=>resolves.push(now)});
 const strip=root.querySelector(".trottl-special-roulette-strip");
 strip.animate=(frames,options)=>{const a={frames,options,currentTime:null,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;};
 const snapshot={session:{id:"s1",status:"playing",gameState:{phase:"roulette_spinning",actor:"u0",roulette:{round_id:"r1",spin_id:"spin1",chosen_color:"RED",result_color:"BLACK",target_index:43,
  start_offset:-201,end_offset:-3522,spin_started_at:new Date(100000).toISOString()}}},membershipRole:"player",identity:{userId:"u0"},players:[{userId:"u0",lifecycle:"alive"}]};
 return {c,root,strip,animations,resolves,actions,snapshot,clock:n=>{now=n;for(const fn of [...timers])fn();},api:win.TrottlSpecialRoulette};
}
test("Special exactly references Fisch Roulette 1x duration/easing, width/pitch and target range",()=>{
 const fish=read("script.js");assert.match(fish,/ROULETTE_BASE_DURATION = 4700/);assert.match(fish,/cubic-bezier\(0.12, 0.7, 0.08, 1\)/);
 const h=harness();h.c.update(h.snapshot);assert.equal(h.animations[0].options.duration,4700);assert.equal(h.animations[0].options.easing,h.api.EASING);
 assert.match(sql,/43\+floor\(pg_catalog.random\(\)\*4\)/);assert.match(sql,/v_target\*81\+39/);
});
test("same spin snapshot seeks original curve; reconnect resumes without new spin or random draw",()=>{
 const h=harness();h.clock(102350);h.c.update(h.snapshot);assert.equal(h.animations[0].currentTime,2350);
 h.c.update(h.snapshot);assert.equal(h.animations.length,1);h.c.suspend();h.clock(103000);h.c.update(h.snapshot);
 assert.equal(h.animations[1].currentTime,3000);assert.equal(h.snapshot.session.gameState.roulette.spin_id,"spin1");assert.equal(h.actions.length,0);
});
test("expired spin instantly shows server result, uses persisted final offset and requests settlement",()=>{
 const h=harness();h.clock(105000);h.c.update(h.snapshot);assert.equal(h.animations.length,0);assert.equal(h.strip.style.transform,"translateX(-3522px)");
 assert.equal(h.root.querySelector("p").textContent,"SCHWARZ · 1 Shot");assert.equal(h.resolves.length,1);
});
test("new spin replaces old animation; suspended or hidden presentation cannot resolve",()=>{
 const h=harness();h.c.update(h.snapshot);h.snapshot.session.gameState.roulette.spin_id="spin2";h.c.update(h.snapshot);
 assert.ok(h.animations[0].cancelled);h.c.suspend();h.clock(110000);assert.equal(h.resolves.length,0);
 h.snapshot.session.gameState.phase="awaiting_roll";h.c.update(h.snapshot);assert.equal(h.root.querySelector(".trottl-special-roulette").hidden,true);
});
test("reduced motion has no scrolling animation, preserves server duration/result and never selects locally",()=>{
 const h=harness(true);h.c.update(h.snapshot);assert.equal(h.animations.length,0);assert.equal(h.actions.length,0);assert.equal(h.resolves.length,0);
 h.clock(104700);assert.equal(h.resolves.length,1);
});
test("missing server clock cannot start a guessed timeline",()=>{
 const h=harness();h.clock(null);h.c.update(h.snapshot);assert.equal(h.animations.length,0);assert.equal(h.resolves.length,0);
 assert.match(h.root.querySelector("p").textContent,/synchronisiert/);
});
test("server RNG uses exact deterministic 45/45/10 boundaries, once at color commit only",()=>{
 assert.match(sql,/p_random<0.45 then 'RED' when p_random<0.90 then 'BLACK' else 'GREEN'/);
 assert.equal((sql.match(/special_roulette_color\(pg_catalog.random\(\)\)/g)||[]).length,1);
 assert.match(sql,/r->>'chosen_color' is not null/);assert.match(sql,/is distinct from p_round_id/);
 assert.match(read("tests/fixtures/trottl-special-roulette.sql"),/0.449999999/);
});
test("server security: locks, own membership, actor, round, phase, disabled reward and legal target guards",()=>{
 for(const text of ["pg_advisory_xact_lock(337734","for update","SPECIAL_STALE_ROULETTE","SPECIAL_ROULETTE_READ_ONLY","SPECIAL_INVALID_COLOR","SPECIAL_INVALID_REWARD_ACTOR","SPECIAL_REWARD_UNAVAILABLE","SPECIAL_INVALID_REWARD_TARGET"])assert.ok(sql.includes(text));
 assert.match(sql,/user_id<>auth.uid\(\) and lifecycle_status='alive' and lives>0/);
 assert.match(sql,/revoke all[\s\S]*special_roulette_color\(double precision\)/);
 assert.match(sql,/revoke all on function public.act_trottl_special_phase_three/);
});
test("normal six activates only after prior rolling resolution; rescue and all previous event code delegate",()=>{
 assert.match(sql,/g->>'phase'='rolling' and \(g->>'result'\)::integer=6 and not coalesce\(\(g->>'rescue'\)::boolean,false\)/);
 assert.match(sql,/perform public.act_trottl_special_phase_three/);assert.doesNotMatch(sql,/create.*special_restore_life_locked/);
});
test("rewards use central life engine, capped central heal and carry points unchanged",()=>{
 assert.match(sql,/perform public.special_lose_life_locked\(p_session_id,\(r->>'target'\)::uuid\)/);
 assert.match(sql,/set lives=lives\+1[\s\S]*lives between 1 and 2/);assert.match(sql,/perform public.special_heal_life_locked/);
 assert.match(sql,/else g:=g\|\|jsonb_build_object\('trottl',r->>'target'\)/);
 assert.match(sql,/select game_state into g[\s\S]*reward_confirmed_at/);
});
test("jackpot requires both greens, excludes actor and dead, includes critical; wrong guess only actor shot",()=>{
 assert.match(sql,/if p_value<>v_color then v_shots:=jsonb_build_object\(auth.uid\(\)::text,1\)/);
 assert.match(sql,/elsif p_value='GREEN' and v_color='GREEN'/);
 assert.match(sql,/user_id<>auth.uid\(\) and lifecycle_status in \('alive','critical'\)/);
});
test("parallel settlement gates reward AND shots, drops dead/left obligations, unavailable reward never hangs",()=>{
 assert.match(sql,/g->>'phase'='roulette_settlement' and \(r->>'reward_done'\)::boolean[\s\S]*not exists[\s\S]*shot_acks/);
 assert.match(sql,/reward_waived/);assert.match(sql,/join public.trottl_special_players[\s\S]*lifecycle_status in \('alive','critical'\)/);
 assert.match(sql,/perform public.special_advance_locked/);
});
test("leave preserves committed spin and confirmed reward, forfeits unconfirmed reward, invalidates missing target",()=>{
 assert.match(sql,/g->>'phase'='roulette_choose_color' and g->>'actor' is null/);
 assert.match(sql,/if not \(r->>'reward_done'\)::boolean then/);assert.match(sql,/r:=r\|\|jsonb_build_object\('target',null\)/);
 assert.doesNotMatch(sql,/last_seen_at|interval '90 seconds'/);
});
test("Special isolated visual code never references Fish stats, speed state, client randomness or local persistence",()=>{
 for(const source of [sql,read("trottl-special-roulette.js")])assert.doesNotMatch(source,/roulette_stats|total_spins|goldfish|leaderboard|rouletteSpeed|localStorage|Math.random|secureRandomInt|trottl_classic/);
 const css=read("trottl-special.css");assert.match(css,/\.trottl-special-roulette \{ position: absolute/);assert.match(css,/pointer-events: none/);assert.match(css,/overflow: hidden/);
 assert.match(read("index.html"),/trottl-special-roulette.js\?v=1/);
});
test("SQL structure: migration transaction, dollar bodies, private helper revokes and fixture rollback are complete",()=>{
 assert.ok(sql.startsWith("begin;"));assert.ok(sql.trim().endsWith("commit;"));
 const bodies=sql.match(/\$\$/g)||[];assert.equal(bodies.length,18);
 for(const name of ["special_roulette_color","special_heal_life_locked","special_roulette_rewards","special_roulette_begin_locked","special_roulette_settle_locked"]) {
  assert.ok(sql.slice(sql.lastIndexOf("revoke all on function")).includes(`public.${name}(`));
 }
 const fixture=read("tests/fixtures/trottl-special-roulette.sql");assert.ok(fixture.trim().endsWith("rollback;"));
 for(const phrase of ["Boundary mapping","Attack matrix","Heal +1","Transfer points lost","Parallel green stalled","Rescue-six regression","Binding green spin lost","No available reward deadlock","Expected %"])assert.ok(fixture.includes(phrase));
});
