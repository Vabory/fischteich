begin;

-- One compact, server-owned plan per Fischfang round. Keys: id/start/duration/slot/asset.
create function public.special_fish_catch_pattern(p_seed bigint)
returns jsonb language plpgsql immutable security definer set search_path='' as $$
declare
 rng bigint; spawn_count integer; plan jsonb:='[]'::jsonb; spawn_id integer;
 start_ms integer:=0; duration_ms integer; spacing_ms integer; slot_start integer;
 candidate integer; chosen_slot integer; asset_id integer; active_count integer; next_free integer;
begin
 if p_seed is null then raise exception 'SPECIAL_INVALID_FISH_CATCH_PATTERN_SEED'; end if;
 rng:=1+mod(mod(p_seed,2147483646)+2147483646,2147483646);
 rng:=mod(rng*48271,2147483647);spawn_count:=26+mod(rng,7)::integer;
 for spawn_id in 0..spawn_count-1 loop
  rng:=mod(rng*48271,2147483647);
  if spawn_id=0 then start_ms:=180+mod(rng,181)::integer;
  else
   spacing_ms:=130+mod(rng,201)::integer;
   start_ms:=start_ms+spacing_ms;
  end if;
  loop
   select count(*),min((entry->>'t')::integer+(entry->>'d')::integer)
    into active_count,next_free from jsonb_array_elements(plan) entry
    where (entry->>'t')::integer<=start_ms and (entry->>'t')::integer+(entry->>'d')::integer>start_ms;
   exit when active_count<3;
   start_ms:=greatest(start_ms,next_free);
  end loop;
  rng:=mod(rng*48271,2147483647);duration_ms:=520+mod(rng,301)::integer;
  if start_ms+duration_ms>10000 then duration_ms:=10000-start_ms; end if;
  if duration_ms<520 then raise exception 'SPECIAL_FISH_CATCH_PATTERN_OVERFLOW'; end if;
  rng:=mod(rng*48271,2147483647);slot_start:=mod(rng,10)::integer;chosen_slot:=null;
  for scan in 0..9 loop
   candidate:=mod(slot_start+scan,10);
   if not exists(select 1 from jsonb_array_elements(plan) entry where (entry->>'s')::integer=candidate
       and (entry->>'t')::integer+(entry->>'d')::integer+180>start_ms)
    and not exists(select 1 from jsonb_array_elements(plan) entry where (entry->>'t')::integer<=start_ms
       and (entry->>'t')::integer+(entry->>'d')::integer>start_ms
       and (abs((entry->>'s')::integer-candidate)=5
         or (floor((entry->>'s')::integer/5.0)=floor(candidate/5.0) and abs((entry->>'s')::integer-candidate)=1))) then
    chosen_slot:=candidate;exit;
   end if;
  end loop;
  if chosen_slot is null then
   for scan in 0..9 loop
    candidate:=mod(slot_start+scan,10);
    if not exists(select 1 from jsonb_array_elements(plan) entry where (entry->>'s')::integer=candidate
      and (entry->>'t')::integer+(entry->>'d')::integer+180>start_ms) then chosen_slot:=candidate;exit;end if;
   end loop;
  end if;
  if chosen_slot is null then raise exception 'SPECIAL_FISH_CATCH_PATTERN_SLOT_EXHAUSTED'; end if;
  rng:=mod(rng*48271,2147483647);asset_id:=1+mod(rng,8)::integer;
  plan:=plan||jsonb_build_array(jsonb_build_object('i',spawn_id,'t',start_ms,'d',duration_ms,'s',chosen_slot,'a',asset_id));
 end loop;
 return plan;
end; $$;

create or replace function public.special_fish_catch_begin_locked(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r uuid;g jsonb;runs jsonb:='{}'::jsonb;u uuid;t timestamptz:=clock_timestamp();pattern_seed bigint;pattern jsonb;
begin
 r:=public.special_minigame_begin_locked(p_id,'special_minigame_02','higher_is_better');
 select game_state into g from public.trottl_special_sessions where id=p_id for update;
 pattern_seed:=1+floor(pg_catalog.random()*2147483646)::bigint;
 pattern:=public.special_fish_catch_pattern(pattern_seed);
 for u in select (p->>'player_id')::uuid from jsonb_array_elements(g->'minigame'->'participants') p loop
  runs:=runs||jsonb_build_object(u::text,jsonb_build_object('score',0,'hits','[]'::jsonb,'completed',false));
 end loop;
 update public.trottl_special_sessions set game_state=(g-'roulette')||jsonb_build_object('minigame',g->'minigame'||jsonb_build_object(
  'title','Fischfang','title_started_at',t,'title_ends_at',t+interval '2 seconds','start_at',t+interval '5 seconds','end_at',t+interval '15 seconds',
  'pattern_version',1,'pattern_seed',pattern_seed,'pattern',pattern,'runs',runs),
  'revision',(g->>'revision')::bigint+1) where id=p_id;
end; $$;

-- Preserve a Fischfang round that happens to be active while this additive migration is deployed.
with active as (
 select id,1+mod(('x'||substr(md5(game_state->'minigame'->>'minigame_id'),1,8))::bit(32)::bigint,2147483646) as seed
 from public.trottl_special_sessions
 where status='playing' and game_state->>'phase'='minigame_active'
  and game_state->'minigame'->>'minigame_type'='special_minigame_02'
  and not (game_state->'minigame' ? 'pattern')
)
update public.trottl_special_sessions s set game_state=jsonb_set(s.game_state,'{minigame}',
 (s.game_state->'minigame')||jsonb_build_object('pattern_version',1,'pattern_seed',active.seed,'pattern',public.special_fish_catch_pattern(active.seed)))
from active where s.id=active.id;

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
 if max_score not between 26 and 32 or p_score is null or p_score<0 or p_score>max_score or jsonb_typeof(p_hits) is distinct from 'array'
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
revoke all on function public.special_fish_catch_begin_locked(uuid),public.save_trottl_special_fish_catch(uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_trottl_special_fish_catch(uuid,uuid,integer,jsonb,boolean) to authenticated;

commit;
