# Static site served by nginx, ready for Cloud Run (listens on $PORT, default 8080).
FROM nginx:1.27-alpine

ENV PORT=8080
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/

EXPOSE 8080
