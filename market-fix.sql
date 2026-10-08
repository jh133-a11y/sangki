create or replace function public.investment_update_market()
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  kst_now timestamp := now() at time zone 'Asia/Seoul';
  today date := kst_now::date;
  current_bucket timestamptz :=
    date_trunc('hour', now())
    + make_interval(
        mins => (floor(extract(minute from now()) / 5) * 5)::integer
      );
  direction_date_value date;
  direction_state_value jsonb;
  asset record;
  pct numeric;
  pct_two numeric;
  previous_pct numeric;
  previous_pct_two numeric;
  daily_direction integer;
  movement_direction integer;
  step numeric;
  step_two numeric;
  min_pct numeric;
  max_pct numeric;
  next_price bigint;
  next_price_two bigint;
  new_direction_day boolean := false;
begin
  insert into public.investment_market (id, last_market_date)
  values (1, null)
  on conflict (id) do nothing;

  select direction_date, direction_state
  into direction_date_value, direction_state_value
  from public.investment_market
  where id = 1
  for update;

  if direction_date_value is distinct from today then
    direction_state_value := jsonb_build_object(
      'SANGI_ROCKET', case when random() < 0.5 then -1 else 1 end,
      'JEONGMIN_ROCKET', 0,
      'SANGI_BIO', case when random() < 0.5 then -1 else 1 end,
      'SAMSUNG_MICROWAVE', case when random() < 0.5 then -1 else 1 end,
      'SEOK_HYNIX', 0,
      'KOREA_SANGI_INDEX', case when random() < 0.5 then -1 else 1 end,
      'SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'CURRENT_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'DONGHWA_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'JEONGMIN_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'JUSEONG_SURGE_STOCK', case when random() < 0.5 then -1 else 1 end,
      'SANGI_AI', case when random() < 0.5 then -1 else 1 end,
      'QUANTUM_YOON', case when random() < 0.5 then -1 else 1 end,
      'rocket_event', random() < 0.10,
      'bio_event', random() < 0.05,
      'quantum_event', random() < 0.05,
      'tech_direction', case when random() < 0.5 then -1 else 1 end
    );
    direction_state_value := jsonb_set(
      direction_state_value,
      '{JEONGMIN_ROCKET}',
      direction_state_value->'SANGI_ROCKET'
    );
    direction_state_value := jsonb_set(
      direction_state_value,
      '{SEOK_HYNIX}',
      direction_state_value->'SAMSUNG_MICROWAVE'
    );
    update public.investment_market
    set direction_date = today,
        direction_state = direction_state_value,
        last_market_date = today,
        last_price_update = null
    where id = 1;
    new_direction_day := true;
  end if;

  select direction_state into direction_state_value
  from public.investment_market
  where id = 1;

  perform set_config('app.investment_admin_reset', 'on', true);
  update public.investment_assets
  set current_price = base_price,
      change_pct = 0,
      listed = true,
      delisted_at = null,
      was_delisted = true
  where listed = false
    and (
      delisted_at is null
      or delisted_at <= now() - interval '5 minutes'
    );
  perform set_config('app.investment_admin_reset', 'off', true);

  if not new_direction_day
     and (
       select last_price_update
       from public.investment_market
       where id = 1
     ) is not distinct from current_bucket then
    return today;
  end if;

  for asset in select * from public.investment_assets order by symbol for update loop
    if not asset.listed and not new_direction_day then
      continue;
    end if;

    if not asset.listed and new_direction_day then
      update public.investment_assets
      set current_price = base_price, change_pct = 0, listed = true
      where symbol = asset.symbol;
      asset.current_price := asset.base_price;
      asset.change_pct := 0;
    end if;

    if asset.symbol = 'JEONGMIN_ROCKET' then
      continue;
    end if;

    pct := 0;
    previous_pct := asset.change_pct;
    if asset.symbol in ('SANGI_ROCKET', 'JEONGMIN_ROCKET') then
      daily_direction := (direction_state_value->>'SANGI_ROCKET')::integer;
      min_pct := -30;
      max_pct := 30;
      if new_direction_day and (direction_state_value->>'rocket_event')::boolean
         and daily_direction > 0 then
        pct := floor(random() * 101) + 100;
        pct_two := floor(random() * 101) + 100;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 5) + 1;
        step_two := floor(random() * 5) + 1;
        pct := greatest(min_pct, least(max_pct, previous_pct + movement_direction * step));
        previous_pct_two := (
          select change_pct from public.investment_assets
          where symbol = 'JEONGMIN_ROCKET'
        );
        pct_two := greatest(min_pct, least(max_pct, previous_pct_two + movement_direction * step_two));
        if pct = 0 then pct := movement_direction; end if;
        if pct_two = 0 then pct_two := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol in ('SAMSUNG_MICROWAVE', 'SEOK_HYNIX') then
      daily_direction := (direction_state_value->>'SAMSUNG_MICROWAVE')::integer;
      min_pct := -15;
      max_pct := 15;
      movement_direction := public.investment_next_direction(previous_pct, daily_direction);
      step := floor(random() * 5) + 1;
      step_two := floor(random() * 5) + 1;
      pct := greatest(min_pct, least(max_pct, previous_pct + movement_direction * step));
      previous_pct_two := (
        select change_pct from public.investment_assets
        where symbol = 'SEOK_HYNIX'
      );
      pct_two := greatest(min_pct, least(max_pct, previous_pct_two + movement_direction * step_two));
      if pct = 0 then pct := movement_direction; end if;
      if pct_two = 0 then pct_two := movement_direction; end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SANGI_BIO' then
      daily_direction := (direction_state_value->>'SANGI_BIO')::integer;
      if new_direction_day and (direction_state_value->>'bio_event')::boolean
         and daily_direction > 0 then
        pct := floor(random() * 501) + 500;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 5) + 1;
        pct := greatest(-30, least(30, previous_pct + movement_direction * step));
        if pct = 0 then pct := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol in (
      'SURGE_STOCK',
      'CURRENT_SURGE_STOCK',
      'DONGHWA_SURGE_STOCK',
      'JEONGMIN_SURGE_STOCK',
      'JUSEONG_SURGE_STOCK'
    ) then
      daily_direction := (direction_state_value->>asset.symbol)::integer;
      if random() < 0.01 then
        pct := floor(random() * 1801) + 200;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 100) + 1;
        pct := greatest(-100, least(100, previous_pct + movement_direction * step));
        if pct = 0 then pct := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'KOREA_SANGI_INDEX' then
      daily_direction := (direction_state_value->>'KOREA_SANGI_INDEX')::integer;
      movement_direction := public.investment_next_direction(previous_pct, daily_direction);
      step := floor(random() * 3) + 1;
      pct := greatest(-1, least(3, previous_pct + movement_direction * step));
      if pct = 0 then pct := movement_direction; end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    elsif asset.symbol = 'SANGI_AI' then
      daily_direction := (direction_state_value->>'SANGI_AI')::integer;
      movement_direction := public.investment_next_direction(previous_pct, daily_direction);
      step := floor(random() * 5) + 1;
      pct := greatest(-10, least(20, previous_pct + movement_direction * step));
      if pct = 0 then pct := movement_direction; end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    else
      daily_direction := (direction_state_value->>'QUANTUM_YOON')::integer;
      if new_direction_day and (direction_state_value->>'quantum_event')::boolean
         and daily_direction > 0 then
        pct := floor(random() * 101) + 100;
      else
        movement_direction := public.investment_next_direction(previous_pct, daily_direction);
        step := floor(random() * 5) + 1;
        pct := greatest(-30, least(50, previous_pct + movement_direction * step));
        if pct = 0 then pct := movement_direction; end if;
      end if;
      next_price := round(asset.current_price * (1 + pct / 100));
    end if;

    if previous_pct >= 10 and random() < 0.7 then
      pct := -abs(pct);
      next_price := round(asset.current_price * (1 + pct / 100));
    end if;

    update public.investment_assets
    set current_price = case when next_price <= 10 then 0 else next_price end,
        change_pct = pct,
        listed = next_price > 10
    where symbol = asset.symbol;

    if next_price <= 10 then
      if asset.listed then
        insert into public.investment_shop_messages(client_id, message)
        select
          h.client_id,
          '보유하고 있던 ' || a.name || ' 종목이 상장폐지되었습니다. 보유 수량 '
            || to_char(h.quantity, 'FM999,999,999,999,999,999,999')
            || '주는 정리되었습니다.'
        from public.investment_holdings h
        join public.investment_assets a on a.symbol = h.symbol
        where h.symbol = asset.symbol
          and h.quantity > 0;
      end if;
      delete from public.investment_holdings where symbol = asset.symbol;
    end if;

    if asset.symbol = 'SANGI_ROCKET' then
      if (
        select change_pct
        from public.investment_assets
        where symbol = 'JEONGMIN_ROCKET'
      ) >= 10 and random() < 0.7 then
        pct_two := -abs(pct_two);
      end if;

      next_price_two := round(
        (select current_price from public.investment_assets where symbol = 'JEONGMIN_ROCKET')
        * (1 + pct_two / 100)
      );
      if next_price_two <= 10 then
        insert into public.investment_shop_messages(client_id, message)
        select
          h.client_id,
          '보유하고 있던 ' || a.name || ' 종목이 상장폐지되었습니다. 보유 수량 '
            || to_char(h.quantity, 'FM999,999,999,999,999,999,999')
            || '주는 정리되었습니다.'
        from public.investment_holdings h
        join public.investment_assets a on a.symbol = h.symbol
        where h.symbol = 'JEONGMIN_ROCKET'
          and h.quantity > 0
          and exists (
            select 1
            from public.investment_assets
            where symbol = 'JEONGMIN_ROCKET'
              and listed = true
          );
      end if;
      update public.investment_assets
      set current_price = case when next_price_two <= 10 then 0 else next_price_two end,
          change_pct = pct_two,
          listed = next_price_two > 10
      where symbol = 'JEONGMIN_ROCKET';
      if next_price_two <= 10 then
        delete from public.investment_holdings
        where symbol = 'JEONGMIN_ROCKET';
      end if;
    end if;
  end loop;

  -- 시장 가격 계산이 끝난 뒤 분할을 적용해 다음 갱신이 분할 가격을 기준으로 시작되게 한다.
  perform public.investment_apply_stock_splits();

  update public.investment_market
  set last_market_date = today,
      last_price_update = current_bucket
  where id = 1;
  return today;
end;
$$;

notify pgrst, 'reload schema';
