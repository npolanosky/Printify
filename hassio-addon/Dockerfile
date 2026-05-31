ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm imagemagick

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data/logs data/uploads data/labelTemplates lib/previewCache \
    && cp hassio-addon/run.sh / \
    && chmod a+x /run.sh

CMD ["/run.sh"]
