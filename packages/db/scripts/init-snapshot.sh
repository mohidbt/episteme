#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?must be set to RO prod connection}"
pnpm --filter @episteme/db exec tsx scripts/snapshot-dump.ts schema-snapshot.sql
echo "Baseline written to packages/db/schema-snapshot.sql — review + commit"
