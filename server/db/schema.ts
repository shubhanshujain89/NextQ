/**
 * MySQL Schema Definitions for NEXTQ
 * 
 * This file contains the SQL statements to create all required tables
 * with proper primary keys, foreign keys, indexes, and constraints.
 */

export const SCHEMA_SQL = `
-- Clinics table
CREATE TABLE IF NOT EXISTS clinics (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    doctor_name VARCHAR(255),
    specialty VARCHAR(255),
    cabin_number VARCHAR(100),
    doctor_status ENUM('IN', 'OUT', 'ON_BREAK', 'EMERGENCY') DEFAULT 'OUT',
    delay_minutes INT DEFAULT 0,
    delay_reason TEXT,
    avg_consultation_minutes DECIMAL(5,2) DEFAULT 12.00,
    consultation_fee DECIMAL(10,2) DEFAULT 0.00,
    current_running_token VARCHAR(50),
    current_running_token_id VARCHAR(64),
    active_session_id VARCHAR(64),
    total_patients_today INT DEFAULT 0,
    revenue_today DECIMAL(12,2) DEFAULT 0.00,
    phone VARCHAR(50),
    address TEXT,
    email VARCHAR(255),
    logo TEXT,
    operating_hours TEXT,
    specializations TEXT,
    qr_code_url TEXT,
    feature_plan ENUM('TRIAL', 'BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE') DEFAULT 'TRIAL',
    subscription_status ENUM('ACTIVE', 'EXPIRED', 'PAUSED') DEFAULT 'ACTIVE',
    subscription_started_at DATETIME NULL,
    subscription_expires_at DATETIME NULL,
    whatsapp_notifications_enabled TINYINT(1) DEFAULT 0,
    has_payment_gateway TINYINT(1) DEFAULT 0,
    clinic_upi_id VARCHAR(100),
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_clinics_feature_plan (feature_plan),
    INDEX idx_clinics_active_session (active_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Shared rate-limit counters for multi-instance deployments
CREATE TABLE IF NOT EXISTS rate_limits (
    rate_key VARCHAR(255) PRIMARY KEY,
    request_count INT NOT NULL DEFAULT 0,
    reset_at TIMESTAMP NOT NULL,
    INDEX idx_rate_limits_reset_at (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doctors table
CREATE TABLE IF NOT EXISTS doctors (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    specialization VARCHAR(255),
    qualification VARCHAR(255),
    experience VARCHAR(50),
    phone VARCHAR(50),
    email VARCHAR(255),
    photo_url TEXT,
    bio TEXT,
    consultation_fee DECIMAL(10,2) DEFAULT 0.00,
    available_days JSON,
    available_hours VARCHAR(100),
    rating DECIMAL(3,2) DEFAULT 0.00,
    status ENUM('active', 'inactive', 'on_leave') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_doctors_clinic_id (clinic_id),
    INDEX idx_doctors_status (status),
    INDEX idx_doctors_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff/Users table
CREATE TABLE IF NOT EXISTS staff_users (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64),
    doctor_id VARCHAR(64),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'STAFF') NOT NULL,
    display_name VARCHAR(255),
    name VARCHAR(255),
    phone VARCHAR(50),
    status ENUM('Active', 'Inactive', 'Pending') DEFAULT 'Active',
    clinic_name VARCHAR(255),
    access_status ENUM('Granted', 'Pending', 'Revoked') DEFAULT 'Granted',
    photo_url TEXT,
    password_reset VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
    INDEX idx_staff_users_clinic_id (clinic_id),
    INDEX idx_staff_users_doctor_id (doctor_id),
    INDEX idx_staff_users_email (email),
    INDEX idx_staff_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Patients table
CREATE TABLE IF NOT EXISTS patients (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    tracking_id VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    age INT,
    gender ENUM('Male', 'Female', 'Other'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_patients_clinic_id (clinic_id),
    INDEX idx_patients_tracking_id (tracking_id),
    INDEX idx_patients_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    date DATE NOT NULL,
    status ENUM('ACTIVE', 'COMPLETED', 'CANCELLED') DEFAULT 'ACTIVE',
    total_tokens_issued INT DEFAULT 0,
    rolling_avg_minutes DECIMAL(5,2) DEFAULT 0.00,
    completed_count INT DEFAULT 0,
    total_revenue DECIMAL(12,2) DEFAULT 0.00,
    active_token_id VARCHAR(64),
    active_token_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_sessions_clinic_id (clinic_id),
    INDEX idx_sessions_date (date),
    INDEX idx_sessions_status (status),
    UNIQUE KEY uk_sessions_clinic_date (clinic_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    doctor_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    tracking_id VARCHAR(64) NOT NULL,
    patient_name VARCHAR(255) NOT NULL,
    patient_phone VARCHAR(50) NOT NULL,
    patient_age INT,
    visit_reason TEXT,
    appointment_type ENUM('ONLINE', 'WALK_IN', 'EMERGENCY') DEFAULT 'ONLINE',
    token_number VARCHAR(50) NOT NULL,
    token_sequence INT NOT NULL,
    scheduled_slot VARCHAR(100),
    status ENUM('scheduled', 'waiting', 'serving', 'completed', 'cancelled', 'no_show') DEFAULT 'scheduled',
    scheduled_time TIMESTAMP NULL,
    estimated_time TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    INDEX idx_appointments_clinic_id (clinic_id),
    INDEX idx_appointments_doctor_id (doctor_id),
    INDEX idx_appointments_session_id (session_id),
    INDEX idx_appointments_tracking_id (tracking_id),
    INDEX idx_appointments_status (status),
    INDEX idx_appointments_token_sequence (token_sequence),
    UNIQUE KEY uk_appointments_tracking_id (tracking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tokens table (for queue management)
CREATE TABLE IF NOT EXISTS tokens (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    session_id VARCHAR(64) NOT NULL,
    doctor_id VARCHAR(64) NOT NULL,
    token_number VARCHAR(50) NOT NULL,
    sequence_number INT NOT NULL,
    patient_id VARCHAR(64),
    patient_name VARCHAR(255) NOT NULL,
    patient_phone VARCHAR(50) NOT NULL,
    patient_age INT,
    patient_gender ENUM('Male', 'Female', 'Other'),
    token_type ENUM('ONLINE', 'WALK_IN', 'EMERGENCY') DEFAULT 'ONLINE',
    status ENUM('WAITING', 'CALLED', 'IN_CONSULTATION', 'SERVING', 'COMPLETED', 'HOLD', 'CANCELLED', 'NO_SHOW') DEFAULT 'WAITING',
    is_vip TINYINT(1) DEFAULT 0,
    is_hold TINYINT(1) DEFAULT 0,
    priority INT DEFAULT 10,
    amount_paid DECIMAL(10,2) DEFAULT 0.00,
    payment_mode VARCHAR(50),
    payment_method VARCHAR(50),
    payment_status ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED') DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    called_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    consultation_duration_seconds INT,
    pre_consultation_notes JSON,
    weight VARCHAR(20),
    temperature VARCHAR(20),
    oxygen_saturation VARCHAR(20),
    blood_pressure VARCHAR(50),
    triage_notes TEXT,
    doctor_notes TEXT,
    whatsapp_sent_count INT DEFAULT 0,
    whatsapp_last_sent_at TIMESTAMP NULL,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
    INDEX idx_tokens_clinic_id (clinic_id),
    INDEX idx_tokens_session_id (session_id),
    INDEX idx_tokens_doctor_id (doctor_id),
    INDEX idx_tokens_status (status),
    INDEX idx_tokens_sequence_number (sequence_number),
    INDEX idx_tokens_patient_id (patient_id),
    UNIQUE KEY uk_tokens_clinic_session_doctor_seq (clinic_id, session_id, doctor_id, sequence_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Queue Events table
CREATE TABLE IF NOT EXISTS queue_events (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    token_id VARCHAR(64),
    patient_id VARCHAR(64),
    event_type VARCHAR(100) NOT NULL,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE SET NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
    INDEX idx_queue_events_clinic_id (clinic_id),
    INDEX idx_queue_events_token_id (token_id),
    INDEX idx_queue_events_patient_id (patient_id),
    INDEX idx_queue_events_event_type (event_type),
    INDEX idx_queue_events_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Doctor Status table
CREATE TABLE IF NOT EXISTS doctor_status (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64) NOT NULL,
    doctor_id VARCHAR(64) NOT NULL,
    status ENUM('IN', 'OUT', 'ON_BREAK', 'EMERGENCY') DEFAULT 'IN',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_doctor_status_clinic_id (clinic_id),
    INDEX idx_doctor_status_doctor_id (doctor_id),
    UNIQUE KEY uk_doctor_status_clinic_doctor (clinic_id, doctor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
    id VARCHAR(64) PRIMARY KEY,
    clinic_id VARCHAR(64),
    \`key\` VARCHAR(100) NOT NULL,
    value TEXT,
    category VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE,
    INDEX idx_settings_clinic_id (clinic_id),
    INDEX idx_settings_key (\`key\`),
    UNIQUE KEY uk_settings_clinic_key (clinic_id, \`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- QR inventory table
CREATE TABLE IF NOT EXISTS qr_codes (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    notes TEXT,
    status ENUM('AVAILABLE', 'ASSIGNED', 'DISABLED') NOT NULL DEFAULT 'AVAILABLE',
    clinic_id VARCHAR(64),
    doctor_id VARCHAR(64),
    assigned_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_qr_codes_status (status),
    INDEX idx_qr_codes_clinic_id (clinic_id),
    INDEX idx_qr_codes_doctor_id (doctor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WhatsApp Logs table
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id VARCHAR(64) PRIMARY KEY,
    token_id VARCHAR(64),
    patient_name VARCHAR(255),
    phone VARCHAR(50),
    template_name VARCHAR(100),
    message_body TEXT,
    status ENUM('sent', 'delivered', 'read', 'failed', 'pending') DEFAULT 'pending',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    meta_message_id VARCHAR(100),
    
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE SET NULL,
    INDEX idx_whatsapp_logs_token_id (token_id),
    INDEX idx_whatsapp_logs_phone (phone),
    INDEX idx_whatsapp_logs_status (status),
    INDEX idx_whatsapp_logs_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

