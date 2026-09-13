/**
 * Database Migration Scripts for NEXTQ
 * 
 * This file contains functions to run database migrations.
 * Run with: npm run db:migrate
 */

import { getPool, executeQuery, executeTransaction, closePool } from './connection.js';
import { SCHEMA_SQL } from './schema.js';
import { getClinicBusinessDate, getClinicDateTimeUtc } from './services/clinicTime.js';

/**
 * Split SQL statements by semicolon, handling edge cases.
 * Respects single-quoted and double-quoted string literals so that
 * semicolons inside values are not treated as statement boundaries.
 */
function splitSqlStatements(sql: string): string[] {
  sql = sql.replace(/^\s*--[^\r\n]*(?:\r?\n|$)/gm, '');
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';
    if (char === "'" && !inDouble && prev !== '\\') inSingle = !inSingle;
    else if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    if (char === ';' && !inSingle && !inDouble) {
      statements.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
}

/**
 * Run all schema migrations
 */
export async function runMigrations(): Promise<void> {
  console.log('🔄 Running database migrations...');
  await executeQuery(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const baseline = await executeQuery<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = ? LIMIT 1',
    ['baseline-20260906']
  );
  const ensureSubscriptionColumns = async () => {
    for (const statement of [
      `ALTER TABLE clinics ADD COLUMN subscription_status ENUM('ACTIVE', 'EXPIRED', 'PAUSED') DEFAULT 'ACTIVE'`,
      `ALTER TABLE clinics ADD COLUMN subscription_started_at DATETIME NULL`,
      `ALTER TABLE clinics ADD COLUMN subscription_expires_at DATETIME NULL`,
    ]) {
      try {
        await executeQuery(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Duplicate column') && !message.includes('already exists')) throw error;
      }
    }
    await executeQuery(
      `UPDATE clinics
       SET subscription_started_at = COALESCE(subscription_started_at, created_at),
           subscription_expires_at = COALESCE(subscription_expires_at, DATE_ADD(COALESCE(subscription_started_at, created_at), INTERVAL 30 DAY))
       WHERE subscription_started_at IS NULL OR subscription_expires_at IS NULL`
    );
  };
  const ensureClinicTimezone = async () => {
    try {
      await executeQuery(`ALTER TABLE clinics ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata'`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Duplicate column') && !message.includes('already exists')) throw error;
    }
    await executeQuery(`UPDATE clinics SET timezone = 'Asia/Kolkata' WHERE timezone IS NULL OR timezone = ''`);
    await executeQuery(`INSERT IGNORE INTO schema_migrations (version) VALUES (?)`, ['clinic-timezone-20260907']);
  };
  const ensureAppointmentSlot = async () => {
    try {
      await executeQuery(`ALTER TABLE appointments ADD COLUMN scheduled_slot VARCHAR(100) NULL AFTER token_sequence`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Duplicate column') && !message.includes('already exists')) throw error;
    }
  };
  const backfillAppointmentTimes = async () => {
    const appointments = await executeQuery<{
      id: string;
      scheduled_slot?: string;
      created_at: Date | string;
      timezone?: string;
    }>(
      `SELECT a.id, a.scheduled_slot, a.created_at, c.timezone
       FROM appointments a
       JOIN clinics c ON c.id = a.clinic_id
       WHERE a.scheduled_slot IS NOT NULL AND TRIM(a.scheduled_slot) <> ''`
    );

    for (const appointment of appointments) {
      const createdAt = new Date(appointment.created_at);
      const businessDate = getClinicBusinessDate(createdAt, appointment.timezone);
      const scheduledTime = getClinicDateTimeUtc(businessDate, appointment.scheduled_slot, appointment.timezone);
      if (!scheduledTime) continue;
      await executeQuery(
        `UPDATE appointments
         SET scheduled_time = ?, estimated_time = ?
         WHERE id = ? AND (scheduled_time IS NULL OR scheduled_time = created_at)`,
        [scheduledTime, scheduledTime, appointment.id]
      );
    }
  };
  const migrateQrInventory = async () => {
    const legacyRows = await executeQuery<{ id: string; value?: string }>(
      'SELECT id, value FROM settings WHERE category = ?',
      ['barcode_inventory']
    );

    for (const row of legacyRows) {
      let payload: any;
      try {
        payload = typeof row.value === 'string' ? JSON.parse(row.value) : row.value || {};
      } catch {
        continue;
      }

      const code = String(payload?.barcodeValue || '').trim().toUpperCase();
      const label = String(payload?.label || '').trim();
      if (!code || !label) continue;

      const status = String(payload?.status || '').trim().toUpperCase() === 'DISABLED'
        ? 'DISABLED'
        : payload?.assignedDoctorId ? 'ASSIGNED' : 'AVAILABLE';
      await executeQuery(
        `INSERT INTO qr_codes
          (id, code, label, notes, status, clinic_id, doctor_id, assigned_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           label = VALUES(label), notes = VALUES(notes), status = VALUES(status),
           clinic_id = VALUES(clinic_id), doctor_id = VALUES(doctor_id), assigned_at = VALUES(assigned_at)`,
        [
          row.id,
          code,
          label,
          String(payload?.notes || '').trim() || null,
          status,
          payload?.assignedClinicId || null,
          payload?.assignedDoctorId || null,
          payload?.assignedAt || null,
          payload?.createdAt || new Date(),
          payload?.updatedAt || new Date(),
        ]
      );
    }
  };
  const ensureDoctorStatusDefault = async () => {
    await executeQuery(`ALTER TABLE clinics ALTER COLUMN doctor_status SET DEFAULT 'OUT'`);
  };
  if (baseline.length > 0) {
    await ensureSubscriptionColumns();
    await ensureClinicTimezone();
    console.log('✅ Database baseline found; checking schema statements and migrations');
  }
  
  const statements = splitSqlStatements(SCHEMA_SQL);
  
  for (const statement of statements) {
    const executableStatement = statement.replace(/^(?:\s*--[^\r\n]*(?:\r?\n|$))+/, '').trim();
    if (!executableStatement) continue;
    
    try {
      await executeQuery(executableStatement);
      console.log(`✅ Executed: ${executableStatement.substring(0, 80)}...`);
    } catch (error) {
      // Some statements might fail if they already exist (e.g., ALTER TABLE)
      // We'll log but continue for non-critical errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Duplicate column') || 
          errorMessage.includes('already exists') ||
          errorMessage.includes('Duplicate key')) {
        console.log(`⚠️  Skipped (already exists): ${executableStatement.substring(0, 80)}...`);
      } else {
        console.error(`❌ Failed: ${executableStatement.substring(0, 80)}...`);
        console.error(`   Error: ${errorMessage}`);
        throw error;
      }
    }
  }

  await ensureSubscriptionColumns();
  await ensureClinicTimezone();
  await ensureAppointmentSlot();
  await backfillAppointmentTimes();
  await migrateQrInventory();
  await ensureDoctorStatusDefault();

  await executeQuery(`ALTER TABLE tokens MODIFY token_type ENUM('ONLINE', 'WALK_IN', 'VIP', 'EMERGENCY') DEFAULT 'ONLINE'`);
  await executeQuery(`UPDATE tokens SET token_type = 'EMERGENCY' WHERE token_type = 'VIP'`);
  await executeQuery(`ALTER TABLE tokens MODIFY token_type ENUM('ONLINE', 'WALK_IN', 'EMERGENCY') DEFAULT 'ONLINE'`);
  await executeQuery(`ALTER TABLE appointments MODIFY appointment_type ENUM('ONLINE', 'WALK_IN', 'VIP', 'EMERGENCY') DEFAULT 'ONLINE'`);
  await executeQuery(`UPDATE appointments SET appointment_type = 'EMERGENCY' WHERE appointment_type = 'VIP'`);
  await executeQuery(`ALTER TABLE appointments MODIFY appointment_type ENUM('ONLINE', 'WALK_IN', 'EMERGENCY') DEFAULT 'ONLINE'`);
  await executeQuery(
    `INSERT IGNORE INTO schema_migrations (version) VALUES (?)`,
    ['baseline-20260906']
  );
  
  console.log('✅ All migrations completed successfully');
}

/** Run the database migrations required by the application. */
export async function initializeDatabase(): Promise<void> {
  console.log('🚀 Initializing database...');
  
  try {
    // Test connection first
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Cannot connect to database. Check your .env configuration.');
    }
    
    console.log('✅ Database connection established');
    
    // Run migrations
    await runMigrations();
    
    console.log('🎉 Database initialization complete!');
  } catch (error) {
    console.error('💥 Database initialization failed:', error);
    throw error;
  } finally {
    await closePool();
  }
}

/**
 * Test database connection
 */
async function testConnection(): Promise<boolean> {
  try {
    const pool = getPool();
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

/**
 * Drop all tables (use with caution!)
 */
export async function dropAllTables(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to drop production tables. Use an approved maintenance procedure.');
  }
  console.log('⚠️  Dropping all tables...');
  
  const tables = [
    'rate_limits',
    'qr_codes',
    'whatsapp_logs',
    'settings',
    'doctor_status',
    'queue_events',
    'tokens',
    'appointments',
    'sessions',
    'patients',
    'staff_users',
    'doctors',
    'clinics',
    'schema_migrations'
  ];
  
  for (const table of tables) {
    try {
      await executeQuery(`DROP TABLE IF EXISTS \`${table}\`;`);
      console.log(`✅ Dropped table: ${table}`);
    } catch (error) {
      console.error(`❌ Failed to drop table ${table}:`, error);
    }
  }
  
  console.log('✅ All tables dropped');
}

/**
 * Reset database - drop all tables and reinitialize
 */
export async function resetDatabase(): Promise<void> {
  console.log('🔄 Resetting database...');
  await dropAllTables();
  await initializeDatabase();
}

// CLI entry point
const command = process.argv[2];

switch (command) {
  case 'migrate':
    runMigrations()
      .finally(() => closePool())
      .catch(() => process.exit(1));
    break;
  case 'reset':
    resetDatabase().catch(() => process.exit(1));
    break;
  case 'drop':
    dropAllTables()
      .finally(() => closePool())
      .catch(() => process.exit(1));
    break;
  default:
    console.log(`
Database Migration Commands:
  npm run db:migrate    - Run migrations only
  npm run db:reset      - Drop all tables and reinitialize empty schema
  npm run db:drop       - Drop all tables (DANGEROUS)
    `);
    process.exit(1);
}