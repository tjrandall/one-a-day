// Supabase client initialisation.
// The publishable key is intentionally public-safe — RLS enforces all
// data isolation at the database layer. Rotate from the Supabase dashboard
// if this repo ever becomes public and you want a fresh key.

window.OAD = window.OAD || {};

(function () {
  var url = 'https://hypddwbncupihqfhwiwb.supabase.co';
  var key = 'sb_publishable_CC_pPMBcknXHEYlqkORohw_M5hB7WKS';
  OAD.supabase = window.supabase.createClient(url, key);
}());
