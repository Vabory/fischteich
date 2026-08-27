"use strict";

const SUPABASE_URL = "https://qhgiqhuodkrevmmbwfeg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Ex5JLH1PpN-N1gGZPDcNtQ_RbO9y7P-";

// Im Browser ausschließlich Publishable Keys verwenden – niemals service_role,
// Secret Keys, Datenbank-Passwörter oder andere serverseitige Geheimnisse.
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
);

console.info("Supabase client initialized");
