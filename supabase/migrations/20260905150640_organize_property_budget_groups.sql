begin;

do $$
declare
  v_user_id uuid;
  v_user_count integer;
  v_requested_category_count integer;
begin
  select count(*), min(candidate.user_id::text)::uuid
    into v_user_count, v_user_id
  from (
    select distinct category.user_id
    from public.budget_categories category
    where category.user_id is not null
      and category.group_name in (
        'Home',
        '2929 AirBnB',
        '2929 W 22nd',
        'Rental Unit: 2929 W 22nd',
        '1301 Milwaukee',
        '19 E Pine'
      )

    union

    select distinct budget.user_id
    from public.budget_categories category
    join public.budgets budget on budget.category_id = category.id
    where category.user_id is null
      and category.group_name = '2929 AirBnB'
  ) candidate;

  -- Fresh environments without this user's budget data should remain untouched.
  if v_user_count = 0 then
    return;
  end if;

  if v_user_count <> 1 or v_user_id is null then
    raise exception
      'Expected exactly one owner for the property budget groups; found %',
      v_user_count;
  end if;

  if exists (
    select 1
    from public.budget_categories source_category
    join public.budget_categories destination_category
      on destination_category.user_id = v_user_id
     and destination_category.group_name = '2929 W 22nd'
     and lower(trim(destination_category.line_item_name)) =
       lower(trim(source_category.line_item_name))
     and lower(trim(coalesce(destination_category.category_type, ''))) =
       lower(trim(coalesce(source_category.category_type, '')))
    where source_category.user_id = v_user_id
      and source_category.group_name = 'Home'
  ) then
    raise exception 'Cannot merge Home into 2929 W 22nd because subcategories conflict';
  end if;

  if exists (
    select 1
    from public.budget_categories source_category
    join public.budget_categories destination_category
      on destination_category.user_id = v_user_id
     and destination_category.group_name = 'Rental Unit: 2929 W 22nd'
     and lower(trim(destination_category.line_item_name)) =
       lower(trim(source_category.line_item_name))
     and lower(trim(coalesce(destination_category.category_type, ''))) =
       lower(trim(coalesce(source_category.category_type, '')))
    where source_category.group_name = '2929 AirBnB'
      and (
        source_category.user_id = v_user_id
        or (
          source_category.user_id is null
          and exists (
            select 1
            from public.budgets source_budget
            where source_budget.category_id = source_category.id
              and source_budget.user_id = v_user_id
          )
        )
      )
  ) then
    raise exception
      'Cannot merge 2929 AirBnB into Rental Unit: 2929 W 22nd because subcategories conflict';
  end if;

  update public.budget_categories
  set group_name = '2929 W 22nd'
  where user_id = v_user_id
    and group_name = 'Home';

  update public.budget_categories category
  set
    group_name = 'Rental Unit: 2929 W 22nd',
    user_id = v_user_id
  where category.group_name = '2929 AirBnB'
    and (
      category.user_id = v_user_id
      or (
        category.user_id is null
        and exists (
          select 1
          from public.budgets budget
          where budget.category_id = category.id
            and budget.user_id = v_user_id
        )
      )
    );

  insert into public.budget_categories (
    user_id,
    group_name,
    line_item_name,
    category_type
  )
  select
    v_user_id,
    requested.group_name,
    requested.line_item_name,
    requested.category_type
  from (
    values
      ('1301 Milwaukee', 'Purchase Costs', 'Expense'),
      ('1301 Milwaukee', 'Home Ownership', 'Expense'),
      ('1301 Milwaukee', 'Home Maintenance', 'Expense'),
      ('19 E Pine', 'Purchase Costs', 'Expense'),
      ('19 E Pine', 'Home Ownership', 'Expense'),
      ('19 E Pine', 'Home Maintenance', 'Expense'),
      ('19 E Pine', 'Initial Rehab', 'Expense'),
      ('19 E Pine', 'Operating Expenses', 'Expense'),
      ('19 E Pine', 'CapEx', 'Expense'),
      ('19 E Pine', 'Revenue', 'Income')
  ) requested(group_name, line_item_name, category_type)
  where not exists (
    select 1
    from public.budget_categories existing
    where existing.user_id = v_user_id
      and lower(trim(existing.group_name)) = lower(trim(requested.group_name))
      and lower(trim(existing.line_item_name)) = lower(trim(requested.line_item_name))
      and lower(trim(coalesce(existing.category_type, ''))) =
        lower(trim(requested.category_type))
  );

  insert into public.budgets (
    category_id,
    year_number,
    month_number,
    budget_limit,
    user_id
  )
  select
    category.id,
    budget_month.year_number,
    budget_month.month_number,
    0,
    v_user_id
  from public.budget_categories category
  cross join (
    select distinct budget.year_number, budget.month_number
    from public.budgets budget
    where budget.user_id = v_user_id
      and make_date(budget.year_number, budget.month_number, 1) >= date '2026-09-01'

    union

    select 2026, 9
  ) budget_month
  where category.user_id = v_user_id
    and category.group_name in ('1301 Milwaukee', '19 E Pine')
  on conflict (category_id, year_number, month_number) do nothing;

  select count(*)
    into v_requested_category_count
  from public.budget_categories category
  where category.user_id = v_user_id
    and (
      (
        category.group_name = '1301 Milwaukee'
        and category.category_type = 'Expense'
        and category.line_item_name in (
          'Purchase Costs',
          'Home Ownership',
          'Home Maintenance'
        )
      )
      or (
        category.group_name = '19 E Pine'
        and (
          (
            category.category_type = 'Expense'
            and category.line_item_name in (
              'Purchase Costs',
              'Home Ownership',
              'Home Maintenance',
              'Initial Rehab',
              'Operating Expenses',
              'CapEx'
            )
          )
          or (
            category.category_type = 'Income'
            and category.line_item_name = 'Revenue'
          )
        )
      )
    );

  if v_requested_category_count <> 10 then
    raise exception
      'Expected 10 requested property categories after migration; found %',
      v_requested_category_count;
  end if;

  if exists (
    select 1
    from public.budget_categories category
    where category.group_name in ('Home', '2929 AirBnB')
      and (
        category.user_id = v_user_id
        or (
          category.user_id is null
          and exists (
            select 1
            from public.budgets budget
            where budget.category_id = category.id
              and budget.user_id = v_user_id
          )
        )
      )
  ) then
    raise exception 'Legacy property group names remain after migration';
  end if;
end
$$;

commit;
