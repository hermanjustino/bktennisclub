# Node server for Cloud Run: serves the site, sign-up API, /admin and Twilio webhooks.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
USER node
CMD ["node", "server/index.js"]
