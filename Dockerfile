FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Expose server port
EXPOSE 8080

# Run the server
CMD ["node", "server.js"]
