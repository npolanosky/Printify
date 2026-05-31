#!/usr/bin/with-contenv bashio
# ╭────────────────────────────╮
# │  run.sh                   │
# │  Home Assistant add-on    │
# │  entry point for Printify │
# ╰────────────────────────────╯

CONFIG_FILE="/app/config/config.yaml"

# Seed a default config on first boot if none exists.
if [ ! -f "$CONFIG_FILE" ]; then
    bashio::log.info "Creating default config from template..."
    cp /app/config/_exampleConfig.yaml "$CONFIG_FILE"
fi

# Apply the testing flag from the add-on options panel.
TESTING=$(bashio::config 'testing')
if [ "$TESTING" = "true" ]; then
    bashio::log.info "Testing mode enabled — prints will be logged but not dispatched."
else
    bashio::log.info "Testing mode disabled — prints will be sent to real printers."
fi

bashio::log.info "Starting Printify..."
exec node /app/Printify.js
