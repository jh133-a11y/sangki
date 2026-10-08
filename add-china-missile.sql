-- 중국산 미사일 추가

alter table public.investment_shop_items
  drop constraint if exists investment_shop_items_item_type_check;
alter table public.investment_shop_items
  add constraint investment_shop_items_item_type_check
  check (item_type in (
    'low_missile',
    'mid_missile',
    'high_missile',
    'nuclear_missile',
    'china_missile',
    'missile_shield',
    'nickname_ticket',
    'letter',
    'megaphone',
    'normal_potion',
    'advanced_potion',
    'legendary_potion',
    'sanggi_hanbok',
    'sanggi_spacesuit',
    'juseong_hanbok',
    'juseong_spacesuit',
    'cash_box',
    'weird_cash_box',
    'gambling_box'
  ));

create or replace function public.shop_get_state(
  p_client_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := p_client_id;
  v_cash bigint;
begin
  select client_id, cash
  into v_client_id, v_cash
  from public.investment_users
  where client_id = p_client_id;

  if v_cash is null and nullif(trim(p_nickname), '') is not null then
    select client_id, cash
    into v_client_id, v_cash
    from public.investment_users
    where nickname = trim(p_nickname);
  end if;

  if v_cash is null then
    raise exception '저장된 투자 정보를 찾을 수 없습니다. 홈 화면에서 투자 닉네임을 먼저 확인하세요.';
  end if;

  return jsonb_build_object(
    'client_id', v_client_id,
    'cash', v_cash,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_type', item_type,
        'name', case item_type
          when 'low_missile' then '하급 미사일'
          when 'mid_missile' then '중급 미사일'
          when 'high_missile' then '고급 미사일'
          when 'nuclear_missile' then '핵 미사일'
          when 'china_missile' then '중국산 미사일'
          when 'missile_shield' then '미사일 방어막'
          when 'nickname_ticket' then '닉네임 변경권'
          when 'letter' then '편지'
          when 'megaphone' then '확성기'
          when 'normal_potion' then '일반 물약'
          when 'advanced_potion' then '고급 물약'
          when 'legendary_potion' then '전설 물약'
          when 'sanggi_hanbok' then '상기 한복'
          when 'sanggi_spacesuit' then '상기 우주복'
          when 'juseong_hanbok' then '주성 한복'
          when 'juseong_spacesuit' then '주성 우주복'
          when 'cash_box' then '랜덤 현금 박스'
          when 'weird_cash_box' then '이상한 랜덤 현금 박스'
          when 'gambling_box' then '도박 중독자 상자'
          else '편지'
        end,
        'quantity', quantity
      ) order by item_type)
      from public.investment_shop_items
      where client_id = v_client_id
    ), '[]'::jsonb),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', u.client_id,
        'nickname', u.nickname,
        'total_asset', u.cash + coalesce((
          select sum(h.quantity * a.current_price)
          from public.investment_holdings h
          join public.investment_assets a on a.symbol = h.symbol
          where h.client_id = u.client_id and a.listed
        ), 0)
      ) order by u.nickname)
      from public.investment_users u
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.shop_purchase(
  p_client_id uuid,
  p_item_type text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price bigint;
  v_name text;
  v_cash bigint;
  v_owned_quantity bigint;
  v_limit_date date;
  v_daily_quantity bigint;
begin
  select price, name into v_price, v_name
  from (values
    ('low_missile', 20000000::bigint, '하급 미사일'),
    ('mid_missile', 50000000::bigint, '중급 미사일'),
    ('high_missile', 150000000::bigint, '고급 미사일'),
    ('nuclear_missile', 10000000000::bigint, '핵 미사일'),
    ('china_missile', 1000000::bigint, '중국산 미사일'),
    ('missile_shield', 10000000::bigint, '미사일 방어막'),
    ('nickname_ticket', 5000000000::bigint, '닉네임 변경권'),
    ('megaphone', 50000::bigint, '확성기'),
    ('normal_potion', 10000000::bigint, '일반 물약'),
    ('advanced_potion', 100000000::bigint, '고급 물약'),
    ('legendary_potion', 1000000000::bigint, '전설 물약'),
    ('sanggi_hanbok', 1000000::bigint, '상기 한복'),
    ('sanggi_spacesuit', 10000000::bigint, '상기 우주복'),
    ('juseong_hanbok', 2000000::bigint, '주성 한복'),
    ('juseong_spacesuit', 20000000::bigint, '주성 우주복'),
    ('letter', 10000::bigint, '편지')
    ,('gambling_box', 1::bigint, '도박 중독자 상자')
  ) items(item_type, price, name)
  where item_type = p_item_type;

  if v_price is null then
    raise exception '존재하지 않는 상품입니다.';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception '구매 수량은 1개 이상이어야 합니다.';
  end if;

  if p_item_type = 'gambling_box' then
    v_limit_date := (now() at time zone 'Asia/Seoul')::date;

    insert into public.investment_shop_daily_limits (
      client_id,
      limit_date,
      gambling_box_quantity
    )
    values (p_client_id, v_limit_date, 0)
    on conflict (client_id, limit_date) do nothing;

    select gambling_box_quantity
    into v_daily_quantity
    from public.investment_shop_daily_limits
    where client_id = p_client_id
      and limit_date = v_limit_date
    for update;

    if v_daily_quantity + p_quantity > 3 then
      raise exception '도박 중독자 상자는 하루에 최대 3개까지만 구매할 수 있습니다. 현재 남은 구매 가능 수량: %개.',
        greatest(0, 3 - v_daily_quantity);
    end if;
  end if;

  select quantity
  into v_owned_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
  for update;

  if coalesce(v_owned_quantity, 0) + p_quantity > 100 then
    raise exception '아이템은 한 종류당 최대 100개까지 보유할 수 있습니다.';
  end if;
  if p_item_type in ('sanggi_hanbok', 'sanggi_spacesuit', 'juseong_hanbok', 'juseong_spacesuit')
    and coalesce(v_owned_quantity, 0) >= 1 then
    raise exception '이미 구매한 의상입니다.';
  end if;

  select cash into v_cash
  from public.investment_users
  where client_id = p_client_id
  for update;

  if v_cash is null then
    raise exception '먼저 투자 닉네임을 설정하세요.';
  end if;
  if v_cash < v_price * p_quantity then
    raise exception '보유 현금이 부족합니다.';
  end if;

  update public.investment_users
  set cash = cash - v_price * p_quantity
  where client_id = p_client_id;

  insert into public.investment_shop_items(client_id, item_type, quantity)
  values (p_client_id, p_item_type, p_quantity)
  on conflict (client_id, item_type)
  do update set quantity = public.investment_shop_items.quantity + excluded.quantity;

  if p_item_type = 'gambling_box' then
    update public.investment_shop_daily_limits
    set gambling_box_quantity = gambling_box_quantity + p_quantity
    where client_id = p_client_id
      and limit_date = v_limit_date;
  end if;

  if p_item_type = 'normal_potion' then
    insert into public.sanggi_game_states (account_id, normal_potions)
    values (p_client_id, p_quantity)
    on conflict (account_id) do update
      set normal_potions = least(100, public.sanggi_game_states.normal_potions + excluded.normal_potions),
          updated_at = now();
  elsif p_item_type = 'advanced_potion' then
    insert into public.sanggi_game_states (account_id, advanced_potions)
    values (p_client_id, p_quantity)
    on conflict (account_id) do update
      set advanced_potions = least(100, public.sanggi_game_states.advanced_potions + excluded.advanced_potions),
          updated_at = now();
  elsif p_item_type = 'legendary_potion' then
    insert into public.sanggi_game_states (account_id, legendary_potions)
    values (p_client_id, p_quantity)
    on conflict (account_id) do update
      set legendary_potions = least(100, public.sanggi_game_states.legendary_potions + excluded.legendary_potions),
          updated_at = now();
  end if;

  return jsonb_build_object('message', v_name || ' ' || p_quantity || '개를 구매했습니다.');
end;
$$;

create or replace function public.shop_use_missile(
  p_client_id uuid,
  p_item_type text,
  p_target_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity bigint;
  v_chance numeric;
  v_damage numeric;
  v_name text;
  v_target_name text;
  v_total bigint;
  v_remaining bigint;
  v_old_cash bigint;
  v_cash_loss bigint;
  v_shield_quantity bigint;
  v_shield_required bigint;
  holding_row record;
  v_remove_quantity bigint;
  v_removed_value bigint;
  v_actual_loss bigint := 0;
  v_success boolean;
begin
  if p_client_id = p_target_client_id then
    raise exception '자기 자신에게는 사용할 수 없습니다.';
  end if;

  select quantity into v_quantity
  from public.investment_shop_items
  where client_id = p_client_id and item_type = p_item_type
  for update;

  if coalesce(v_quantity, 0) < 1 then
    raise exception '가방에 해당 아이템이 없습니다.';
  end if;

  select nickname into v_target_name
  from public.investment_users
  where client_id = p_target_client_id
  for update;
  if v_target_name is null then
    raise exception '공격 대상을 찾을 수 없습니다.';
  end if;

  select
    case p_item_type
      when 'low_missile' then 0.20
      when 'mid_missile' then 0.30
      when 'high_missile' then 0.40
      when 'nuclear_missile' then 0.80
      when 'china_missile' then 0.01
    end,
    case p_item_type
      when 'low_missile' then 0.20
      when 'mid_missile' then 0.30
      when 'high_missile' then 0.40
      when 'nuclear_missile' then 0.80
      when 'china_missile' then 0.10
    end,
    case p_item_type
      when 'low_missile' then '하급 미사일'
      when 'mid_missile' then '중급 미사일'
      when 'high_missile' then '고급 미사일'
      when 'china_missile' then '중국산 미사일'
      else '핵 미사일'
    end
  into v_chance, v_damage, v_name;

  update public.investment_shop_items
  set quantity = quantity - 1
  where client_id = p_client_id and item_type = p_item_type;

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
    and quantity <= 0;

  v_success := random() < v_chance;
  if not v_success then
    insert into public.investment_shop_messages(client_id, message)
    values (
      p_client_id,
      v_name || ' 발사 실패. ' || v_target_name
        || '에게 명중하지 않았습니다.'
    );
    insert into public.investment_shop_messages(client_id, message)
    values (
      p_target_client_id,
      v_name || ' 공격을 받았지만 회피했습니다. '
        || '누군가가 당신을 맞힐 뻔했습니다.'
    );
    return jsonb_build_object(
      'success', false,
      'message', v_name || '을(를) 발사했지만 ' || v_target_name || '에게 명중하지 않았습니다.'
    );
  end if;

  v_shield_required := case p_item_type
    when 'low_missile' then 1
    when 'mid_missile' then 3
    when 'high_missile' then 5
    when 'nuclear_missile' then 10
    when 'china_missile' then 1
  end;
  select quantity into v_shield_quantity
  from public.investment_shop_items
  where client_id = p_target_client_id
    and item_type = 'missile_shield'
  for update;

  if coalesce(v_shield_quantity, 0) >= v_shield_required then
    update public.investment_shop_items
    set quantity = quantity - v_shield_required
    where client_id = p_target_client_id
      and item_type = 'missile_shield';

    delete from public.investment_shop_items
    where client_id = p_target_client_id
      and item_type = 'missile_shield'
      and quantity <= 0;

    insert into public.investment_shop_messages(client_id, message)
    values (
      p_target_client_id,
      v_name || ' 공격을 미사일 방어막 '
        || v_shield_required || '개로 막았습니다. 피해를 받지 않았습니다.'
    ), (
      p_client_id,
      v_name || ' 발사 성공! ' || v_target_name || '에게 명중했지만 '
        || '미사일 방어막 ' || v_shield_required || '개에 의해 막혔습니다.'
    );

    return jsonb_build_object(
      'success', true,
      'blocked', true,
      'message', v_name || ' 명중! ' || v_target_name
        || '에게 공격이 성공했습니다.',
      'blocked_message', v_name || ' 공격이 '
        || v_target_name || '의 미사일 방어막에 의해 막혔습니다.'
    );
  end if;

  select u.cash + coalesce((
    select sum(h.quantity * a.current_price)
    from public.investment_holdings h
    join public.investment_assets a on a.symbol = h.symbol
    where h.client_id = u.client_id and a.listed
  ), 0)
  into v_total
  from public.investment_users u
  where u.client_id = p_target_client_id;

  v_remaining := greatest(1, round(v_total * v_damage));
  select cash into v_old_cash
  from public.investment_users
  where client_id = p_target_client_id
  for update;
  v_cash_loss := least(v_old_cash, v_remaining);
  update public.investment_users
  set cash = cash - v_cash_loss
  where client_id = p_target_client_id;
  v_remaining := v_remaining - v_cash_loss;
  v_actual_loss := v_cash_loss;

  for holding_row in
    select h.client_id, h.symbol, h.quantity, h.invested_amount, a.current_price
    from public.investment_holdings h
    join public.investment_assets a on a.symbol = h.symbol
    where h.client_id = p_target_client_id
      and h.quantity > 0
      and a.listed
    order by h.quantity * a.current_price desc
    for update of h
  loop
    exit when v_remaining <= 0;
    v_remove_quantity := least(
      holding_row.quantity,
      ceil(v_remaining::numeric / greatest(holding_row.current_price, 1))::bigint
    );
    v_removed_value := least(v_remaining, v_remove_quantity * holding_row.current_price);
    update public.investment_holdings
    set quantity = quantity - v_remove_quantity,
        invested_amount = greatest(
          0,
          invested_amount - round(
            invested_amount * v_remove_quantity::numeric
            / greatest(holding_row.quantity, 1)
          )
        )
    where client_id = holding_row.client_id
      and symbol = holding_row.symbol;
    v_remaining := v_remaining - v_removed_value;
    v_actual_loss := v_actual_loss + v_removed_value;
  end loop;

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_target_client_id,
    v_name || ' 피격! 자산이 '
      || to_char(v_actual_loss, 'FM999,999,999,999,999,999,999')
      || '원 감소했습니다.'
  );

  insert into public.investment_shop_messages(client_id, message)
  values (
    p_client_id,
    v_name || ' 발사 성공! ' || v_target_name || '의 자산 '
      || to_char(v_actual_loss, 'FM999,999,999,999,999,999,999')
      || '원을 감소시켰습니다.'
  );

  return jsonb_build_object(
    'success', true,
    'message', v_name || ' 명중! ' || v_target_name || '의 자산 '
      || to_char(v_actual_loss, 'FM999,999,999,999,999,999,999')
      || '원이 감소했습니다.'
  );
end;
$$;

create or replace function public.shop_discard_item(
  p_client_id uuid,
  p_item_type text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned_quantity bigint;
  v_name text;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception '버릴 수량은 1개 이상이어야 합니다.';
  end if;

  v_name := case p_item_type
    when 'low_missile' then '하급 미사일'
    when 'mid_missile' then '중급 미사일'
    when 'high_missile' then '고급 미사일'
    when 'nuclear_missile' then '핵 미사일'
    when 'china_missile' then '중국산 미사일'
    when 'missile_shield' then '미사일 방어막'
    when 'nickname_ticket' then '닉네임 변경권'
    when 'letter' then '편지'
    when 'megaphone' then '확성기'
    when 'normal_potion' then '일반 물약'
    when 'advanced_potion' then '고급 물약'
    when 'legendary_potion' then '전설 물약'
    when 'sanggi_hanbok' then '상기 한복'
    when 'sanggi_spacesuit' then '상기 우주복'
    when 'juseong_hanbok' then '주성 한복'
    when 'juseong_spacesuit' then '주성 우주복'
    when 'cash_box' then '랜덤 현금 박스'
    when 'weird_cash_box' then '이상한 랜덤 현금 박스'
    when 'gambling_box' then '도박 중독자 상자'
    else null
  end;

  if v_name is null then
    raise exception '버릴 수 없는 아이템입니다.';
  end if;

  if p_item_type in (
    'sanggi_hanbok', 'sanggi_spacesuit',
    'juseong_hanbok', 'juseong_spacesuit'
  ) then
    raise exception '의상 아이템은 버릴 수 없습니다.';
  end if;

  select quantity
  into v_owned_quantity
  from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
  for update;

  if coalesce(v_owned_quantity, 0) < p_quantity then
    raise exception '보유 수량보다 많이 버릴 수 없습니다.';
  end if;

  update public.investment_shop_items
  set quantity = quantity - p_quantity
  where client_id = p_client_id
    and item_type = p_item_type;

  delete from public.investment_shop_items
  where client_id = p_client_id
    and item_type = p_item_type
    and quantity <= 0;

  return jsonb_build_object(
    'message',
    v_name || ' ' || p_quantity || '개를 버렸습니다.'
  );
end;
$$;

create or replace function public.investment_admin_grant_item(
  p_admin_password text,
  p_target_client_id uuid,
  p_item_type text,
  p_quantity bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_name text;
  v_message text;
  v_user_count integer;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_item_type not in (
    'low_missile', 'mid_missile', 'high_missile', 'nuclear_missile',
    'china_missile',
    'missile_shield', 'nickname_ticket', 'letter',
    'megaphone',
    'gambling_box',
    'normal_potion', 'advanced_potion', 'legendary_potion',
    'sanggi_hanbok', 'sanggi_spacesuit', 'juseong_hanbok',
    'juseong_spacesuit', 'cash_box', 'weird_cash_box'
  ) then
    raise exception '지급할 수 없는 아이템입니다.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception '수량은 1개 이상 1,000,000개 이하로 입력하세요.';
  end if;

  if p_message is null or char_length(trim(p_message)) < 1 then
    raise exception '전달할 메시지를 입력하세요.';
  end if;

  if char_length(trim(p_message)) > 500 then
    raise exception '메시지는 500자 이하로 입력하세요.';
  end if;

  v_item_name := case p_item_type
    when 'low_missile' then '하급 미사일'
    when 'mid_missile' then '중급 미사일'
    when 'high_missile' then '고급 미사일'
    when 'nuclear_missile' then '핵 미사일'
    when 'china_missile' then '중국산 미사일'
    when 'missile_shield' then '미사일 방어막'
    when 'nickname_ticket' then '닉네임 변경권'
    when 'letter' then '편지'
    when 'megaphone' then '확성기'
    when 'gambling_box' then '도박 중독자 상자'
    when 'gambling_box' then '도박 중독자 상자'
    when 'normal_potion' then '일반 물약'
    when 'advanced_potion' then '고급 물약'
    when 'legendary_potion' then '전설 물약'
    when 'sanggi_hanbok' then '상기 한복'
    when 'sanggi_spacesuit' then '상기 우주복'
    when 'juseong_hanbok' then '주성 한복'
    when 'juseong_spacesuit' then '주성 우주복'
    when 'cash_box' then '랜덤 현금 박스'
    when 'weird_cash_box' then '이상한 랜덤 현금 박스'
  end;

  if p_target_client_id is not null
    and not exists (
      select 1 from public.investment_users
      where client_id = p_target_client_id
    ) then
    raise exception '지급할 유저를 찾을 수 없습니다.';
  end if;

  insert into public.investment_shop_items(client_id, item_type, quantity)
  select u.client_id, p_item_type, p_quantity
  from public.investment_users u
  where p_target_client_id is null or u.client_id = p_target_client_id
  on conflict (client_id, item_type)
  do update set
    quantity = public.investment_shop_items.quantity + excluded.quantity;

  get diagnostics v_user_count = row_count;

  v_message := v_item_name || ' ' || p_quantity
    || '개를 지급했습니다.' || E'\n' || trim(p_message);

  insert into public.investment_shop_messages(client_id, sender_name, message_body, message)
  select u.client_id, '관리자', v_message, '관리자가 ' || v_message
  from public.investment_users u
  where p_target_client_id is null or u.client_id = p_target_client_id;

  return jsonb_build_object(
    'user_count', v_user_count,
    'item_type', p_item_type,
    'quantity', p_quantity,
    'message', v_message
  );
end;
$$;

create or replace function public.investment_admin_remove_item(
  p_admin_password text,
  p_target_client_id uuid,
  p_item_type text,
  p_quantity bigint,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_name text;
  v_owned_quantity bigint;
  v_message text;
begin
  if p_admin_password <> '8170' then
    raise exception '관리자 비밀번호가 틀렸습니다.';
  end if;

  if p_target_client_id is not null
     and not exists (
       select 1 from public.investment_users
       where client_id = p_target_client_id
     ) then
    raise exception '차감할 유저를 찾을 수 없습니다.';
  end if;

  if p_item_type not in (
    'low_missile', 'mid_missile', 'high_missile', 'nuclear_missile',
    'china_missile',
    'missile_shield', 'nickname_ticket', 'letter',
    'megaphone',
    'gambling_box',
    'normal_potion', 'advanced_potion', 'legendary_potion',
    'sanggi_hanbok', 'sanggi_spacesuit', 'juseong_hanbok',
    'juseong_spacesuit', 'cash_box', 'weird_cash_box'
  ) then
    raise exception '차감할 수 없는 아이템입니다.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception '수량은 1개 이상 1,000,000개 이하로 입력하세요.';
  end if;

  if p_message is null or char_length(trim(p_message)) < 1 then
    raise exception '전달할 메시지를 입력하세요.';
  end if;

  if char_length(trim(p_message)) > 500 then
    raise exception '메시지는 500자 이하로 입력하세요.';
  end if;

  v_item_name := case p_item_type
    when 'low_missile' then '하급 미사일'
    when 'mid_missile' then '중급 미사일'
    when 'high_missile' then '고급 미사일'
    when 'nuclear_missile' then '핵 미사일'
    when 'china_missile' then '중국산 미사일'
    when 'missile_shield' then '미사일 방어막'
    when 'nickname_ticket' then '닉네임 변경권'
    when 'letter' then '편지'
    when 'megaphone' then '확성기'
    when 'gambling_box' then '도박 중독자 상자'
    when 'normal_potion' then '일반 물약'
    when 'advanced_potion' then '고급 물약'
    when 'legendary_potion' then '전설 물약'
    when 'sanggi_hanbok' then '상기 한복'
    when 'sanggi_spacesuit' then '상기 우주복'
    when 'juseong_hanbok' then '주성 한복'
    when 'juseong_spacesuit' then '주성 우주복'
    when 'cash_box' then '랜덤 현금 박스'
    when 'weird_cash_box' then '이상한 랜덤 현금 박스'
  end;

  if p_target_client_id is not null then
    select quantity into v_owned_quantity
    from public.investment_shop_items
    where client_id = p_target_client_id and item_type = p_item_type
    for update;

    if coalesce(v_owned_quantity, 0) < p_quantity then
      raise exception '해당 유저의 보유 수량이 부족합니다.';
    end if;
  else
    if exists (
      select 1
      from public.investment_users u
      left join public.investment_shop_items i
        on i.client_id = u.client_id and i.item_type = p_item_type
      where coalesce(i.quantity, 0) < p_quantity
    ) then
      raise exception '모든 유저가 해당 수량을 보유하고 있지 않습니다.';
    end if;
  end if;

  update public.investment_shop_items
  set quantity = quantity - p_quantity
  where item_type = p_item_type
    and (p_target_client_id is null or client_id = p_target_client_id);

  delete from public.investment_shop_items
  where item_type = p_item_type
    and quantity <= 0
    and (p_target_client_id is null or client_id = p_target_client_id);

  v_message := v_item_name || ' ' || p_quantity
    || '개를 차감했습니다.' || E'\n' || trim(p_message);

  insert into public.investment_shop_messages(client_id, sender_name, message_body, message)
  select client_id, '관리자', v_message, '관리자가 ' || v_message
  from public.investment_users
  where p_target_client_id is null or client_id = p_target_client_id;

  return jsonb_build_object(
    'user_count', (select count(*) from public.investment_users
      where p_target_client_id is null or client_id = p_target_client_id),
    'item_type', p_item_type,
    'quantity', p_quantity,
    'message', v_message
  );
end;
$$;

notify pgrst, 'reload schema';
