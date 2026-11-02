import { createClient } from "@supabase/supabase-js";

// Public Supabase client values. The fallbacks keep the browser build connected
// when the hosting runtime does not expose NEXT_PUBLIC_* variables at build time.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ubkscstjgcrrxpudvoie.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_a7UB1q4G_FCg5iSFjrL5AQ_5wsQ3Dhq";

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
