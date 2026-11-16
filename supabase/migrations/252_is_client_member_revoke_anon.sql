-- 252: anon keeps Supabase's default EXECUTE on is_client_member() after 251's revoke from public; take it away.
revoke execute on function public.is_client_member() from anon;
