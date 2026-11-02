CREATE DATABASE IF NOT EXISTS college_bus_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE college_bus_demo;

CREATE TABLE IF NOT EXISTS staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_code VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  department VARCHAR(80) NOT NULL,
  daily_transport_rate DECIMAL(10,2) NOT NULL,
  phone VARCHAR(24) NULL,
  address VARCHAR(500) NULL,
  bus_id INT NULL,
  stop_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_staff_daily_transport_rate CHECK (daily_transport_rate >= 0)
);
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','bus_staff','student','staff_passenger') NOT NULL,
  student_id INT NULL,
  staff_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_staff_id UNIQUE (staff_id),
  CONSTRAINT fk_user_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT chk_user_staff_link CHECK ((role='staff_passenger' AND staff_id IS NOT NULL AND student_id IS NULL) OR (role<>'staff_passenger' AND staff_id IS NULL))
);
CREATE TABLE IF NOT EXISTS buses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bus_name VARCHAR(80) NOT NULL,
  registration_no VARCHAR(30) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS routes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_name VARCHAR(100) NOT NULL
);
CREATE TABLE IF NOT EXISTS stops (
  id INT AUTO_INCREMENT PRIMARY KEY,
  route_id INT NOT NULL,
  stop_name VARCHAR(100) NOT NULL,
  CONSTRAINT fk_stop_route FOREIGN KEY (route_id) REFERENCES routes(id)
);
CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  roll_number CHAR(6) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  department VARCHAR(80) NOT NULL,
  year_of_study TINYINT UNSIGNED NOT NULL,
  bus_id INT NULL,
  stop_id INT NULL,
  fee_status ENUM('Paid','Pending') NOT NULL DEFAULT 'Pending',
  amount_due DECIMAL(10,2) NOT NULL DEFAULT 0,
  annual_fee DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) NOT NULL,
  phone VARCHAR(24) NULL,
  address VARCHAR(500) NULL,
  CONSTRAINT fk_student_bus FOREIGN KEY (bus_id) REFERENCES buses(id),
  CONSTRAINT fk_student_stop FOREIGN KEY (stop_id) REFERENCES stops(id),
  CONSTRAINT chk_students_roll_number_six_digits CHECK (roll_number REGEXP '^[0-9]{6}$'),
  CONSTRAINT chk_students_fee_balance CHECK (annual_fee >= 0 AND amount_paid >= 0 AND amount_paid <= annual_fee AND amount_due = annual_fee - amount_paid),
  CONSTRAINT chk_students_fee_status CHECK ((amount_due = 0 AND fee_status = 'Paid') OR (amount_due > 0 AND fee_status = 'Pending'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('Simulated','Failed') NOT NULL DEFAULT 'Simulated',
  reference VARCHAR(48) NOT NULL UNIQUE,
  request_key VARCHAR(100) NOT NULL,
  method VARCHAR(32) NOT NULL DEFAULT 'SIMULATED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_payment_request (student_id,request_key),
  CONSTRAINT fk_payment_student FOREIGN KEY (student_id) REFERENCES students(id)
);
CREATE TABLE IF NOT EXISTS scan_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  roll_number VARCHAR(80) NULL,
  student_id INT NULL,
  staff_id INT NULL,
  charge_id BIGINT NULL,
  scan_type ENUM('student','staff','unknown') NOT NULL DEFAULT 'student',
  result ENUM('Eligible','Fee Pending','Unknown/Unable to Verify','Error','Staff boarding recorded','Already charged today') NOT NULL,
  scanned_by INT NULL,
  bus_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_scan_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_scan_user FOREIGN KEY (scanned_by) REFERENCES users(id),
  CONSTRAINT fk_scan_bus FOREIGN KEY (bus_id) REFERENCES buses(id),
  INDEX idx_scan_created (created_at)
);
CREATE TABLE IF NOT EXISTS staff_boarding_charges (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NOT NULL,
  boarding_date DATE NOT NULL,
  daily_rate DECIMAL(10,2) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  scan_record_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_staff_charge_day (staff_id,boarding_date),
  INDEX idx_staff_charge_date (boarding_date),
  CONSTRAINT fk_charge_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT fk_charge_scan FOREIGN KEY (scan_record_id) REFERENCES scan_records(id),
  CONSTRAINT chk_charge_amount CHECK (amount >= 0 AND daily_rate >= 0)
);
CREATE TABLE IF NOT EXISTS staff_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status ENUM('Simulated','Failed') NOT NULL DEFAULT 'Simulated',
  reference VARCHAR(48) NOT NULL UNIQUE,
  request_key VARCHAR(100) NOT NULL UNIQUE,
  method VARCHAR(32) NOT NULL DEFAULT 'SIMULATED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_staff_payment (staff_id,created_at),
  CONSTRAINT fk_staff_payment_staff FOREIGN KEY (staff_id) REFERENCES staff(id),
  CONSTRAINT chk_staff_payment_amount CHECK (amount > 0)
);
CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS change_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  requested_bus_id INT NULL,
  requested_stop_id INT NULL,
  note VARCHAR(500) NULL,
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  active_username VARCHAR(80) GENERATED ALWAYS AS (CASE WHEN status IN ('Pending','Approved') THEN username ELSE NULL END) STORED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_request_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_request_bus FOREIGN KEY (requested_bus_id) REFERENCES buses(id),
  CONSTRAINT fk_request_stop FOREIGN KEY (requested_stop_id) REFERENCES stops(id)
);
CREATE TABLE IF NOT EXISTS registration_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('student','staff_passenger') NOT NULL,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  department VARCHAR(80) NOT NULL,
  phone VARCHAR(24) NOT NULL,
  address VARCHAR(500) NOT NULL,
  year_of_study TINYINT UNSIGNED NULL,
  preferred_route_id INT NOT NULL,
  status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
  rejection_reason VARCHAR(500) NULL,
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_registration_active_username(active_username),
  CONSTRAINT fk_registration_route FOREIGN KEY (preferred_route_id) REFERENCES routes(id),
  CONSTRAINT fk_registration_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_registration_status_created(status,created_at)
);
