# Build stage
FROM node:16-alpine3.11 as builder

LABEL maintainer="ever@ever.co"

ENV IS_DOCKER=true

RUN apk --update add bash && \
    apk add --no-cache --virtual build-dependencies libgcc libstdc++ linux-headers dos2unix gcc g++ git make python2 py2-setuptools vips-dev

RUN npm install --quiet node-gyp -g

COPY wait docker-entrypoint.compose.sh docker-entrypoint.sh /

RUN chmod +x /wait /docker-entrypoint.compose.sh /docker-entrypoint.sh && dos2unix /docker-entrypoint.compose.sh && dos2unix /docker-entrypoint.sh

WORKDIR /opt/traduora

COPY bin bin
COPY api api
COPY webapp webapp

RUN dos2unix bin/* && chmod +x bin/*.sh

RUN bin/build.sh

# Runtime stage
FROM node:16-alpine3.11

WORKDIR /opt/traduora

COPY --from=builder /wait /docker-entrypoint.sh /docker-entrypoint.compose.sh ./

COPY --from=builder /opt/traduora/dist/ /opt/traduora/

EXPOSE 8080

ENTRYPOINT [ "./docker-entrypoint.sh" ]
