FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# The server uses only Node built-ins (node:http, node:sqlite), so no npm install is needed here.
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
EXPOSE 3001
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
