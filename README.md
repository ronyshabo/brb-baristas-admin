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
docker build -t brb-baristas .
docker run -p 3001:80 brb-baristas
```
