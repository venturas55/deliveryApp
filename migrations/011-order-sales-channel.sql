ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sales_channel ENUM('web','telephone','counter') NOT NULL DEFAULT 'web';
