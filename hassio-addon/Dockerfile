ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

# Printify's application code lives at the repository root, but a Home
# Assistant add-on only sees its own folder as the Docker build context.
# Fetch the source at build time so the program code stays untouched and
# the conventional / Docker deployments keep working unchanged.
ARG PRINTIFY_REF=main

RUN apk add --no-cache nodejs npm imagemagick git

WORKDIR /app
# package-lock.json is not tracked upstream, so install rather than ci.
RUN git clone --depth 1 --branch "${PRINTIFY_REF}" \
        https://github.com/npolanosky/Printify.git . \
    && npm install --omit=dev \
    && npm cache clean --force

COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
