#!/bin/sh
set -eu
mc alias set local http://storage:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"
# MinIO's native stale-upload expiry is configured on the storage service.
# The worker also aborts each expired application upload explicitly.
