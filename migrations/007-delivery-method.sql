ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery' AFTER payment_method;
