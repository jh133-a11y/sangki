-- Run in Supabase SQL Editor after the existing site schema.
-- Allows discarding gambling boxes without opening them or changing assets.
begin;

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

revoke all on function public.shop_discard_item(uuid, text, bigint) from public;
grant execute on function public.shop_discard_item(uuid, text, bigint) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
