CREATE TABLE IF NOT EXISTS delivery_providers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  provider VARCHAR(40) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  credentials_ciphertext LONGTEXT,
  settings_json LONGTEXT,
  webhook_secret_ciphertext LONGTEXT,
  last_test_status VARCHAR(20),
  last_test_error VARCHAR(500),
  last_tested_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_delivery_provider_restaurant (restaurant_id, provider),
  INDEX idx_delivery_provider_enabled (restaurant_id, enabled),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);