ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_setup_token_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS password_setup_expires_at DATETIME NULL;
