CREATE TABLE IF NOT EXISTS restaurant_customers (
  restaurant_id INT NOT NULL,
  customer_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (restaurant_id, customer_id),
  INDEX idx_restaurant_customers_customer (customer_id),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

INSERT IGNORE INTO restaurant_customers (restaurant_id, customer_id)
SELECT DISTINCT restaurant_id, customer_id FROM orders WHERE customer_id IS NOT NULL;

INSERT IGNORE INTO restaurant_customers (restaurant_id, customer_id)
SELECT r.id, c.id FROM customers c CROSS JOIN restaurants r
WHERE (SELECT COUNT(*) FROM restaurants)=1
AND NOT EXISTS (SELECT 1 FROM restaurant_customers rc WHERE rc.customer_id=c.id);
