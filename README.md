# BRB Baristas (Admin Dashboard)

Admin dashboard for BRB Coffee event management and staff oversight.

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in Firebase credentials
2. Install dependencies: `npm install`
3. Run dev server: `npm run dev`
4. Navigate to `http://localhost:5173`

## Features

- Admin login (Firebase Auth)
- Events management (CRUD)
- Google Calendar integration
- Band invitation link generation
- Band request viewing

## Build

```bash
npm run build
```

## Docker

```bash
docker build -t brb-admin .
docker run -p 3001:80 brb-admin
```

## Deployment

### Automatic Deployment (GitHub Actions)

Push to `main` branch - GitHub Actions automatically:
1. Connects to EC2 via SSH
2. Pulls latest code
3. Rebuilds Docker image
4. Restarts the container

**Prerequisites:** Set up GitHub Secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`

### Manual Deployment to EC2

```bash
# 1. SSH into EC2
ssh -i brb-key.pem ubuntu@18.191.96.186

# 2. Go to app folder
cd ~/brb-baristas-admin

# 3. Pull latest code from GitHub
git pull origin main

# 4. Rebuild the Docker image
docker stop brb-admin && docker rm brb-admin
docker build --no-cache -t brb-admin .

# 5. Run the container
docker run -d -p 3001:80 --name brb-admin brb-admin

# 6. Verify it's running
docker ps | grep brb-admin
```

## Environment Variables (.env.local)

```
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=brb-coffee-dev.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=brb-coffee-dev
VITE_FIREBASE_STORAGE_BUCKET=brb-coffee-dev.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_GOOGLE_CALENDAR_ID=brbcafeatx@gmail.com
# Barista shifts ("[Name, Shift]" entries). Defaults to VITE_GOOGLE_CALENDAR_ID.
VITE_GOOGLE_SCHEDULE_CALENDAR_ID=brbcafeatx@gmail.com
# Band events, on the separate events Gmail account. Defaults to VITE_GOOGLE_CALENDAR_ID.
VITE_GOOGLE_EVENTS_CALENDAR_ID=brb-events-account@gmail.com
# Accounts allowed to add calendar entries; anything else is flagged by the calendar check.
VITE_GOOGLE_CALENDAR_TRUSTED_EDITORS=brbcafeatx@gmail.com,brother@gmail.com
VITE_SIGNUP_BASE_URL=https://events.brbcoffee-atx.com
```

## Dashboard tabs

Events Management · Schedule · Staff Management · Website Content · Inventory.

**Schedule** is the barista master schedule (also live for baristas at schedule.brbcoffee-atx.com). Its code is
in `src/schedule/`, copied from `brb-master-schedule` by `brb-master-schedule/scripts/sync-admin-tab.sh` —
edit it there, not here. The old Calendar and Pending Bookings tabs are gone: bookings are approved from
Events Management, and the calendar check below now shows at the top of Events Management.

## Two calendars and the calendar check

Band events and barista shifts live on separate Google Calendars:

- **Schedule calendar** (`VITE_GOOGLE_SCHEDULE_CALENDAR_ID`): the shop's existing calendar. Shifts are
  added by hand as `[Name, Opening|Closing|Shared]`.
- **Events calendar** (`VITE_GOOGLE_EVENTS_CALENDAR_ID`): owned by the separate events Gmail account.
  Only this app writes to it. In that account's Google Calendar settings, share it with the admin
  account with **Make changes to events** so the admin's Google connection can write to it.

**Events Management** runs a calendar check every time Google is connected, and its tab shows a count
when it finds anything. It flags:

- band events edited, deleted or added directly in Google instead of through the app
- approved events missing from Google, edits that never reached Google, and rejected events still on it
- entries Gmail added automatically or accepted invitations, and entries created by accounts not in
  `VITE_GOOGLE_CALENDAR_TRUSTED_EDITORS`
- shift entries the staff tab cannot read (wrong format, unknown barista, duplicates), and disagreement
  with shifts confirmed in brb-schedule
- every change in the last 7 days that the app did not make

After the split, existing band events are still on the schedule calendar. The check lists them with a
**Move all to the events calendar** button. Moving keeps the same Google event, so phones show it moving.

Run the check's tests with `node src/lib/calendarAudit.test.mjs`.

## Caddy Reverse Proxy Setup

Update `/home/ubuntu/deploy/proxy/Caddyfile`:

```
staff.brbcoffee-atx.com {
  reverse_proxy 172.17.0.2:80
}

events.brbcoffee-atx.com {
  reverse_proxy 127.0.0.1:3002
}
```

Reload Caddy after changes:
```bash
docker exec brb-caddy caddy reload --config /etc/caddy/Caddyfile
```
