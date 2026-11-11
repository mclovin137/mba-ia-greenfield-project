#!/bin/sh
set -eu
mc alias set local http://storage:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY"
mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"
# The bucket is dedicated to video multipart uploads. Expire abandoned parts.
mc ilm rule import "local/$S3_BUCKET" <<'JSON'
{"Rules":[{"ID":"abort-incomplete","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}
JSON
