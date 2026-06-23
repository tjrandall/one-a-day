import urllib.request
import json

URL = "https://hypddwbncupihqfhwiwb.supabase.co/rest/v1/user_data?select=user_id,updated_at"
HEADERS = {
    "apikey": "sb_publishable_CC_pPMBcknXHEYlqkORohw_M5hB7WKS",
    "Authorization": "Bearer sb_publishable_CC_pPMBcknXHEYlqkORohw_M5hB7WKS"
}
req = urllib.request.Request(URL, headers=HEADERS)
try:
    with urllib.request.urlopen(req) as response:
        print(response.read().decode('utf-8'))
except Exception as e:
    print(e)
