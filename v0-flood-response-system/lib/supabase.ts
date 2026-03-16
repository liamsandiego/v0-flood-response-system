import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Use a simple no-op lock instead of navigator.locks which hangs on
    // some mobile browsers (Edge on Huawei, older Android WebView)
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => {
      return await fn()
    },
    persistSession: true,
    detectSessionInUrl: true,
  },
})
