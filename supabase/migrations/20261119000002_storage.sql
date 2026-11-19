-- Photo storage.
--   listing-photos: public (photos appear on public listings), files under <user id>/.
--   chat-images:    private, files under <order id>/; only the two parties and admins can read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-photos', 'listing-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
  ('chat-images', 'chat-images', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "listing photos: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "listing photos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "chat images: upload as a party" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-images' and private.can_chat_text((storage.foldername(name))[1]));

create policy "chat images: read as a party or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and (private.is_party_text((storage.foldername(name))[1]) or private.is_admin())
  );
