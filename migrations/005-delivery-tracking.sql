ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_verification_code VARCHAR(36) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_details_json LONGTEXT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_event_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE order_events ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(191) COLLATE utf8mb4_bin NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_provider_event ON order_events(order_id,provider_event_id);
