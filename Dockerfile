FROM node:20-alpine

RUN apk add --no-cache imagemagick

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p data/logs data/uploads data/labelTemplates lib/previewCache

EXPOSE 8020

CMD ["node", "Printify.js"]
