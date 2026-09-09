-- PROPOSAL ONLY. Depends on 01. No existing-environment execution authorized.
begin;
create function public.stackmint_category(p_command jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
#variable_conflict use_variable
declare owner_id uuid:=(select auth.uid()); category public.budget_categories%rowtype;
  action text:=p_command->>'action'; category_id uuid:=(p_command->>'id')::uuid;
  group_name text:=trim(p_command->>'group_name'); item_name text:=trim(p_command->>'line_item_name');
  category_type text:=p_command->>'category_type';
begin
  if owner_id is null then raise exception using errcode='42501',message='Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtext(owner_id::text),1101);
  if action not in ('create','rename','rename_group') or action is null then raise exception 'Invalid category command'; end if;
  if group_name is null or length(group_name) not between 1 and 150 then raise exception 'Enter a group name of 1 to 150 characters'; end if;
  if action in ('create','rename') and (item_name is null or length(item_name) not between 1 and 150) then raise exception 'Enter a subcategory name of 1 to 150 characters'; end if;
  if category_type not in ('Income','Expense','income','expense') or category_type is null then raise exception 'Choose Income or Expense'; end if;
  if action='create' then
    if category_id is null then raise exception 'Missing category identity'; end if;
    select * into category from public.budget_categories where id=category_id and user_id=owner_id;
    if found then
      if category.group_name=group_name and category.line_item_name=item_name and category.category_type=category_type then return category_id; end if;
      raise exception 'Category identity already exists';
    end if;
  else
    select * into category from public.budget_categories where id=category_id and user_id=owner_id for update;
    if not found then raise exception using errcode='42501',message='Category not found'; end if;
    if category.group_name is distinct from p_command->>'expected_group'
      or category.line_item_name is distinct from p_command->>'expected_item'
      or category.category_type is distinct from category_type then
      raise exception using errcode='40001',message='This category changed. Reload before renaming.';
    end if;
  end if;
  if action='rename_group' then
    if exists(select 1 from public.budget_categories c where c.user_id=owner_id
      and lower(c.category_type)=lower(category_type) and c.group_name=group_name and c.group_name<>category.group_name) then
      raise exception 'A group with that name already exists';
    end if;
    update public.budget_categories c set group_name=group_name
      where c.user_id=owner_id and c.group_name=category.group_name and lower(c.category_type)=lower(category_type);
  else
    if exists(select 1 from public.budget_categories c where c.user_id=owner_id and c.id<>category_id
      and lower(c.category_type)=lower(category_type) and lower(trim(c.group_name))=lower(group_name) and lower(trim(c.line_item_name))=lower(item_name)) then
      raise exception 'That subcategory already exists in this group';
    end if;
    if action='create' then
      insert into public.budget_categories(id,user_id,group_name,line_item_name,category_type)
      values(category_id,owner_id,group_name,item_name,category_type);
      perform public.stackmint_save_budgets(jsonb_build_array(jsonb_build_object('category_id',category_id,
        'year',p_command->'year','month',p_command->'month','budget_limit',p_command->'budget_limit','expected_version',null)));
    else
      update public.budget_categories set group_name=group_name,line_item_name=item_name where id=category_id and user_id=owner_id;
    end if;
  end if;
  return category_id;
end;
$$;
revoke all on function public.stackmint_category(jsonb) from public,anon;
grant execute on function public.stackmint_category(jsonb) to authenticated;
commit;
