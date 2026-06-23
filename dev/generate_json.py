import json
import random
import datetime
import uuid

counselors = [f'Counselor {i}' for i in range(1, 11)]
now = datetime.datetime(2026, 6, 22, 12, 0, 0)

with open('config/rules/hc_admission.json', 'r') as f:
    rules = json.load(f)

threads = []

def add_days(d, days):
    return d + datetime.timedelta(days=days)

def make_uuid():
    return 'u-' + str(uuid.uuid4())[:9].replace('-', '')

def add_patient(name, counselor, checkout_type, check_in_days_ago, stay, is_active, loc=None):
    p_uuid = make_uuid()
    check_in_date = add_days(now, -check_in_days_ago)
    
    t = {
        "uuid": p_uuid,
        "title": f"[Patient] {name}",
        "status": "open" if is_active else "closed",
        "priority": "Medium",
        "life_area": "Patient",
        "closing_condition": "Patient discharged.",
        "closing_condition_met": not is_active,
        "metadata": {
            "counselor": counselor,
            "checkout_type": checkout_type,
            "check_in_date": check_in_date.strftime("%Y-%m-%d"),
            "discharge_date": add_days(check_in_date, stay).strftime("%Y-%m-%d"),
            "discharge_location": loc,
            "total_planned_days": 28,
            "total_stay_days": stay
        }
    }
    threads.append(t)
    
    if is_active:
        # Generate tasks
        for trigger in rules.get('triggers', []):
            if trigger.get('type') in ['thread', 'escalation']:
                due = check_in_date
                if trigger.get('anchor') == 'admission':
                    due = add_days(due, trigger.get('offset_days', 0))
                elif trigger.get('anchor') == 'discharge':
                    due = add_days(due, 28 + trigger.get('offset_days', 0))
                
                threads.append({
                    "uuid": make_uuid(),
                    "parent_uuid": p_uuid,
                    "title": f"[{trigger.get('owner_role')}] {trigger.get('name')} - {name}",
                    "status": "stalled" if is_active and random.random() < 0.15 else "open",
                    "priority": trigger.get('priority', 'Medium'),
                    "life_area": trigger.get('owner_role'),
                    "next_action": "Complete mandatory requirement." if trigger.get('mandatory') else "Complete task.",
                    "next_action_date": due.strftime("%Y-%m-%d"),
                    "closing_condition": "Documentation submitted.",
                    "metadata": {}
                })
            elif trigger.get('type') == 'cadence':
                interval = trigger.get('interval_days', 0)
                if interval > 0:
                    iteration = 1
                    for i in range(interval, 29, interval):
                        due = add_days(check_in_date, i)
                        threads.append({
                            "uuid": make_uuid(),
                            "parent_uuid": p_uuid,
                            "title": f"[{trigger.get('owner_role')}] {trigger.get('name')} (Part {iteration}) - {name}",
                            "status": "stalled" if is_active and random.random() < 0.15 else "open",
                            "priority": trigger.get('priority', 'Medium'),
                            "life_area": trigger.get('owner_role'),
                            "next_action": "Complete mandatory requirement." if trigger.get('mandatory') else "Complete task.",
                            "next_action_date": due.strftime("%Y-%m-%d"),
                            "closing_condition": "Documentation submitted.",
                            "metadata": {}
                        })
                        iteration += 1

# 1. 2 ACA
add_patient('ACA Client 1', random.choice(counselors), 'ACA', 20, 14, False)
add_patient('ACA Client 2', random.choice(counselors), 'ACA', 18, 14, False)

# 2. 1 BNC
add_patient('BNC Client 1', random.choice(counselors), 'BNC', 15, 10, False)

# 3. 24 Standard
for i in range(24):
    days_ago = random.randint(29, 50)
    add_patient(f'Standard Client {i+1}', random.choice(counselors), 'Standard', days_ago, 28, False)

# 4. 20 Active
locations = [
    "Cape Heritage Rehabilitation & Health Care Center",
    "Plymouth Rehabilitation & Health Care Center",
    "Spaulding Rehabilitation Hospital (Boston)",
    "Quaboag Rehabilitation & Skilled Care Center"
]
for i in range(20):
    if i < 4:
        # Force 4 discharges to happen in exactly 2 days (+2 days)
        # stay is 28, so check_in_days_ago must be 26 (28 - 2 = 26)
        days_ago = 26
        loc = locations[i]
    else:
        days_ago = random.randint(0, 27)
        if i < 10:
            days_ago = random.randint(14, 16)
        loc = random.choice(locations) if random.random() > 0.5 else None
    
    add_patient(f'Active Client {i+1}', counselors[i % 10], 'Active', days_ago, 28, True, loc)

# Add Training threads for 70% of counselors
training_counselors = random.sample(counselors, 7)
for c in training_counselors:
    due = add_days(now, random.randint(-15, 15))
    threads.append({
        "uuid": make_uuid(),
        "title": f"[Counselor] Mandatory Quarterly Training - {c}",
        "status": "open",
        "priority": "High",
        "life_area": "Counselor",
        "next_action": "Complete training module.",
        "next_action_date": due.strftime("%Y-%m-%d"),
        "closing_condition": "Certificate uploaded.",
        "metadata": {"counselor": c}
    })

# Director Alpha tasks
threads.append({
    "uuid": make_uuid(),
    "title": "[Director Alpha] Q3 Operations Budget Review",
    "status": "open",
    "priority": "High",
    "life_area": "Director",
    "next_action": "Consolidate counselor variance reports.",
    "next_action_date": add_days(now, -2).strftime("%Y-%m-%d"), # Overdue
    "closing_condition": "Budget approved.",
    "metadata": {"counselor": "Director Alpha"}
})
threads.append({
    "uuid": make_uuid(),
    "title": "[Director Alpha] Executive Steering Committee",
    "status": "stalled",
    "priority": "Critical",
    "life_area": "Director",
    "next_action": "Draft slides for board deck.",
    "next_action_date": add_days(now, 1).strftime("%Y-%m-%d"),
    "closing_condition": "Slides submitted.",
    "metadata": {"counselor": "Director Alpha"}
})

cadences = []
group_meetings = [
    {"title": "Release Prevention Build History", "days": [1, 2, 3, 4, 5]},
    {"title": "Seeking Safety", "days": [0, 1, 2, 3, 4]},
    {"title": "Mindfulness & Grounding", "days": [1, 3, 5]},
    {"title": "Family Systems Therapy", "days": [2, 4]}
]
c_id = 1
for idx, c in enumerate(counselors):
    meeting = group_meetings[idx % len(group_meetings)]
    cadences.append({
        "id": c_id,
        "title": f"[Group] {meeting['title']}",
        "recurrence": "weekly-days",
        "days_of_week": meeting['days'],
        "next_due": "2026-06-22",
        "metadata": {"counselor": c}
    })
    c_id += 1

output = {
    "version": 1,
    "export_date": now.isoformat() + "Z",
    "threads": threads,
    "cadences": cadences,
    "edges": []
}

with open('modules/demo/demo_data.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"Generated demo_data.json with {len(threads)} threads!")
