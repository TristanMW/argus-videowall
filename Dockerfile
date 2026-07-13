# Argus web UI + backend. Zero npm dependencies — just Node built-ins.
FROM node:20-alpine
WORKDIR /app
COPY server.js mdns.js ./
COPY web ./web
ENV PORT=8080 \
    DATA_FILE=/data/cameras.json \
    GO2RTC_URL=http://go2rtc:1984
EXPOSE 8080
CMD ["node", "server.js"]
