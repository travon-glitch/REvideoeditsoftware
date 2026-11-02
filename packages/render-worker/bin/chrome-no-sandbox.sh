#!/bin/sh
# Chrome for the render sandbox when the worker must run as root (containers without
# user namespaces). Prefer running the worker as a non-root user and pointing
# FABLECUT_CHROME straight at Chrome instead.
exec "${LVS_CHROME_BIN:-google-chrome}" --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"
