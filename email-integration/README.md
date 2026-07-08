# FlowQueue Email Integration

This script acts as a local bridge between your Gmail inbox and FlowQueue. It uses IMAP to pull emails that you tag with `FlowQueue`, runs them through Gemini to extract the actionable items, and writes them to a JSON file ready for import into FlowQueue.

## Setup Instructions

### 1. Create the Gmail Label
In your Gmail account, create a new label called exactly **`FlowQueue`**.

### 2. Generate a Gmail App Password
Because this script uses standard IMAP (which Google considers "less secure" than OAuth), you must generate an App Password. You cannot use your normal Gmail password.
1. Go to your Google Account -> **Security**.
2. Make sure 2-Step Verification is turned ON.
3. Search for **App Passwords** in the search bar.
4. Generate a new App Password (name it "FlowQueue"). It will give you a 16-digit code.

### 3. Run the Script
Open your terminal, export the required environment variables, and run the script:

```bash
export GMAIL_USER="your-email@gmail.com"
export GMAIL_APP_PASSWORD="your-16-digit-password"
export GEMINI_API_KEY="your-gemini-key"

python3 fetch_emails.py
```

## How It Works
1. When you get an email that represents a task, just tag it with the `FlowQueue` label in Gmail.
2. Run the script.
3. The script will find the email, read it, and ask Gemini to convert it into a FlowQueue thread format.
4. The script will save the result to `email_import.json` in this directory.
5. In Gmail, the script will automatically archive the email by removing the `FlowQueue` label so it doesn't get processed twice.
6. Open FlowQueue, click "Scan Mail" (Import), and select `email_import.json`.
