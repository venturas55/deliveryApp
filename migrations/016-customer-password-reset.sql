ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS password_reset_token_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at DATETIME NULL;
