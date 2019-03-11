# Build stage
FROM node:10.13-alpine as builder

RUN apk --no-cache add g++ gcc libgcc libstdc++ linux-headers make python
RUN npm install --quiet node-gyp -g

WORKDIR /opt/traduora

COPY bin bin
COPY api api
COPY webapp webapp
RUN bin/build.sh

# Runtime stage
FROM node:10.13-alpine

WORKDIR /opt/traduora

COPY --from=builder /opt/traduora/dist/ /opt/traduora/

COPY docker-entrypoint.sh .

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
