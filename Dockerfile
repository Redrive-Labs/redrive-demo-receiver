FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
