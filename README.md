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
VITE_SIGNUP_BASE_URL=https://events.brbcoffee-atx.com
```

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
