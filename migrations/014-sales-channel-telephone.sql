ALTER TABLE orders
  MODIFY COLUMN sales_channel ENUM('web','phone','telephone','counter') NOT NULL DEFAULT 'web';
