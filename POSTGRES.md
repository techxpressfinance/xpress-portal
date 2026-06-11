# Postgres Reference — Xpress Tech Portal

## Credentials

| Thing      | Value                                                |
| ---------- | ---------------------------------------------------- |
| Host       | `xpress-db.ca3wk0oewgar.us-east-1.rds.amazonaws.com` |
| Port       | `5432`                                               |
| Database   | `xpress`                                             |
| Admin user | `xpress_admin`                                       |
| App user   | `xpress_app`                                         |
| Region     | `us-east-1`                                          |
| Instance   | `db.t4g.micro`                                       |

---

## Connection

```bash
# As admin (maintenance)
psql -h xpress-db.ca3wk0oewgar.us-east-1.rds.amazonaws.com -U xpress_admin -d xpress

# As app user
psql -h xpress-db.ca3wk0oewgar.us-east-1.rds.amazonaws.com -U xpress_app -d xpress
```

---

## Essential psql Commands

```
\dt                  list all tables
\d table_name        describe a table (columns, types, constraints)
\du                  list users and roles
\l                   list databases
\q                   quit
\x                   toggle expanded output (easier to read wide rows)
\timing              show query execution time
```

---

## Common Queries

```sql
-- Row counts
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM loan_applications;

-- See all tenants
SELECT id, name, slug, is_active FROM tenants;

-- See all users
SELECT id, email, role, is_active, tenant_id FROM users;

-- Database size
SELECT pg_size_pretty(pg_database_size('xpress'));

-- Table sizes (largest first)
SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- Active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'xpress';

-- Kill idle connections (if connection pool gets stuck)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'xpress' AND state = 'idle' AND pid <> pg_backend_pid();
```

---

## User Management

```sql
-- Change xpress_app password (update .env on EC2 after this)
ALTER USER xpress_app WITH PASSWORD 'new-password';

-- Change xpress_admin password
ALTER USER xpress_admin WITH PASSWORD 'new-password';

-- Check permissions for a user
\du xpress_app
```

---

## Backups

RDS runs automated daily backups with 7-day retention.
To restore: **RDS Console → your DB → Maintenance & backups → Restore to point in time**

Manual dump/restore from EC2:

```bash
# Dump to file
pg_dump -h xpress-db.ca3wk0oewgar.us-east-1.rds.amazonaws.com \
  -U xpress_admin -d xpress -F c -f /tmp/xpress_backup.dump

# Restore from file (into a fresh DB)
pg_restore -h xpress-db.ca3wk0oewgar.us-east-1.rds.amazonaws.com \
  -U xpress_admin -d xpress /tmp/xpress_backup.dump
```

---

## Restart / Maintenance

RDS manages the Postgres process — never restart it directly.

- **Apply pending maintenance**: RDS Console → your DB → Maintenance
- **Reboot the instance** (rarely needed): RDS Console → your DB → Actions → Reboot
- **Restart the app** after a DB or config change:

```bash
sudo systemctl restart xpress-backend.service
sudo journalctl -u xpress-backend.service -n 50 --no-pager
```

---

## Monitoring

```bash
# Check app logs for DB errors
sudo journalctl -u xpress-backend.service -n 50 --no-pager
```

In AWS Console: **RDS → your DB → Monitoring** shows CPU, connections, free storage, and IOPS.
DB logs: **RDS Console → your DB → Logs & events**

---

## Important Rules

- **Never drop `xpress_admin`** — it owns all the tables. Dropping it breaks everything.
- **Deletion protection is on** — you cannot delete the RDS instance without first disabling this in the console.
- **Password rotation**: if you change `xpress_app`'s password, update `DATABASE_URL` in `/opt/xpress-tech-portal/backend/.env` and restart the backend.
- **Storage**: currently 20 GB. If it fills up, RDS goes read-only. Monitor free storage in CloudWatch and expand via RDS Console → Storage → Modify if needed.
nscx4p@#gebXhqLM
psql -h xpress-db.ca3wk0oewgar.us-east-1.rds.amazonaws.com -U xpress_app -d xpress
UPDATE users
  SET password_hash = '$2b$12$LfiQ5Lge6mvaZssLTTkok.fMVtapLqDy1aPFe/KZkzl0ltG8kvlwK',
      failed_login_attempts = 0,
      locked_until = NULL
  WHERE email = 'admin@xpressfinance.com.au';


UPDATE users
  SET password_hash = '$2b$12$LfiQ5Lge6mvaZssLTTkok.fMVtapLqDy1aPFe/KZkzl0ltG8kvlwK'',
      failed_login_attempts = 0,
      locked_until = NULL
  WHERE email = 'admin@xpressfinance.com.au' AND tenant_id IS NOT NULL;
admin@xpressfinance.com.au
  Xpress123!