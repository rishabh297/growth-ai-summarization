import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pjtvlhyapgpbvubxiqfg.supabase.co'
const supabaseKey = 'sb_publishable_g0eIjHq0rCqn4CedVjXxNQ_0ecDgPp6'

export const supabase = createClient(supabaseUrl, supabaseKey)