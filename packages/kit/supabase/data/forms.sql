-- the forms' rows: the bucket a recorded run is kept in (26-run-recordings.sql; openspec: recorded-rounds)
-- Rows, not schema: idempotent, run whole on every plan and every reset after the kit's data.sql, and assembled only
-- while the module is on (openspec: module-switch-removes-backend). Never a table or a policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('run-recordings', 'run-recordings', false, 52428800, array['video/mp4', 'audio/mp4'])   -- a part at most 50 MB; a part is a megabyte in practice
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
