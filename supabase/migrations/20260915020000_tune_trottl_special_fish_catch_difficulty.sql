begin;

-- New rounds use the denser two-phase plan. Existing 26..32-spawn rounds remain
-- valid during a rolling deployment and finish against their stored plan.
create or replace function public.special_fish_catch_pattern(p_seed bigint)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare
 round_ms constant integer:=10000;spawn_min constant integer:=34;spawn_max constant integer:=42;
 life_min constant integer:=400;life_max constant integer:=650;max_parallel constant integer:=4;
 spacing_min constant integer:=100;spacing_target_max constant integer:=270;slot_count constant integer:=10;asset_count constant integer:=8;slot_cooldown constant integer:=180;
 first_start_min constant integer:=180;first_start_max constant integer:=360;early_phase_end constant integer:=7900;
 late_count_min constant integer:=6;late_count_max constant integer:=8;late_phase_min constant integer:=8000;late_phase_max constant integer:=8120;
 last_start_min constant integer:=9400;last_start_max constant integer:=9600;jitter_radius constant integer:=60;
 rng bigint;spawn_count integer;plan jsonb:='[]'::jsonb;spawn_id integer;
 start_ms integer:=0;previous_start integer:=-1;duration_ms integer;slot_start integer;
 first_start integer;last_start integer;late_start integer;late_count integer;early_count integer;phase_index integer;phase_count integer;
 phase_start integer;phase_end integer;ideal_start integer;jitter integer;remaining integer;minimum_start integer;maximum_start integer;
 candidate integer;chosen_slot integer;asset_id integer;active_count integer;next_free integer;
begin
 if p_seed is null then raise exception 'SPECIAL_INVALID_FISH_CATCH_PATTERN_SEED'; end if;
 rng:=1+mod(mod(p_seed,2147483646)+2147483646,2147483646);
 rng:=mod(rng*48271,2147483647);spawn_count:=spawn_min+mod(rng,spawn_max-spawn_min+1)::integer;
 rng:=mod(rng*48271,2147483647);first_start:=first_start_min+mod(rng,first_start_max-first_start_min+1)::integer;
 rng:=mod(rng*48271,2147483647);last_start:=last_start_min+mod(rng,last_start_max-last_start_min+1)::integer;
 rng:=mod(rng*48271,2147483647);late_count:=late_count_min+mod(rng,late_count_max-late_count_min+1)::integer;early_count:=spawn_count-late_count;
 rng:=mod(rng*48271,2147483647);late_start:=late_phase_min+mod(rng,late_phase_max-late_phase_min+1)::integer;
 for spawn_id in 0..spawn_count-1 loop
  if spawn_id<early_count then
   phase_index:=spawn_id;phase_count:=early_count;phase_start:=first_start;phase_end:=early_phase_end;
  else
   phase_index:=spawn_id-early_count;phase_count:=late_count;phase_start:=late_start;phase_end:=last_start;
  end if;
  ideal_start:=phase_start+floor((phase_end-phase_start)*phase_index::numeric/greatest(1,phase_count-1))::integer;
  rng:=mod(rng*48271,2147483647);jitter:=mod(rng,jitter_radius*2+1)::integer-jitter_radius;remaining:=phase_count-1-phase_index;
  minimum_start:=case when phase_index=0 then phase_start else greatest(phase_start,previous_start+spacing_min) end;
  maximum_start:=phase_end-remaining*spacing_min;
  start_ms:=greatest(minimum_start,least(maximum_start,ideal_start+jitter));
  if phase_index=0 then start_ms:=phase_start; end if;
  if remaining=0 then start_ms:=phase_end; end if;
  loop
   select count(*),min((entry->>'t')::integer+(entry->>'d')::integer)
    into active_count,next_free from jsonb_array_elements(plan) entry
    where (entry->>'t')::integer<=start_ms and (entry->>'t')::integer+(entry->>'d')::integer>start_ms;
   exit when active_count<max_parallel;
   start_ms:=greatest(start_ms,next_free);
  end loop;
  previous_start:=start_ms;
  rng:=mod(rng*48271,2147483647);duration_ms:=life_min+mod(rng,life_max-life_min+1)::integer;
  if start_ms+duration_ms>round_ms then duration_ms:=round_ms-start_ms; end if;
  if duration_ms<life_min then raise exception 'SPECIAL_FISH_CATCH_PATTERN_OVERFLOW'; end if;
  rng:=mod(rng*48271,2147483647);slot_start:=mod(rng,slot_count)::integer;chosen_slot:=null;
  for scan in 0..slot_count-1 loop
   candidate:=mod(slot_start+scan,slot_count);
   if not exists(select 1 from jsonb_array_elements(plan) entry where (entry->>'s')::integer=candidate
       and (entry->>'t')::integer+(entry->>'d')::integer+slot_cooldown>start_ms)
    and not exists(select 1 from jsonb_array_elements(plan) entry where (entry->>'t')::integer<=start_ms
       and (entry->>'t')::integer+(entry->>'d')::integer>start_ms
       and (abs((entry->>'s')::integer-candidate)=5
         or (floor((entry->>'s')::integer/5.0)=floor(candidate/5.0) and abs((entry->>'s')::integer-candidate)=1))) then
    chosen_slot:=candidate;exit;
   end if;
  end loop;
  if chosen_slot is null then
   for scan in 0..slot_count-1 loop
    candidate:=mod(slot_start+scan,slot_count);
    if not exists(select 1 from jsonb_array_elements(plan) entry where (entry->>'s')::integer=candidate
      and (entry->>'t')::integer+(entry->>'d')::integer+slot_cooldown>start_ms) then chosen_slot:=candidate;exit;end if;
   end loop;
  end if;
  if chosen_slot is null then raise exception 'SPECIAL_FISH_CATCH_PATTERN_SLOT_EXHAUSTED'; end if;
  rng:=mod(rng*48271,2147483647);asset_id:=1+mod(rng,asset_count)::integer;
  plan:=plan||jsonb_build_array(jsonb_build_object('i',spawn_id,'t',start_ms,'d',duration_ms,'s',chosen_slot,'a',asset_id));
 end loop;
 return plan;
end; $$;

create or replace function public.save_trottl_special_fish_catch(p_session_id uuid,p_round_id uuid,p_score integer,p_hits jsonb,p_final boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.trottl_special_sessions;m jsonb;r jsonb;pattern jsonb;pattern_hit jsonb;slot smallint;t timestamptz;elapsed bigint;
 h jsonb;i integer;a integer;previous_at integer:=-1;seen_ids integer[]:='{}'::integer[];max_score integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select room_slot into slot from public.trottl_special_sessions where id=p_session_id;
 if not found then raise exception 'TROTTL_SPECIAL_SESSION_NOT_FOUND'; end if;
 perform pg_catalog.pg_advisory_xact_lock(337734,slot::integer);
 select * into s from public.trottl_special_sessions where id=p_session_id for update;m:=s.game_state->'minigame';r:=m->'runs'->auth.uid()::text;pattern:=m->'pattern';
 if s.status<>'playing' or (m->>'minigame_id')::uuid is distinct from p_round_id or m->>'minigame_type' is distinct from 'special_minigame_02'
  or s.game_state->>'phase' not in ('minigame_active','minigame_results') or r is null
  or not exists(select 1 from public.trottl_special_players where session_id=p_session_id and user_id=auth.uid() and lifecycle_status in ('alive','critical'))
  or not exists(select 1 from jsonb_array_elements(m->'participants') p where p->>'player_id'=auth.uid()::text) then raise exception 'SPECIAL_INVALID_FISH_CATCH_PARTICIPANT'; end if;
 if jsonb_typeof(pattern) is distinct from 'array' then raise exception 'SPECIAL_INVALID_FISH_CATCH_PATTERN'; end if;
 max_score:=jsonb_array_length(pattern);
 if (max_score not between 26 and 32 and max_score not between 34 and 42) or p_score is null or p_score<0 or p_score>max_score or jsonb_typeof(p_hits) is distinct from 'array'
  or p_score<>jsonb_array_length(p_hits) or p_final is null then raise exception 'SPECIAL_INVALID_FISH_CATCH_SCORE'; end if;
 t:=clock_timestamp();elapsed:=floor(extract(epoch from (t-(m->>'start_at')::timestamptz))*1000)::bigint;
 if elapsed<0 or (p_final and t<(m->>'end_at')::timestamptz) then raise exception 'SPECIAL_FISH_CATCH_NOT_FINISHED'; end if;
 for h in select value from jsonb_array_elements(p_hits) loop
  if jsonb_typeof(h->'index') is distinct from 'number' or jsonb_typeof(h->'at') is distinct from 'number'
   or (h->>'index') !~ '^[0-9]+$' or (h->>'at') !~ '^[0-9]+$' then raise exception 'SPECIAL_INVALID_FISH_CATCH_HIT'; end if;
  i:=(h->>'index')::integer;a:=(h->>'at')::integer;
  if i<0 or i>=max_score or i=any(seen_ids) or a<previous_at or a<0 or a>=10000 or a>elapsed+1000 then raise exception 'SPECIAL_INVALID_FISH_CATCH_HIT'; end if;
  pattern_hit:=pattern->i;
  if (pattern_hit->>'i')::integer<>i or a<(pattern_hit->>'t')::integer or a>=(pattern_hit->>'t')::integer+(pattern_hit->>'d')::integer then raise exception 'SPECIAL_INVALID_FISH_CATCH_HIT_WINDOW'; end if;
  seen_ids:=array_append(seen_ids,i);previous_at:=a;
 end loop;
 if coalesce((r->>'completed')::boolean,false) then
  if p_final and p_score=(r->>'score')::integer and p_hits=r->'hits' then return p_session_id; end if;
  raise exception 'SPECIAL_FISH_CATCH_ALREADY_SUBMITTED';
 end if;
 if p_score<(r->>'score')::integer then return p_session_id; end if;
 if exists(select 1 from jsonb_array_elements(r->'hits') with ordinality oldhit(v,n) where p_hits->(oldhit.n::integer-1) is distinct from oldhit.v) then raise exception 'SPECIAL_FISH_CATCH_CONFLICT'; end if;
 r:=r||jsonb_build_object('score',p_score,'hits',p_hits,'completed',p_final,'updated_at',t);
 m:=m||jsonb_build_object('runs',(m->'runs')||jsonb_build_object(auth.uid()::text,r));
 update public.trottl_special_sessions set game_state=s.game_state||jsonb_build_object('minigame',m,'revision',(s.game_state->>'revision')::bigint+1) where id=p_session_id;
 if p_final then perform public.special_fish_catch_finalize_locked(p_session_id); end if;
 return p_session_id;
end; $$;

revoke all on function public.special_fish_catch_pattern(bigint) from public,anon,authenticated;
revoke all on function public.save_trottl_special_fish_catch(uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_trottl_special_fish_catch(uuid,uuid,integer,jsonb,boolean) to authenticated;

commit;
