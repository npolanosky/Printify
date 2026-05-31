#!/usr/bin/with-contenv bashio
# ╭────────────────────────────╮
# │  run.sh                   │
# │  Home Assistant add-on    │
# │  entry point for Printify │
# ╰────────────────────────────╯

APP=/app

# The cloned source ships as a read-only baseline inside the image. Anything
# the user creates or edits is redirected onto persistent volumes:
#   /config  -> add-on config volume, editable from the host file editors
#   /data    -> always-persistent add-on data volume
mkdir -p /data/userdata/logs /data/userdata/uploads /data/userdata/labelTemplates \
         /data/uploads /data/previewCache

# Seed a default config on first boot if the user has none yet.
if [ ! -f /config/config.yaml ]; then
    bashio::log.info "Creating default config from template..."
    cp "$APP/config/_exampleConfig.yaml" /config/config.yaml
fi

# Point the app's writable paths at the persistent volumes. Remove the
# baseline directories first so the symlinks replace them cleanly.
rm -rf "$APP/data" "$APP/uploads" "$APP/lib/previewCache"
ln -sf  /config/config.yaml  "$APP/config/config.yaml"
ln -sfn /data/userdata       "$APP/data"
ln -sfn /data/uploads        "$APP/uploads"
ln -sfn /data/previewCache   "$APP/lib/previewCache"
ln -sf  /data/serverData.json "$APP/serverData.json"

bashio::log.info "Config is at /addon_configs/printify/config.yaml"
bashio::log.info "Set 'testing: false' there to send jobs to the printer."

bashio::log.info "Starting Printify..."
exec node /app/Printify.js
