-- Run after chess-schema.sql to bound AI computation. Does not change saved games or rewards.
begin;

create or replace function public.chess_search_fast(
  p_state jsonb,p_depth integer,p_alpha double precision,p_beta double precision,p_deadline timestamptz
)
returns double precision language plpgsql volatile set search_path = public
as $$
declare moves jsonb; m jsonb; best double precision; score double precision;
begin
  if clock_timestamp()>=p_deadline then return public.chess_evaluate(p_state); end if;
  if p_depth=0 and not public.chess_check(p_state,p_state->>'turn') then
    return public.chess_evaluate(p_state);
  end if;
  moves:=public.chess_legal(p_state);
  if jsonb_array_length(moves)=0 then
    return case when public.chess_check(p_state,p_state->>'turn') then
      case when p_state->>'turn'='w' then -100000-p_depth else 100000+p_depth end else 0 end;
  end if;
  if p_depth=0 then return public.chess_evaluate(p_state); end if;
  best:=case when p_state->>'turn'='w' then '-Infinity'::double precision else 'Infinity'::double precision end;
  for m in select value from jsonb_array_elements(moves)
    order by public.chess_evaluate(public.chess_apply(p_state,value))
      * (case when p_state->>'turn'='w' then 1 else -1 end) desc
    limit 6 loop
    score:=public.chess_search_fast(public.chess_apply(p_state,m),p_depth-1,p_alpha,p_beta,p_deadline);
    if p_state->>'turn'='w' then best:=greatest(best,score); p_alpha:=greatest(p_alpha,best);
    else best:=least(best,score); p_beta:=least(p_beta,best);
    end if;
    exit when p_alpha>=p_beta or clock_timestamp()>=p_deadline;
  end loop;
  return best;
end;
$$;

create or replace function public.chess_ai(p_state jsonb,p_level integer)
returns jsonb language plpgsql volatile set search_path = public
as $$
declare
  moves jsonb:=public.chess_legal(p_state); m jsonb; chosen jsonb; candidate jsonb;
  score double precision; best double precision; depth integer; complete boolean;
  deadline timestamptz:=clock_timestamp()+interval '750 milliseconds';
begin
  if jsonb_array_length(moves)=0 then return null; end if;
  if p_level=1 and random()<.35 then return moves->floor(random()*jsonb_array_length(moves))::integer; end if;
  chosen:=moves->0;
  for depth in 1..p_level loop
    best:=case when p_state->>'turn'='w' then '-Infinity'::double precision else 'Infinity'::double precision end;
    complete:=true; candidate:=null;
    for m in select value from jsonb_array_elements(moves)
      order by public.chess_evaluate(public.chess_apply(p_state,value))
        * (case when p_state->>'turn'='w' then 1 else -1 end) desc loop
      if clock_timestamp()>=deadline then complete:=false; exit; end if;
      score:=public.chess_search_fast(public.chess_apply(p_state,m),depth-1,
        case when p_state->>'turn'='w' then best else '-Infinity'::double precision end,
        case when p_state->>'turn'='b' then best else 'Infinity'::double precision end,deadline);
      if clock_timestamp()>=deadline then complete:=false; exit; end if;
      if (p_state->>'turn'='w' and score>best) or (p_state->>'turn'='b' and score<best) then
        best:=score; candidate:=m;
      end if;
    end loop;
    if not complete then exit; end if;
    if candidate is not null then chosen:=candidate; end if;
  end loop;
  return chosen;
end;
$$;

revoke all on function public.chess_search_fast(jsonb,integer,double precision,double precision,timestamptz)
  from public, anon, authenticated;
revoke all on function public.chess_ai(jsonb,integer) from public, anon, authenticated;

notify pgrst,'reload schema';
commit;
