// Supabase client initialisation.
// The publishable key is intentionally public-safe — RLS enforces all
// data isolation at the database layer. Rotate from the Supabase dashboard
// if this repo ever becomes public and you want a fresh key.

window.OAD = window.OAD || {};

(function () {
  var url = '<URL-REPO>';
  var key = '<REPO-KEY>';
  
  if (url !== '<URL-REPO>') {
    OAD.supabase = window.supabase.createClient(url, key);
  } else {
    // If placeholders aren't filled out, do not initialize the client
    // so the app cleanly falls back to offline/local mode.
    console.warn('[OAD] Supabase not configured. Running in offline mode.');
  }
}());
