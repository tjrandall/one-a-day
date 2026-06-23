import urllib.request
import json

url = "https://hzgecxrfystpesrelqee.supabase.co/rest/v1/user_data?user_id=eq.local-superadmin-id&select=db"
req = urllib.request.Request(url, headers={
    'apikey': 'sb_publishable_mOjvEOFrBZsVCAdEWDQ48Q_Plug540w',
    'Authorization': 'Bearer sb_publishable_mOjvEOFrBZsVCAdEWDQ48Q_Plug540w'
})

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        if not data:
            print("No data found")
        else:
            db = data[0].get('db', {})
            threads = db.get('threads', [])
            print(f"Threads count: {len(threads)}")
            patient_threads = [t for t in threads if t.get('life_area') == 'Patient']
            print(f"Patient threads count: {len(patient_threads)}")
except Exception as e:
    print(f"Error: {e}")
