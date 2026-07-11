# Ever Traduora Platform

ARG NODE_OPTIONS
ARG NODE_ENV

# Build stage
FROM node:20.19.0-alpine3.21 as builder

LABEL maintainer="ever@ever.co"
LABEL org.opencontainers.image.source https://github.com/ever-co/ever-traduora

ENV IS_DOCKER=true

# Set Python interpreter for `node-gyp` to use
ENV PYTHON /usr/bin/python

RUN apk --update add bash && npm i -g npm \
	&& apk add --no-cache --virtual build-dependencies bind-tools curl tar xz jq python3 python3-dev py3-configobj py3-pip py3-setuptools build-base \
	snappy libheif dos2unix gcc g++ snappy-dev git libgcc libstdc++ linux-headers autoconf automake make nasm vips-dev vips

# Verify the Node.js version
RUN node --version
RUN npm --version

# Output Python3 version
RUN python3 --version

RUN npm install --quiet node-gyp@9.3.1 -g
RUN npm install yarn -g --force

COPY wait docker-entrypoint.compose.sh docker-entrypoint.sh /

RUN chmod +x /wait /docker-entrypoint.compose.sh /docker-entrypoint.sh && dos2unix /docker-entrypoint.compose.sh && dos2unix /docker-entrypoint.sh

WORKDIR /opt/traduora

COPY bin bin
COPY api api
COPY webapp webapp

RUN dos2unix bin/* && chmod +x bin/*.sh

# Configure the npm/yarn registry: prefer the internal Verdaccio cache (VERDACCIO_REGISTRY build-arg,
# anonymous), else public npm (empty, e.g. a fork). Writing to the home-level .npmrc/.yarnrc makes it
# apply to all installs run by bin/install-deps.sh (root, webapp and api). The yarn.lock rewrites are
# best-effort (non-fatal) so a path mismatch degrades to public downloads rather than breaking the build.
ARG VERDACCIO_REGISTRY=""
RUN if [ -n "$VERDACCIO_REGISTRY" ]; then \
		echo "registry=${VERDACCIO_REGISTRY}" >> "$HOME/.npmrc" && \
		printf 'registry "%s"\n' "${VERDACCIO_REGISTRY}" >> "$HOME/.yarnrc" && \
		for lock in yarn.lock webapp/yarn.lock api/yarn.lock; do \
			sed -i "s|https://registry.yarnpkg.com|${VERDACCIO_REGISTRY%/}|g; s|https://registry.npmjs.org|${VERDACCIO_REGISTRY%/}|g" "$lock" 2>/dev/null || true; \
		done; \
	fi

RUN bin/build.sh

# Runtime stage
FROM node:20.19.0-alpine3.21

ENV NODE_OPTIONS=${NODE_OPTIONS:-"--max-old-space-size=12288"}
ENV NODE_ENV=${NODE_ENV:-production}

ENV IS_DOCKER=true

WORKDIR /opt/traduora

COPY --from=builder /wait /docker-entrypoint.sh /docker-entrypoint.compose.sh ./

COPY --from=builder /opt/traduora/dist/ /opt/traduora/

# Clean up
RUN yarn cache clean

EXPOSE 8080

ENTRYPOINT [ "./docker-entrypoint.sh" ]
