"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname,".."), read = file => fs.readFileSync(path.join(root,file),"utf8");
const migration = read("supabase/migrations/20260924010000_add_trottl_special_finale_and_winner_flow.sql");
function model(overrides={}) {
  const win = {}; vm.runInNewContext(read("trottl-special-finale.js"),{window:win,Set,Map,Object,Array,Number,Date});
  const finale = { active:true, phase:"ready", finalists:[
    {player_id:"right",seat_index:7,display_name:"Right"},{player_id:"left",seat_index:2,display_name:"Left"}], ready:{}, ...overrides };
  const snapshot = { session:{status:overrides.sessionStatus??"playing",gameState:{finale}},identity:{userId:overrides.userId??"left"},players:overrides.players??[
    {userId:"left",displayName:"Left",avatarId:"a",lives:3,lifecycle:"alive"},{userId:"right",displayName:"Right",avatarId:"b",lives:2,lifecycle:"alive"},
    {userId:"observer",displayName:"Observer",avatarId:"c",lives:0,lifecycle:"eliminated"}] };
  return win.TrottlSpecialFinale.presentation(snapshot);
}

test("finalists are stable by seat and eliminated players stay outside the duel",()=>{const view=model();assert.deepEqual(Array.from(view.finalists,p=>p.userId),["left","right"]);assert.equal(view.finalists.length,2);});
test("ready is one-way in the presentation and only the local living finalist can act",()=>{assert.equal(model().canReady,true);assert.equal(model({ready:{left:true}}).canReady,false);assert.equal(Boolean(model({userId:"observer"}).canReady),false);});
test("draw and score display survive the server result phase",()=>{const view=model({phase:"round_result",result:{draw:true,winner_id:null,loser_id:null,left_display_value:"10 ms",right_display_value:"10 ms"}});assert.equal(view.result.draw,true);assert.equal(view.finalists[0].score,"10 ms");});
test("finished winner and opponent-left reason remain reconnect-renderable",()=>{const view=model({phase:"winner",winner_id:"left",winner_reason:"opponent_left",sessionStatus:"finished"});assert.equal(view.winnerId,"left");assert.equal(view.winnerReason,"opponent_left");assert.equal(view.canReady,false);});
test("a direct one-player finish has a renderable winner without inventing an opponent",()=>{const view=model({phase:"winner",winner_id:"left",winner_reason:"normal_finale_win",sessionStatus:"finished",finalists:[{player_id:"left",seat_index:2,display_name:"Left"}]});assert.equal(view.finalists.length,1);assert.equal(view.winnerId,"left");});

test("migration enters at two, resolves one and zero, and invalidates critical rescue",()=>{
  assert.match(migration,/if v_count>2 then return false/);assert.match(migration,/lifecycle_status='critical' and lives=0/);
  assert.match(migration,/v_count=1[\s\S]*normal_finale_win/);assert.match(migration,/v_count=0[\s\S]*no_finalists/);
  assert.match(migration,/order by seat_index/);assert.match(migration,/special_finale_auto_enter_player/);
});
test("ready barrier is locked, idempotent and launches exactly the existing dispatcher",()=>{
  assert.match(migration,/pg_advisory_xact_lock\(337734,slot::integer\)/);assert.match(migration,/if coalesce\(\(f->'ready'->>v_user::text\)::boolean,false\) then return/);
  assert.match(migration,/count\(\*\)[\s\S]*=2 then[\s\S]*special_number_hunt_begin_locked\(p_session_id\)/);
  assert.doesNotMatch(migration,/chosen='special_minigame_/);
});
test("all existing minigames feed one finale settlement hook including reaction",()=>{
  assert.match(migration,/special_minigame_finalize_before_finale_locked[\s\S]*special_finalize_trottl_special_finale_round_locked/);
  assert.match(migration,/special_reaction_finalize_before_finale_locked[\s\S]*special_finalize_trottl_special_finale_round_locked/);
  assert.match(migration,/special_minigame_03[\s\S]*status'<>'completed'[\s\S]*draw:=true/);
  assert.match(migration,/ranking_direction/);assert.match(migration,/if av=bv then draw:=true/);
});
test("a unique loser loses exactly one life without critical and draw loses none",()=>{
  const settlement=migration.match(/create function public\.special_finalize_trottl_special_finale_round_locked[\s\S]*?end;\$\$;/)?.[0]??"";
  assert.match(settlement,/if loser is not null then[\s\S]*lives=greatest\(lives-1,0\)/);
  assert.match(settlement,/lifecycle_status=case when lives<=1 then 'eliminated' else 'alive' end/);
  assert.doesNotMatch(settlement,/critical/);assert.match(settlement,/interval '2 seconds'/);
});
test("explicit finalist leave is an immediate forfeit while non-finale leave delegates",()=>{
  assert.match(migration,/not coalesce\(\(f->>'active'\)::boolean,false\) then return public\.leave_trottl_special_before_finale/);
  assert.match(migration,/opponent_left/);assert.match(migration,/lifecycle_status='left'/);assert.doesNotMatch(migration,/disconnect|last_seen_at/);
});
test("winner persistence, finished memberships and host reference survive reconnect",()=>{
  assert.match(migration,/status='finished',finished_at=clock_timestamp\(\),current_turn_seat=null/);assert.match(migration,/finale_winner/);assert.match(migration,/winner_reason/);
  assert.match(migration,/s\.status='finished' and s\.game_state->>'phase'='finale_winner'/);assert.match(migration,/host_user_id=v_left/);
});
test("finale UI hides normal controls and retains server-timed transitions",()=>{
  const ui=read("trottl-special-ui.js"),finale=read("trottl-special-finale.js"),css=read("trottl-special.css");
  assert.match(ui,/if \(g\.finale\?\.active\)[\s\S]*mount\.hidden = true[\s\S]*rule-controls/);
  assert.match(finale,/service\.serverNow\(\)/);assert.match(finale,/Der andere Finalist hat das Spiel verlassen!/);
  assert.match(css,/trottl-special-finale-card[^{]*\{[^}]*scale\(1\.18\)/);assert.match(css,/prefers-reduced-motion:reduce/);
});
test("leave copy, debug shortcut and exact cache wiring are shipped",()=>{
  const ui=read("trottl-special-ui.js"),debug=read("trottl-special-debug.js"),html=read("index.html"),sw=read("service-worker.js");
  assert.match(ui,/Wenn du jetzt gehst, gewinnt der andere Finalist sofort/);assert.match(debug,/Finale mit 2 starten/);
  for(const asset of ["trottl-special-finale.js?v=1","trottl-special-service.js?v=23","trottl-special-ui.js?v=27","trottl-special.css?v=34"]){assert.ok(html.includes(asset));assert.ok(sw.includes(asset));}
  assert.match(read("trottl-special-service.js"),/setFinaleReady:[\s\S]*syncFinale:[\s\S]*startFinaleTest:/);
});
