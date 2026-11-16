# Xpress Tech Portal — AWS Production Deployment

## Architecture

```
Internet → Route 53 (DNS)
         → EC2 t4g.small (Ubuntu 24.04 ARM)
           ├── Nginx (port 80/443) — HTTPS + frontend static + /api reverse proxy
           ├── Uvicorn (FastAPI, port 8000) — 1 worker (in-process scheduler; see systemd unit)
           ├── PostgreSQL 16 (localhost:5432)
           ├── Tesseract OCR
           └── Cron → daily pg_dump → S3
```

## Monthly Cost Estimate

| Service | Spec | Cost |
|---------|------|------|
| EC2 | t4g.small (2 vCPU, 2 GB RAM, ARM) | ~$12/mo |
| EBS | 20 GB gp3 | ~$1.60/mo |
| Route 53 | Hosted zone + DNS queries | ~$0.50/mo |
| S3 | Backups + optional doc storage | ~$1–5/mo |
| SSL | Let's Encrypt | Free |
| **Total** | | **~$15–20/mo** |

> **Free tier (year 1):** Use t4g.micro (1 GB RAM) for ~$0/mo compute. Works for <20 concurrent users.

---

## Step-by-Step Deployment

### Step 1: Launch EC2 Instance

1. Open [EC2 Console](https://console.aws.amazon.com/ec2/)
2. Click **Launch Instance**
3. Settings:
   - **Name:** `xpress-tech-portal`
   - **AMI:** Ubuntu Server 24.04 LTS (ARM — Graviton)
   - **Instance type:** `t4g.small` (or `t4g.micro` for free tier)
   - **Key pair:** Create or select an existing key pair
   - **Network / Security Group:**
     - Allow SSH (port 22) — **your IP only**
     - Allow HTTP (port 80) — anywhere
     - Allow HTTPS (port 443) — anywhere
   - **Storage:** 20 GB gp3
4. Click **Launch Instance**
5. Note the **Public IPv4 address**

### Step 2: Point Your Domain

1. Open [Route 53 Console](https://console.aws.amazon.com/route53/) (or your DNS provider)
2. Create an **A record** pointing your domain to the EC2 public IP
3. Wait for DNS propagation (1–5 minutes)

### Step 3: Connect via SSH

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### Step 4: Upload Project Files

From your **local machine**:

```bash
# Option A: Clone from git (recommended)
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
sudo mkdir -p /opt/xpress-tech-portal
sudo chown ubuntu:ubuntu /opt/xpress-tech-portal
git clone <YOUR_REPO_URL> /opt/xpress-tech-portal

# Option B: SCP the project
scp -i your-key.pem -r backend/ frontend/ deploy/ .env.example \
  ubuntu@<EC2_PUBLIC_IP>:/opt/xpress-tech-portal/
```

### Step 5: Run Setup Script

```bash
sudo chmod +x /opt/xpress-tech-portal/deploy/setup.sh
sudo /opt/xpress-tech-portal/deploy/setup.sh yourdomain.com
```

This automatically:
- Installs Python 3, Node 20, PostgreSQL 16, Nginx, Tesseract, Certbot
- Creates PostgreSQL database + user with a random password
- Creates Python venv, installs backend deps
- Builds the frontend
- **Auto-generates** secure JWT_SECRET_KEY and FIELD_ENCRYPTION_KEY
- Creates `.env` with all secrets pre-filled
- Starts the systemd service + Nginx
- Sets up daily database backup cron

**Save the credentials printed at the end of the script.**

### Step 6: Set Up SSL (HTTPS)

```bash
sudo certbot --nginx -d yourdomain.com
```

Certbot automatically:
- Gets a free Let's Encrypt certificate
- Configures Nginx for HTTPS + HTTP→HTTPS redirect
- Sets up auto-renewal

Verify renewal works:
```bash
sudo certbot renew --dry-run
```

### Step 7: Update CORS + Frontend URL

```bash
sudo nano /opt/xpress-tech-portal/backend/.env
```

Ensure these match your domain:
```
FRONTEND_URL=https://yourdomain.com
CORS_ORIGINS=https://yourdomain.com
```

If the portal is served on a host with **no tenant subdomain** (an apex domain
such as `yourdomain.com`, or `www.`), the tenant cannot be read from the Host
header — name it explicitly, or every login returns 400:
```
DEFAULT_TENANT_SLUG=default          # the slug used by create_admin.py --tenant-slug
```
Leave it empty only on a genuinely multi-tenant host, where each tenant is
reached at `{slug}.yourdomain.com`. Do not use `ALLOW_TENANT_HEADER=true`
instead: that lets any caller choose the tenant that login, registration and
password reset act on.

Restart:
```bash
sudo systemctl restart xpress-backend
```

### Step 8: Verify

```bash
# Health check
curl https://yourdomain.com/api/health
# → {"status":"ok"}

# Service status
sudo systemctl status xpress-backend

# Live logs
sudo journalctl -u xpress-backend -f
```

Open `https://yourdomain.com` in your browser — you should see the login page.

---

## Optional: S3 for Document Storage

Keeps uploaded documents off the EC2 instance (recommended for production).

### 1. Create S3 Bucket

```bash
aws s3 mb s3://xpress-documents-prod --region ap-southeast-2
```

### 2. Create IAM Role for EC2

1. IAM Console → Roles → Create role → AWS service → EC2
2. Create inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:HeadObject"],
      "Resource": "arn:aws:s3:::xpress-documents-prod/*"
    }
  ]
}
```

3. Attach the role to your EC2 instance (EC2 Console → Instance → Actions → Security → Modify IAM role)

### 3. Update .env

```
S3_BUCKET_NAME=xpress-documents-prod
S3_REGION=ap-southeast-2
```

Restart: `sudo systemctl restart xpress-backend`

---

## Backups (required before go-live)

Three things must survive the loss of this server. Each lives somewhere different on purpose.

| What | Where it goes | How |
|------|---------------|-----|
| Database | S3 backup bucket | `deploy/backup.sh` (daily cron + before every deploy) |
| Uploaded documents | S3 | Either store them in S3 directly (`S3_BUCKET_NAME`, with bucket versioning on) or let `backup.sh` sync `uploads/` to the backup bucket |
| `FIELD_ENCRYPTION_KEY` | AWS Secrets Manager / company password manager | By hand, once, and again on every key rotation |

**The encryption key is never stored with the backups.** A dump that travels with its own key is plaintext to whoever gets the bucket. But without the key every encrypted column (names, addresses, IDs, bank details, OCR text) in every backup is gone for good — so escrow it now:

```bash
# Run once on the server; repeat whenever the key ring changes.
sudo grep '^FIELD_ENCRYPTION_KEY=' /opt/xpress-tech-portal/backend/.env | cut -d= -f2- | \
  aws secretsmanager create-secret --name xpress/prod/field-encryption-key \
    --region ap-southeast-2 --secret-string file:///dev/stdin
# (later rotations: put-secret-value --secret-id xpress/prod/field-encryption-key ...)
```
Restrict that secret to a break-glass IAM role — **not** the EC2 instance role. Escrow `JWT_SECRET_KEY` and the DB password the same way if you want a full rebuild without resetting them.

### Off-box database backups

```bash
# 1. A dedicated bucket, versioned, private, with old versions expiring
aws s3 mb s3://xpress-backups-prod --region ap-southeast-2
aws s3api put-bucket-versioning --bucket xpress-backups-prod --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket xpress-backups-prod \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 2. Give the EC2 role s3:PutObject + s3:ListBucket on it (GetObject too if you
#    want restore-test.sh --from-s3). Leave out s3:DeleteObject: a compromised
#    server should not be able to destroy its own backups.

# 3. Tell the backup script, and make a missing bucket a failure
sudo tee /etc/xpress-backup.conf <<'CONF'
S3_BACKUP_BUCKET=xpress-backups-prod
REQUIRE_OFFSITE=1
CONF

# 4. Install / update the cron job and run it once
sudo cp /opt/xpress-tech-portal/deploy/backup.sh /etc/cron.daily/xpress-backup
sudo /etc/cron.daily/xpress-backup
```
Add an S3 lifecycle rule to expire dumps after your retention period (e.g. 90 days). Local copies are kept 7 days.

### Restore drill — run monthly

```bash
sudo /opt/xpress-tech-portal/deploy/restore-test.sh            # newest local dump
sudo /opt/xpress-tech-portal/deploy/restore-test.sh --from-s3  # newest dump in the bucket
```
It restores into a scratch database, checks the row counts, decrypts sample PII with the key on the server, and drops the scratch database. The live database is not touched. Exit status 0 means the backup is restorable **and** readable.

### Restoring for real

```bash
sudo systemctl stop xpress-backend
sudo -u postgres dropdb xpresstech && sudo -u postgres createdb -O xpresstech xpresstech
sudo -u postgres pg_restore --no-owner --role=xpresstech -d xpresstech /opt/backups/xpress/xpresstech_YYYYMMDD_HHMMSS.dump
# Rebuilding on a new server: put the escrowed FIELD_ENCRYPTION_KEY back in backend/.env FIRST.
cd /opt/xpress-tech-portal/backend && sudo -u xpress ./venv/bin/python3 -m app.migrate --check
sudo systemctl start xpress-backend
```

---

## Error tracking and uptime

**Errors.** Create a Sentry project (the free tier is enough; pick a region that suits your data-residency needs), then add `SENTRY_DSN=...` to `backend/.env` and restart. Unhandled request errors, failed scheduler jobs / background tasks (anything logged at ERROR) and startup failures are reported, tagged with the deployed commit. Events are scrubbed before sending: no request bodies, headers, cookies, query strings, local variables or breadcrumbs, and only the internal user id. Turn on Sentry's email/Slack alert rule for "a new issue is created".

**Uptime.** Point an external monitor (UptimeRobot, Better Stack, Route 53 health check) at `https://<your-domain>/api/health/ready`. It returns 503 when the database is unreachable or the schema is behind; `/api/health` only says the process is up.

**Backups.** A silent cron failure is the usual way backups die. `REQUIRE_OFFSITE=1` makes the job exit non-zero; pair it with a dead-man's-switch check (e.g. healthchecks.io pinged at the end of the cron job) so a backup that stops running raises an alert.

---

## Database migrations

The schema is managed by Alembic. The app never creates or alters tables when it starts; in production it refuses to start if the schema is behind.

```bash
cd /opt/xpress-tech-portal/backend
sudo -u xpress ./venv/bin/python3 -m app.migrate --check   # is the schema current?
sudo -u xpress ./venv/bin/python3 -m app.migrate           # apply pending migrations
```
`deploy.sh` does this for you: build, back up, stop, migrate, start, wait for `/api/health/ready`. If the backup fails the deploy stops before touching anything.

**First deploy after Alembic was introduced:** the database has no `alembic_version` table yet. `app.migrate` detects that, runs the old upgrade path one last time, and stamps the baseline — no manual step. Rehearse it first on a restored copy (`restore-test.sh` shows how to restore one) if you want to see it run before production.

---

## CI/CD: Auto-Deploy on Push

Add these secrets to your GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your EC2 public IP or domain |
| `EC2_SSH_KEY` | Contents of your `.pem` private key |

Every push to `main` runs the frontend lint/typecheck and the backend tests; the deploy job runs only if both pass.

---

## Ongoing Operations

### Manual Deploy

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
cd /opt/xpress-tech-portal
sudo ./deploy/deploy.sh
```

### View Logs

```bash
sudo journalctl -u xpress-backend -f          # Backend app logs
sudo tail -f /var/log/nginx/access.log         # Nginx access
sudo tail -f /var/log/nginx/error.log          # Nginx errors
sudo journalctl -u postgresql -f               # Database logs
```

### Database Operations

```bash
# Connect interactively
sudo -u postgres psql xpresstech

# Manual backup
sudo /etc/cron.daily/xpress-backup

# Restore: see "Restoring for real" above. Prove backups work: sudo ./deploy/restore-test.sh
```

### Restart Services

```bash
sudo systemctl restart xpress-backend
sudo systemctl restart nginx
sudo systemctl restart postgresql
```

---

## Security Checklist

- [x] PostgreSQL (not SQLite) — concurrent writes, authentication, encryption
- [x] PII encrypted at rest (Fernet via FIELD_ENCRYPTION_KEY)
- [x] Refresh tokens in httpOnly cookies (not localStorage)
- [x] CSRF double-submit cookie protection
- [x] Global exception handler (no stack traces leaked)
- [x] Path traversal fix in file deletion
- [x] HTTPS enforced via Certbot + HSTS headers
- [x] Security headers (X-Frame-Options, CSP, Permissions-Policy, etc.)
- [x] `.env` file permissions 600 (owner-only)
- [x] Systemd hardening (NoNewPrivileges, ProtectSystem=strict)
- [x] Daily automated PostgreSQL backups
- [x] SSH restricted to your IP only
- [ ] Configure SMTP for email notifications (optional)
- [ ] Set up S3 for document storage (recommended)
- [ ] Set up S3 backup bucket (recommended)

---

## Troubleshooting

### Backend won't start

```bash
sudo journalctl -u xpress-backend -n 50 --no-pager

# Test manually:
cd /opt/xpress-tech-portal/backend
sudo -u xpress ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Nginx errors

```bash
sudo nginx -t                              # Check config syntax
sudo tail -f /var/log/nginx/error.log      # Check error logs
```

### PostgreSQL connection issues

```bash
sudo systemctl status postgresql           # Is it running?
sudo -u postgres psql -c "SELECT 1"        # Can it connect?
sudo -u postgres psql -l                   # List databases
```

### Permission issues

```bash
sudo chown -R xpress:xpress /opt/xpress-tech-portal
sudo ls -la /opt/xpress-tech-portal/backend/.env
# Should be: -rw------- xpress xpress
```

---

## Scaling Path

| Threshold | Action | Cost Delta |
|-----------|--------|------------|
| >50 concurrent users | Upgrade to `t4g.medium` (4 GB RAM) | +$12/mo |
| Need DB high availability | Move PostgreSQL to RDS `db.t4g.micro` | +$13/mo |
| >1 TB documents | Move uploads to S3 | ~$23/TB/mo |
| Multi-region users | Add CloudFront CDN | ~$1–5/mo |
| Zero-downtime deploys | ALB + 2 EC2 instances | +$30/mo |

---

## Files Reference

| File | Purpose |
|------|---------|
| `deploy/setup.sh` | One-time server provisioning (PostgreSQL, Nginx, systemd, secrets) |
| `deploy/deploy.sh` | Redeploy after code changes (pull, build, back up, migrate, restart, wait for ready) |
| `deploy/backup.sh` | Daily backup: PostgreSQL + local uploads, to S3 when configured |
| `deploy/restore-test.sh` | Restore drill: proves the newest backup restores and decrypts |
| `deploy/nginx.conf` | Nginx config — HTTPS, static files, API reverse proxy |
| `deploy/xpress-backend.service` | Systemd service — auto-start, restart on failure |
| `.github/workflows/deploy.yml` | GitHub Actions CI/CD — lint, build, deploy to EC2 |
| `.env.example` | Environment variable template |
