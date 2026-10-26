# Node server for Cloud Run: serves public/ plus the enrollment and SMS APIs.
FROM node:22-alpine

ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/ server/
COPY public/ public/

USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
