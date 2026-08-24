-- Fix: error_events.id is bigint, not uuid.
--
-- The previous migration declared the local variable holding it as uuid, so the find-or-insert
-- worked for the INSERT branch and threw "invalid input syntax for type uuid" the moment it found
-- an existing row to increment — i.e. every coalesce. The route's fallback caught it and inserted
-- normally, so no report was lost, but coalescing was doing nothing at all: five identical reports
-- produced five rows.
--
-- Caught by testing the deployed behaviour rather than trusting the deploy.
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
  -- Newest matching unresolved row inside the window. FOR UPDATE serialises concurrent callers on
  -- this exact incident; anyone else waits here and then reads the value we are about to write,
  -- which is what stops two requests both reading the same counter and writing the same value.
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
  limit 1
  for update;

  if v_id is null then
    insert into public.error_events (level, source, message, album_id, context, ua)
    values (p_level, p_source, p_message, p_album_id, p_context, p_ua);
    return;
  end if;

  -- Merge only keys the stored row is MISSING, so the first occurrence stays the sample and a later
  -- report cannot rewrite history — while a diagnostic that only some occurrences carry (the
  -- directCause/relayCause fields) still survives instead of being lost to whichever arrived first.
  v_ctx := coalesce(p_context, '{}'::jsonb) || v_ctx;
  v_ctx := jsonb_set(v_ctx, '{repeats}',
                     to_jsonb(coalesce((v_ctx ->> 'repeats')::int, 1) + 1), true);
  -- created_at deliberately stays put so the timeline is not shredded; lastSeen is what says an
  -- old-looking row is still happening right now.
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
