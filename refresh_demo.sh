#!/bin/bash

# Navigate to the demo directory (now serving strictly from one-a-day-demo)
cd /home/tjrandall/code/one-a-day-demo || exit 1

echo "🛑 Stopping existing server on port 8081..."
fuser -k 8081/tcp 2>/dev/null || echo "No server currently running on port 8081."

echo "💾 Backing up Supabase credentials..."
# Credentials now live directly in the one-a-day root's js folder
cp js/supabase-client.js /tmp/oad_supabase_backup.js

echo "⬇️ Pulling latest changes from one-a-day..."
git reset --hard HEAD
git pull origin main

# We no longer need the submodule updates because fq-cic and fq-health
# have been merged directly into the core repo (e.g. one-a-day/cic).
# So everything natively loads out of one-a-day!

echo "♻️ Restoring Supabase credentials..."
cp /tmp/oad_supabase_backup.js js/supabase-client.js

echo "🚀 Starting fresh, no-cache demo server on port 8081..."
# We use the custom python server script to completely prevent browser caching
python3 server.py &

echo "✅ Update complete! Go to http://localhost:8081/?reset=true"
