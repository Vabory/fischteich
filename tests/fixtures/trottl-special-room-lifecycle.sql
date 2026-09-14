-- Owner-only regression fixture in a DISPOSABLE PostgreSQL database after all migrations.
-- Never run against production. No roles are created or elevated.
-- Configure three distinct existing profiles before running:
-- SET fischteich.test_user_id='non-admin UUID';
-- SET fischteich.test_other_user_id='other UUID';
-- SET fischteich.test_admin_user_id='existing admin UUID';
-- Both Special room slots must have no active sessions. Everything rolls back.
begin;
create temp table session_update_count(n integer);
create function pg_temp.count_special_update() returns trigger language plpgsql as $$
begin insert into session_update_count values(1);return new;end; $$;
create trigger special_fixture_update after update on public.trottl_special_sessions
 for each row execute function pg_temp.count_special_update();
create function pg_temp.expect_special_error(q text,expected text) returns void language plpgsql as $$
begin
 begin execute q;exception when others then if position(expected in sqlerrm)=0 then raise;end if;return;end;
 raise exception 'Expected % for %',expected,q;
end; $$;
do $$ declare u uuid:=nullif(current_setting('fischteich.test_user_id',true),'')::uuid;
 o uuid:=nullif(current_setting('fischteich.test_other_user_id',true),'')::uuid;
 a uuid:=nullif(current_setting('fischteich.test_admin_user_id',true),'')::uuid;
begin
 if u is null or o is null or a is null or u=o or u=a or o=a then raise exception 'Three distinct fixture actors required';end if;
 if (select count(*) from public.app_profiles where user_id in (u,o,a))<>3 then raise exception 'Existing profiles required';end if;
 if exists(select 1 from public.trottl_special_sessions where status in ('lobby','playing')) then raise exception 'Empty disposable Special slots required';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 if public.is_tournament_admin() then raise exception 'Non-admin actor required';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 if not public.is_tournament_admin() then raise exception 'Existing admin actor required';end if;
 if has_function_privilege('authenticated','public.cleanup_trottl_special_lobby_locked(uuid,timestamp with time zone)','EXECUTE')
  or has_function_privilege('authenticated','public.set_trottl_special_ready_before_lifecycle(uuid,boolean)','EXECUTE')
  or has_function_privilege('anon','public.admin_reset_trottl_special_room(smallint)','EXECUTE') then raise exception 'Private/anonymous RPC exposed';end if;
end; $$;
-- Invalid historical profile values need temporary constraint removal in this rolled-back fixture only.
alter table public.app_profiles drop constraint app_profiles_trottl_avatar_valid;
do $$ declare u uuid:=current_setting('fischteich.test_user_id')::uuid;
 s uuid;avatar text;expected text;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);
 foreach avatar in array array[null::text,'','invalid-historical-avatar','nitro-forelle'] loop
  update public.app_profiles set trottl_avatar_id=avatar where user_id=u;
  s:=public.join_trottl_special_room(1::smallint);
  expected:=case when avatar='nitro-forelle' then avatar else 'turbo-lachs' end;
  if not exists(select 1 from public.trottl_special_players where session_id=s and user_id=u and avatar_id=expected and not is_ready)
   or (select trottl_avatar_id from public.app_profiles where user_id=u)<>expected then raise exception 'Default avatar/profile persistence';end if;
  perform public.set_trottl_special_ready(s,true);
  perform public.recover_trottl_special_lobby(s);
  if not exists(select 1 from public.trottl_special_players where session_id=s and user_id=u and avatar_id=expected and is_ready) then raise exception 'Recovery changed chosen avatar or Ready';end if;
  perform public.set_trottl_special_ready(s,false);
  update public.trottl_special_players set avatar_id=null where session_id=s and user_id=u;
  perform public.recover_trottl_special_lobby(s);
  if not exists(select 1 from public.trottl_special_players where session_id=s and avatar_id=expected and not is_ready) then raise exception 'Old null avatar recovery';end if;
  perform public.leave_trottl_special_session(s);
 end loop;
end; $$;
do $$ declare u uuid:=current_setting('fischteich.test_user_id')::uuid;
 o uuid:=current_setting('fischteich.test_other_user_id')::uuid;s uuid;t timestamptz:=clock_timestamp();age interval;before_count integer;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);s:=public.join_trottl_special_room(1::smallint);
 perform set_config('request.jwt.claim.sub',o::text,true);perform public.join_trottl_special_room(1::smallint);
 truncate session_update_count;
 perform public.reconcile_trottl_special_members_locked(s);
 if exists(select 1 from session_update_count) then raise exception 'No-op reconcile emitted Session UPDATE/realtime';end if;
 foreach age in array array[interval '119 seconds',interval '120 seconds',interval '120.001 seconds'] loop
  update public.trottl_special_players set last_seen_at=t where session_id=s and user_id=u;
  update public.trottl_special_players set last_seen_at=t-age where session_id=s and user_id=o;
  perform public.cleanup_trottl_special_lobby_locked(s,t);
  if (age<=interval '120 seconds')<>exists(select 1 from public.trottl_special_players where session_id=s and user_id=o) then raise exception 'Strict 120s boundary';end if;
 end loop;
 if (select count(*) from session_update_count)<>1 then raise exception 'Real count change must update exactly once';end if;
 perform set_config('request.jwt.claim.sub',o::text,true);perform public.join_trottl_special_room(1::smallint);
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.trottl_special_players set last_seen_at=clock_timestamp()-interval '130 seconds' where session_id=s and user_id=o;
 perform public.set_trottl_special_ready(s,true);
 if exists(select 1 from public.trottl_special_players where session_id=s and user_id=o) then raise exception 'Ready preflight stale cleanup';end if;
 perform public.set_trottl_special_ready(s,false);
 perform set_config('request.jwt.claim.sub',o::text,true);perform public.join_trottl_special_room(1::smallint);
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.trottl_special_players set last_seen_at=clock_timestamp()-interval '130 seconds' where session_id=s and user_id=o;
 perform public.set_trottl_special_avatar(s,'nitro-forelle');
 if exists(select 1 from public.trottl_special_players where session_id=s and user_id=o) then raise exception 'Avatar preflight stale cleanup';end if;
 perform set_config('request.jwt.claim.sub',o::text,true);perform public.join_trottl_special_room(1::smallint);
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.kick_trottl_special_player(s,o);
 if (select player_count from public.trottl_special_sessions where id=s)<>1 then raise exception 'Kick reconcile';end if;
 perform public.leave_trottl_special_session(s);
end; $$;
do $$ declare u uuid:=current_setting('fischteich.test_user_id')::uuid;
 o uuid:=current_setting('fischteich.test_other_user_id')::uuid;s uuid;next_id uuid;t timestamptz;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);s:=public.join_trottl_special_room(1::smallint);
 perform pg_temp.expect_special_error('select public.join_trottl_special_room(2::smallint)','TROTTL_SPECIAL_ALREADY_IN_OTHER_ROOM');
 update public.trottl_special_players set last_seen_at=clock_timestamp()-interval '130 seconds' where session_id=s;
 next_id:=public.join_trottl_special_room(2::smallint);
 if exists(select 1 from public.trottl_special_players where session_id=s) or not exists(select 1 from public.trottl_special_players where session_id=next_id and user_id=u) then raise exception 'Other-room stale join';end if;
 perform public.leave_trottl_special_session(next_id);
 s:=public.join_trottl_special_room(1::smallint);
 update public.trottl_special_sessions set status='playing',started_at=clock_timestamp(),
  game_state='{"phase":"roulette_choose_color","actor":"fixture","minigame":{},"panic":{},"roulette":{},"acks":{},"drinks":{}}',
  debug_test='{"next_roll":4,"next_minigame":"special_minigame_02"}' where id=s;
 update public.trottl_special_players set last_seen_at=clock_timestamp()-interval '130 seconds' where session_id=s;
 perform public.cleanup_trottl_special_lobby_locked(s,clock_timestamp());
 if not exists(select 1 from public.trottl_special_players where session_id=s) then raise exception 'Ingame stale must remain';end if;
 perform pg_temp.expect_special_error('select public.join_trottl_special_room(2::smallint)','TROTTL_SPECIAL_ALREADY_IN_OTHER_ROOM');
 perform set_config('request.jwt.claim.sub',o::text,true);perform public.join_trottl_special_spectator(s,1::smallint);
 delete from public.trottl_special_players where session_id=s;
 perform public.reconcile_trottl_special_members_locked(s);
 if not exists(select 1 from public.trottl_special_sessions where id=s and status='finished' and player_count=0 and current_turn_seat is null and game_state='{}' and debug_test='{}')
  or exists(select 1 from public.trottl_special_spectators where session_id=s) then raise exception 'Empty live state/spectator finalization';end if;
 select finished_at into t from public.trottl_special_sessions where id=s;
 truncate session_update_count;perform public.reconcile_trottl_special_members_locked(s);
 if exists(select 1 from session_update_count) or (select finished_at from public.trottl_special_sessions where id=s)<>t then raise exception 'Empty finalization idempotence/history';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);next_id:=public.join_trottl_special_room(1::smallint);
 if next_id=s or not exists(select 1 from public.trottl_special_sessions where id=next_id and status='lobby' and game_state='{}' and debug_test='{}') then raise exception 'New room clean session';end if;
 perform public.leave_trottl_special_session(next_id);
end; $$;
do $$ declare u uuid:=current_setting('fischteich.test_user_id')::uuid;
 o uuid:=current_setting('fischteich.test_other_user_id')::uuid;
 a uuid:=current_setting('fischteich.test_admin_user_id')::uuid;s uuid;slot smallint;
begin
 foreach slot in array array[1::smallint,2::smallint] loop
  perform set_config('request.jwt.claim.sub',u::text,true);s:=public.join_trottl_special_room(slot);
  perform pg_temp.expect_special_error(format('select public.admin_reset_trottl_special_room(%s::smallint)',slot),'TROTTL_SPECIAL_ADMIN_REQUIRED');
  update public.trottl_special_sessions set status='playing',started_at=clock_timestamp() where id=s;
  perform set_config('request.jwt.claim.sub',o::text,true);perform public.join_trottl_special_spectator(s,slot);
  perform set_config('request.jwt.claim.sub',a::text,true);
  if not public.admin_reset_trottl_special_room(slot) then raise exception 'Admin reset failed';end if;
  if exists(select 1 from public.trottl_special_sessions where id=s) or exists(select 1 from public.trottl_special_players where session_id=s)
   or exists(select 1 from public.trottl_special_spectators where session_id=s) then raise exception 'Admin reset residue';end if;
 end loop;
end; $$;
rollback;
