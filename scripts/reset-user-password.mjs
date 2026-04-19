// scripts/reset-user-password.mjs
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

const { data, error } = await supabase.auth.admin.updateUserById(
  '4aa59005-5c1d-495c-8029-8c9453950c4d',
  {
    password: 'OffPixelReview2026',
    email_confirm: true,
  }
)

console.log(JSON.stringify({ data, error }, null, 2))
