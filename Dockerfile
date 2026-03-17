# syntax=docker/dockerfile:1.6

# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN --mount=type=secret,id=VITE_FIREBASE_API_KEY \
	--mount=type=secret,id=VITE_FIREBASE_AUTH_DOMAIN \
	--mount=type=secret,id=VITE_FIREBASE_PROJECT_ID \
	--mount=type=secret,id=VITE_FIREBASE_STORAGE_BUCKET \
	--mount=type=secret,id=VITE_FIREBASE_MESSAGING_SENDER_ID \
	--mount=type=secret,id=VITE_FIREBASE_APP_ID \
	--mount=type=secret,id=VITE_GOOGLE_CALENDAR_ID \
	--mount=type=secret,id=VITE_GOOGLE_CALENDAR_API_KEY \
	/bin/sh -c 'export VITE_FIREBASE_API_KEY="$(cat /run/secrets/VITE_FIREBASE_API_KEY)" && \
	export VITE_FIREBASE_AUTH_DOMAIN="$(cat /run/secrets/VITE_FIREBASE_AUTH_DOMAIN)" && \
	export VITE_FIREBASE_PROJECT_ID="$(cat /run/secrets/VITE_FIREBASE_PROJECT_ID)" && \
	export VITE_FIREBASE_STORAGE_BUCKET="$(cat /run/secrets/VITE_FIREBASE_STORAGE_BUCKET)" && \
	export VITE_FIREBASE_MESSAGING_SENDER_ID="$(cat /run/secrets/VITE_FIREBASE_MESSAGING_SENDER_ID)" && \
	export VITE_FIREBASE_APP_ID="$(cat /run/secrets/VITE_FIREBASE_APP_ID)" && \
	export VITE_GOOGLE_CALENDAR_ID="$(cat /run/secrets/VITE_GOOGLE_CALENDAR_ID)" && \
	export VITE_GOOGLE_CALENDAR_API_KEY="$(cat /run/secrets/VITE_GOOGLE_CALENDAR_API_KEY)" && \
	npm run build'

# Stage 2: Serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
