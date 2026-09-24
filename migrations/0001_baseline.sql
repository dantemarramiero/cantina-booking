-- Baseline dello schema (migrazione 0001), generata da server.js su un database vuoto il 2026-09-24.
-- Solo riferimento: queste tabelle sono create all'avvio da server.js, non da questo file.
-- 50 tabelle, 52 indici.

CREATE TABLE agent_provinces (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id  INTEGER NOT NULL,
    province  TEXT NOT NULL,
    UNIQUE(agent_id, province),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

CREATE TABLE agents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    token      TEXT UNIQUE NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  , code TEXT, username TEXT, password_hash TEXT, gender TEXT, mobile TEXT, address TEXT, city TEXT, business_province TEXT, postal_code TEXT, country TEXT, vat_number TEXT, sdi_code TEXT, pec TEXT, iban TEXT, fiscal_code TEXT, payment_terms TEXT, commission_percent REAL DEFAULT 0, enasarco_number TEXT, contract_type TEXT);

CREATE TABLE b2c_customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE,
    phone      TEXT,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE b2c_orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id   INTEGER NOT NULL,
    channel       TEXT NOT NULL,
    order_number  TEXT,
    amount_cents  INTEGER NOT NULL DEFAULT 0,
    order_date    TEXT NOT NULL,
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (customer_id) REFERENCES b2c_customers(id)
  );

CREATE TABLE bookings (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id               INTEGER NOT NULL,
    experience_id         INTEGER NOT NULL,
    customer_name         TEXT NOT NULL,
    email                 TEXT NOT NULL,
    phone                 TEXT,
    guests                INTEGER NOT NULL DEFAULT 1,
    language              TEXT DEFAULT 'it',
    notes                 TEXT,
    status                TEXT NOT NULL DEFAULT 'in_attesa',
    amount_cents          INTEGER NOT NULL DEFAULT 0,
    discount_code         TEXT,
    discount_cents        INTEGER NOT NULL DEFAULT 0,
    stripe_session_id     TEXT,
    payment_intent_id     TEXT,
    stripe_payment_status TEXT,
    checked_in            INTEGER DEFAULT 0,
    checked_in_at         TEXT,
    created_at            TEXT DEFAULT (datetime('now','localtime')), operator_id INTEGER, b2c_customer_id INTEGER, discount_code_id INTEGER, person_id INTEGER,
    FOREIGN KEY (slot_id) REFERENCES slots(id),
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  );

CREATE TABLE catalogs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    filename   TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE contacts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type    TEXT NOT NULL,
    entity_id      INTEGER NOT NULL,
    name           TEXT NOT NULL,
    role           TEXT,
    email          TEXT,
    phone          TEXT,
    mobile         TEXT,
    notes          TEXT,
    source_fair_id INTEGER,
    created_at     TEXT DEFAULT (datetime('now','localtime'))
  , migrated_person_id INTEGER);

CREATE TABLE crm_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    original_name TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE crm_deals (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type          TEXT NOT NULL,
    entity_id            INTEGER NOT NULL,
    name                 TEXT NOT NULL,
    value_cents          INTEGER DEFAULT 0,
    stage                TEXT DEFAULT 'nuovo',
    expected_close_date  TEXT,
    notes                TEXT,
    created_at           TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE crm_emails (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    subject       TEXT,
    direction     TEXT DEFAULT 'out',
    counterparty  TEXT,
    sent_at       TEXT,
    body          TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE crm_meetings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    title         TEXT NOT NULL,
    meeting_date  TEXT,
    participants  TEXT,
    outcome       TEXT,
    status        TEXT DEFAULT 'aperta',
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE crm_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE crm_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    title       TEXT NOT NULL,
    due_date    TEXT,
    assignee    TEXT,
    status      TEXT DEFAULT 'aperto',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    address    TEXT,
    country    TEXT,
    province   TEXT,
    agent_id   INTEGER,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), city TEXT, postal_code TEXT, zone TEXT, mobile TEXT, fax TEXT, pec TEXT, sdi_code TEXT, vat_number TEXT, fiscal_code TEXT, iban TEXT, payment_terms TEXT, price_list_id INTEGER, category TEXT, closing_days TEXT, delivery_notes TEXT, discount_code TEXT, discount_percent REAL DEFAULT 0, business_type TEXT, relationship_type TEXT NOT NULL DEFAULT '[]', supplied_by_importer_id INTEGER, supplied_by_distributor_id INTEGER, exclusive_territory TEXT, export_market TEXT, contact_person TEXT, contact_person_secondary TEXT, newsletter_subscribed INTEGER DEFAULT 0, website TEXT, shipping_address TEXT, shipping_city TEXT, shipping_province TEXT, shipping_postal_code TEXT, shipping_country TEXT, estimated_volume_cents INTEGER, source_fair_id INTEGER,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

CREATE TABLE discount_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    type        TEXT NOT NULL,
    value       INTEGER NOT NULL,
    max_uses    INTEGER,
    used_count  INTEGER NOT NULL DEFAULT 0,
    valid_from  TEXT,
    valid_to    TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE experience_availability (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    day_of_week    INTEGER NOT NULL,
    time           TEXT NOT NULL,
    capacity       INTEGER NOT NULL DEFAULT 10,
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  );

CREATE TABLE experience_images (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    image_url      TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  );

CREATE TABLE experience_products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    product_id     INTEGER NOT NULL,
    UNIQUE(experience_id, product_id),
    FOREIGN KEY (experience_id) REFERENCES experiences(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

CREATE TABLE experiences (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name_it           TEXT NOT NULL,
    name_en           TEXT NOT NULL,
    description_it    TEXT,
    description_en    TEXT,
    price_cents       INTEGER NOT NULL,
    duration_minutes  INTEGER NOT NULL DEFAULT 90,
    max_guests        INTEGER NOT NULL DEFAULT 10,
    image_url         TEXT,
    active            INTEGER NOT NULL DEFAULT 1,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
  , included_it TEXT, included_en TEXT, languages TEXT, facilities TEXT, type TEXT NOT NULL DEFAULT 'visita');

CREATE TABLE fair_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fair_id       INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    original_name TEXT,
    uploaded_at   TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE fairs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    location           TEXT,
    start_date         TEXT,
    end_date           TEXT,
    responsible_name   TEXT,
    status             TEXT DEFAULT 'pianificata',
    report_notes       TEXT,
    created_at         TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE importers (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    name                      TEXT NOT NULL,
    contact_person            TEXT,
    contact_person_secondary  TEXT,
    newsletter_subscribed     INTEGER DEFAULT 0,
    phone                     TEXT,
    mobile                    TEXT,
    email                     TEXT,
    website                   TEXT,
    address                   TEXT,
    city                      TEXT,
    province                  TEXT,
    postal_code               TEXT,
    country                   TEXT,
    shipping_address          TEXT,
    shipping_city             TEXT,
    shipping_province         TEXT,
    shipping_postal_code      TEXT,
    shipping_country          TEXT,
    discount_code             TEXT,
    discount_percent          REAL DEFAULT 0,
    payment_terms             TEXT,
    sdi_code                  TEXT,
    vat_number                TEXT,
    estimated_volume_cents    INTEGER,
    agent_id                  INTEGER,
    notes                     TEXT,
    created_at                TEXT DEFAULT (datetime('now','localtime')), territory TEXT, exclusivity_type TEXT, incoterms TEXT, iban TEXT, pec TEXT, fiscal_code TEXT,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

CREATE TABLE news (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE newsletter (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE operators (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  , portal_user_id INTEGER);

CREATE TABLE order_items (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id           INTEGER NOT NULL,
    product_id         INTEGER,
    product_name_raw   TEXT,
    label_variant      TEXT,
    quantity           INTEGER NOT NULL DEFAULT 1,
    unit_price_cents   INTEGER DEFAULT 0,
    production_status  TEXT DEFAULT 'da_produrre',
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

CREATE TABLE orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number      TEXT,
    customer_name     TEXT,
    customer_country  TEXT,
    channel           TEXT,
    price_list_name   TEXT,
    order_date        TEXT,
    status            TEXT DEFAULT 'nuovo',
    total_cents       INTEGER DEFAULT 0,
    source            TEXT DEFAULT 'excel_import',
    imported_at       TEXT DEFAULT (datetime('now','localtime'))
  , customer_id INTEGER, agent_id INTEGER, billing_customer_id INTEGER, causale TEXT DEFAULT 'ORDCLI', delivery_date TEXT, discount_percent REAL DEFAULT 0, discount_cents INTEGER DEFAULT 0, payment_status TEXT DEFAULT 'non_pagato', payment_due_date TEXT, paid_at TEXT, warehouse_note TEXT, notes TEXT);

CREATE TABLE people (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    email             TEXT,
    phone             TEXT,
    notes             TEXT,
    roles             TEXT NOT NULL DEFAULT '[]',
    contact_role      TEXT,
    source_channels   TEXT NOT NULL DEFAULT '[]',
    newsletter_opt_in INTEGER NOT NULL DEFAULT 0,
    wine_club         INTEGER NOT NULL DEFAULT 0,
    customer_id       INTEGER,
    importer_id       INTEGER,
    agent_id          INTEGER,
    created_at        TEXT DEFAULT (datetime('now','localtime')), first_name TEXT, last_name TEXT, birth_date TEXT, preferred_language TEXT, profiling_consent INTEGER NOT NULL DEFAULT 0, wine_club_since TEXT, wine_club_auto INTEGER NOT NULL DEFAULT 0, wine_club_excluded INTEGER NOT NULL DEFAULT 0, mobile TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (importer_id) REFERENCES importers(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

CREATE TABLE person_links (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id      INTEGER NOT NULL,
    entity_type    TEXT NOT NULL,
    entity_id      INTEGER NOT NULL,
    contact_role   TEXT,
    source_fair_id INTEGER,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(person_id, entity_type, entity_id)
  );

CREATE TABLE pickup_order_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id          INTEGER NOT NULL,
    product_id        INTEGER,
    product_name      TEXT NOT NULL,
    quantity          INTEGER NOT NULL,
    unit_price_cents  INTEGER NOT NULL,
    line_total_cents  INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES pickup_orders(id)
  );

CREATE TABLE pickup_orders (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name         TEXT NOT NULL,
    customer_email        TEXT NOT NULL,
    customer_phone        TEXT,
    b2c_customer_id       INTEGER,
    language              TEXT DEFAULT 'it',
    status                TEXT NOT NULL DEFAULT 'in_attesa_pagamento',
    amount_cents          INTEGER NOT NULL DEFAULT 0,
    pickup_token          TEXT UNIQUE,
    stripe_session_id     TEXT,
    payment_intent_id     TEXT,
    stripe_payment_status TEXT,
    notes                 TEXT,
    picked_up_at          TEXT,
    created_at            TEXT DEFAULT (datetime('now','localtime')), person_id INTEGER,
    FOREIGN KEY (b2c_customer_id) REFERENCES b2c_customers(id)
  );

CREATE TABLE portal_users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    email          TEXT UNIQUE NOT NULL,
    username       TEXT UNIQUE NOT NULL,
    password_hash  TEXT NOT NULL,
    access_key     TEXT UNIQUE NOT NULL,
    reset_token    TEXT,
    reset_expires  TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT DEFAULT (datetime('now','localtime'))
  , role_id INTEGER REFERENCES roles(id));

CREATE TABLE price_list_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    price_list_id INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    price_cents   INTEGER NOT NULL,
    UNIQUE(price_list_id, product_id),
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

CREATE TABLE price_lists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'EUR',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sku         TEXT UNIQUE,
    name        TEXT NOT NULL,
    vintage     TEXT,
    varietal    TEXT,
    description TEXT,
    image_url   TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  , wine_type TEXT, stock_quantity INTEGER);

CREATE TABLE reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER,
    customer_name  TEXT NOT NULL,
    rating         INTEGER NOT NULL,
    comment        TEXT,
    approved       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    workspaces  TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE sales_target_areas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    countries  TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE sales_target_products (
    year           INTEGER NOT NULL,
    area_id        INTEGER NOT NULL,
    product_id     INTEGER NOT NULL,
    target_bottles INTEGER NOT NULL DEFAULT 0,
    target_eur     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (year, area_id, product_id),
    FOREIGN KEY (area_id) REFERENCES sales_target_areas(id)
  );

CREATE TABLE sales_target_year_areas (
    year           INTEGER NOT NULL,
    area_id        INTEGER NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    sum_mode       INTEGER NOT NULL DEFAULT 1,
    target_bottles INTEGER NOT NULL DEFAULT 0,
    target_eur     INTEGER NOT NULL DEFAULT 0,
    month_mode     TEXT NOT NULL DEFAULT 'stagionale',
    manual_pct     TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (year, area_id),
    FOREIGN KEY (area_id) REFERENCES sales_target_areas(id)
  );

CREATE TABLE sales_target_years (
    year           INTEGER PRIMARY KEY,
    target_bottles INTEGER NOT NULL DEFAULT 0,
    target_eur     INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE TABLE sales_targets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    year           INTEGER NOT NULL,
    area_id        INTEGER NOT NULL,
    product_id     INTEGER NOT NULL DEFAULT 0,
    month          INTEGER NOT NULL,
    target_bottles INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(year, area_id, product_id, month),
    FOREIGN KEY (area_id) REFERENCES sales_target_areas(id)
  );

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE shop_sale_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id           INTEGER NOT NULL,
    product_id        INTEGER,
    product_name      TEXT NOT NULL,
    quantity          INTEGER NOT NULL,
    unit_price_cents  INTEGER NOT NULL,
    line_total_cents  INTEGER NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES shop_sales(id)
  );

CREATE TABLE shop_sales (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name    TEXT,
    customer_email   TEXT,
    customer_phone   TEXT,
    b2c_customer_id  INTEGER,
    sale_context     TEXT NOT NULL DEFAULT 'negozio',
    payment_method   TEXT NOT NULL DEFAULT 'contanti',
    discount_cents   INTEGER NOT NULL DEFAULT 0,
    total_cents      INTEGER NOT NULL DEFAULT 0,
    operator_id      INTEGER,
    notes            TEXT,
    created_at       TEXT DEFAULT (datetime('now','localtime')), person_id INTEGER,
    FOREIGN KEY (b2c_customer_id) REFERENCES b2c_customers(id)
  );

CREATE TABLE slots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    date           TEXT NOT NULL,
    time           TEXT NOT NULL,
    capacity       INTEGER NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  );

CREATE TABLE suppliers (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    name                      TEXT NOT NULL,
    contact_person            TEXT,
    contact_person_secondary  TEXT,
    newsletter_subscribed     INTEGER DEFAULT 0,
    phone                     TEXT,
    mobile                    TEXT,
    email                     TEXT,
    website                   TEXT,
    address                   TEXT,
    city                      TEXT,
    province                  TEXT,
    postal_code               TEXT,
    country                   TEXT,
    shipping_address          TEXT,
    shipping_city             TEXT,
    shipping_province         TEXT,
    shipping_postal_code      TEXT,
    shipping_country          TEXT,
    category                  TEXT,
    discount_code             TEXT,
    discount_percent          REAL DEFAULT 0,
    payment_terms             TEXT,
    sdi_code                  TEXT,
    vat_number                TEXT,
    estimated_volume_cents    INTEGER,
    notes                     TEXT,
    created_at                TEXT DEFAULT (datetime('now','localtime'))
  , iban TEXT, pec TEXT, fiscal_code TEXT);

CREATE TABLE venue_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT NOT NULL,
    organizer_name    TEXT NOT NULL,
    organizer_email   TEXT,
    organizer_phone   TEXT,
    event_date        TEXT NOT NULL,
    start_time        TEXT,
    end_time          TEXT,
    guests_estimate   INTEGER,
    rental_fee_cents  INTEGER NOT NULL DEFAULT 0,
    deposit_cents     INTEGER NOT NULL DEFAULT 0,
    deposit_paid      INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'richiesta',
    notes             TEXT,
    crm_customer_id   INTEGER,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
  , person_id INTEGER);

CREATE TABLE warehouse_finished (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER UNIQUE NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 0,
    threshold       INTEGER NOT NULL DEFAULT 0,
    alert_email     TEXT,
    below_threshold INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

CREATE TABLE warehouse_raw (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sku             TEXT,
    name            TEXT NOT NULL,
    unit            TEXT DEFAULT 'pz',
    quantity        INTEGER NOT NULL DEFAULT 0,
    threshold       INTEGER NOT NULL DEFAULT 0,
    alert_email     TEXT,
    below_threshold INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
  );

CREATE INDEX idx_agent_provinces_agent ON agent_provinces(agent_id);

CREATE INDEX idx_b2c_orders_customer ON b2c_orders(customer_id);

CREATE INDEX idx_bookings_b2c_customer ON bookings(b2c_customer_id);

CREATE INDEX idx_bookings_experience ON bookings(experience_id);

CREATE INDEX idx_bookings_operator ON bookings(operator_id);

CREATE INDEX idx_bookings_person ON bookings(person_id);

CREATE INDEX idx_bookings_slot ON bookings(slot_id);

CREATE INDEX idx_contacts_entity ON contacts(entity_type, entity_id);

CREATE INDEX idx_contacts_source_fair ON contacts(source_fair_id);

CREATE INDEX idx_crm_attachments_entity ON crm_attachments(entity_type, entity_id);

CREATE INDEX idx_crm_deals_entity ON crm_deals(entity_type, entity_id);

CREATE INDEX idx_crm_emails_entity ON crm_emails(entity_type, entity_id);

CREATE INDEX idx_crm_meetings_entity ON crm_meetings(entity_type, entity_id);

CREATE INDEX idx_crm_notes_entity ON crm_notes(entity_type, entity_id);

CREATE INDEX idx_crm_tasks_entity ON crm_tasks(entity_type, entity_id);

CREATE INDEX idx_customers_agent ON customers(agent_id);

CREATE INDEX idx_customers_source_fair ON customers(source_fair_id);

CREATE INDEX idx_customers_supplied_by_distributor ON customers(supplied_by_distributor_id);

CREATE INDEX idx_customers_supplied_by_importer ON customers(supplied_by_importer_id);

CREATE INDEX idx_experience_availability_experience ON experience_availability(experience_id);

CREATE INDEX idx_experience_images_experience ON experience_images(experience_id);

CREATE INDEX idx_experience_products_experience ON experience_products(experience_id);

CREATE INDEX idx_fair_attachments_fair ON fair_attachments(fair_id);

CREATE INDEX idx_importers_agent ON importers(agent_id);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE INDEX idx_order_items_product ON order_items(product_id);

CREATE INDEX idx_orders_agent ON orders(agent_id);

CREATE INDEX idx_orders_billing_customer ON orders(billing_customer_id);

CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE INDEX idx_people_agent ON people(agent_id);

CREATE INDEX idx_people_customer ON people(customer_id);

CREATE INDEX idx_people_importer ON people(importer_id);

CREATE INDEX idx_person_links_entity ON person_links(entity_type, entity_id);

CREATE INDEX idx_person_links_fair ON person_links(source_fair_id);

CREATE INDEX idx_person_links_person ON person_links(person_id);

CREATE INDEX idx_pickup_order_items_order ON pickup_order_items(order_id);

CREATE INDEX idx_pickup_order_items_product ON pickup_order_items(product_id);

CREATE INDEX idx_pickup_orders_b2c_customer ON pickup_orders(b2c_customer_id);

CREATE INDEX idx_pickup_orders_person ON pickup_orders(person_id);

CREATE INDEX idx_portal_users_role ON portal_users(role_id);

CREATE INDEX idx_price_list_items_price_list ON price_list_items(price_list_id);

CREATE INDEX idx_price_list_items_product ON price_list_items(product_id);

CREATE INDEX idx_reviews_experience ON reviews(experience_id);

CREATE INDEX idx_sales_targets_area ON sales_targets(area_id);

CREATE INDEX idx_shop_sale_items_product ON shop_sale_items(product_id);

CREATE INDEX idx_shop_sale_items_sale ON shop_sale_items(sale_id);

CREATE INDEX idx_shop_sales_b2c_customer ON shop_sales(b2c_customer_id);

CREATE INDEX idx_shop_sales_person ON shop_sales(person_id);

CREATE INDEX idx_slots_experience ON slots(experience_id);

CREATE INDEX idx_venue_events_date ON venue_events(event_date);

CREATE INDEX idx_venue_events_person ON venue_events(person_id);

CREATE INDEX idx_warehouse_finished_product ON warehouse_finished(product_id);
