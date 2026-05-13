# packages/db/ops

Operator-run SQL for Neon prod that lives outside the Drizzle migration stream.
These are one-shot (or rotation-cadence) scripts that touch roles and grants —
things we don't want auto-applied on deploy.

## predeploy-ro.sql

Provisions the read-only role + login user used by the
`schema-predeploy-prod` GitHub Actions check. The check needs `SELECT` on
`public.*` and `drizzle.*` plus access to `information_schema` (granted by
default to PUBLIC). It must NOT have write access — it runs against prod on
every PR.

### When to run

- **Initial setup** on a new Neon project.
- **Password rotation** (drop user, recreate user with new password, update
  the `PROD_DATABASE_URL` GitHub secret).
- **New schemas added** — if we ever introduce schemas other than `public` and
  `drizzle`, edit this file to add the `USAGE` + `SELECT` grants and re-run.

### How to run

1. Generate a 32-char password locally (don't commit it):

   ```bash
   openssl rand -base64 32 | tr -d '=+/' | cut -c1-32
   ```

2. Connect to prod as `neondb_owner` with that role's password:

   ```bash
   psql "postgres://neondb_owner:<owner-pw>@<host>/neondb?sslmode=require"
   ```

3. Paste the contents of `predeploy-ro.sql` with `<generated-32-char-password>`
   substituted. Or, with envsubst:

   ```bash
   PREDEPLOY_RO_PW='...' \
     sed "s/<generated-32-char-password>/$PREDEPLOY_RO_PW/" predeploy-ro.sql \
     | psql "postgres://neondb_owner:...@.../neondb?sslmode=require"
   ```

4. Build the connection string and store it as the `PROD_DATABASE_URL` GitHub
   Actions secret:

   ```
   postgres://predeploy_ro_user:<generated-32-char-password>@<host>/neondb?sslmode=require
   ```

### Rotation procedure

```sql
DROP USER predeploy_ro_user;
CREATE USER predeploy_ro_user
  WITH PASSWORD '<new-generated-32-char-password>'
  IN ROLE predeploy_ro;
```

Then update the `PROD_DATABASE_URL` GitHub secret. Grants live on
`predeploy_ro` (the NOLOGIN role) so they survive rotation without
re-issuance.

## schema-snapshot.sql (structural drift baseline)

`packages/db/schema-snapshot.sql` is a normalized `pg_dump --schema-only`
of prod. The daily `schema-snapshot-diff` GitHub Action diffs current prod
against it and goes red on any structural delta — enums, defaults,
triggers, RLS, function bodies, etc. (things `information_schema` misses).

### Seeding the baseline (one-shot)

```bash
export DATABASE_URL='postgres://predeploy_ro_user:...@.../neondb?sslmode=require'
packages/db/scripts/init-snapshot.sh
# review the diff, then commit packages/db/schema-snapshot.sql
```

### After a planned migration deploys

```bash
DATABASE_URL='...' pnpm --filter @episteme/db db:snapshot-update
git add packages/db/schema-snapshot.sql
git commit -m "chore(db): refresh schema snapshot after <migration>"
```

### Why not `neon roles create`?

The Neon CLI/dashboard role-create flow auto-grants `neon_superuser` to new
roles. That gives write access — unacceptable for a role exposed to every PR
build. Hand-rolled `CREATE ROLE NOLOGIN` + explicit `SELECT` grants is the
only way to get a true read-only Neon role today.
