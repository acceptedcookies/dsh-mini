# CloudBase Run 镜像：byok 数据面代理
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./
# canonical 共享库（部署时与 cloud/lib/* 保持同步）
COPY lib/ ./lib/
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
