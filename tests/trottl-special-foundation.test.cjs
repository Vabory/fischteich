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
  const doc = createDocument(read("index.html")), calls=[], channels=[], store=new Map();
  const players = Array.from({length:count}, (_,seat_index) => ({ session_id:"special-1",user_id:`u${seat_index}`,
    seat_index,display_name_snapshot:`Spieler ${seat_index}`,avatar_id:"turbo-lachs",is_ready:true,joined_at:"2026-09-13",last_seen_at:"2026-09-13" }));
  const rows = { special: { id:"special-1",mode:"special",room_slot:1,status:"lobby",host_user_id:"u0",player_count:count,
    current_turn_seat:null,started_at:null,game_state:{} }, classic: { id:"classic-1",mode:"classic",room_slot:1,status:"lobby",host_user_id:"u0",player_count:5 } };
  const client = {
    async rpc(name,p={}) {
      calls.push({name,p}); const mode=name.includes("special")?"special":"classic", row=rows[mode];
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
    syncCurrentAuthProfileDisplayName:async()=>{},getAppAuthState:()=>({currentAuthUser:{id:"u0"},currentProfile:{displayName:"Spieler 0"}})});
  for(const file of ["trottl-avatar-service.js","trottl-classic-service.js","trottl-classic-ui.js","classic-background-fit.js","trottl-special-service.js","trottl-special-presentation.js","trottl-special-ui.js"])vm.runInContext(read(file),context);
  win.FischteichDice={mount:({mountPoint,rollOnClick})=>{assert.equal(rollOnClick,false);const die=doc.createElement("button");die.className="fischteich-die";mountPoint.append(die);return {setResultInstant(){}};}};
  const ui=win.TrottlSpecialUI.create({showScreen:screen=>{for(const item of doc.querySelectorAll(".screen"))item.hidden=item!==screen;},showTrottlMenu:()=>{for(const item of doc.querySelectorAll(".screen"))item.hidden=item.id!=="trottl-menu-screen";}});
  return {doc,win,ui,calls,channels,rows,players,store,service:win.trottlSpecialService};
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
test("running Special room blocks newcomers in UI without hiding reconnect",async()=>{
  const h=harness();h.rows.special.status="playing";h.rows.special.current_turn_seat=0;
  await h.ui.openRooms();await flush();assert.equal(h.doc.querySelector("#trottl-special-room-list").children[0].disabled,false);
  assert.match(h.doc.querySelector("#trottl-special-room-list").children[0].textContent,/Wieder beitreten/);
  h.rows.special.is_member=false;await h.ui.refresh();await flush();
  assert.equal(h.doc.querySelector("#trottl-special-room-list").children[0].disabled,true);
  assert.match(h.doc.querySelector("#trottl-special-room-list").children[0].textContent,/Spiel läuft/);
  assert.match(read("trottl-special-ui.js"),/!room\.isMember && \(room\.status === "playing"/);
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
  for(const selector of css.matchAll(/([^{}]+)\{/g))assert.ok(selector[1].includes("special")||selector[1].includes("@media"),selector[1]);
});
