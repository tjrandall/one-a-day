import imaplib
import email
from email.header import decode_header
import json
import os
import urllib.request
import urllib.error
import uuid
import time
from datetime import datetime

# --- Configuration ---
print("Initializing FlowQueue Mail Fetcher...", flush=True)
GMAIL_USER = os.getenv("GMAIL_USER", "your.email@gmail.com")
GMAIL_PASS = os.getenv("GMAIL_APP_PASSWORD", "your-16-digit-app-password")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "your-gemini-key")
LABEL = "FlowQueue"
OUTPUT_FILE = os.path.expanduser("~/Downloads/flowqueue_email_import.json")

def call_gemini(prompt, content):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {'Content-Type': 'application/json'}
    data = {
        "contents": [{"parts": [{"text": f"{prompt}\n\nEmail Content:\n{content}"}]}],
        "generationConfig": {"temperature": 0.2}
    }
    
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode())
            return res_data['candidates'][0]['content']['parts'][0]['text']
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return None

def clean_json_response(raw_text):
    if raw_text.startswith("```json"):
        raw_text = raw_text[7:]
    if raw_text.startswith("```"):
        raw_text = raw_text[3:]
    if raw_text.endswith("```"):
        raw_text = raw_text[:-3]
    return raw_text.strip()

def get_body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))
            if content_type == "text/plain" and "attachment" not in content_disposition:
                try:
                    return part.get_payload(decode=True).decode()
                except:
                    pass
    else:
        return msg.get_payload(decode=True).decode()
    return ""

def process_emails():
    print(f"Connecting to Gmail IMAP for {GMAIL_USER}...", flush=True)
    try:
        mail = imaplib.IMAP4_SSL("imap.gmail.com", timeout=10)
        mail.login(GMAIL_USER, GMAIL_PASS)
    except Exception as e:
        print(f"Login failed. Check your App Password and email. Error: {e}")
        return

    # Select the specific label
    status, messages = mail.select(LABEL)
    if status != 'OK':
        print(f"Label '{LABEL}' not found in Gmail. Please create it first.")
        return

    # Search for all emails in this label
    status, search_data = mail.search(None, "ALL")
    if status != 'OK':
        print("No messages found.")
        return

    mail_ids = search_data[0].split()
    if not mail_ids:
        print("No new emails to process.")
        return

    print(f"Found {len(mail_ids)} emails to process.")
    
    # Load existing import file if it exists
    threads = []
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, 'r') as f:
            try:
                data = json.load(f)
                threads = data.get("threads", [])
            except:
                pass

    for i in mail_ids:
        status, msg_data = mail.fetch(i, "(RFC822)")
        for response_part in msg_data:
            if isinstance(response_part, tuple):
                msg = email.message_from_bytes(response_part[1])
                
                # Decode subject
                subject, encoding = decode_header(msg["Subject"])[0]
                if isinstance(subject, bytes):
                    subject = subject.decode(encoding if encoding else "utf-8")
                
                # Decode sender
                sender = msg.get("From")
                body = get_body(msg)

                print(f"Parsing: {subject} from {sender}")

                prompt = """
You are a seasoned executive assistant and Chief of Staff. Your job is to analyze this email and convert it into a highly actionable FlowQueue thread JSON object for your executive.

Follow these specific routing and extraction rules:
1. Routing (life_area): If the email involves "Jackie" (sender or content), classify it as "Finance". If it involves "Andrea", "Abigail", "Zachary", "Mazie", "Cydney", or "Marisa", classify it as "Family". Otherwise, choose between "Career", "Logistics", or "Other".
2. Title: A punchy, 3-5 word summary of the exact action needed (e.g., "Review Q3 Marketing Budget" or "Schedule Vet for Hank").
3. Context: A concise 1-2 sentence summary of what this email is about and why it matters.
4. Next Action: The immediate, concrete next physical or digital step to take.
5. Assumption: Formulate a logical assumption about the situation, the sender's intent, or the blocker that needs to be verified.

Output ONLY raw JSON. No markdown backticks. Do not include arrays, just a single JSON object.

Format requirement:
{
  "title": "Action-oriented title",
  "life_area": "Finance", // or Family, Career, Logistics, etc.
  "priority": "high", // Or 'medium', 'low' based on urgency
  "closing_condition": "What defines this thread as complete?",
  "next_action": "The immediate next action to take",
  "next_action_channel": "email",
  "next_action_contact": "Name or email of the key person",
  "current_assumption": "Your formulated assumption",
  "context": "Brief summary of the email"
}
"""
                ai_response = call_gemini(prompt, f"From: {sender}\nSubject: {subject}\n\n{body[:2000]}")
                
                if ai_response:
                    try:
                        thread_data = json.loads(clean_json_response(ai_response))
                        
                        # Add system fields
                        thread_data['uuid'] = str(uuid.uuid4())
                        thread_data['status'] = 'open'
                        thread_data['closing_condition_type'] = 'outcome'
                        thread_data['next_action_date'] = datetime.today().strftime('%Y-%m-%d')
                        
                        threads.append(thread_data)
                        print(f" -> Successfully mapped to Thread: {thread_data['title']}")
                        
                        # Mark email as deleted (removes the label in Gmail)
                        mail.store(i, '+FLAGS', '\\Deleted')
                    except Exception as e:
                        print(f" -> Failed to parse JSON from AI: {e}")

    # Expunge deletes the emails marked for deletion (removes them from the label, archiving them)
    mail.expunge()
    mail.logout()

    if threads:
        with open(OUTPUT_FILE, 'w') as f:
            json.dump({"threads": threads}, f, indent=2)
        print(f"\nSuccess! Wrote {len(mail_ids)} new threads to {OUTPUT_FILE}.")
        print("You can now import this file in FlowQueue.")

if __name__ == "__main__":
    if GEMINI_API_KEY == "your-gemini-key":
        print("ERROR: Please set GEMINI_API_KEY environment variable.")
    elif GMAIL_PASS == "your-16-digit-app-password":
        print("ERROR: Please set GMAIL_APP_PASSWORD environment variable.")
    else:
        process_emails()
