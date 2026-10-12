"use strict";

const SUPABASE_URL = window.FischteichEnvironment?.supabaseUrl ?? "";
const SUPABASE_PUBLISHABLE_KEY = window.FischteichEnvironment?.supabasePublishableKey ?? "";

// Im Browser ausschließlich Publishable Keys verwenden – niemals service_role,
// Secret Keys, Datenbank-Passwörter oder andere serverseitige Geheimnisse.
const supabaseClient = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
): null;

if (supabaseClient) console.info("Supabase client initialized");
