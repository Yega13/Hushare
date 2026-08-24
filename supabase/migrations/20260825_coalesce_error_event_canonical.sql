-- CANONICAL definition of coalesce_error_event. This is the one that must win.
--
-- Three files defined this function on 2026-08-24 and db-migrate applies them by plain filename
-- sort, so the order is: base -> _advisory_lock -> _fix_id_type. The LAST of those is the
-- FOR UPDATE-only body, which the advisory-lock version exists specifically to replace. The live
-- database is correct because the files were applied incrementally as they were written, but a
-- database rebuilt from the migration set — a restore, a new environment — would silently lose the
-- lock and start producing duplicate rows again on concurrent first reports.
--
-- Dated a day later so it sorts after all three regardless of how the earlier names collate. The
-- three originals are left in place: they have already been applied and recorded, and deleting an
-- applied migration is how a tracking table stops matching reality.

-- Serialise the whole find-or-insert, not just the update.
--
-- FOR UPDATE can only lock a row that already exists. Two concurrent reports of a NEW incident both
-- found nothing and both inserted, so five simultaneous reports still produced two rows instead of
-- one. At an event that is the normal case, not an edge: many guests in one album hit the same
-- failure inside the same millisecond.
--
-- A transaction-scoped advisory lock keyed on the incident's identity closes it. Anyone reporting
-- the SAME (level, source, message, album) waits; anyone reporting anything else is unaffected,
-- because the key is derived from those four values. It is released automatically when the
-- statement's transaction ends, including on error — nothing to leak.
create or replace function public.coalesce_error_event(
  p_level      text,
  p_source     text,
  p_message    text,
  p_album_id   uuid,
  p_context    jsonb,
  p_ua         text,
  p_window_seconds int default 300
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_ctx jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_level || '|' || p_source || '|' || p_message || '|' || coalesce(p_album_id::text, ''), 0)
  );

  select id, coalesce(context, '{}'::jsonb)
    into v_id, v_ctx
  from public.error_events
  where level = p_level
    and source = p_source
    and message = p_message
    and album_id is not distinct from p_album_id
    and resolved_at is null
    and created_at >= now() - make_interval(secs => p_window_seconds)
  order by created_at desc
  limit 1;

  if v_id is null then
    insert into public.error_events (level, source, message, album_id, context, ua)
    values (p_level, p_source, p_message, p_album_id, p_context, p_ua);
    return;
  end if;

  -- Merge only keys the stored row is MISSING, so the first occurrence stays the sample and a later
  -- report cannot rewrite history -- while a diagnostic only some occurrences carry (directCause /
  -- relayCause) still survives instead of being lost to whichever arrived first.
  v_ctx := coalesce(p_context, '{}'::jsonb) || v_ctx;
  v_ctx := jsonb_set(v_ctx, '{repeats}',
                     to_jsonb(coalesce((v_ctx ->> 'repeats')::int, 1) + 1), true);
  -- created_at stays put so the timeline is not shredded; lastSeen is what says an old-looking row
  -- is still happening right now.
  v_ctx := jsonb_set(v_ctx, '{lastSeen}', to_jsonb(now()), true);
  if p_ua is not null and v_ctx ? 'firstUa' and (v_ctx ->> 'firstUa') <> left(p_ua, 80) then
    v_ctx := jsonb_set(v_ctx, '{multiDevice}', 'true'::jsonb, true);
  elsif p_ua is not null and not (v_ctx ? 'firstUa') then
    v_ctx := jsonb_set(v_ctx, '{firstUa}', to_jsonb(left(p_ua, 80)), true);
  end if;

  update public.error_events set context = v_ctx where id = v_id;
end;
$$;

revoke all on function public.coalesce_error_event(text, text, text, uuid, jsonb, text, int) from public;
revoke all on function public.coalesce_error_event(text, text, text, uuid, jsonb, text, int) from anon;
revoke all on function public.coalesce_error_event(text, text, text, uuid, jsonb, text, int) from authenticated;
grant execute on function public.coalesce_error_event(text, text, text, uuid, jsonb, text, int) to service_role;
