# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production Nginx stage
FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build output to Nginx document root
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
