"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createDocument}=require("./helpers/trottl-special-dom.cjs");
const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
const sql=read("supabase/migrations/20260914020000_polish_trottl_special_room_lifecycle.sql");
const section=name=>{const start=sql.indexOf(`function public.${name}(`);assert.ok(start>=0,name);return sql.slice(start,sql.indexOf("end; $$;",start)+9);};
test("SQL reconcile guards all relevant session values with IS DISTINCT FROM",()=>{
 const s=section("reconcile_trottl_special_members_locked");assert.match(s,/where id=p_session_id and \(player_count,host_user_id,current_turn_seat,status,finished_at,game_state,debug_test\)\s+is distinct from/);
 assert.equal((s.match(/update public.trottl_special_sessions/g)||[]).length,1);
 assert.match(s,/if n=0 then[\s\S]*g:='\{\}'::jsonb;d:='\{\}'::jsonb/);assert.match(s,/delete from public.trottl_special_spectators/);
});
test("SQL stale pruning is strict >120s, lobby-only, and caller presence precedes cleanup",()=>{
 const s=section("cleanup_trottl_special_lobby_locked");assert.match(s,/if s.status<>'lobby' then return/);assert.match(s,/p_now>last_seen_at\+interval '120 seconds'/);
 const p=section("cleanup_trottl_special_lobby");assert.ok(p.indexOf("last_seen_at=t")<p.indexOf("cleanup_trottl_special_lobby_locked"));assert.doesNotMatch(p,/host_user_id/);
});
test("SQL membership default preserves valid profile; recovery repairs null/not-ready only",()=>{
 assert.match(section("join_trottl_special_room"),/is_valid_trottl_avatar_id\(avatar\)[\s\S]*avatar:='turbo-lachs'/);
 assert.match(section("join_trottl_special_room"),/values\(s.id,u,name_value,seat_id,avatar,false,t\)/);
 const s=section("repair_trottl_special_lobby_avatar_locked");assert.match(s,/p.avatar_id is null and not p.is_ready/);assert.match(s,/avatar_id is null and not is_ready/);assert.doesNotMatch(s,/set is_ready/);
});
test("SQL cross-room join locks ordered slots and prunes old lobby before rejection",()=>{
 const s=section("join_trottl_special_room");assert.ok(s.indexOf("(337734,1)")<s.indexOf("(337734,2)"));
 assert.ok(s.indexOf("cleanup_trottl_special_lobby_locked(existing.id,t)")<s.indexOf("TROTTL_SPECIAL_ALREADY_IN_OTHER_ROOM"));
 assert.match(s,/if existing.status='lobby' then perform public.cleanup/);assert.match(s,/TROTTL_SPECIAL_GAME_ALREADY_STARTED/);
});
for(const name of ["set_trottl_special_ready","set_trottl_special_avatar","kick_trottl_special_player"])test(`${name} uses shared lobby preflight`,()=>assert.match(section(name),/trottl_special_lobby_preflight/));
test("SQL leave retains ingame handler and finalizes last membership after existing event cleanup",()=>{
 const s=section("leave_trottl_special_session");assert.match(s,/if s.status='lobby' then[\s\S]*reconcile_trottl_special_members_locked/);
 assert.match(s,/done:=public.leave_trottl_special_before_room_lifecycle[\s\S]*if not exists[\s\S]*reconcile/);
});
test("SQL admin authority is existing tournament admin; private helpers are not granted to clients",()=>{
 const s=section("admin_reset_trottl_special_room");assert.match(s,/auth.uid\(\) is null or not public.is_tournament_admin\(\)/);
 assert.match(s,/delete from public.trottl_special_players/);assert.match(s,/delete from public.trottl_special_spectators/);assert.match(s,/delete from public.trottl_special_sessions/);
 const grants=sql.slice(sql.indexOf("grant execute"));assert.doesNotMatch(grants,/before_lifecycle|before_room_lifecycle|_locked|lobby_preflight/);
 assert.doesNotMatch(sql,/update public.trottl_classic|delete from public.trottl_classic|insert into public.trottl_classic/);
});
test("SQL function bodies/transaction delimiters are balanced and native matrix exists",()=>{
 assert.equal((sql.match(/\$\$/g)||[]).length,24);assert.match(sql,/^begin;/);assert.match(sql,/commit;\s*$/);
 const fixture=read("tests/fixtures/trottl-special-room-lifecycle.sql");for(const marker of ["119 seconds","120 seconds","120.001 seconds","session_update_count","is_tournament_admin","rollback;"])assert.ok(fixture.includes(marker),marker);
});
function adminHarness(isAdmin){
 const doc=createDocument(read("index.html")),calls=[],auth={isAdmin};const win={document:doc,trottlSpecialService:{async adminResetRoom(slot){calls.push(slot);return true;}}};
 vm.runInNewContext(read("trottl-special-admin.js"),{window:win});win.TrottlSpecialAdmin.create({getAuthState:()=>auth});
 return {doc,calls,auth,buttons:doc.querySelectorAll(".settings-special-reset-button"),modal:doc.querySelector("#admin-special-reset-modal")};
}
test("non-admin cannot open Special reset confirmation",()=>{const h=adminHarness(false);assert.ok(h.buttons.every(b=>b.hidden));h.buttons[0].click();assert.equal(h.modal.hidden,true);assert.equal(h.calls.length,0);});
for(const slot of [1,2])test(`admin Special room ${slot} confirmation cancels safely and resets only selected slot`,async()=>{
 const h=adminHarness(true),[cancel,confirm]=h.modal.querySelectorAll("button");h.buttons[slot-1].click();assert.equal(h.modal.hidden,false);cancel.click();assert.equal(h.calls.length,0);
 h.buttons[slot-1].click();confirm.click();for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));assert.deepEqual(h.calls,[slot]);assert.equal(h.modal.hidden,true);
});
test("admin asset is loaded before main Settings integration; CSS/Classic handlers are reused without editing",()=>{
 const html=read("index.html");assert.ok(html.indexOf("trottl-special-admin.js?v=1")<html.indexOf("script.js?v="));
 assert.match(read("script.js"),/specialRoomAdmin\?\.render\(auth\)/);assert.match(read("trottl-special-admin.js"),/admin-trottl-reset-card/);
});
