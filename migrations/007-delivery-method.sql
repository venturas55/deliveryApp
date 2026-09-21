ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery' AFTER payment_method;
ALTER TABLE restaurants
    ADD COLUMN delivery_base_cents INT UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN free_delivery_from_cents INT UNSIGNED DEFAULT NULL,
    ADD COLUMN logo_url VARCHAR(500) DEFAULT NULL;