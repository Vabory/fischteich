"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createDocument } = require("./helpers/trottl-special-dom.cjs");
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\r/g, "");
const sql = read("supabase/migrations/20260913010000_add_trottl_special_foundation.sql");
const flush = async () => { for (let i=0; i<8; i++) await new Promise(resolve => setImmediate(resolve)); };

function harness(count=3) {
  const doc = createDocument(read("index.html")), calls=[], channels=[], store=new Map(), spectators=[];
  let userId = "u0", gameRPC = null;
  const players = Array.from({length:count}, (_,seat_index) => ({ session_id:"special-1",user_id:`u${seat_index}`,
    seat_index,display_name_snapshot:`Spieler ${seat_index}`,avatar_id:"turbo-lachs",is_ready:true,lives:3,lifecycle_status:"alive",critical_used:false,joined_at:"2026-09-13",last_seen_at:"2026-09-13" }));
  const rows = { special: { id:"special-1",mode:"special",room_slot:1,status:"lobby",host_user_id:"u0",player_count:count,
    current_turn_seat:null,started_at:null,game_state:{} }, classic: { id:"classic-1",mode:"classic",room_slot:1,status:"lobby",host_user_id:"u0",player_count:5 } };
  const client = {
    async rpc(name,p={}) {
      calls.push({name,p}); const mode=name.includes("special")?"special":"classic", row=rows[mode];
      if (name==="act_trottl_special_game" && gameRPC) return gameRPC(p);
      const role=players.some(x=>x.user_id===userId)?"player":spectators.some(x=>x.user_id===userId)?"spectator":"none";
      if(name==="get_trottl_special_membership")return {data:[{membership_role:role,spectator_count:spectators.length}],error:null};
      if(name==="get_trottl_special_memberships")return {data:role==="none"?[]:[{session_id:rows.special.id,membership_role:role,room_slot:1}],error:null};
      if(name==="join_trottl_special_spectator") {
        if(role==="player")return {error:new Error("TROTTL_SPECIAL_ALREADY_PLAYER")};
        if(row.status!=="playing")return {error:new Error("TROTTL_SPECIAL_NOT_PLAYING")};
        if(role!=="spectator")spectators.push({session_id:row.id,user_id:userId});
        return {data:row.id,error:null};
      }
      if(name==="leave_trottl_special_spectator") {const index=spectators.findIndex(x=>x.user_id===userId);if(index>=0)spectators.splice(index,1);return {data:true,error:null};}
      if (name.startsWith("get_trottl_") && name.endsWith("_rooms")) return {data:[{room_slot:1,session_id:row.id,session_status:row.status,player_count:row.player_count,is_member:row.is_member!==false}],error:null};
      if (name==="start_trottl_special_session") {
        if (row.host_user_id!=="u0" || row.status!=="lobby" || players.length<3 || players.some(x=>!x.is_ready)) return {error:new Error("TROTTL_SPECIAL_PLAYERS_NOT_READY")};
        row.status="playing";row.started_at="2026-09-13";row.current_turn_seat=0;return {data:row.id,error:null};
      }
      if(name==="join_trottl_special_room")return {data:row.id,error:null};
      if(name==="set_trottl_special_ready")players[0].is_ready=p.p_ready;
      if(name==="set_trottl_special_avatar")players[0].avatar_id=p.p_avatar_id;
      if(name==="leave_trottl_special_session")players.splice(0,1);
      if(name==="kick_trottl_special_player")players.splice(players.findIndex(x=>x.user_id===p.p_target_player_id),1);
      return {data:true,error:null};
    },
    from(table) {
      calls.push({table});const filters=[];
      const builder={select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},
        async maybeSingle(){return {data:table==="trottl_special_sessions"?{...rows.special}:null,error:null};},
        then(resolve,reject){let data=table==="trottl_special_players"?players:[];
          data=data.filter(x=>filters.every(([k,v])=>x[k]===v));return Promise.resolve({data:data.map(x=>({...x})),error:null}).then(resolve,reject);}};
      return builder;
    },
    channel(name){const ch={name,handlers:[],on(type,options,fn){this.handlers.push({type,options,fn});return this;},subscribe(){return this;}};channels.push(ch);return ch;},
    async removeChannel(ch){channels.splice(channels.indexOf(ch),1);}
  };
  const win={document:doc,localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
    addEventListener(){},requestAnimationFrame(){return 1;},MutationObserver:class{observe(){}},
    setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){}};
  const context=vm.createContext({window:win,document:doc,console,supabaseClient:client,
    getLocalIdentity:()=>({displayName:"Spieler 0",deviceId:"device"}),initializeAppAuth:async()=>{},
    syncCurrentAuthProfileDisplayName:async()=>{},getAppAuthState:()=>({currentAuthUser:{id:userId},currentProfile:{displayName:"Spieler 0"}})});
  for(const file of ["trottl-avatar-service.js","trottl-classic-service.js","trottl-classic-ui.js","classic-background-fit.js","trottl-special-service.js","trottl-special-presentation.js","trottl-special-ui.js"])vm.runInContext(read(file),context);
  win.FischteichDice={mount:({mountPoint,rollOnClick})=>{assert.equal(rollOnClick,false);const die=doc.createElement("button");die.className="fischteich-die";mountPoint.append(die);return {setResultInstant(){}};}};
  const ui=win.TrottlSpecialUI.create({showScreen:screen=>{for(const item of doc.querySelectorAll(".screen"))item.hidden=item!==screen;},showTrottlMenu:()=>{for(const item of doc.querySelectorAll(".screen"))item.hidden=item.id!=="trottl-menu-screen";}});
  return {doc,win,ui,calls,channels,rows,players,spectators,store,setUser:id=>{userId=id;},setGameRPC:fn=>{gameRPC=fn;},service:win.trottlSpecialService};
}

test("Classic and Special room one summaries are independent in both lobby and playing combinations",async()=>{
  const h=harness();
  for(const [classic,special] of [["lobby","lobby"],["playing","lobby"],["lobby","playing"]]){
    h.rows.classic.status=classic;h.rows.special.status=special;
    const [a,b]=await Promise.all([h.win.trottlClassicService.loadRooms(),h.service.loadRooms()]);
    assert.equal(a[0].sessionId,"classic-1");assert.equal(b[0].sessionId,"special-1");
    assert.equal(a[0].status,classic);assert.equal(b[0].status,special);
    assert.equal(a[0].playerCount,5);assert.equal(b[0].playerCount,3);
  }
});

async function openGame(h, g) {
  h.rows.special.status="playing"; h.rows.special.current_turn_seat=0;
  h.rows.special.game_state={phase:"awaiting_roll",actor:"u0",actor_seat:0,roll_seq:4,revision:1,trottl:null,points:0,...g};
  await h.ui.openRooms(); await flush(); h.doc.querySelector("#trottl-special-room-list").children[0].click(); await flush();
}
for (const lives of [0,1,2,3]) test(`Special renders three stable SVG hearts with ${lives} red hearts`,async()=>{
  const h=harness(); Object.assign(h.players[1],{lives,lifecycle_status:lives===0?"critical":"alive",critical_used:lives===0});
  await openGame(h,{});
  const seat=h.doc.querySelector("#trottl-special-seat-layer").children[1];
  assert.equal(seat.querySelector(".trottl-special-hearts").children.length,3);
  assert.equal(seat.querySelectorAll(".is-live").length,lives);
  assert.equal(seat.querySelectorAll("svg").length,3);
});
test("eliminated local member retains its exact seat, skull, hearts, but no DU or roll action",async()=>{
  const h=harness(7);Object.assign(h.players[0],{lives:0,lifecycle_status:"eliminated",critical_used:true});
  await openGame(h,{actor:"u1"});
  const seats=h.doc.querySelector("#trottl-special-seat-layer").children;
  assert.equal(seats.length,7); assert.equal(seats[0].dataset.lifecycle,"eliminated");
  assert.ok(seats[0].querySelector(".trottl-special-skull"));
  assert.equal(seats[0].querySelector(".trottl-classic-seat-self-marker"),null);
  assert.equal(h.doc.querySelector(".fischteich-die").disabled,true);
  assert.equal(h.doc.querySelector("#trottl-special-rule-controls").hidden,true);
});
test("hearts precede DU; critical rescue status uses existing statusbox",async()=>{
  const h=harness();Object.assign(h.players[0],{lives:0,lifecycle_status:"critical",critical_used:true});
  await openGame(h,{phase:"rescue_roll"});
  const seat=h.doc.querySelector("#trottl-special-seat-layer").children[0];
  assert.ok(seat.children.indexOf(seat.querySelector(".trottl-special-hearts"))<seat.children.indexOf(seat.querySelector(".trottl-classic-seat-self-marker")));
  assert.equal(h.doc.querySelector("#trottl-special-event-copy").textContent,"MUSS EINE 6 WÜRFELN");
  assert.equal(h.doc.querySelector("#trottl-special-event-action").textContent,"Letzte Chance!");
});
test("Trottl targets exclude critical/dead/self while drink targets include self and critical",async()=>{
  const h=harness(4);Object.assign(h.players[1],{lives:0,lifecycle_status:"critical",critical_used:true});
  Object.assign(h.players[2],{lives:0,lifecycle_status:"eliminated",critical_used:true});
  await openGame(h,{phase:"choose_trottl"});
  assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,1);
  h.rows.special.game_state={...h.rows.special.game_state,phase:"distribution",total:2,drinks:{},revision:2};await h.ui.refresh();await flush();
  assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,3);
});
test("early confirm flashes counter without sending any confirm intent",async()=>{
  const h=harness();await openGame(h,{phase:"distribution",total:2,drinks:{}});
  h.doc.querySelector("#trottl-special-four-confirm").click();await flush();
  assert.ok(h.doc.querySelector("#trottl-special-action-progress").classList.contains("is-incomplete-hint"));
  assert.equal(h.calls.filter(x=>x.name==="act_trottl_special_game").length,0);
});
test("optimistic queue serializes repeated self assignments; confirm waits for server and empty queue; reset clears distribution",async()=>{
  const h=harness();let release;let inFlight=0,maxFlight=0;
  h.setGameRPC(async p=>{
    inFlight++;maxFlight=Math.max(maxFlight,inFlight);
    if (!release && p.p_action==="assign") await new Promise(resolve=>{release=resolve;});
    const g=h.rows.special.game_state;
    if(p.p_action==="assign")g.drinks[p.p_target]=(g.drinks[p.p_target]??0)+1;
    if(p.p_action==="reset")g.drinks={};
    if(p.p_action==="confirm")g.phase="drink_ack";
    g.revision++;inFlight--;return {data:"special-1",error:null};
  });
  await openGame(h,{phase:"distribution",total:2,drinks:{},acks:{}});
  h.doc.querySelectorAll(".trottl-special-target")[0].click();await flush();
  h.doc.querySelectorAll(".trottl-special-target")[0].click();await flush();
  assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"2 / 2");
  assert.ok(h.doc.querySelector("#trottl-special-four-confirm").classList.contains("is-incomplete"));
  release();await flush();assert.equal(maxFlight,1);
  assert.equal(h.rows.special.game_state.drinks.u0,2);
  assert.equal(h.doc.querySelector("#trottl-special-four-confirm").classList.contains("is-incomplete"),false);
  h.doc.querySelector("#trottl-special-four-reset").click();await flush();
  assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"0 / 2");
});
for(const lifecycle of ["alive","critical","eliminated"]) test(`ACK visibility after life-state ${lifecycle} is based on server snapshot`,async()=>{
 const h=harness();Object.assign(h.players[0],{lives:lifecycle==="alive"?1:0,lifecycle_status:lifecycle,critical_used:lifecycle!=="alive"});
 await openGame(h,{phase:"drink_ack",actor:"u1",drinks:lifecycle==="eliminated"?{}:{u0:1},acks:{}});
 assert.equal(h.doc.querySelector("#trottl-special-global-confirm").hidden,lifecycle==="eliminated");
});
test("reconnect renders server distribution, ACK and Trottl points without local authority",async()=>{
 const h=harness();await openGame(h,{phase:"distribution",total:2,drinks:{u1:1},trottl:"u1",points:2});
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"1 / 2");
 assert.equal(h.doc.querySelector(".trottl-classic-trottl-badge").textContent,"3ER 2/3");
});
const phaseSQL=read("supabase/migrations/20260913030000_add_trottl_special_phase_one.sql");
const section=name=>phaseSQL.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?end; \\$\\$;`))[0];
test("SQL structure: life engine decrements centrally, once-only critical, permanent elimination, zero-life Trottl reset",()=>{
 const s=section("special_lose_life_locked");
 assert.match(s,/lifecycle_status<>'alive' or v_player.lives<1/);
 assert.match(s,/lives>1 then 'alive' when v_player.critical_used then 'eliminated' else 'critical'/);
 assert.match(s,/lives=lives-1/);assert.match(s,/critical_used=critical_used or v_status='critical'/);
 assert.match(s,/v_player.lives=1[\s\S]*'trottl',null,'points',0/);
});
test("SQL structure: rescue branches before ordinary rules, restores exactly one, failed rescue advances without events",()=>{
 const s=section("act_trottl_special_game");
 assert.match(s,/if coalesce\(\(g->>'rescue'\)::boolean,false\)[\s\S]*v_result=6[\s\S]*special_restore_life_locked[\s\S]*'phase','awaiting_roll'/);
 assert.match(s,/lifecycle_status='eliminated'[\s\S]*special_advance_locked[\s\S]*return p_session_id;[\s\S]*elsif v_result in \(1,2\)/);
 assert.match(section("special_restore_life_locked"),/set lives=1,lifecycle_status='alive'[\s\S]*lifecycle_status='critical' and lives=0 and critical_used/);
});
test("SQL structure: third-point A/B retain ACK, C waives ACK after central engine; peak visible before resolution",()=>{
 const s=section("act_trottl_special_game");
 const peak=s.slice(s.indexOf("if g->>'phase'='trottl_peak'"),s.indexOf("v_result:=(g->>'result')"));
 assert.match(peak,/v_status:=public.special_lose_life_locked/);
 assert.match(peak,/'points',0,'phase','drink_ack'/);
 assert.match(peak,/if v_status='eliminated' then[\s\S]*'drinks','\{\}'::jsonb[\s\S]*special_advance_locked[\s\S]*return/);
 assert.match(s,/integer=2 then 'trottl_peak'/);assert.match(s,/600 milliseconds/);
});
test("SQL structure: critical drink targets valid, Trottl targets alive only, transfer retains points",()=>{
 const s=section("act_trottl_special_game");
 assert.match(s,/v_used>=v_total[\s\S]*lifecycle_status in \('alive','critical'\)/);
 const choose=s.slice(s.indexOf("elsif p_action='choose'"),s.indexOf("elsif p_action='ack'"));
 assert.match(choose,/p_target=v_user/);assert.match(choose,/lifecycle_status='alive' and lives>0/);
 assert.doesNotMatch(choose,/'points'/);
 assert.match(section("special_validate_game_state"),/lifecycle_status='alive' and p.lives>0/);
 assert.match(phaseSQL,/deferrable initially deferred/);
});
test("SQL structure: guarded authoritative randomness, atomic locks, sparse turn order, no Classic writes or finale",()=>{
 assert.match(phaseSQL,/pg_advisory_xact_lock\(337734/);assert.match(phaseSQL,/for update/);
 assert.match(phaseSQL,/p_roll_seq is distinct from v_seq/);assert.match(phaseSQL,/v_actor is distinct from v_user/);
 assert.match(phaseSQL,/floor\(random\(\)\*6\)/);
 assert.match(section("special_advance_locked"),/lifecycle_status in \('alive','critical'\)[\s\S]*seat_index>p_after/);
 assert.doesNotMatch(phaseSQL,/(?:update|alter table|create or replace function) public\.trottl_classic/);
 assert.match(phaseSQL,/revoke all on function public\.special_advance_locked/);
 assert.match(phaseSQL,/grant execute on function public\.act_trottl_special_game/);
 assert.doesNotMatch(phaseSQL,/winner|confetti|roulette/);
});
test("Realtime events use disjoint tables and mode/session channels",()=>{
  const h=harness();let a=0,b=0;
  h.win.trottlClassicService.subscribeSession("classic-2",()=>a++);
  h.service.subscribeSession("special-2",()=>b++);
  for(const channel of h.channels)for(const handler of channel.handlers)if(handler.options.table==="trottl_classic_sessions")handler.fn({});
  assert.equal(a,1);assert.equal(b,0);
  for(const channel of h.channels)for(const handler of channel.handlers)if(handler.options.table==="trottl_special_players")handler.fn({});
  assert.equal(a,1);assert.equal(b,1);
  assert.match(h.channels[1].name,/trottl-special-session-special-2/);
  assert.ok(h.channels[1].handlers.every(x=>x.options.filter.includes("special-2")));
});
test("room two join intent cannot address Classic membership tables or RPCs",async()=>{
  const h=harness();await h.service.joinRoom(2);
  assert.ok(h.calls.some(x=>x.name==="join_trottl_special_room"&&x.p.p_room_slot===2));
  assert.ok(h.calls.every(x=>!x.table||x.table.startsWith("trottl_special_")));
  assert.ok(h.calls.every(x=>!x.name||!x.name.includes("classic")));
});
test("Special rejects Classic rows during reconnect and restores only own session",async()=>{
  const h=harness();assert.throws(()=>h.service.normalizeSession(h.rows.classic),/Invalid Special/);
  const snapshot=await h.service.restoreMembership();assert.equal(snapshot.session.mode,"special");
  h.store.set("fischteich:trottl-active-mode","special");assert.equal(await h.ui.restoreMembership(),true);
  assert.equal(h.doc.querySelector("#trottl-special-session-screen").hidden,false);
  assert.equal(h.doc.querySelector("#trottl-classic-session-screen").hidden,true);
});
test("room markup is cloned from current Classic master before central screen inventory",()=>{
  const h=harness();const a=h.doc.querySelector("#trottl-classic-rooms-screen"),b=h.doc.querySelector("#trottl-special-rooms-screen");
  assert.equal(a.querySelector(".trottl-classic-room-context").textContent,"3er TrottlCLASSIC");
  assert.equal(b.querySelector(".trottl-classic-room-context").textContent,"3er TrottlSPECIAL");
  for(const cls of ["trottl-classic-room-title-asset","trottl-classic-room-background"])assert.deepEqual(b.querySelector(`.${cls}`).attributes,a.querySelector(`.${cls}`).attributes);
  const ids=h.doc.querySelectorAll("*").map(x=>x.id).filter(Boolean);assert.equal(new Set(ids).size,ids.length);
  assert.ok(b.querySelectorAll("button").every(x=>x.id.includes("special")||!x.id));
});
for(const count of [2,3,8])test(`Special lobby start availability at ${count} ready players`,async()=>{
  const h=harness(count);await h.ui.openRooms();await flush();
  h.doc.querySelector("#trottl-special-room-list").children[0].click();await flush();
  const start=h.doc.querySelector("#trottl-special-start");assert.equal(start.disabled,count<3);
  assert.equal(h.doc.querySelector("#trottl-special-player-list").children.length,count);
  start.click();assert.equal(h.doc.querySelector("#trottl-special-start-modal").hidden,count<3);
  assert.equal(h.calls.filter(x=>x.name==="start_trottl_special_session").length,0);
});
test("two-step start: cancel leaves lobby unchanged; final green tap invokes Special RPC and switches shell",async()=>{
  const h=harness();await h.ui.openRooms();await flush();h.doc.querySelector("#trottl-special-room-list").children[0].click();await flush();
  h.doc.querySelector("#trottl-special-start").click();const modal=h.doc.querySelector("#trottl-special-start-modal");
  modal.querySelectorAll("button")[0].click();assert.equal(modal.hidden,true);assert.equal(h.rows.special.status,"lobby");
  h.doc.querySelector("#trottl-special-start").click();modal.querySelectorAll("button")[1].click();await flush();
  assert.equal(h.rows.special.status,"playing");assert.equal(h.rows.classic.status,"lobby");
  assert.equal(h.doc.querySelector("#trottl-special-game-view").hidden,false);assert.equal(modal.hidden,true);
  assert.equal(h.calls.filter(x=>x.name==="start_trottl_special_session").length,1);
  const seats=h.doc.querySelector("#trottl-special-seat-layer").children;
  assert.equal(seats[0].style["--seat-top"],"87%");assert.equal(seats[1].style["--seat-left"],"16%");
});
test("lobby changes during popup are checked on final server call, not assumed from first tap",async()=>{
  const h=harness();await h.ui.openRooms();await flush();h.doc.querySelector("#trottl-special-room-list").children[0].click();await flush();
  h.doc.querySelector("#trottl-special-start").click();h.players[1].is_ready=false;
  h.doc.querySelector("#trottl-special-start-modal").querySelectorAll("button")[1].click();await flush();
  assert.equal(h.rows.special.status,"lobby");assert.equal(h.doc.querySelector("#trottl-special-start-modal").hidden,false);
});
test("running Special room offers spectators while keeping player reconnect",async()=>{
  const h=harness();h.rows.special.status="playing";h.rows.special.current_turn_seat=0;
  await h.ui.openRooms();await flush();assert.equal(h.doc.querySelector("#trottl-special-room-list").children[0].disabled,false);
  assert.match(h.doc.querySelector("#trottl-special-room-list").children[0].textContent,/Wieder beitreten/);
  h.rows.special.is_member=false;await h.ui.refresh();await flush();
  assert.equal(h.doc.querySelector("#trottl-special-room-list").children[0].disabled,false);
  assert.match(h.doc.querySelector("#trottl-special-room-list").children[0].textContent,/Spiel läuft/);
  assert.match(read("trottl-special-ui.js"),/room\?\.status === "playing" && !room\.isMember/);
});

const spectatorSql = read("supabase/migrations/20260913020000_add_trottl_special_spectators.sql");
async function spectatorHarness(count=3) {
  const h=harness(count);h.setUser("viewer");h.rows.special.status="playing";h.rows.special.current_turn_seat=0;h.rows.special.is_member=false;
  await h.ui.openRooms();await flush();return h;
}
async function watch(h) {
  h.doc.querySelector("#trottl-special-room-list").children[0].click();
  h.doc.querySelector("#trottl-special-spectator-modal").querySelectorAll("button")[1].click();await flush();
}

test("spectator room tap opens modal; cancel does not execute any join",async()=>{
  const h=await spectatorHarness();h.doc.querySelector("#trottl-special-room-list").children[0].click();
  const modal=h.doc.querySelector("#trottl-special-spectator-modal");assert.equal(modal.hidden,false);
  assert.match(modal.textContent,/Als Zuschauer beitreten/);
  modal.querySelectorAll("button")[0].click();assert.equal(modal.hidden,true);
  assert.ok(!h.calls.some(x=>x.name==="join_trottl_special_room"||x.name==="join_trottl_special_spectator"));
});
test("watch creates spectator membership, not seat or DU; host is bottom; count is an overlay",async()=>{
  const h=await spectatorHarness();await watch(h);
  assert.equal(h.spectators.length,1);assert.equal(h.players.length,3);
  assert.equal(h.doc.querySelector("#trottl-special-game-view").hidden,false);
  const seats=h.doc.querySelector("#trottl-special-seat-layer").children;
  assert.equal(seats.length,3);assert.equal(seats[0].dataset.globalSeat,"0");assert.equal(seats[0].style["--seat-top"],"87%");
  assert.ok(seats.every(x=>!x.classList.contains("trottl-classic-player--self")));
  assert.equal(h.doc.querySelector("#trottl-special-seat-layer").querySelectorAll(".trottl-classic-seat-self-marker").length,0);
  assert.equal(h.doc.querySelector("#trottl-special-rule-controls").hidden,true);
  assert.equal(h.doc.querySelector("#trottl-special-spectator-count").querySelector("span").textContent,"1");
  assert.ok(!h.calls.some(x=>x.name==="join_trottl_special_room"));
});
test("eight players plus five spectators do not alter active-player count or preset",async()=>{
  const h=await spectatorHarness(8);for(let i=0;i<4;i++)h.spectators.push({session_id:"special-1",user_id:`v${i}`});
  await watch(h);assert.equal(h.spectators.length,5);assert.equal(h.players.length,8);
  assert.equal(h.doc.querySelector("#trottl-special-seat-layer").children.length,8);
  assert.equal(h.doc.querySelector("#trottl-special-spectator-count").querySelector("span").textContent,"5");
  assert.equal((await h.service.loadRooms())[0].playerCount,8);
});
test("spectator back leaves immediately without player leave RPC or confirm popup",async()=>{
  const h=await spectatorHarness();await watch(h);h.ui.goBack();await flush();
  assert.equal(h.spectators.length,0);assert.equal(h.players.length,3);
  assert.equal(h.doc.querySelector("#trottl-special-rooms-screen").hidden,false);
  assert.equal(h.doc.querySelector("#trottl-special-leave-modal").hidden,true);
  assert.ok(h.calls.some(x=>x.name==="leave_trottl_special_spectator"));
  assert.ok(!h.calls.some(x=>x.name==="leave_trottl_special_session"));
});
test("spectator reconnect restores role and host perspective without duplication",async()=>{
  const h=await spectatorHarness();await watch(h);await h.ui.openRooms();await flush();
  assert.equal(await h.ui.restoreMembership(),true);await flush();
  assert.equal(h.spectators.length,1);assert.equal(h.doc.querySelector("#trottl-special-rule-controls").hidden,true);
  assert.equal(h.doc.querySelector("#trottl-special-seat-layer").querySelectorAll(".trottl-classic-seat-self-marker").length,0);
});
test("current server host is derived afresh after host change",async()=>{
  const h=await spectatorHarness(4);await watch(h);h.rows.special.host_user_id="u2";await h.ui.refresh();await flush();
  const seats=h.doc.querySelector("#trottl-special-seat-layer").children;
  assert.deepEqual(seats.map(x=>x.dataset.globalSeat),["2","3","0","1"]);
  assert.equal(seats[0].style["--seat-top"],"87%");
  assert.equal(h.doc.querySelector("#trottl-special-seat-layer").querySelectorAll(".trottl-classic-seat-self-marker").length,0);
});
test("spectator cannot invoke client player mutations and uses spectator heartbeat",async()=>{
  const h=await spectatorHarness();await watch(h);
  await h.ui.refresh();await flush();
  for(const fn of [()=>h.service.setReady("special-1",true),()=>h.service.setAvatar("special-1","turbo-lachs"),
    ()=>h.service.startSession("special-1"),()=>h.service.kickPlayer("special-1","u1")])await assert.rejects(fn,/PLAYER_REQUIRED/);
  assert.ok(!h.calls.some(x=>/^set_trottl_special_|^start_trottl_special_|^kick_trottl_special_/.test(x.name??"")));
  assert.ok(h.calls.some(x=>x.name==="heartbeat_trottl_special_spectator"));
});
test("active player cannot also become spectator; former player can watch without becoming active again",async()=>{
  const h=harness();h.rows.special.status="playing";
  await assert.rejects(()=>h.service.joinSpectator("special-1",1),/ALREADY_PLAYER/);assert.equal(h.spectators.length,0);
  await h.service.leaveSession("special-1");const snapshot=await h.service.joinSpectator("special-1",1);
  assert.equal(snapshot.membershipRole,"spectator");assert.equal(h.players.length,2);
  assert.ok(!snapshot.players.some(x=>x.userId==="u0"));
});
test("spectator join and leave events subscribe by session; heartbeat-only updates do not recurse",()=>{
  const h=harness();let calls=0;h.service.subscribeSession("special-1",()=>calls++);
  const ch=h.channels[0],spectator=ch.handlers.find(x=>x.options.table==="trottl_special_spectators");
  assert.equal(spectator.options.filter,"session_id=eq.special-1");
  spectator.fn({table:"trottl_special_spectators",eventType:"INSERT",new:{user_id:"viewer"}});
  spectator.fn({table:"trottl_special_spectators",eventType:"DELETE",old:{user_id:"viewer"}});
  spectator.fn({table:"trottl_special_spectators",eventType:"UPDATE",old:{user_id:"viewer",last_seen_at:"old"},new:{user_id:"viewer",last_seen_at:"new"}});
  assert.equal(calls,2);
});
test("player eye counter sees live authoritative spectator count and zero is retained",async()=>{
  const h=harness();h.rows.special.status="playing";h.rows.special.current_turn_seat=0;
  h.store.set("fischteich:trottl-active-mode","special");await h.ui.restoreMembership();await flush();
  h.spectators.push({session_id:"special-1",user_id:"viewer"});await h.ui.refresh();await flush();
  const count=h.doc.querySelector("#trottl-special-spectator-count");assert.equal(count.querySelector("span").textContent,"1");
  h.spectators.splice(0,1);await h.ui.refresh();await flush();assert.equal(count.hidden,false);assert.equal(count.querySelector("span").textContent,"0");
});
test("spectator migration adds RLS and durable role uniqueness, TTL count, lifecycle vocabulary only",()=>{
  assert.match(spectatorSql,/primary key\(session_id,user_id\)/);
  assert.match(spectatorSql,/lifecycle_status in \('alive','eliminated','left'\)/);
  assert.match(spectatorSql,/create trigger trottl_special_spectator_role_guard/);
  assert.match(spectatorSql,/create trigger trottl_special_player_role_guard/);
  assert.match(spectatorSql,/pg_advisory_xact_lock\(337734/);
  assert.match(spectatorSql,/where s.id=new.session_id for update/);
  assert.match(spectatorSql,/TROTTL_SPECIAL_ALREADY_PLAYER/);assert.match(spectatorSql,/TROTTL_SPECIAL_ALREADY_SPECTATOR/);
  assert.match(spectatorSql,/v_session.room_slot<>p_room_slot or v_session.status<>'playing'/);
  assert.match(spectatorSql,/on conflict\(session_id,user_id\) do update set last_seen_at/);
  assert.match(spectatorSql,/last_seen_at>pg_catalog.clock_timestamp\(\)-interval '120 seconds'/);
  assert.match(spectatorSql,/using\(public.is_trottl_special_viewer\(session_id\)\)/);
  assert.doesNotMatch(spectatorSql,/grant (insert|update|delete)/i);
  assert.doesNotMatch(spectatorSql.replace(/--[^\n]*/g,""),/trottl_classic|winner|finale|set lifecycle_status/);
});
test("all existing Special player mutations remain behind the new alive-player guard",()=>{
  const foundation=read("supabase/migrations/20260913010000_add_trottl_special_foundation.sql");
  for(const name of ["heartbeat_trottl_special_session","cleanup_trottl_special_lobby","set_trottl_special_ready",
    "set_trottl_special_avatar","start_trottl_special_session","leave_trottl_special_session","kick_trottl_special_player"]){
    const body=foundation.slice(foundation.indexOf(`create function public.${name}`)).split("end; $$;")[0];
    assert.match(body,/lock_trottl_special_session\(p_session_id\)/);
  }
  const guard=spectatorSql.match(/create or replace function public\.lock_trottl_special_session[\s\S]*?end; \$\$;/)[0];
  assert.match(guard,/p.user_id=auth.uid\(\) and p.lifecycle_status='alive'/);
  assert.doesNotMatch(guard,/trottl_special_spectators/);
});

for(const status of ["lobby",null])test(`non-running room uses player join, not spectator modal: ${status}`,async()=>{
  const h=harness();h.rows.special.status=status;h.rows.special.is_member=false;
  await h.ui.openRooms();await flush();h.doc.querySelector("#trottl-special-room-list").children[0].click();await flush();
  assert.ok(h.calls.some(x=>x.name==="join_trottl_special_room"));
  assert.ok(!h.calls.some(x=>x.name==="join_trottl_special_spectator"));
  assert.equal(h.doc.querySelector("#trottl-special-spectator-modal").hidden,true);
});

test("spectator reads identical public game state and subscribes to session updates",async()=>{
  const h=await spectatorHarness();await watch(h);h.rows.special.game_state={public_event:"foundation-only"};
  const snapshot=await h.service.loadSession("special-1");assert.equal(snapshot.gameState,undefined);
  assert.equal(snapshot.session.gameState.public_event,"foundation-only");
  assert.ok(h.channels.some(ch=>ch.handlers.some(handler=>handler.options.table==="trottl_special_sessions"&&handler.options.filter==="id=eq.special-1")));
});

for (const change of ["host", "count", "started"]) test(`final start is refused after popup lobby change: ${change}`,async()=>{
  const h=harness();await h.ui.openRooms();await flush();h.doc.querySelector("#trottl-special-room-list").children[0].click();await flush();
  h.doc.querySelector("#trottl-special-start").click();
  if(change==="host")h.rows.special.host_user_id="u1";
  if(change==="count")h.players.splice(2,1);
  if(change==="started")h.rows.special.status="playing";
  h.doc.querySelector("#trottl-special-start-modal").querySelectorAll("button")[1].click();await flush();
  assert.equal(h.calls.filter(x=>x.name==="start_trottl_special_session").length,1);
  assert.equal(h.rows.special.started_at,null);
});

test("more than eight players is rejected by the Special normalizer",()=>{
  const h=harness();assert.throws(()=>h.service.normalizeSession({...h.rows.special,player_count:9}),/Invalid Special/);
});

test("Special ID style aliases reproduce current Classic dock declarations",()=>{
  const classic=read("style.css"),special=read("trottl-special.css");
  const block=(css,selector)=>css.slice(css.indexOf(selector+" {")+selector.length+2).split("}")[0].trim();
  for(const ending of ["four-reset","four-confirm","four-confirm.is-incomplete","four-confirm:not(:disabled):not(.is-incomplete)","four-confirm.is-incomplete::before","game-feedback"]){
    assert.equal(block(special,`.trottl-classic-rule-controls #trottl-special-${ending}`),
      block(classic,`.trottl-classic-rule-controls #trottl-classic-${ending}`));
  }
});
test("Special uses exactly the same frozen seat, avatar and background-fit presentation functions",()=>{
  const h=harness();const p=h.win.TrottlSpecialPresentation,c=h.win.TrottlClassicUI;
  for(const count of [3,4,5,6,7,8])assert.equal(p.getTableSeatPreset(count),c.getTableSeatPreset(count));
  assert.equal(p.createGameAvatarPresentation,c.createGameAvatarPresentation);
  assert.equal(p.createPlayerCardPresentation,c.createPlayerCardPresentation);
  assert.match(read("trottl-special-presentation.js"),/FischteichClassicBackgroundFit\.calculateFit/);
  assert.equal(p.gameBackgroundAsset,"./assets/3er-trottl-ingame-background-v2.png?v=2");
  assert.match(read("trottl-special-ui.js"),/rollOnClick: false/);
  assert.doesNotMatch(read("trottl-special-service.js"),/roll_trottl|assign_trottl|reaction|ack_trottl/);
});
test("server migration has independent keys, locked join/start validation and no Classic mutations",()=>{
  assert.match(sql,/mode = 'special'/);assert.match(sql,/on public\.trottl_special_sessions\(room_slot\)/);
  assert.match(sql,/pg_advisory_xact_lock\(337734/);assert.doesNotMatch(sql,/337733/);
  assert.match(sql,/if found and v_session\.status='playing' then[\s\S]*TROTTL_SPECIAL_GAME_ALREADY_STARTED/);
  assert.ok(sql.indexOf("return v_existing.id")<sql.indexOf("TROTTL_SPECIAL_GAME_ALREADY_STARTED"));
  const start=sql.match(/create function public\.start_trottl_special_session[\s\S]*?end; \$\$;/)[0];
  assert.match(start,/lock_trottl_special_session/);assert.match(start,/host_user_id<>auth\.uid/);
  assert.match(start,/v_count<3 or v_count>8/);assert.match(start,/not p\.is_ready/);
  assert.match(start,/status<>'lobby'/);assert.match(start,/cleanup_trottl_special_lobby/);
  assert.match(sql,/generate_series\(0,7\)/);assert.match(sql,/TROTTL_SPECIAL_ROOM_FULL/);
  assert.match(sql,/enable row level security/);assert.match(sql,/revoke all on function public\.lock_trottl_special_session/);
  assert.doesNotMatch(sql,/(?:alter|update|delete from|insert into|create or replace function) public\.trottl_classic/);
});
test("Classic code and stylesheet stay byte-identical to the finished current master",()=>{
  const hashes={"style.css":"860b731f11905d157fdfbd8b1b3ca850b0eea1b0bb5a7c4f99c10bf3de0ed0b8",
    "trottl-classic-ui.js":"cb1b68f158ed59b0f9eeee212d27e8ea010b1b36aa348d9e13d2cdcff1650650",
    "trottl-classic-service.js":"cfb53ae6de0d9133275849a7d5a11551ff6962e63de61e77c05aebb4a45f14c0",
    "classic-background-fit.js":"99c7395479f98673ab6a17299d6b54c8237038252569a23149ea19cce47b44b3"};
  for(const [f,hash]of Object.entries(hashes))assert.equal(crypto.createHash("sha256").update(read(f)).digest("hex"),hash,f);
  const css=read("trottl-special.css");
  for(const selector of css.matchAll(/([^{}]+)\{/g))assert.ok(selector[1].includes("special")||selector[1].includes("@media")||/^\s*\d+%(?:,\s*\d+%)*\s*$/.test(selector[1]),selector[1]);
});
