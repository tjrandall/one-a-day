const { createClient } = require('@supabase/supabase-js');
const url = 'https://hzgecxrfystpesrelqee.supabase.co';
const key = 'sb_publishable_mOjvEOFrBZsVCAdEWDQ48Q_Plug540w';
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.from('user_data').select('db').eq('user_id', 'local-superadmin-id').single();
  if (error) console.log('Error:', error.message);
  else {
    console.log('Threads count:', data?.db?.threads?.length);
    console.log('Patient threads:', data?.db?.threads?.filter(t => t.life_area === 'Patient').length);
  }
}
run();
