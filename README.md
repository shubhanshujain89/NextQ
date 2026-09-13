# NEXTQ

A smart, app-free clinic appointment and queue management platform for doctors, reception teams, and patients with real-time queue workflows, patient tracking, and comprehensive admin dashboard.

## Quick Start - Local Development

### Prerequisites
- Node.js 18+ (Node.js 20 LTS recommended)
- npm or yarn

### Installation

```bash
# Clone repository
git clone <repo-url>
cd nextq

# Install dependencies
npm ci

# Create .env file from example
cp .env.example .env
```

### Development Mode

```bash
# Terminal 1: Frontend (runs on port 3000)
npm run dev

# Terminal 2: Backend API (runs on port 4000)
npm run dev:server
```

Visit `http://localhost:3000` in your browser.

## Production Build

```bash
# Build frontend assets
npm run build

# Start production server (both frontend + backend)
npm run start
```

## Deployment on Hostinger

### 1. Prepare Repository

```bash
npm run clean     # Remove build artifacts
npm run lint      # Verify code
npm run build     # Create production build
```


### 2. Push to GitHub

```bash
git add .
git commit -m "Production ready: NEXTQ v1.0"
git push origin main
```

### 3. Hostinger Deployment Steps

1. **Connect GitHub Repository**
   - Go to Hostinger Dashboard > Hosting > Git
   - Click "Connect Repository"
   - Select your GitHub account and repository
   - Choose `main` branch

2. **Configure Environment Variables**
   - In Hostinger Dashboard, set these variables:
     ```
     NODE_ENV=production
     PORT=<auto-assigned by Hostinger>
   DB_HOST=<mysql-host>
   DB_PORT=3306
   DB_USER=<mysql-user>
   DB_PASSWORD=<mysql-password>
   DB_NAME=<mysql-database>
   SUPER_ADMIN_PASSWORD=<strong-bootstrap-password-at-least-12-characters>
     ```
   - **IMPORTANT**: Change default admin password before deploying

3. **Build & Deploy**
   - Set build command: `npm ci && npm run build`
   - Set start command: `npm run start`
   - Enable automatic deployments on git push

4. **Database Persistence**
   - Create the MySQL database and user in Hostinger before starting the server.
   - Run `npm run db:migrate` once with the production environment variables. Migrations create an empty schema and never insert accounts or sample records.
   - Back up the MySQL database regularly.

### 4. Post-Deployment Verification

After deployment, test:

```bash
# Liveness check: process is running
curl https://your-domain.com/api/health

# Readiness check: database is reachable and usable
curl https://your-domain.com/api/ready

# Status endpoint
curl https://your-domain.com/api/status
```

## Project Structure

```
nextq/
├── src/                    # React frontend components
│   ├── components/        # React components
│   ├── pages/            # Page components
│   ├── lib/              # Utilities and services
│   └── types/            # TypeScript types
├── server/               # Express backend
│   └── db/               # MySQL schema, migrations, repositories, and services
├── server.ts            # Express server entry point
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
├── tsconfig.json        # TypeScript configuration
├── package.json         # Dependencies
└── dist-server/         # Generated production server output
```

## Key Features

- **Real-time Queue Management**: Live doctor and receptionist workflows
- **Patient Tracking**: Track patient status from booking to consultation
- **Admin Dashboard**: Comprehensive clinic management with billing and user management
- **WhatsApp Integration**: Optional WhatsApp notifications (webhook ready)
- **Responsive UI**: Premium dark theme optimized for healthcare
- **Multi-user Support**: Clinic Admin, Doctor, Staff, and Super Admin roles

## API Endpoints

### Public Endpoints
- `GET /api/health` - Health check
- `GET /api/ready` - Readiness check including live MySQL connectivity
- `GET /api/status` - Server status

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout

### Database Operations
- `GET /api/db/collection/:path` - Read collection
- `GET /api/db/doc/:path` - Read document
- `POST /api/db/doc` - Create/update document

### WhatsApp Integration
- `GET /api/whatsapp/webhook` - Webhook verification
- `POST /api/whatsapp/webhook` - Receive WhatsApp messages
- `POST /api/whatsapp/send-template` - Send WhatsApp template

## Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Vite
- **Backend**: Express.js, Node.js
- **Database**: MySQL 8+
- **UI Components**: Lucide React icons
- **Build Tool**: Vite 6.2.3
- **Package Manager**: npm

## Environment Variables

See `.env.example` for complete configuration. Key variables:

- `NODE_ENV` - Set to `production` for deployment
- `PORT` - Server port (default: 3000)
- `BACKEND_PORT` - API port (default: 4000)
- `SUPER_ADMIN_USERNAME` - Super-admin login email
- `SUPER_ADMIN_PASSWORD` - Strong bootstrap password
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - MySQL connection settings

## Security Notes

⚠️ **IMPORTANT**: Before going live:

1. Provision the first administrator through the approved production account workflow
2. Enable HTTPS on Hostinger
3. Set `NODE_ENV=production`
4. Disable debug mode (`DEBUG_MODE=false`)
5. Use strong session secrets
6. Regularly back up the MySQL database

## Production Notes

- Authentication uses signed expiring cookies shared across instances; set a long random `SESSION_SECRET` in every instance.
- Rate-limit counters are stored in MySQL and are initialized by `npm run db:migrate`.
- Run `npm run db:migrate` as a release step before the first start.
- `npm run db:reset` and `npm run db:drop` are destructive commands and must never run against production data.
- `npm test`, `npm run lint`, and `npm run build` are the required pre-deploy checks.

## Support & Issues

For issues or questions, please check:
1. Hostinger logs: Dashboard > Hosting > Logs
2. Server console output via Hostinger terminal
3. Browser console for frontend errors

---

**Version**: 1.0.0 | **License**: Proprietary | **Maintained**: Yes

