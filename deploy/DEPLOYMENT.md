# Xpress Tech Portal — AWS Production Deployment

## Architecture

```
Internet → Route 53 (DNS)
         → EC2 t4g.small (Ubuntu 24.04 ARM)
           ├── Nginx (port 80/443) — HTTPS + frontend static + /api reverse proxy
           ├── Uvicorn (FastAPI, port 8000) — 2 workers
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

## Optional: S3 Database Backups

```bash
# Create backup bucket
aws s3 mb s3://xpress-backups-prod --region ap-southeast-2

# Add S3 backup permissions to the IAM role (same as above, different bucket ARN)

# Configure
sudo bash -c 'echo "export S3_BACKUP_BUCKET=xpress-backups-prod" >> /etc/environment'
```

---

## CI/CD: Auto-Deploy on Push

Add these secrets to your GitHub repo (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your EC2 public IP or domain |
| `EC2_SSH_KEY` | Contents of your `.pem` private key |

Every push to `main` will automatically lint, build, and deploy.

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

# Restore from backup
gunzip xpresstech_YYYYMMDD_HHMMSS.sql.gz
sudo -u postgres pg_restore -d xpresstech --clean xpresstech_YYYYMMDD_HHMMSS.sql
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
| `deploy/deploy.sh` | Redeploy after code changes (git pull, build, restart) |
| `deploy/backup.sh` | Daily PostgreSQL backup (local + optional S3) |
| `deploy/nginx.conf` | Nginx config — HTTPS, static files, API reverse proxy |
| `deploy/xpress-backend.service` | Systemd service — auto-start, restart on failure |
| `.github/workflows/deploy.yml` | GitHub Actions CI/CD — lint, build, deploy to EC2 |
| `.env.example` | Environment variable template |
