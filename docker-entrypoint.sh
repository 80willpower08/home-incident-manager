#!/bin/sh
set -e

mkdir -p /data/home/.claude

# exec so Node becomes PID 1 and receives signals directly
exec node src/server.js
