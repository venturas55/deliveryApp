ALTER TABLE orders
    ADD COLUMN payment_status ENUM(
        'pending',
        'paid',
        'failed',
        'cancelled',
        'refunded'
    ) NOT NULL DEFAULT 'pending' AFTER payment_method,

    ADD COLUMN redsys_order VARCHAR(12) DEFAULT NULL AFTER payment_status,

    ADD COLUMN redsys_authorization_code VARCHAR(20) DEFAULT NULL AFTER redsys_order,

    ADD COLUMN paid_at DATETIME DEFAULT NULL AFTER redsys_authorization_code,

    ADD UNIQUE KEY uq_orders_redsys_order (redsys_order);