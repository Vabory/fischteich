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
  const doc = createDocument(read("index.html")), calls=[], channels=[], store=new Map(), spectators=[], timeouts=new Map(); let timeoutId=0, inputId=0;
  let userId = "u0", gameRPC = null, rouletteRPC = null, numberHuntRPC = null, serverTime = null;
  const players = Array.from({length:count}, (_,seat_index) => ({ session_id:"special-1",user_id:`u${seat_index}`,
    seat_index,display_name_snapshot:`Spieler ${seat_index}`,avatar_id:"turbo-lachs",is_ready:true,lives:3,lifecycle_status:"alive",critical_used:false,joined_at:"2026-09-13",last_seen_at:"2026-09-13" }));
  const rows = { special: { id:"special-1",mode:"special",room_slot:1,status:"lobby",host_user_id:"u0",player_count:count,
    current_turn_seat:null,started_at:null,game_state:{} }, classic: { id:"classic-1",mode:"classic",room_slot:1,status:"lobby",host_user_id:"u0",player_count:5 } };
  const client = {
    async rpc(name,p={}) {
      calls.push({name,p}); const mode=name.includes("special")?"special":"classic", row=rows[mode];
      if (name==="act_trottl_special_game" && gameRPC) return gameRPC(p);
      if (name==="act_trottl_special_roulette" && rouletteRPC) return rouletteRPC(p);
      if (name==="tap_trottl_special_number_hunt" && numberHuntRPC) return numberHuntRPC(p);
      if (name==="get_trottl_special_server_time" && serverTime!==null) return {data:new Date(serverTime).toISOString(),error:null};
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
  const win={document:doc,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++inputId).padStart(12,"0")}`},localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},
    addEventListener(){},requestAnimationFrame(){return 1;},MutationObserver:class{observe(){}},
    setInterval(){return 1;},clearInterval(){},setTimeout(fn,ms){const id=++timeoutId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);}};
  const context=vm.createContext({window:win,document:doc,console,supabaseClient:client,
    getLocalIdentity:()=>({displayName:"Spieler 0",deviceId:"device"}),initializeAppAuth:async()=>{},
    syncCurrentAuthProfileDisplayName:async()=>{},getAppAuthState:()=>({currentAuthUser:{id:userId},currentProfile:{displayName:"Spieler 0"}})});
  for(const file of ["trottl-avatar-service.js","trottl-classic-service.js","trottl-classic-ui.js","classic-background-fit.js","trottl-special-service.js","trottl-special-presentation.js","trottl-special-panic.js","trottl-special-roulette.js","trottl-special-minigames.js","trottl-special-number-hunt.js","trottl-special-fish-catch.js","trottl-special-debug.js","trottl-special-ui.js"])vm.runInContext(read(file),context);
  win.FischteichDice={mount:({mountPoint,rollOnClick})=>{assert.equal(rollOnClick,false);const die=doc.createElement("button");die.className="fischteich-die";mountPoint.append(die);return {setResultInstant(){}};}};
  const ui=win.TrottlSpecialUI.create({showScreen:screen=>{for(const item of doc.querySelectorAll(".screen"))item.hidden=item!==screen;},showTrottlMenu:()=>{for(const item of doc.querySelectorAll(".screen"))item.hidden=item.id!=="trottl-menu-screen";}});
  return {doc,win,ui,calls,channels,rows,players,spectators,store,timeouts,setUser:id=>{userId=id;},setGameRPC:fn=>{gameRPC=fn;},setRouletteRPC:fn=>{rouletteRPC=fn;},setNumberHuntRPC:fn=>{numberHuntRPC=fn;},setServerTime:t=>{serverTime=t;},service:win.trottlSpecialService};
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

function rouletteFixture(overrides={}) {
 return {round_id:"r1",chosen_color:"RED",result_color:"RED",reward:null,target:null,reward_done:false,
  available:{attack:true,heal:false,transfer:false},shots:{},shot_acks:{},end_offset:-3522,...overrides};
}
test("automatic resolve remains single-flight during realtime rerenders and obsolete callbacks cannot mutate a later turn",async()=>{
 const h=harness();let release;h.setGameRPC(()=>new Promise(r=>{release=r;}));
 await openGame(h,{phase:"rolling",deadline:new Date(Date.now()-1000).toISOString()});
 const old=[...h.timeouts.values()].find(t=>t.ms<=100).fn;old();await flush();await h.ui.refresh();await flush();old();await flush();
 assert.equal(h.calls.filter(c=>c.name==="act_trottl_special_game").length,1);assert.equal(h.timeouts.size,0);
 h.rows.special.game_state={...h.rows.special.game_state,phase:"awaiting_roll",roll_seq:5,revision:2};release({data:"special-1",error:null});await flush();old();await flush();
 assert.equal(h.calls.filter(c=>c.name==="act_trottl_special_game").length,1);assert.equal(h.doc.querySelector("#trottl-special-game-feedback").textContent,"");
});
test("concurrent server turn resolution causing stale automatic action reconciles without false user-error",async()=>{
 const h=harness();h.setGameRPC(p=>{assert.equal(p.p_action,"resolve");h.rows.special.game_state={...h.rows.special.game_state,phase:"awaiting_roll",roll_seq:5,revision:2};return {error:Error("TROTTL_SPECIAL_STALE_ACTION")};});
 await openGame(h,{phase:"rolling",deadline:new Date(Date.now()-1000).toISOString()});[...h.timeouts.values()].find(t=>t.ms<=100).fn();await flush();
 assert.equal(h.doc.querySelector("#trottl-special-game-feedback").textContent,"");assert.equal(h.rows.special.game_state.roll_seq,5);
});
test("real rejected user action retains reconcile feedback; successful action clears it and realtime alone sends no action",async()=>{
 const h=harness();h.setGameRPC(()=>({error:Error("TROTTL_SPECIAL_NOT_ACTOR")}));await openGame(h,{});
 h.doc.querySelector(".fischteich-die").click();await flush();const message=h.doc.querySelector("#trottl-special-game-feedback");assert.match(message.textContent,/Aktion nicht übernommen/);
 const calls=h.calls.filter(c=>c.name==="act_trottl_special_game").length;await h.ui.refresh();await flush();assert.equal(h.calls.filter(c=>c.name==="act_trottl_special_game").length,calls);
 h.setGameRPC(()=>({data:"special-1",error:null}));h.doc.querySelector(".fischteich-die").click();await flush();assert.equal(message.textContent,"");
});
test("already persisted result ACK with lost response is not treated as failed user action",async()=>{
 const h=harness(),m=minigameFixture(h,{minigame_type:"panic",title:"PANIK"});await openGame(h,{phase:"panic_results",minigame:m});
 h.setGameRPC(()=>{h.rows.special.game_state={...h.rows.special.game_state,revision:2,minigame:{...m,result_seen:{u0:true}}};return {error:Error("reply lost")};});
 h.doc.querySelector(".trottl-special-panic-result-confirm").click();await flush();assert.equal(h.doc.querySelector("#trottl-special-game-feedback").textContent,"");
});
for(const n of [3,4,5,6,7,8])test(`PANIK result ${n} players has internal confirm, pure value and life-loss next to identity`,async()=>{
 const h=harness(n),m=minigameFixture(h,{minigame_type:"panic",title:"PANIK"});m.results=[{player_id:"u0",display_name:"Sportakus",display_value:"63 Taps",rank:3,is_loser:true,life_loss:1}];
 await openGame(h,{phase:"panic_results",minigame:m});const p=h.doc.querySelector(".trottl-special-minigame-results");
 assert.equal(p.querySelector("h2").textContent,"Ergebnisse von Panik Event");assert.doesNotMatch(p.textContent,/Ergebnis bestätigen, um fortzufahren/);
 assert.equal(p.querySelector(".trottl-special-panic-result-confirm").parentNode,p);
 assert.equal(p.querySelector(".trottl-special-result-value").textContent,"63 Taps");assert.equal(p.querySelector(".trottl-special-result-identity").textContent,"Sportakus−1 Leben");
 assert.equal(h.doc.querySelector("#trottl-special-event-player").textContent,"");assert.equal(h.doc.querySelector("#trottl-special-event-copy").textContent,"PANIK – ERGEBNIS");
});
for(const uid of ["u0","u1","u2","watch"])test(`winner distribution identity comes from local allocation not original actor: ${uid}`,async()=>{
 const h=harness(4);h.setUser(uid);if(uid==="watch")h.spectators.push({user_id:uid,session_id:"special-1"});
 await openGame(h,{phase:"minigame_distribution",actor:"u2",minigame:minigameFixture(h),drinks:{u2:2,u3:1}});
 assert.equal(h.doc.querySelector("#trottl-special-event-player").textContent,uid==="u0"?"Spieler 0":uid==="u1"?"Spieler 1":"");
 if(uid==="u0"||uid==="u1"){assert.ok(h.doc.querySelector("#trottl-special-rule-controls").classList.contains("has-actions"));assert.equal(h.doc.querySelector("#trottl-special-four-reset").textContent,"Rückgängig");}
 const badges=h.doc.querySelectorAll(".trottl-special-minigame-drinks");assert.deepEqual(badges.map(b=>b.textContent),["2 Schlücke","1 Schluck"]);
});
for(const life of ["alive","critical","eliminated"])test(`last-chance overlay badge is exclusive to critical and does not change coordinates: ${life}`,async()=>{
 const h=harness();if(life!=="alive")Object.assign(h.players[1],{lifecycle_status:life,lives:0,critical_used:true});await openGame(h,{});
 const seat=h.doc.querySelector("#trottl-special-seat-layer").children[1];assert.equal(seat.style["--seat-left"],"16%");assert.equal(seat.style["--seat-top"],"29%");
 assert.equal(Boolean(seat.querySelector(".trottl-special-critical-badge")),life==="critical");
});
test("spectator observes critical badge without any additional mutation rights",async()=>{
 const h=harness();h.setUser("watch");h.spectators.push({user_id:"watch",session_id:"special-1"});Object.assign(h.players[1],{lives:0,lifecycle_status:"critical",critical_used:true});await openGame(h,{});
 assert.equal(h.doc.querySelector(".trottl-special-critical-badge").textContent,"LETZTE CHANCE!");assert.equal(h.doc.querySelector(".fischteich-die").disabled,true);
});
function numberHuntFixture() {
 const start=Date.now()-1000;
 return {minigame_id:"hunt-1",minigame_type:"special_minigame_01",title:"Zahlenjagd",title_started_at:new Date(start-5000).toISOString(),
  title_ends_at:new Date(start-3000).toISOString(),start_at:new Date(start).toISOString(),participants:[{player_id:"u0"},{player_id:"u1"},{player_id:"u2"}],
  runs:{u0:{board:[9,8,7,6,5,4,3,2,1],progress:0,completed:false},u1:{board:[1,3,2,4,6,5,7,9,8],progress:9,completed:true,elapsed_ms:999},u2:{board:[1,2,3,4,5,6,7,8,9],progress:0,completed:false}}};
}
test("number hunt adds only avatar glows and leaves exact table/seat/background geometry untouched",async()=>{
 const h=harness(8);h.setServerTime(Date.now());await openGame(h,{});
 const geometry=()=>h.doc.querySelector("#trottl-special-seat-layer").children.map(x=>[x.style["--seat-left"],x.style["--seat-top"]]);const before=geometry();
 h.rows.special.game_state={...h.rows.special.game_state,phase:"minigame_active",minigame:numberHuntFixture(),revision:2};await h.ui.refresh();await flush();
 assert.deepEqual(geometry(),before);assert.equal(h.doc.querySelectorAll(".trottl-special-minigame-done").length,1);assert.equal(h.doc.querySelectorAll(".trottl-special-minigame-waiting").length,2);
 assert.equal(h.doc.querySelector(".trottl-special-minigame-shell").hidden,false);assert.equal(h.doc.querySelector(".trottl-special-number-hunt-board").children.length,9);
});
test("number hunt host view follows current host and spectators have no writable controls",async()=>{
 const h=harness();h.setUser("watch");h.spectators.push({user_id:"watch",session_id:"special-1"});h.setServerTime(Date.now());
 await openGame(h,{phase:"minigame_active",minigame:numberHuntFixture()});
 const board=()=>h.doc.querySelector(".trottl-special-number-hunt-board").children;
 assert.deepEqual(board().map(x=>x.textContent),["9","8","7","6","5","4","3","2","1"]);assert.ok(board().every(x=>x.disabled));
 h.rows.special.host_user_id="u1";h.rows.special.game_state={...h.rows.special.game_state,revision:2};await h.ui.refresh();await flush();
 assert.deepEqual(board().map(x=>x.textContent),["1","3","2","4","6","5","7","9","8"]);
 assert.match(h.doc.querySelector(".trottl-special-minigame-copy").textContent,/Host fertig/);
 assert.equal(h.calls.filter(x=>x.name==="tap_trottl_special_number_hunt").length,0);
});
test("number hunt service sends own round, ordered number and only final frozen measurement",async()=>{
 const h=harness();await h.service.tapNumberHunt("special-1","hunt-1",9,1234);
 assert.deepEqual({...h.calls.find(x=>x.name==="tap_trottl_special_number_hunt").p},{p_session_id:"special-1",p_round_id:"hunt-1",p_number:9,p_elapsed_ms:1234,p_input_id:null,p_input_seq:null});
});
test("full minigame tie presents all-winner result and retains each winner's two-drink dock",async()=>{
 const h=harness();const m=minigameFixture(h);m.all_tied=true;m.draw=false;m.winners=["u0","u1","u2"];
 m.results=m.results.map(r=>({...r,rank:1,is_winner:true,is_loser:false}));m.automatic_drinks={};m.distributions={u0:{drinks:{},confirmed:false},u1:{drinks:{},confirmed:false},u2:{drinks:{},confirmed:false}};
 await openGame(h,{phase:"minigame_results",minigame:m});assert.match(h.doc.querySelector(".trottl-special-minigame-results").querySelector("p").textContent,/Alle gleich – alle Gewinner/);
 h.rows.special.game_state={...h.rows.special.game_state,phase:"minigame_distribution",revision:2};await h.ui.refresh();await flush();
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"0 / 2");
});
test("roulette actor color selection sends only server intent and preserves all seat geometry",async()=>{
 const h=harness(7);await openGame(h,{});
 const geometry=()=>h.doc.querySelector("#trottl-special-seat-layer").children.map(x=>[x.style["--seat-left"],x.style["--seat-top"]]);
 const before=geometry(),bg=h.doc.querySelector("#trottl-special-session-background").src;
 h.rows.special.game_state={...h.rows.special.game_state,phase:"roulette_choose_color",roulette:rouletteFixture({chosen_color:null,result_color:null}),revision:2};await h.ui.refresh();await flush();
 assert.deepEqual(geometry(),before);assert.equal(h.doc.querySelector("#trottl-special-session-background").src,bg);
 const b=h.doc.querySelector(".trottl-special-roulette-colors").children;assert.equal(b.length,3);assert.ok(b.every(x=>!x.disabled));
 b[0].click();await flush();const call=h.calls.find(x=>x.name==="act_trottl_special_roulette");
 assert.deepEqual({...call.p},{p_session_id:"special-1",p_round_id:"r1",p_action:"color",p_value:"RED",p_target:null});
 assert.equal(h.doc.querySelector(".fischteich-die").disabled,true);
});
for(const who of ["other","spectator","eliminated"])test(`roulette selection and reward are readonly for ${who}`,async()=>{
 const h=harness();if(who==="other")h.setUser("u1");
 if(who==="spectator"){h.setUser("watch");h.spectators.push({user_id:"watch",session_id:"special-1"});}
 if(who==="eliminated")Object.assign(h.players[0],{lives:0,lifecycle_status:"eliminated",critical_used:true});
 await openGame(h,{phase:"roulette_choose_color",roulette:rouletteFixture({chosen_color:null,result_color:null})});
 assert.ok(h.doc.querySelector(".trottl-special-roulette-colors").children.every(b=>b.disabled));
 h.rows.special.game_state={...h.rows.special.game_state,phase:"roulette_settlement",roulette:rouletteFixture(),revision:2};await h.ui.refresh();await flush();
 assert.equal(h.doc.querySelector(".trottl-special-roulette-rewards").children.length,3);
 assert.ok(h.doc.querySelector(".trottl-special-roulette-rewards").children.every(b=>b.disabled));
 assert.equal(h.doc.querySelector("#trottl-special-rule-controls").querySelectorAll(".trottl-special-target").length,0);
});
test("roulette reward cards remain visible, disabled availability and selected color follow server snapshot",async()=>{
 const h=harness();await openGame(h,{phase:"roulette_settlement",roulette:rouletteFixture()});
 const cards=h.doc.querySelector(".trottl-special-roulette-rewards").children;
 assert.deepEqual(cards.map(b=>b.disabled),[false,true,true]);cards[0].click();await flush();
 assert.equal(h.calls.find(x=>x.name==="act_trottl_special_roulette").p.p_action,"reward");
 const colors=h.doc.querySelector(".trottl-special-roulette-colors").children;
 assert.ok(colors[0].classList.contains("is-selected"));assert.ok(colors[1].classList.contains("is-dimmed"));
});
test("roulette target dock excludes self/critical/dead, early confirm flashes, and target click never confirms",async()=>{
 const h=harness(4);Object.assign(h.players[1],{lives:0,lifecycle_status:"critical",critical_used:true});
 Object.assign(h.players[2],{lives:0,lifecycle_status:"eliminated",critical_used:true});
 await openGame(h,{phase:"roulette_settlement",roulette:rouletteFixture({reward:"attack"})});
 assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,1);
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"0 / 1");
 h.doc.querySelector("#trottl-special-four-confirm").click();await flush();
 assert.ok(h.doc.querySelector("#trottl-special-action-progress").classList.contains("is-incomplete-hint"));
 assert.equal(h.calls.filter(x=>x.name==="act_trottl_special_roulette").length,0);
 h.doc.querySelector(".trottl-special-target").click();await flush();
 const call=h.calls.find(x=>x.name==="act_trottl_special_roulette");assert.equal(call.p.p_action,"target");assert.equal(call.p.p_target,"u3");
 assert.ok(h.players.every(p=>p.lives===(p.user_id==="u1"||p.user_id==="u2"?0:3)));
});
for(const reward of ["attack","transfer","heal"])test(`roulette restores pending ${reward}, confirm and undo use own event RPC`,async()=>{
 const h=harness();await openGame(h,{phase:"roulette_settlement",roulette:rouletteFixture({reward,target:reward==="heal"?null:"u1"})});
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,reward==="heal"?"+1 Leben":"1 / 1");
 h.doc.querySelector("#trottl-special-four-confirm").click();await flush();
 h.doc.querySelector("#trottl-special-four-reset").click();await flush();
 assert.deepEqual(h.calls.filter(x=>x.name==="act_trottl_special_roulette").map(x=>x.p.p_action),["confirm","undo"]);
 assert.equal(h.calls.filter(x=>x.name==="act_trottl_special_game").length,0);
});
for(const life of ["alive","critical","eliminated"])test(`green shot ACK is own-only and lifecycle-gated: ${life}`,async()=>{
 const h=harness();h.setUser("u1");if(life!=="alive")Object.assign(h.players[1],{lifecycle_status:life,lives:0,critical_used:true});
 await openGame(h,{phase:"roulette_settlement",roulette:rouletteFixture({chosen_color:"GREEN",result_color:"GREEN",shots:{u1:1,u2:1}})});
 const ack=h.doc.querySelector("#trottl-special-global-confirm");assert.equal(ack.hidden,life==="eliminated");
 assert.equal(h.doc.querySelectorAll(".trottl-classic-seat-status-overlay").length,2);
 if(life!=="eliminated"){ack.click();await flush();assert.equal(h.calls.find(x=>x.name==="act_trottl_special_roulette").p.p_action,"shot_ack");}
});
test("confirmed roulette reward leaves other players' outstanding shots available on reconnect",async()=>{
 const h=harness();h.setUser("u1");await openGame(h,{phase:"roulette_settlement",roulette:rouletteFixture({chosen_color:"GREEN",result_color:"GREEN",reward:"heal",reward_done:true,shots:{u1:1,u2:1},shot_acks:{u2:true}})});
 assert.equal(h.doc.querySelector("#trottl-special-global-confirm").hidden,false);
 assert.equal(h.doc.querySelector("#trottl-special-four-confirm").hidden,true);
 assert.ok(h.doc.querySelector(".trottl-special-roulette-rewards").children.every(b=>b.disabled));
});
test("roulette overlay disappears outside Special game without moving its parent",async()=>{
 const h=harness();await openGame(h,{phase:"roulette_choose_color",roulette:rouletteFixture({chosen_color:null})});
 assert.equal(h.doc.querySelector(".trottl-special-roulette").hidden,false);
 h.rows.special.game_state={...h.rows.special.game_state,phase:"awaiting_roll",revision:2};await h.ui.refresh();await flush();
 assert.equal(h.doc.querySelector(".trottl-special-roulette").hidden,true);
 assert.equal(h.doc.querySelector(".trottl-special-roulette").parentNode.id,"trottl-special-game-view");
});

async function openGame(h, g) {
  h.rows.special.status="playing"; h.rows.special.current_turn_seat=0;
  h.rows.special.game_state={phase:"awaiting_roll",actor:"u0",actor_seat:0,roll_seq:4,revision:1,trottl:null,points:0,...g};
  await h.ui.openRooms(); await flush(); h.doc.querySelector("#trottl-special-room-list").children[0].click(); await flush();
}
test("temporary TEST is mounted only in Special game view, survives host swap, disappears for spectators",async()=>{
 const h=harness();await openGame(h,{});const b=h.doc.querySelector(".trottl-special-test-button");
 assert.equal(b.parentNode.id,"trottl-special-game-view");assert.equal(b.hidden,false);
 assert.equal(h.doc.querySelector("#trottl-classic-session-screen").querySelector(".trottl-special-test-button"),null);
 h.rows.special.host_user_id="u1";await h.ui.refresh();assert.equal(b.hidden,true);
 h.rows.special.host_user_id="u0";await h.ui.refresh();assert.equal(b.hidden,false);
 h.setUser("watcher");h.spectators.push({session_id:"special-1",user_id:"watcher"});await h.ui.refresh();assert.equal(b.hidden,true);
});
test("fish controller mounts shared shell; completed green/unfinished white seats derive from authoritative fish runs",async()=>{
 const h=harness(),now=Date.now();h.setServerTime(now);
 await openGame(h,{phase:"minigame_active",minigame:{minigame_id:"f1",minigame_type:"special_minigame_02",title:"Fischfang",title_started_at:new Date(now-7000).toISOString(),title_ends_at:new Date(now-5000).toISOString(),start_at:new Date(now-2000).toISOString(),end_at:new Date(now+8000).toISOString(),participants:[{player_id:"u0"},{player_id:"u1"},{player_id:"u2"}],runs:{u0:{seed:123,score:0,hits:[],completed:false},u1:{seed:42,score:5,hits:[],completed:true},u2:{seed:99,score:0,hits:[],completed:false}}}});
 const seats=h.doc.querySelector("#trottl-special-seat-layer").children;
 assert.ok(seats[1].querySelector(".trottl-special-minigame-done"));assert.ok(seats[0].querySelector(".trottl-special-minigame-waiting"));
 assert.equal(h.doc.querySelector(".trottl-special-fish-field").parentNode.parentNode.hidden,false);
 assert.equal(h.doc.querySelector(".trottl-special-number-hunt-board").parentNode.parentNode.hidden,true);
});
test("debug pending state comes from server row and fish/debug RPC payloads stay Special-only",async()=>{
 const h=harness();h.rows.special.debug_test={next_roll:4,next_minigame:"special_minigame_02"};await openGame(h,{});
 h.doc.querySelector(".trottl-special-test-button").click();assert.match(h.doc.querySelector(".trottl-special-test-panel").querySelector("p").textContent,/Nächster Würfel: 4.*Fischfang/);
 await h.service.setDebugNext("special-1",6,"special_minigame_01");await h.service.saveFishCatch("special-1","f1",1,[{index:0,at:10}],true);
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c.name==="set_trottl_special_debug_next").p)),{p_session_id:"special-1",p_roll:6,p_minigame:"special_minigame_01"});
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c.name==="save_trottl_special_fish_catch").p)),{p_session_id:"special-1",p_round_id:"f1",p_score:1,p_hits:[{index:0,at:10}],p_final:true});
 assert.ok(h.calls.every(c=>!c.name?.startsWith("act_trottl_classic")));
});
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
const minigameSQL=read("supabase/migrations/20260913040000_add_trottl_special_minigame_framework.sql");
function minigameFixture(h, overrides={}) {
 return {minigame_id:"round-1",minigame_type:"special_minigame_01",ranking_direction:"higher_is_better",status:"distribution",draw:false,
  participants:h.players.map(p=>({player_id:p.user_id,display_name:p.display_name_snapshot})),
  results:[{player_id:"u0",raw_value:100,display_value:"100 Punkte",rank:1,is_winner:true,is_loser:false},
   {player_id:"u1",raw_value:100,display_value:"100 Punkte",rank:1,is_winner:true,is_loser:false},
   {player_id:"u3",raw_value:50,display_value:"50 Punkte",rank:3,is_winner:false,is_loser:false},
   {player_id:"u2",raw_value:20,display_value:"20 Punkte",rank:4,is_winner:false,is_loser:true}],
  winners:["u0","u1"],losers:["u2"],result_seen:{},automatic_drinks:{u2:2},
  distributions:{u0:{drinks:{},confirmed:false,cancelled:false},u1:{drinks:{},confirmed:false,cancelled:false}},...overrides};
}
test("minigame result panel presents server ranking, ties and winner/loser flags without changing seat presets",async()=>{
 const h=harness(4),m=minigameFixture(h);await openGame(h,{phase:"minigame_results",minigame:m});
 const panel=h.doc.querySelector(".trottl-special-minigame-results");
 assert.equal(panel.hidden,false);assert.equal(panel.querySelector("ol").children.length,4);
 assert.equal(panel.querySelectorAll(".is-winner").length,2);assert.equal(panel.querySelectorAll(".is-loser").length,1);
 assert.equal(h.doc.querySelector("#trottl-special-global-confirm").textContent,"ERGEBNIS BESTÄTIGEN");
 const seats=h.doc.querySelector("#trottl-special-seat-layer").children;
 assert.equal(seats[0].style["--seat-top"],"87%");
});
test("draw results use explicit outcome and never expose winner distribution or premature drink ACK",async()=>{
 const h=harness(4);await openGame(h,{phase:"minigame_results",minigame:minigameFixture(h,{draw:true,winners:[],losers:[],distributions:{},automatic_drinks:{}}),drinks:{}});
 assert.equal(h.doc.querySelector("#trottl-special-event-copy").textContent,"Unentschieden");
 assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,0);
 assert.equal(h.doc.querySelector("#trottl-special-four-confirm").hidden,true);
 assert.equal(h.doc.querySelector("#trottl-special-global-confirm").textContent,"ERGEBNIS BESTÄTIGEN");
});
test("local winner dock tracks own allocation rather than aggregate or actor; other winner stays independently usable",async()=>{
 const h=harness(4);const m=minigameFixture(h);
 m.distributions.u0.drinks={u2:1};await openGame(h,{phase:"minigame_distribution",actor:"u3",minigame:m,drinks:{u2:3}});
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"1 / 2");
 assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,4);
 h.setUser("u1");await h.ui.refresh();await flush();
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"0 / 2");
 assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,4);
});
test("confirmed winner loses its dock while unconfirmed winner retains it and losers cannot ACK yet",async()=>{
 const h=harness(4),m=minigameFixture(h);m.distributions.u0={drinks:{u2:1,u3:1},confirmed:true,cancelled:false};
 await openGame(h,{phase:"minigame_distribution",minigame:m,drinks:{u2:3,u3:1},acks:{}});
 assert.equal(h.doc.querySelector("#trottl-special-four-confirm").hidden,true);
 assert.equal(h.doc.querySelector("#trottl-special-event-action").textContent,"Verteilung bestätigt");
 h.setUser("u2");await h.ui.refresh();await flush();assert.equal(h.doc.querySelector("#trottl-special-global-confirm").hidden,true);
 h.setUser("u1");await h.ui.refresh();await flush();assert.equal(h.doc.querySelector("#trottl-special-four-confirm").hidden,false);
});
for(const phase of ["minigame_results","minigame_distribution","drink_ack"]) test(`spectator sees public minigame ${phase} without result/distribution/drink controls`,async()=>{
 const h=harness(4);h.spectators.push({session_id:"special-1",user_id:"watcher"});h.setUser("watcher");
 await openGame(h,{phase,minigame:minigameFixture(h),drinks:{u2:4,u3:1},acks:{}});
 assert.equal(h.doc.querySelector("#trottl-special-rule-controls").hidden,true);
 assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,0);
 assert.equal(h.doc.querySelector("#trottl-special-global-confirm").hidden,true);
 if(phase==="minigame_results") assert.equal(h.doc.querySelector(".trottl-special-minigame-results").hidden,false);
});
test("critical winner can distribute to self and critical recipients using the same dock",async()=>{
 const h=harness(4);Object.assign(h.players[0],{lives:0,lifecycle_status:"critical",critical_used:true});
 await openGame(h,{phase:"minigame_distribution",actor:"u3",minigame:minigameFixture(h),drinks:{u2:2}});
 assert.equal(h.doc.querySelectorAll(".trottl-special-target").length,4);
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"0 / 2");
});
test("late spectator can inspect stored ranking during distribution without any mutation intent",async()=>{
 const h=harness(4);h.spectators.push({session_id:"special-1",user_id:"watcher"});h.setUser("watcher");
 await openGame(h,{phase:"minigame_distribution",minigame:minigameFixture(h),drinks:{u2:2}});
 const panel=h.doc.querySelector(".trottl-special-minigame-results"),toggle=h.doc.querySelector(".trottl-special-minigame-result-toggle");
 assert.equal(panel.hidden,true);assert.equal(toggle.hidden,false);toggle.click();assert.equal(panel.hidden,false);
 assert.equal(panel.querySelector("ol").children.length,4);toggle.click();assert.equal(panel.hidden,true);
 assert.equal(h.calls.filter(x=>x.name==="act_trottl_special_game").length,0);
});
for(const lifecycle of ["alive","critical","eliminated"])test(`panic result screen reuses ranking/hearts and requires ACK only for active ${lifecycle}`,async()=>{
 const h=harness(4);Object.assign(h.players[0],{lives:lifecycle==="alive"?2:0,lifecycle_status:lifecycle,critical_used:lifecycle!=="alive"});
 const m=minigameFixture(h,{minigame_type:"panic",title:"PANIK"});m.results[0].life_loss=1;
 await openGame(h,{phase:"panic_results",minigame:m,actor:lifecycle==="eliminated"?null:"u0"});
 const panel=h.doc.querySelector(".trottl-special-minigame-results");assert.equal(panel.hidden,false);assert.equal(panel.querySelector("h2").textContent,"Ergebnisse von Panik Event");
 assert.ok(panel.textContent.includes("−1 Leben"));assert.equal(h.doc.querySelector("#trottl-special-global-confirm").hidden,true);
 assert.equal(panel.querySelector(".trottl-special-panic-result-confirm").hidden,lifecycle==="eliminated");
 assert.equal(h.doc.querySelector("#trottl-special-seat-layer").children.length,4);
});
for(const step of ["results","partial","confirmed","ack"]) test(`reconnect restores minigame ${step} from server snapshot`,async()=>{
 const h=harness(4),m=minigameFixture(h);let phase="minigame_distribution";
 if(step==="results")phase="minigame_results";
 if(step==="partial")m.distributions.u0.drinks={u2:1};
 if(step==="confirmed")m.distributions.u0={drinks:{u2:1,u3:1},confirmed:true,cancelled:false};
 if(step==="ack")phase="drink_ack";
 await openGame(h,{phase,minigame:m,drinks:{u0:1,u2:4,u3:1},acks:{}});
 assert.equal(await h.ui.restoreMembership(),true);await flush();
 if(step==="partial")assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"1 / 2");
 if(step==="confirmed")assert.equal(h.doc.querySelector("#trottl-special-four-confirm").hidden,true);
 if(step==="results")assert.equal(h.doc.querySelector(".trottl-special-minigame-results").hidden,false);
 if(step==="ack")assert.equal(h.doc.querySelector("#trottl-special-global-confirm").textContent,"1 SCHLUCK BESTÄTIGEN");
});
test("winner queue reuses serialized optimistic assignments, waits for server, and sends only local winner intents",async()=>{
 const h=harness(4),m=minigameFixture(h);let release,inFlight=0,maxFlight=0;
 h.setGameRPC(async p=>{
  inFlight++;maxFlight=Math.max(maxFlight,inFlight);if(!release)await new Promise(resolve=>{release=resolve;});
  const g=h.rows.special.game_state,w=g.minigame.distributions.u0;
  if(p.p_action==="assign")w.drinks[p.p_target]=(w.drinks[p.p_target]??0)+1;
  g.revision++;inFlight--;return {data:"special-1",error:null};
 });
 await openGame(h,{phase:"minigame_distribution",actor:"u3",minigame:m,drinks:{u2:2}});
 h.doc.querySelectorAll(".trottl-special-target")[0].click();await flush();h.doc.querySelectorAll(".trottl-special-target")[0].click();await flush();
 assert.equal(h.doc.querySelector("#trottl-special-action-progress-value").textContent,"2 / 2");
 assert.ok(h.doc.querySelector("#trottl-special-four-confirm").classList.contains("is-incomplete"));
 release();await flush();assert.equal(maxFlight,1);assert.deepEqual(h.rows.special.game_state.minigame.distributions.u1.drinks,{});
 assert.equal(h.rows.special.game_state.minigame.distributions.u0.drinks.u0,2);
 assert.equal(h.doc.querySelector("#trottl-special-four-confirm").classList.contains("is-incomplete"),false);
});
test("SQL structure: result ranking is numeric, direction-aware, tied, deterministic and separate from settlement",()=>{
 assert.match(minigameSQL,/rank\(\) over\(order by case when p_direction='higher_is_better'/);
 assert.match(minigameSQL,/v_best<>v_worst and raw_value=v_best/);assert.match(minigameSQL,/v_best<>v_worst and raw_value=v_worst/);
 assert.match(minigameSQL,/'draw',v_best=v_worst/);assert.match(minigameSQL,/jsonb_typeof\(r->'raw_value'\) is distinct from 'number'/);
 const rank=minigameSQL.slice(minigameSQL.indexOf("create function public.special_minigame_rank"),minigameSQL.indexOf("create function public.special_minigame_aggregate"));
 assert.doesNotMatch(rank,/lives|drinks|trottl/);
});
test("SQL structure: parallel winner writers serialize, mutate auth.uid allocation only, freeze confirms, and gate aggregate ACK",()=>{
 assert.match(minigameSQL,/pg_advisory_xact_lock\(337734/);assert.match(minigameSQL,/for update/);
 assert.match(minigameSQL,/w:=m->'distributions'->v_user::text/);assert.match(minigameSQL,/v_used>=2/);assert.match(minigameSQL,/v_used<>2/);
 assert.match(minigameSQL,/w is null or \(w->>'confirmed'\)::boolean or \(w->>'cancelled'\)::boolean/);
 assert.match(minigameSQL,/where not \(w.value->>'confirmed'\)::boolean and not \(w.value->>'cancelled'\)::boolean/);
 assert.match(minigameSQL,/'phase','drink_ack','acks','\{\}'::jsonb/);
});
test("SQL structure: private registry/start/finalize are inaccessible to app roles; productive Roll 4 and Phase 1 delegate unchanged",()=>{
 assert.match(minigameSQL,/special_minigame_pick_slot[\s\S]*floor\(random\(\)\*10\)/);
 assert.match(minigameSQL,/revoke all on function public.special_minigame_pick_slot/);
 const grants=minigameSQL.match(/grant execute[\s\S]*?;/g).join("\n");assert.doesNotMatch(grants,/begin_locked|finalize_locked|rank|pick_slot/);
 assert.match(minigameSQL,/return public.act_trottl_special_phase_one\(p_session_id,p_action,p_roll_seq,p_target\)/);
 assert.match(minigameSQL,/return public.leave_trottl_special_phase_one\(p_session_id\)/);
 assert.doesNotMatch(minigameSQL,/special_lose_life_locked|special_restore_life_locked|public\.trottl_classic/);
});
test("SQL structure: explicit leave cancels unconfirmed winner, retains confirmed history, removes missing targets, and prevents zero-participant hangs",()=>{
 assert.match(minigameSQL,/jsonb_array_length\(v_members\)<2/);assert.match(minigameSQL,/'draw',true,'results','\[\]'::jsonb/);
 assert.match(minigameSQL,/v_winner is not null and not \(v_winner->>'confirmed'\)::boolean/);
 assert.match(minigameSQL,/'drinks','\{\}'::jsonb,'cancelled',true/);
 assert.match(minigameSQL,/case when \(w.value->>'confirmed'\)::boolean then w.value/);
 assert.match(minigameSQL,/lifecycle_status in \('alive','critical'\)/);
 assert.match(minigameSQL,/m->'result_seen' \? \(p->>'player_id'\)/);
});
test("PostgreSQL fixture includes ranking matrix, section 18, guard checks, ACK gate and unchanged life/Trottl assertion",()=>{
 const fixture=read("tests/fixtures/trottl-special-minigame-framework.sql");
 assert.match(fixture,/"values":\[100,100,100,40\]/);assert.match(fixture,/"direction":"lower_is_better"/);
 assert.match(fixture,/Final section 18 settlement regression/);assert.match(fixture,/Premature ACK/);
 assert.match(fixture,/Life \/ critical \/ Trottl regression/);assert.match(fixture,/rollback;/);
});
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
