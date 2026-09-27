ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promo_code VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS discount_cents INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  promotion_type ENUM('percentage','buy_get') NOT NULL,
  percentage TINYINT UNSIGNED NULL,
  trigger_category VARCHAR(80) NULL,
  trigger_product_id INT NULL,
  trigger_quantity SMALLINT UNSIGNED NULL,
  reward_category VARCHAR(80) NULL,
  reward_product_id INT NULL,
  reward_quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_promotions_restaurant_code (restaurant_id, code),
  INDEX idx_promotions_restaurant_active (restaurant_id, active),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);
