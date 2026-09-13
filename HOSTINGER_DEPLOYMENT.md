# NEXTQ - Hostinger Deployment Guide

## Quick Summary

**NEXTQ** is a smart, app-free clinic appointment and queue management platform built with React 19, Express.js, TypeScript, and MySQL.

- **Repository**: GitHub (Ready for deployment)
- **Status**: Single-instance deployment ready after environment and database setup
- **Node Version**: 18+ required (20 LTS recommended)
- **Build Status**: ✅ Passing (TypeScript strict mode)

---

## 🚀 Hostinger Deployment Steps

### Step 1: Repository Setup on Hostinger

1. Log in to Hostinger Dashboard
2. Navigate to **Hosting → Git**
3. Click **Connect Repository**
4. Select GitHub and authorize
5. Choose the NEXTQ repository
6. Select `main` branch
7. Click **Connect**

### Step 2: Environment Variables

Go to **Hosting → Environment Variables** and set:

```
NODE_ENV=production
PORT=<Hostinger-provided application port>
BACKEND_PORT=<same port as PORT for the unified server>
DB_HOST=<hostinger-mysql-host>
DB_PORT=3306
DB_USER=<hostinger-mysql-user>
DB_PASSWORD=<strong-database-password>
DB_NAME=<hostinger-mysql-database>
SUPER_ADMIN_USERNAME=<unique-production-super-admin-email>
SESSION_SECRET=<long-random-secret>
```

⚠️ **CRITICAL**: Change `SUPER_ADMIN_PASSWORD` to a strong, unique password before deploying!

Optional variables:
```
DEBUG_MODE=false
SESSION_MAX_AGE=28800
TRUST_PROXY=true
```

`SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD` are optional bootstrap credentials. If configured, use a unique production identity.

### Step 3: Build Configuration

Set in Hostinger deployment settings:

**Build Command:**
```bash
npm ci && npm run build
```

**Start Command:**
```bash
npm run start
```

**Build Output:** `dist/` and `dist-server/` (both are required by `npm run start`)

**Root Directory:** `/`

### Step 4: Deploy

1. Click **Deploy**
2. Wait for build to complete (typically 3-5 minutes)
3. Check deployment logs for errors
4. Access site at your Hostinger domain

---

## ✅ Verification Checklist

After deployment, verify:

### Health Checks
```bash
# Check if the process is running
curl https://your-domain/api/health

# Check if the application and database are ready
curl https://your-domain/api/ready

# Check server status
curl https://your-domain/api/status
```

### Test Login
- Navigate to app login page
- Use the super-admin email configured in `SUPER_ADMIN_USERNAME` and the corresponding bootstrap password.

### Test Database
- Check if patient data can be created
- Verify clinic information is saved
- Confirm database persists between requests

---

## 📁 Project Structure

```
nextq/
├── src/                    # React frontend
│   ├── pages/             # Page components (Admin, Login, etc)
│   ├── components/        # Reusable UI components
│   ├── lib/              # Utilities (Firebase API, auth, etc)
│   └── types/            # TypeScript type definitions
├── server/
│   └── db/               # MySQL schema, repositories, and services
├── server.ts             # Express server
├── vite.config.ts        # Frontend build config
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies
├── .env.example          # Environment template
└── README.md             # Full documentation
```

---

## 🔑 Key Features

✅ **Clinic Management** - Clinic profiles, staff, doctor management
✅ **Queue System** - Real-time patient queue tracking
✅ **Admin Dashboard** - Comprehensive management interface with billing
✅ **Multi-role Support** - Clinic Admin, Doctor, Staff, Super Admin
✅ **Patient Booking** - Appointment scheduling system
✅ **Payment Tracking** - Billing and subscription management
✅ **Responsive UI** - Mobile-friendly design
✅ **Database Persistence** - MySQL with daily queue-data retention

---

## 🛡️ Security

- All sensitive data stored in environment variables (not in code)
- Password hashing with scrypt algorithm
- Session-based authentication with secure cookies
- HTTPS required for production
- No hardcoded credentials

---

## 📝 Important Notes

### Database
- MySQL is configured with `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.
- Run `npm run db:migrate` before the first deployment.
- Queue and patient history older than the current day is automatically removed.
- Authentication uses signed expiring cookies shared across instances. Keep the same long random `SESSION_SECRET` on every instance.
- Rate-limit counters are stored in MySQL and are initialized by `npm run db:migrate`.
- Back up MySQL regularly for production data.

### Database Initialization
Run `npm run db:migrate` before the first start. It creates the schema only; no users, clinics, or sample records are inserted.


### Ports
- Unified server: the exact `PORT` supplied by Hostinger
- Single unified server running both

---

## 🔧 Troubleshooting

### Build Fails
- Check Node.js version (must be 18+)
- Verify all dependencies: `npm list`
- Check Hostinger build logs

### App Won't Start
- Verify `SUPER_ADMIN_PASSWORD` is set
- Check database permissions
- Review Hostinger error logs

### Login Issues
- Verify credentials and environment variables
- Check that MySQL migrations completed successfully
- Enable `DEBUG_MODE=true` temporarily for logs

### Database Errors
- Verify MySQL host, credentials, database name, and permissions
- Run `npm run db:migrate` from the release environment
- Check available database connections and Hostinger logs

---

## 📞 Support

For issues:
1. Check Hostinger Dashboard Logs
2. Review `.env` configuration
3. Verify Node.js version compatibility
4. Check GitHub repository for updates

---

**Version**: 1.0.0  
**Last Updated**: 2026-08-30  
**Status**: Single-instance deployment ready; shared sessions are still required for horizontal scaling
