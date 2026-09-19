CREATE DATABASE IF NOT EXISTS reparto CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE reparto;

CREATE TABLE IF NOT EXISTS restaurants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  phone VARCHAR(40),
  address VARCHAR(500),
  city VARCHAR(100) DEFAULT 'Valencia',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  category VARCHAR(80) DEFAULT 'Pizzas',
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255),
  price_cents INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  postal_codes VARCHAR(500),
  min_order_cents INT NOT NULL DEFAULT 0,
  delivery_fee_cents INT NOT NULL DEFAULT 399,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  restaurant_id INT NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL,
  delivery_address VARCHAR(500) NOT NULL,
  delivery_notes VARCHAR(500),
  payment_method ENUM('cash','card_on_delivery','online') NOT NULL DEFAULT 'cash',
  status ENUM('new','accepted','preparing','ready','delivery_requested','courier_assigned','out_for_delivery','delivered','cancelled') NOT NULL DEFAULT 'new',
  subtotal_cents INT NOT NULL,
  delivery_cents INT NOT NULL DEFAULT 0,
  total_cents INT NOT NULL,
  provider VARCHAR(40),
  provider_order_id VARCHAR(160),
  provider_status VARCHAR(80),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_restaurant_status (restaurant_id,status),
  INDEX idx_restaurant_created (restaurant_id,created_at),
  FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  quantity INT NOT NULL,
  unit_price_cents INT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_json LONGTEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_events(order_id,created_at),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

INSERT INTO restaurants(name,slug,phone,address)
SELECT 'Pizzería Demo','demo','+34000000000','Dirección pendiente'
WHERE NOT EXISTS (SELECT 1 FROM restaurants);

SET @rid=(SELECT id FROM restaurants WHERE slug='demo' LIMIT 1);

INSERT INTO products(restaurant_id,category,name,description,price_cents,sort_order)
SELECT @rid,'Pizzas','Margarita','Tomate, mozzarella y albahaca',950,10
WHERE NOT EXISTS (SELECT 1 FROM products WHERE restaurant_id=@rid);
INSERT INTO products(restaurant_id,category,name,description,price_cents,sort_order)
SELECT @rid,'Pizzas','Pepperoni','Tomate, mozzarella y pepperoni',1150,20
WHERE NOT EXISTS (SELECT 1 FROM products WHERE restaurant_id=@rid AND name='Pepperoni');
INSERT INTO products(restaurant_id,category,name,description,price_cents,sort_order)
SELECT @rid,'Pizzas','4 Quesos','Mozzarella, gorgonzola, parmesano y emmental',1250,30
WHERE NOT EXISTS (SELECT 1 FROM products WHERE restaurant_id=@rid AND name='4 Quesos');
INSERT INTO products(restaurant_id,category,name,description,price_cents,sort_order)
SELECT @rid,'Pizzas','Prosciutto','Tomate, mozzarella y jamón',1150,40
WHERE NOT EXISTS (SELECT 1 FROM products WHERE restaurant_id=@rid AND name='Prosciutto');
INSERT INTO products(restaurant_id,category,name,description,price_cents,sort_order)
SELECT @rid,'Bebidas','Bebida','Refresco 330 ml',250,50
WHERE NOT EXISTS (SELECT 1 FROM products WHERE restaurant_id=@rid AND name='Bebida');

INSERT INTO delivery_zones(restaurant_id,name,postal_codes,min_order_cents,delivery_fee_cents)
SELECT @rid,'Zona estándar','46001,46002,46003,46004,46005,46006,46007,46008,46009,46010,46011,46012,46013,46014,46015,46016,46017,46018,46019,46020,46021,46022,46023,46024,46025,46026,46035',0,399
WHERE NOT EXISTS (SELECT 1 FROM delivery_zones WHERE restaurant_id=@rid);
