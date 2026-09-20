const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const XLSX    = require('xlsx');

const { DatabaseSync } = require('node:sqlite');

const app   = express();
const PORT  = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cantina2026';
const CANTINA_NAME    = process.env.CANTINA_NAME || 'Marramiero';
const STRIPE_SECRET   = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET  = process.env.STRIPE_WEBHOOK_SECRET;
const DB_PATH = process.env.DB_PATH || path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname, 'cantina.db');

const stripe = STRIPE_SECRET ? require('stripe')(STRIPE_SECRET) : null;

// ── Email ─────────────────────────────────────────────────────────────────────
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const gmailTransporter = (process.env.GMAIL_USER && process.env.GMAIL_PASS)
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS } })
  : null;

const EMAIL_FROM      = process.env.RESEND_FROM || `${CANTINA_NAME} <${process.env.GMAIL_USER || 'noreply@example.com'}>`;
const EMAIL_FROM_NAME = CANTINA_NAME;

function fmtPrice(cents) {
  return (cents / 100).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(dateStr, lang) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function sendMail({ to, subject, html }) {
  if (!gmailTransporter && !resend) {
    console.log('EMAIL: nessun provider configurato — invio saltato.');
    return;
  }
  if (gmailTransporter) {
    const info = await gmailTransporter.sendMail({ from: `"${EMAIL_FROM_NAME}" <${process.env.GMAIL_USER}>`, to, subject, html });
    console.log(`EMAIL: inviata via Gmail — ${info.messageId}`);
  } else {
    const result = await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
    console.log(`EMAIL: inviata via Resend — ${result?.data?.id || result?.id || 'n/a'}`);
  }
}

function bookingSummaryHtml(booking, lang) {
  const t = lang === 'en'
    ? { title: 'Booking', ref: 'Reference', exp: 'Experience', date: 'Date', time: 'Time', guests: 'Guests', total: 'Total' }
    : { title: 'Prenotazione', ref: 'Riferimento', exp: 'Esperienza', date: 'Data', time: 'Ora', guests: 'Ospiti', total: 'Totale' };
  const ref = '#' + String(booking.id).padStart(4, '0');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f4ede2;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4ede2;padding:40px 0;">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="background:#241014;max-width:580px;width:100%;">
    <tr><td style="padding:44px 44px 28px;border-bottom:1px solid rgba(138,69,80,0.3);">
      <p style="margin:0;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#8a4550;">${CANTINA_NAME}</p>
      <h1 style="margin:12px 0 0;font-size:30px;font-weight:400;color:#f4ede2;">${t.title}</h1>
    </td></tr>
    <tr><td style="padding:32px 44px 24px;">
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:400;color:#f4ede2;">${booking.customer_name},</h2>
      <p style="margin:0;font-size:15px;line-height:1.7;color:rgba(244,237,226,0.75);">
        ${booking.status === 'confermata'
          ? (lang === 'en' ? 'Your booking is confirmed. We look forward to welcoming you.' : 'La tua prenotazione è confermata. Ti aspettiamo in cantina.')
          : (lang === 'en' ? 'We received your request and will confirm it shortly.' : 'Abbiamo ricevuto la tua richiesta e la confermeremo a breve.')}
      </p>
    </td></tr>
    <tr><td style="padding:0 44px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(138,69,80,0.08);border:1px solid rgba(138,69,80,0.2);">
        <tr><td style="padding:24px 24px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.ref}</td>
                <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:18px;color:#8a4550;text-align:right;font-style:italic;">${ref}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.exp}</td>
                <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:14px;color:#f4ede2;text-align:right;">${booking.experience_name}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.date}</td>
                <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:14px;color:#f4ede2;text-align:right;">${fmtDate(booking.date, lang)}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.time}</td>
                <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:14px;color:#f4ede2;text-align:right;">${booking.time}</td></tr>
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.guests}</td>
                <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:14px;color:#f4ede2;text-align:right;">${booking.guests}</td></tr>
            <tr><td style="padding:14px 0 0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.total}</td>
                <td style="padding:14px 0 0;font-size:22px;color:#8a4550;text-align:right;">€ ${fmtPrice(booking.amount_cents)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px;"></td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 44px;border-top:1px solid rgba(138,69,80,0.2);">
      <p style="margin:0;font-size:12px;color:rgba(244,237,226,0.3);line-height:1.7;">${CANTINA_NAME}</p>
    </td></tr>
  </table>
  </td></tr></table></body></html>`;
}

async function sendBookingEmail(booking) {
  const lang = booking.language === 'en' ? 'en' : 'it';
  const subject = booking.status === 'confermata'
    ? (lang === 'en' ? `Booking confirmed — ${CANTINA_NAME}` : `Prenotazione confermata — ${CANTINA_NAME}`)
    : (lang === 'en' ? `Request received — ${CANTINA_NAME}` : `Richiesta ricevuta — ${CANTINA_NAME}`);
  await sendMail({ to: booking.email, subject, html: bookingSummaryHtml(booking, lang) });
}

function pickupOrderSummaryHtml(order, lang) {
  const t = lang === 'en'
    ? { title: 'Order confirmed', ref: 'Reference', total: 'Total', intro: 'Your order is paid and ready — pick it up at the winery whenever suits you.' }
    : { title: 'Ordine confermato', ref: 'Riferimento', total: 'Totale', intro: 'Il tuo ordine è pagato e pronto — puoi ritirarlo in cantina quando preferisci.' };
  const ref = '#' + String(order.id).padStart(4, '0');
  const rows = order.items.map(it => `
    <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:14px;color:#f4ede2;">${it.quantity}× ${it.product_name}</td>
        <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:14px;color:#f4ede2;text-align:right;">€ ${fmtPrice(it.line_total_cents)}</td></tr>
  `).join('');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f4ede2;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4ede2;padding:40px 0;">
  <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="background:#241014;max-width:580px;width:100%;">
    <tr><td style="padding:44px 44px 28px;border-bottom:1px solid rgba(138,69,80,0.3);">
      <p style="margin:0;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#8a4550;">${CANTINA_NAME}</p>
      <h1 style="margin:12px 0 0;font-size:30px;font-weight:400;color:#f4ede2;">${t.title}</h1>
    </td></tr>
    <tr><td style="padding:32px 44px 24px;">
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:400;color:#f4ede2;">${order.customer_name},</h2>
      <p style="margin:0;font-size:15px;line-height:1.7;color:rgba(244,237,226,0.75);">${t.intro}</p>
    </td></tr>
    <tr><td style="padding:0 44px 36px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(138,69,80,0.08);border:1px solid rgba(138,69,80,0.2);">
        <tr><td style="padding:24px 24px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.ref}</td>
                <td style="padding:8px 0;border-bottom:1px solid rgba(244,237,226,0.08);font-size:18px;color:#8a4550;text-align:right;font-style:italic;">${ref}</td></tr>
            ${rows}
            <tr><td style="padding:14px 0 0;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(244,237,226,0.5);">${t.total}</td>
                <td style="padding:14px 0 0;font-size:22px;color:#8a4550;text-align:right;">€ ${fmtPrice(order.amount_cents)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px;"></td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 44px;border-top:1px solid rgba(138,69,80,0.2);">
      <p style="margin:0;font-size:12px;color:rgba(244,237,226,0.3);line-height:1.7;">${CANTINA_NAME}</p>
    </td></tr>
  </table>
  </td></tr></table></body></html>`;
}

async function sendPickupOrderEmail(order) {
  const lang = order.language === 'en' ? 'en' : 'it';
  const subject = lang === 'en' ? `Order confirmed — ${CANTINA_NAME}` : `Ordine confermato — ${CANTINA_NAME}`;
  await sendMail({ to: order.customer_email, subject, html: pickupOrderSummaryHtml(order, lang) });
}

// ── Database ──────────────────────────────────────────────────────────────────
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS experiences (
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
  )
`);
try { db.exec('ALTER TABLE experiences ADD COLUMN included_it TEXT'); } catch {}
try { db.exec('ALTER TABLE experiences ADD COLUMN included_en TEXT'); } catch {}
try { db.exec('ALTER TABLE experiences ADD COLUMN languages TEXT'); } catch {}
try { db.exec('ALTER TABLE experiences ADD COLUMN facilities TEXT'); } catch {}
// 'visita' | 'evento' — stesso motore anagrafica/disponibilità/prenotazioni/operatori,
// solo la vetrina pubblica e le liste in admin li separano (modulo Eventi proprietari).
try { db.exec("ALTER TABLE experiences ADD COLUMN type TEXT NOT NULL DEFAULT 'visita'"); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS experience_images (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    image_url      TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS experience_products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    product_id     INTEGER NOT NULL,
    UNIQUE(experience_id, product_id),
    FOREIGN KEY (experience_id) REFERENCES experiences(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS experience_availability (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    day_of_week    INTEGER NOT NULL,
    time           TEXT NOT NULL,
    capacity       INTEGER NOT NULL DEFAULT 10,
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS slots (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER NOT NULL,
    date           TEXT NOT NULL,
    time           TEXT NOT NULL,
    capacity       INTEGER NOT NULL,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
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
    created_at            TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (slot_id) REFERENCES slots(id),
    FOREIGN KEY (experience_id) REFERENCES experiences(id)
  )
`);
try { db.exec('ALTER TABLE bookings ADD COLUMN operator_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE bookings ADD COLUMN b2c_customer_id INTEGER'); } catch {}

// ── Enoturismo: operatori addetti alle visite ─────────────────────────────────
// Gli operatori selezionabili sono sempre uno specchio degli utenti con accesso al
// software (portal_users): niente anagrafica separata, si sincronizza automaticamente
// (vedi syncOperatorForPortalUser). Le righe restano per non rompere gli operator_id
// già assegnati a prenotazioni passate anche se l'utente viene poi rimosso.
db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
try { db.exec('ALTER TABLE operators ADD COLUMN portal_user_id INTEGER'); } catch {}

// ── Enoturismo: eventi terzi (affitto struttura) ──────────────────────────────
// Lato operativo soltanto: l'organizzatore è un testo libero, non un'anagrafica
// CRM collegata. crm_customer_id è un aggancio riservato per la futura
// unificazione dell'identità CRM (persone/ruoli), oggi non usato.
db.exec(`
  CREATE TABLE IF NOT EXISTS venue_events (
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
  )
`);

// ── Enoturismo: CRM B2C (visitatori, clienti negozio/e-commerce) ──────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS b2c_customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT UNIQUE,
    phone      TEXT,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS b2c_orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id   INTEGER NOT NULL,
    channel       TEXT NOT NULL,
    order_number  TEXT,
    amount_cents  INTEGER NOT NULL DEFAULT 0,
    order_date    TEXT NOT NULL,
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (customer_id) REFERENCES b2c_customers(id)
  )
`);

// ── Enoturismo: negozio fisico (cassa) ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_sales (
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
    created_at       TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (b2c_customer_id) REFERENCES b2c_customers(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS shop_sale_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id           INTEGER NOT NULL,
    product_id        INTEGER,
    product_name      TEXT NOT NULL,
    quantity          INTEGER NOT NULL,
    unit_price_cents  INTEGER NOT NULL,
    line_total_cents  INTEGER NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES shop_sales(id)
  )
`);

// ── Enoturismo: negozio fisico — prenotazione e pagamento anticipato (ritiro in cantina) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS pickup_orders (
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
    created_at            TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (b2c_customer_id) REFERENCES b2c_customers(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS pickup_order_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id          INTEGER NOT NULL,
    product_id        INTEGER,
    product_name      TEXT NOT NULL,
    quantity          INTEGER NOT NULL,
    unit_price_cents  INTEGER NOT NULL,
    line_total_cents  INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES pickup_orders(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS discount_codes (
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
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    experience_id  INTEGER,
    customer_name  TEXT NOT NULL,
    rating         INTEGER NOT NULL,
    comment        TEXT,
    approved       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now','localtime'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS newsletter (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);

// ── ERP: products (bottiglie) ─────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sku         TEXT UNIQUE,
    name        TEXT NOT NULL,
    vintage     TEXT,
    varietal    TEXT,
    description TEXT,
    image_url   TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  )
`);
try { db.exec('ALTER TABLE products ADD COLUMN wine_type TEXT'); } catch {}
// stock_quantity: giacenza per la vendita diretta (cassa negozio fisico). NULL = scorte non tracciate per questa bottiglia.
try { db.exec('ALTER TABLE products ADD COLUMN stock_quantity INTEGER'); } catch {}

// ── ERP: listini ──────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS price_lists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    currency   TEXT NOT NULL DEFAULT 'EUR',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS price_list_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    price_list_id INTEGER NOT NULL,
    product_id    INTEGER NOT NULL,
    price_cents   INTEGER NOT NULL,
    UNIQUE(price_list_id, product_id),
    FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);

// ── ERP: ordini commerciali (import da Excel/gestionale) ──────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
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
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
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
  )
`);
try { db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN agent_id INTEGER'); } catch {}

// ── CRM: agenti, aree di competenza, clienti ──────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    token      TEXT UNIQUE NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_provinces (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id  INTEGER NOT NULL,
    province  TEXT NOT NULL,
    UNIQUE(agent_id, province),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT,
    phone      TEXT,
    address    TEXT,
    country    TEXT,
    province   TEXT,
    agent_id   INTEGER,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);
// Anagrafica cliente estesa (allineata al gestionale B2B reale)
try { db.exec('ALTER TABLE customers ADD COLUMN city TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN postal_code TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN zone TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN mobile TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN fax TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN pec TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN sdi_code TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN vat_number TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN fiscal_code TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN iban TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN payment_terms TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN price_list_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN category TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN closing_days TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN delivery_notes TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN code TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN username TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN password_hash TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN gender TEXT'); } catch {}
// ── CRM: anagrafica estesa agenti (allineata a clienti/importatori/fornitori) ──
try { db.exec('ALTER TABLE agents ADD COLUMN mobile TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN address TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN city TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN business_province TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN postal_code TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN country TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN vat_number TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN sdi_code TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN pec TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN iban TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN fiscal_code TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN payment_terms TEXT'); } catch {}
try { db.exec('ALTER TABLE agents ADD COLUMN commission_percent REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN billing_customer_id INTEGER'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN causale TEXT DEFAULT \'ORDCLI\''); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN delivery_date TEXT'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN discount_percent REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN discount_cents INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN discount_code TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN discount_percent REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT \'non_pagato\''); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN payment_due_date TEXT'); } catch {}
try { db.exec('ALTER TABLE orders ADD COLUMN paid_at TEXT'); } catch {}

// ── CRM: anagrafica estesa (Informazioni di contatto / indirizzo / business) ──
try { db.exec('ALTER TABLE customers ADD COLUMN contact_person TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN contact_person_secondary TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN newsletter_subscribed INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN website TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN shipping_address TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN shipping_city TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN shipping_province TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN shipping_postal_code TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN shipping_country TEXT'); } catch {}
try { db.exec('ALTER TABLE customers ADD COLUMN estimated_volume_cents INTEGER'); } catch {}

// ── CRM: Importatori ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS importers (
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
    created_at                TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )
`);

// ── CRM: Fornitori ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS suppliers (
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
  )
`);
try { db.exec('ALTER TABLE importers ADD COLUMN iban TEXT'); } catch {}
try { db.exec('ALTER TABLE importers ADD COLUMN pec TEXT'); } catch {}
try { db.exec('ALTER TABLE importers ADD COLUMN fiscal_code TEXT'); } catch {}
try { db.exec('ALTER TABLE suppliers ADD COLUMN iban TEXT'); } catch {}
try { db.exec('ALTER TABLE suppliers ADD COLUMN pec TEXT'); } catch {}
try { db.exec('ALTER TABLE suppliers ADD COLUMN fiscal_code TEXT'); } catch {}

// ── CRM: attività polimorfiche (note/allegati/riunioni/compiti/affari/email) ──
// entity_type ∈ {'customer','agent','importer','supplier'}, entity_id = id del record
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    original_name TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_meetings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    title         TEXT NOT NULL,
    meeting_date  TEXT,
    participants  TEXT,
    outcome       TEXT,
    status        TEXT DEFAULT 'aperta',
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER NOT NULL,
    title       TEXT NOT NULL,
    due_date    TEXT,
    assignee    TEXT,
    status      TEXT DEFAULT 'aperto',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_deals (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type          TEXT NOT NULL,
    entity_id            INTEGER NOT NULL,
    name                 TEXT NOT NULL,
    value_cents          INTEGER DEFAULT 0,
    stage                TEXT DEFAULT 'nuovo',
    expected_close_date  TEXT,
    notes                TEXT,
    created_at           TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS crm_emails (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    subject       TEXT,
    direction     TEXT DEFAULT 'out',
    counterparty  TEXT,
    sent_at       TEXT,
    body          TEXT,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// ── CRM: contatti (persone collegate a clienti/agenti/importatori/fornitori) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
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
  )
`);

// ── Commerciale: fiere ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS fairs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    location           TEXT,
    start_date         TEXT,
    end_date           TEXT,
    responsible_name   TEXT,
    status             TEXT DEFAULT 'pianificata',
    report_notes       TEXT,
    created_at         TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS fair_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fair_id       INTEGER NOT NULL,
    filename      TEXT NOT NULL,
    original_name TEXT,
    uploaded_at   TEXT DEFAULT (datetime('now','localtime'))
  )
`);
try { db.exec('ALTER TABLE customers ADD COLUMN source_fair_id INTEGER'); } catch {}

// ── Portale agenti: news e cataloghi condivisi ────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS catalogs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    filename   TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// ── Utenti del portale interno (admin.html / portal.html) ────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS portal_users (
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
  )
`);
try { db.exec('ALTER TABLE orders ADD COLUMN warehouse_note TEXT'); } catch {}

// ── Ruoli e permessi (matrice di accesso per workspace) ──────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    workspaces  TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
  )
`);
try { db.exec('ALTER TABLE portal_users ADD COLUMN role_id INTEGER REFERENCES roles(id)'); } catch {}
const ALL_WORKSPACES = ['enoturismo', 'commerciale', 'produzione', 'magazzino', 'crm', 'impostazioni'];

// Mantiene "operators" (selezionabile nelle visite enoturismo) sincronizzato con gli
// utenti del portale: ogni "utente che ha accesso al software" è automaticamente un
// operatore selezionabile, senza doverlo ricreare a mano in una lista separata.
function syncOperatorForPortalUser(pu) {
  const existing = db.prepare('SELECT id FROM operators WHERE portal_user_id = ?').get(pu.id);
  if (existing) {
    db.prepare('UPDATE operators SET name = ?, email = ?, active = ? WHERE id = ?').run(pu.name, pu.email, pu.active ? 1 : 0, existing.id);
  } else {
    db.prepare('INSERT INTO operators (name, email, portal_user_id, active) VALUES (?, ?, ?, ?)').run(pu.name, pu.email, pu.id, pu.active ? 1 : 0);
  }
}
function deactivateOperatorForPortalUser(portalUserId) {
  db.prepare('UPDATE operators SET active = 0 WHERE portal_user_id = ?').run(portalUserId);
}
db.prepare('SELECT * FROM portal_users').all().forEach(syncOperatorForPortalUser);

// ── ERP: magazzino prodotti finiti / materie prime ────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS warehouse_finished (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER UNIQUE NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 0,
    threshold       INTEGER NOT NULL DEFAULT 0,
    alert_email     TEXT,
    below_threshold INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS warehouse_raw (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sku             TEXT,
    name            TEXT NOT NULL,
    unit            TEXT DEFAULT 'pz',
    quantity        INTEGER NOT NULL DEFAULT 0,
    threshold       INTEGER NOT NULL DEFAULT 0,
    alert_email     TEXT,
    below_threshold INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
  )
`);

// ── Commerciale: obiettivi annui per area (configurabile da Impostazioni → Regole) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS sales_target_areas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    countries  TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`);
// Un obiettivo per (anno, area, prodotto, mese). product_id = 0 significa "totale" (tutte le bottiglie),
// non un vero prodotto — evita gli NULL, che SQLite non considera uguali in un vincolo UNIQUE.
db.exec(`
  CREATE TABLE IF NOT EXISTS sales_targets (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    year           INTEGER NOT NULL,
    area_id        INTEGER NOT NULL,
    product_id     INTEGER NOT NULL DEFAULT 0,
    month          INTEGER NOT NULL,
    target_bottles INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(year, area_id, product_id, month),
    FOREIGN KEY (area_id) REFERENCES sales_target_areas(id)
  )
`);
if (db.prepare('SELECT COUNT(*) AS c FROM sales_target_areas').get().c === 0) {
  const insertArea = db.prepare('INSERT INTO sales_target_areas (name, countries, sort_order) VALUES (?, ?, ?)');
  insertArea.run('Italia', JSON.stringify(['Italia']), 1);
  insertArea.run('CE', JSON.stringify(['Germania', 'Francia', 'Spagna', 'Belgio', 'Olanda', 'Austria']), 2);
  insertArea.run('Extra CE', JSON.stringify(['Stati Uniti', 'Regno Unito', 'Svizzera', 'Giappone', 'Canada']), 3);
}

// Seed a couple of demo experiences on first run
const expCount = db.prepare('SELECT COUNT(*) AS c FROM experiences').get().c;
if (expCount === 0) {
  const insertExp = db.prepare(`INSERT INTO experiences
    (name_it, name_en, description_it, description_en, price_cents, duration_minutes, max_guests, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertExp.run(
    'Impresso nel Vino', 'Impressed in Wine',
    'Vivi un\'emozione che rimarrà "Impressa nel Vino": tra vitigni Abruzzesi e internazionali scoprirai una storia fatta di modernità e tradizione.',
    'Live an emotion that will stay "Impressed in Wine": among Abruzzo and international varietals, discover a story of modernity and tradition.',
    3500, 90, 14, 1
  );
  insertExp.run(
    'Le Passioni del Fondatore', 'The Founder\'s Passions',
    'Anima e Incanto: scopri Rosciano nelle sue denominazioni più caratteristiche come Montepulciano d\'Abruzzo DOC e Trebbiano d\'Abruzzo DOC.',
    'Soul and Charm: discover Rosciano through its most characteristic denominations, Montepulciano d\'Abruzzo DOC and Trebbiano d\'Abruzzo DOC.',
    4500, 90, 14, 2
  );
  insertExp.run(
    'I Tesori del Fondatore', 'The Founder\'s Treasures',
    'Vieni a degustare Inferi, Altare e Colle delle Pietre: i vini che onorano l\'eredità di Dante Marramiero e la tradizione abruzzese del vino.',
    'Come taste Inferi, Altare and Colle delle Pietre: the wines that honor Dante Marramiero\'s legacy and Abruzzo\'s winemaking tradition.',
    6500, 90, 10, 3
  );
  insertExp.run(
    'L\'Eredità di Dante Marramiero', 'The Legacy of Dante Marramiero',
    'Un viaggio nella storia e nella visione di Dante Marramiero, dove tradizione e innovazione si incontrano tra le colline di Rosciano.',
    'A journey through the history and vision of Dante Marramiero, where tradition and innovation meet among the hills of Rosciano.',
    10000, 90, 8, 4
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getExperience(id) {
  return db.prepare('SELECT * FROM experiences WHERE id = ?').get(id);
}
function getSlot(id) {
  return db.prepare('SELECT * FROM slots WHERE id = ?').get(id);
}
function slotAvailability(slotId) {
  const slot = getSlot(slotId);
  if (!slot) return null;
  const used = db.prepare(
    "SELECT COALESCE(SUM(guests),0) AS n FROM bookings WHERE slot_id = ? AND status IN ('in_attesa','confermata')"
  ).get(slotId).n;
  return { slot, used, available: slot.capacity - used };
}
function bookingWithDetails(id) {
  return db.prepare(`
    SELECT b.*, s.date, s.time,
           CASE WHEN b.language = 'en' THEN e.name_en ELSE e.name_it END AS experience_name
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    JOIN experiences e ON e.id = b.experience_id
    WHERE b.id = ?
  `).get(id);
}
function findOrCreateB2CCustomer(name, email, phone) {
  const emailClean = email?.toLowerCase().trim() || null;
  if (!emailClean) return null;
  const existing = db.prepare('SELECT * FROM b2c_customers WHERE email = ?').get(emailClean);
  if (existing) {
    if (phone && !existing.phone) db.prepare('UPDATE b2c_customers SET phone = ? WHERE id = ?').run(phone, existing.id);
    return existing.id;
  }
  const result = db.prepare('INSERT INTO b2c_customers (name, email, phone) VALUES (?, ?, ?)').run(name, emailClean, phone || null);
  return result.lastInsertRowid;
}
function validateDiscount(code, amountCents) {
  if (!code) return { valid: false };
  const d = db.prepare('SELECT * FROM discount_codes WHERE code = ? AND active = 1').get(code.trim().toUpperCase());
  if (!d) return { valid: false, error: 'Codice sconto non valido.' };
  const today = new Date().toISOString().slice(0, 10);
  if (d.valid_from && today < d.valid_from) return { valid: false, error: 'Codice sconto non ancora attivo.' };
  if (d.valid_to && today > d.valid_to) return { valid: false, error: 'Codice sconto scaduto.' };
  if (d.max_uses != null && d.used_count >= d.max_uses) return { valid: false, error: 'Codice sconto esaurito.' };
  const discountCents = d.type === 'percent'
    ? Math.round(amountCents * (d.value / 100))
    : Math.min(d.value, amountCents);
  return { valid: true, discount: d, discountCents };
}
function authAdmin(req, res, next) {
  const pwd = req.query.key || req.headers['x-admin-key'];
  if (pwd === ADMIN_PASSWORD) { req.isMasterKey = true; return next(); }
  const user = pwd ? db.prepare('SELECT * FROM portal_users WHERE access_key = ? AND active = 1').get(pwd) : null;
  if (user) { req.portalUser = user; return next(); }
  return res.status(401).json({ error: 'Non autorizzato.' });
}

function permittedWorkspacesFor(req) {
  if (req.isMasterKey || !req.portalUser?.role_id) return null; // null = accesso completo
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.portalUser.role_id);
  if (!role) return null;
  try { return JSON.parse(role.workspaces); } catch { return null; }
}

// ── ERP helpers ───────────────────────────────────────────────────────────────
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ── CRM helpers ───────────────────────────────────────────────────────────────
function generateAgentToken() {
  return crypto.randomBytes(20).toString('hex');
}

function generateAgentUsername(name) {
  const base = (name || 'agente').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'agente';
  let candidate = base;
  let i = 1;
  while (db.prepare('SELECT id FROM agents WHERE username = ?').get(candidate)) {
    candidate = `${base}${++i}`;
  }
  return candidate;
}

function generateAgentPassword() {
  return crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const hashBuf = Buffer.from(hash, 'hex');
  const candidateBuf = crypto.scryptSync(password, salt, 64);
  return hashBuf.length === candidateBuf.length && crypto.timingSafeEqual(hashBuf, candidateBuf);
}

function authAgent(req, res, next) {
  const agent = db.prepare('SELECT * FROM agents WHERE token = ? AND active = 1').get(req.params.token);
  if (!agent) return res.status(404).json({ error: 'Link non valido o agente disattivato.' });
  req.agent = agent;
  next();
}

function agentWithStats(agent) {
  const provinces = db.prepare('SELECT province FROM agent_provinces WHERE agent_id = ? ORDER BY province').all(agent.id).map(r => r.province);
  const orders = db.prepare('SELECT order_date, total_cents FROM orders WHERE agent_id = ? ORDER BY order_date').all(agent.id);
  const orderCount = orders.length;
  const revenueCents = orders.reduce((s, o) => s + (o.total_cents || 0), 0);
  const avgValueCents = orderCount ? Math.round(revenueCents / orderCount) : 0;

  let avgFrequencyDays = null;
  if (orderCount > 1) {
    const dates = orders.map(o => new Date(o.order_date + 'T00:00:00').getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
    if (dates.length > 1) {
      const totalSpanDays = (dates[dates.length - 1] - dates[0]) / 86400000;
      avgFrequencyDays = Math.round((totalSpanDays / (dates.length - 1)) * 10) / 10;
    }
  }

  const customerCount = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE agent_id = ?').get(agent.id).c;

  const { password_hash, ...agentSafe } = agent;
  return { ...agentSafe, provinces, orderCount, revenueCents, avgValueCents, avgFrequencyDays, customerCount, ...crmSalesStats('agent_id', agent.id), ...crmCounts('agent', agent.id) };
}

// Statistiche vendite per l'intestazione della scheda CRM (clienti/agenti) — 'column' è
// sempre una stringa fissa lato codice ('customer_id' | 'agent_id'), mai input utente.
function crmSalesStats(column, id) {
  const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
  const yearStart = new Date().getFullYear() + '-01-01';
  const today = new Date().toISOString().slice(0, 10);

  const revenue12mCents = db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM orders WHERE ${column} = ? AND order_date >= ?`).get(id, oneYearAgoStr).cents;

  const bottlesYear = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.${column} = ? AND o.order_date >= ?
  `).get(id, yearStart).q;

  const topProduct = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name_raw) AS name, SUM(oi.quantity) AS q
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.${column} = ? GROUP BY COALESCE(p.name, oi.product_name_raw) ORDER BY q DESC LIMIT 1
  `).get(id);

  const unpaidTotalCents = db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM orders WHERE ${column} = ? AND payment_status != 'pagato'`).get(id).cents;

  const nextUnpaid = db.prepare(`
    SELECT order_number, total_cents, payment_due_date FROM orders
    WHERE ${column} = ? AND payment_status != 'pagato'
    ORDER BY (payment_due_date IS NULL), payment_due_date ASC LIMIT 1
  `).get(id);

  return {
    revenue_12m_cents: revenue12mCents,
    bottles_year: bottlesYear,
    top_product_name: topProduct ? topProduct.name : null,
    unpaid_total_cents: unpaidTotalCents,
    next_unpaid: nextUnpaid ? { ...nextUnpaid, overdue: !!(nextUnpaid.payment_due_date && nextUnpaid.payment_due_date < today) } : null,
  };
}

// Contatori per l'indice laterale della scheda CRM (Contatti/Affari/Compiti/Documenti)
function crmCounts(entityType, entityId) {
  const c = (sql) => db.prepare(sql).get(entityType, entityId).c;
  return {
    contacts_count: c('SELECT COUNT(*) c FROM contacts WHERE entity_type = ? AND entity_id = ?'),
    deals_count: c('SELECT COUNT(*) c FROM crm_deals WHERE entity_type = ? AND entity_id = ?'),
    open_tasks_count: c("SELECT COUNT(*) c FROM crm_tasks WHERE entity_type = ? AND entity_id = ? AND status != 'chiuso'"),
    documents_count: c('SELECT COUNT(*) c FROM crm_attachments WHERE entity_type = ? AND entity_id = ?'),
  };
}

function customerActivityStatus(lastOrderDate) {
  if (!lastOrderDate) return 'inattivo';
  const last = new Date(lastOrderDate + 'T00:00:00');
  if (isNaN(last.getTime())) return 'inattivo';
  const activeMonths = parseInt(getSetting('active_months_threshold', '6')) || 6;
  const semiActiveMonths = parseInt(getSetting('semi_active_months_threshold', '12')) || 12;
  const activeCutoff = new Date();
  activeCutoff.setMonth(activeCutoff.getMonth() - activeMonths);
  const semiActiveCutoff = new Date();
  semiActiveCutoff.setMonth(semiActiveCutoff.getMonth() - semiActiveMonths);
  if (last >= activeCutoff) return 'attivo';
  if (last >= semiActiveCutoff) return 'semi_attivo';
  return 'inattivo';
}

const uploadsDir = path.join(__dirname, 'public', 'uploads', 'products');
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});

const expUploadsDir = path.join(__dirname, 'public', 'uploads', 'experiences');
fs.mkdirSync(expUploadsDir, { recursive: true });
const uploadExpImage = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, expUploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)),
});

// Cataloghi PDF: salvati sul volume persistente (RAILWAY_VOLUME_MOUNT_PATH) così sopravvivono ai redeploy.
const catalogsDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname, 'catalogs');
fs.mkdirSync(catalogsDir, { recursive: true });
const uploadCatalog = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, catalogsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

function parsePaymentTermsDays(text) {
  const match = (text || '').match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// Sends an email alert the moment a stock quantity crosses AT/BELOW its threshold
// (edge-triggered via the below_threshold flag, so it fires once per dip, not on every read).
async function checkStockThreshold({ table, id, name, quantity, threshold, alertEmail, defaultEmailKey, kind }) {
  const wasBelow = db.prepare(`SELECT below_threshold FROM ${table} WHERE id = ?`).get(id)?.below_threshold;
  const isBelow = quantity <= threshold ? 1 : 0;
  db.prepare(`UPDATE ${table} SET below_threshold = ? WHERE id = ?`).run(isBelow, id);
  if (!isBelow || wasBelow) return;

  const to = alertEmail || getSetting(defaultEmailKey);
  if (!to) return;

  const subject = kind === 'finished'
    ? `Scorte in esaurimento — ${name}`
    : `Riordino necessario — ${name}`;
  const html = `<div style="font-family:Georgia,serif;padding:24px;background:#f4ede2;color:#241014;">
    <h2 style="margin:0 0 12px;">${subject}</h2>
    <p style="font-size:15px;line-height:1.6;">
      ${kind === 'finished'
        ? `Il prodotto finito <strong>${name}</strong> è sceso a <strong>${quantity}</strong> unità (soglia: ${threshold}). Avvisa il commerciale della scarsità.`
        : `La materia prima <strong>${name}</strong> è scesa a <strong>${quantity}</strong> unità (soglia: ${threshold}). Procedere con il riordino.`}
    </p>
    <p style="font-size:12px;color:#6b5f52;">${CANTINA_NAME} — avviso automatico di magazzino</p>
  </div>`;
  try { await sendMail({ to, subject, html }); }
  catch (e) { console.error('Alert email error:', e.message); }
}

// ── Stripe webhook (raw body — before express.json) ──────────────────────────
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !WEBHOOK_SECRET) return res.status(400).json({ error: 'Stripe non configurato.' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bid = session.metadata?.booking_id;
    if (bid) {
      const bookingId = parseInt(bid);
      const paymentIntentId = session.payment_intent || null;
      db.prepare("UPDATE bookings SET status = 'confermata', payment_intent_id = ?, stripe_payment_status = 'paid' WHERE id = ?")
        .run(paymentIntentId, bookingId);
      const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
      if (booking?.discount_code) {
        db.prepare('UPDATE discount_codes SET used_count = used_count + 1 WHERE code = ?').run(booking.discount_code);
      }
      const full = bookingWithDetails(bookingId);
      if (full) sendBookingEmail(full).catch(console.error);
    }
    const pid = session.metadata?.pickup_order_id;
    if (pid) {
      const orderId = parseInt(pid);
      const paymentIntentId = session.payment_intent || null;
      db.prepare("UPDATE pickup_orders SET status = 'da_ritirare', payment_intent_id = ?, stripe_payment_status = 'paid' WHERE id = ?")
        .run(paymentIntentId, orderId);
      const items = db.prepare('SELECT * FROM pickup_order_items WHERE order_id = ?').all(orderId);
      const decrementStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity IS NOT NULL');
      for (const it of items) if (it.product_id) decrementStock.run(it.quantity, it.product_id);
      const order = db.prepare('SELECT * FROM pickup_orders WHERE id = ?').get(orderId);
      if (order) { order.items = items; sendPickupOrderEmail(order).catch(console.error); }
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const bid = session.metadata?.booking_id;
    if (bid) db.prepare("UPDATE bookings SET status = 'annullata' WHERE id = ?").run(parseInt(bid));
    const pid = session.metadata?.pickup_order_id;
    if (pid) db.prepare("UPDATE pickup_orders SET status = 'annullato' WHERE id = ?").run(parseInt(pid));
  }

  res.json({ received: true });
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Public: config / experiences ─────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ cantina_name: CANTINA_NAME, payments_enabled: !!stripe });
});

app.get('/api/experiences', (req, res) => {
  const type = req.query.type === 'evento' ? 'evento' : 'visita';
  const rows = db.prepare('SELECT * FROM experiences WHERE active = 1 AND type = ? ORDER BY sort_order, id').all(type);
  res.json(rows);
});

app.get('/api/experiences/:id/slots', (req, res) => {
  const exp = getExperience(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Esperienza non trovata.' });

  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to   = req.query.to   || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

  const slots = db.prepare(`
    SELECT * FROM slots
    WHERE experience_id = ? AND active = 1 AND date >= ? AND date <= ?
    ORDER BY date, time
  `).all(exp.id, from, to);

  const withAvailability = slots.map(s => {
    const { available } = slotAvailability(s.id);
    return { id: s.id, date: s.date, time: s.time, capacity: s.capacity, available };
  }).filter(s => s.available > 0);

  res.json(withAvailability);
});

// ── Public: discount validation ──────────────────────────────────────────────
app.post('/api/discount/validate', (req, res) => {
  const { code, experience_id, guests } = req.body || {};
  const exp = getExperience(experience_id);
  if (!exp) return res.status(404).json({ error: 'Esperienza non trovata.' });
  const amount = exp.price_cents * (parseInt(guests) || 1);
  const result = validateDiscount(code, amount);
  if (!result.valid) return res.status(400).json({ valid: false, error: result.error || 'Codice non valido.' });
  res.json({ valid: true, discount_cents: result.discountCents, amount_cents: amount - result.discountCents });
});

// ── Checkout / booking request ───────────────────────────────────────────────
app.post('/api/create-checkout-session', async (req, res) => {
  const { experience_id, slot_id, customer_name, email, phone, guests, notes, discount_code, language } = req.body || {};

  if (!customer_name?.trim() || !email?.trim() || !experience_id || !slot_id) {
    return res.status(400).json({ error: 'Compila tutti i campi obbligatori.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Indirizzo email non valido.' });
  }
  const guestCount = Math.max(1, parseInt(guests) || 1);

  const exp = getExperience(experience_id);
  if (!exp || !exp.active) return res.status(404).json({ error: 'Esperienza non disponibile.' });

  const slot = getSlot(slot_id);
  if (!slot || slot.experience_id !== exp.id || !slot.active) {
    return res.status(404).json({ error: 'Slot non disponibile.' });
  }
  const { available } = slotAvailability(slot.id);
  if (guestCount > available) {
    return res.status(409).json({ error: `Posti insufficienti: disponibili ${available}.` });
  }

  let amountCents = exp.price_cents * guestCount;
  let discountCents = 0;
  const codeClean = discount_code?.trim().toUpperCase() || null;
  if (codeClean) {
    const result = validateDiscount(codeClean, amountCents);
    if (!result.valid) return res.status(400).json({ error: result.error || 'Codice sconto non valido.' });
    discountCents = result.discountCents;
    amountCents -= discountCents;
  }

  const lang = language === 'en' ? 'en' : 'it';
  const emailClean = email.toLowerCase().trim();

  const b2cCustomerId = findOrCreateB2CCustomer(customer_name.trim(), emailClean, phone?.trim());

  const result = db.prepare(`
    INSERT INTO bookings (slot_id, experience_id, customer_name, email, phone, guests, language, notes, status, amount_cents, discount_code, discount_cents, b2c_customer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_attesa', ?, ?, ?, ?)
  `).run(slot.id, exp.id, customer_name.trim(), emailClean, phone?.trim() || null, guestCount, lang, notes?.trim() || null, amountCents, codeClean, discountCents, b2cCustomerId);

  const bookingId = result.lastInsertRowid;

  if (!stripe) {
    // No payment configured — treat as a booking request to be confirmed manually.
    const full = bookingWithDetails(bookingId);
    try { await sendBookingEmail(full); } catch (e) { console.error('Email error:', e.message); }
    return res.json({ request: true, booking_id: bookingId });
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  const expName = lang === 'en' ? exp.name_en : exp.name_it;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: emailClean,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${CANTINA_NAME} — ${expName}`,
            description: `${slot.date} ${slot.time} · ${guestCount} ${guestCount === 1 ? 'ospite' : 'ospiti'}`,
          },
          unit_amount: Math.max(0, Math.round(amountCents / guestCount)),
        },
        quantity: guestCount,
      }],
      mode: 'payment',
      success_url: `${origin}/?payment=success&ref=${bookingId}`,
      cancel_url:  `${origin}/?payment=cancelled`,
      metadata: { booking_id: String(bookingId) },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    db.prepare('UPDATE bookings SET stripe_session_id = ? WHERE id = ?').run(session.id, bookingId);
    res.json({ url: session.url });
  } catch (err) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(bookingId);
    console.error('STRIPE ERROR:', err.message);
    res.status(500).json({ error: 'Errore Stripe: ' + err.message });
  }
});

// ── Public: negozio online — prenotazione e pagamento anticipato con ritiro ───
app.get('/api/shop-products', (req, res) => {
  const priceListId = parseInt(getSetting('shop_price_list_id', ''));
  if (!priceListId) return res.json([]);
  const rows = db.prepare(`
    SELECT p.id, p.name, p.vintage, p.varietal, p.description, p.image_url, p.wine_type, p.stock_quantity, pli.price_cents
    FROM products p JOIN price_list_items pli ON pli.product_id = p.id AND pli.price_list_id = ?
    WHERE p.active = 1
    ORDER BY p.name
  `).all(priceListId);
  res.json(rows);
});

app.post('/api/create-pickup-checkout-session', async (req, res) => {
  const { customer_name, email, phone, items, notes, language } = req.body || {};
  if (!customer_name?.trim() || !email?.trim() || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Compila tutti i campi obbligatori e aggiungi almeno una bottiglia.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Indirizzo email non valido.' });

  const priceListId = parseInt(getSetting('shop_price_list_id', ''));
  if (!priceListId) return res.status(400).json({ error: 'Negozio online non disponibile al momento.' });

  const resolvedItems = [];
  for (const it of items) {
    const product = db.prepare(`
      SELECT p.id, p.name, p.vintage, p.stock_quantity, pli.price_cents
      FROM products p JOIN price_list_items pli ON pli.product_id = p.id AND pli.price_list_id = ?
      WHERE p.id = ? AND p.active = 1
    `).get(priceListId, it.product_id);
    if (!product) return res.status(404).json({ error: 'Una delle bottiglie selezionate non è più disponibile.' });
    const qty = Math.max(1, parseInt(it.quantity) || 1);
    if (product.stock_quantity != null && qty > product.stock_quantity) {
      return res.status(409).json({ error: `Disponibilità insufficiente per ${product.name}.` });
    }
    resolvedItems.push({ product_id: product.id, product_name: product.name + (product.vintage ? ' ' + product.vintage : ''), quantity: qty, unit_price_cents: product.price_cents });
  }

  const amountCents = resolvedItems.reduce((sum, it) => sum + it.quantity * it.unit_price_cents, 0);
  const lang = language === 'en' ? 'en' : 'it';
  const emailClean = email.toLowerCase().trim();
  const b2cCustomerId = findOrCreateB2CCustomer(customer_name.trim(), emailClean, phone?.trim());
  const pickupToken = crypto.randomBytes(16).toString('hex');

  const orderResult = db.prepare(`
    INSERT INTO pickup_orders (customer_name, customer_email, customer_phone, b2c_customer_id, language, status, amount_cents, pickup_token, notes)
    VALUES (?, ?, ?, ?, ?, 'in_attesa_pagamento', ?, ?, ?)
  `).run(customer_name.trim(), emailClean, phone?.trim() || null, b2cCustomerId, lang, amountCents, pickupToken, notes?.trim() || null);
  const orderId = orderResult.lastInsertRowid;
  const insertItem = db.prepare('INSERT INTO pickup_order_items (order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?)');
  for (const it of resolvedItems) insertItem.run(orderId, it.product_id, it.product_name, it.quantity, it.unit_price_cents, it.quantity * it.unit_price_cents);

  if (!stripe) {
    db.prepare('DELETE FROM pickup_order_items WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM pickup_orders WHERE id = ?').run(orderId);
    return res.status(500).json({ error: 'Pagamento online non configurato.' });
  }

  const origin = `${req.protocol}://${req.get('host')}`;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: emailClean,
      line_items: resolvedItems.map(it => ({
        price_data: { currency: 'eur', product_data: { name: `${CANTINA_NAME} — ${it.product_name}` }, unit_amount: it.unit_price_cents },
        quantity: it.quantity,
      })),
      mode: 'payment',
      success_url: `${origin}/?pickup=success&token=${pickupToken}`,
      cancel_url: `${origin}/?pickup=cancelled`,
      metadata: { pickup_order_id: String(orderId) },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    db.prepare('UPDATE pickup_orders SET stripe_session_id = ? WHERE id = ?').run(session.id, orderId);
    res.json({ url: session.url });
  } catch (err) {
    db.prepare('DELETE FROM pickup_order_items WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM pickup_orders WHERE id = ?').run(orderId);
    console.error('STRIPE ERROR:', err.message);
    res.status(500).json({ error: 'Errore Stripe: ' + err.message });
  }
});

function pickupOrderPublicView(order) {
  return {
    id: order.id,
    ref: '#' + String(order.id).padStart(4, '0'),
    customer_name: order.customer_name,
    status: order.status,
    amount_cents: order.amount_cents,
    picked_up_at: order.picked_up_at,
    items: db.prepare('SELECT product_name, quantity, unit_price_cents, line_total_cents FROM pickup_order_items WHERE order_id = ?').all(order.id),
  };
}

app.get('/api/pickup-orders/verify/:token', (req, res) => {
  const order = db.prepare('SELECT * FROM pickup_orders WHERE pickup_token = ?').get(req.params.token);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato.' });
  res.json(pickupOrderPublicView(order));
});

app.post('/api/pickup-orders/verify/:token/pickup', (req, res) => {
  const order = db.prepare('SELECT * FROM pickup_orders WHERE pickup_token = ?').get(req.params.token);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato.' });
  if (order.status === 'in_attesa_pagamento') return res.status(409).json({ error: 'Il pagamento non risulta ancora completato.' });
  if (order.status === 'annullato') return res.status(409).json({ error: 'Questo ordine è stato annullato.' });
  if (order.status !== 'ritirato') {
    db.prepare("UPDATE pickup_orders SET status = 'ritirato', picked_up_at = datetime('now','localtime') WHERE id = ?").run(order.id);
  }
  res.json(pickupOrderPublicView(db.prepare('SELECT * FROM pickup_orders WHERE id = ?').get(order.id)));
});

// ── Public: reviews ───────────────────────────────────────────────────────────
app.get('/api/reviews', (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.customer_name, r.rating, r.comment, r.created_at, r.experience_id,
           e.name_it AS experience_name_it, e.name_en AS experience_name_en
    FROM reviews r LEFT JOIN experiences e ON e.id = r.experience_id
    WHERE r.approved = 1 ORDER BY r.created_at DESC LIMIT 30
  `).all();
  res.json(rows);
});

app.post('/api/reviews', (req, res) => {
  const { customer_name, rating, comment, experience_id } = req.body || {};
  const r = parseInt(rating);
  if (!customer_name?.trim() || !r || r < 1 || r > 5) {
    return res.status(400).json({ error: 'Nome e valutazione (1-5) sono obbligatori.' });
  }
  db.prepare('INSERT INTO reviews (experience_id, customer_name, rating, comment) VALUES (?, ?, ?, ?)')
    .run(experience_id || null, customer_name.trim(), r, comment?.trim() || null);
  res.json({ success: true });
});

// ── Public: newsletter ────────────────────────────────────────────────────────
app.post('/api/newsletter', (req, res) => {
  const { email } = req.body || {};
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Indirizzo email non valido.' });
  }
  try {
    db.prepare('INSERT INTO newsletter (email) VALUES (?)').run(email.toLowerCase().trim());
  } catch { /* già iscritto */ }
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/stats', authAdmin, (req, res) => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS bookings, COALESCE(SUM(guests),0) AS guests, COALESCE(SUM(amount_cents),0) AS revenue_cents
    FROM bookings WHERE status = 'confermata'
  `).get();
  const pending = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE status = 'in_attesa'").get().c;
  const upcoming = db.prepare(`
    SELECT COUNT(*) AS c FROM bookings b JOIN slots s ON s.id = b.slot_id
    WHERE b.status = 'confermata' AND s.date >= date('now')
  `).get().c;
  const byExperience = db.prepare(`
    SELECT e.id, e.name_it, COUNT(*) AS bookings, COALESCE(SUM(b.guests),0) AS guests, COALESCE(SUM(b.amount_cents),0) AS revenue_cents
    FROM bookings b JOIN experiences e ON e.id = b.experience_id
    WHERE b.status = 'confermata' GROUP BY e.id ORDER BY revenue_cents DESC
  `).all();
  const newsletterCount = db.prepare('SELECT COUNT(*) AS c FROM newsletter').get().c;
  const reviewsPending = db.prepare('SELECT COUNT(*) AS c FROM reviews WHERE approved = 0').get().c;
  res.json({ totals, pending, upcoming, byExperience, newsletterCount, reviewsPending });
});

// ── Admin: experiences ────────────────────────────────────────────────────────
function attachExperienceExtras(exp) {
  const images = db.prepare('SELECT id, image_url, sort_order FROM experience_images WHERE experience_id = ? ORDER BY sort_order, id').all(exp.id);
  const tastingProducts = db.prepare(`
    SELECT p.id, p.name, p.image_url FROM experience_products ep JOIN products p ON p.id = ep.product_id WHERE ep.experience_id = ?
  `).all(exp.id);
  return {
    ...exp,
    languages: exp.languages ? exp.languages.split(',').filter(Boolean) : [],
    facilities: exp.facilities ? exp.facilities.split(',').filter(Boolean) : [],
    images,
    tastingProducts,
  };
}

app.get('/api/admin/experiences', authAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM experiences ORDER BY sort_order, id').all();
  res.json(rows.map(attachExperienceExtras));
});

app.get('/api/admin/experiences/:id', authAdmin, (req, res) => {
  const exp = getExperience(req.params.id);
  if (!exp) return res.status(404).json({ error: 'Esperienza non trovata.' });
  res.json(attachExperienceExtras(exp));
});

app.post('/api/admin/experiences', authAdmin, uploadExpImage.single('image'), (req, res) => {
  const { name_it, name_en, description_it, description_en, included_it, included_en, price_cents, duration_minutes, max_guests, sort_order, languages, facilities, type } = req.body || {};
  if (!name_it?.trim() || !name_en?.trim() || !price_cents) {
    return res.status(400).json({ error: 'Nome (IT/EN) e prezzo sono obbligatori.' });
  }
  const image_url = req.file ? `/uploads/experiences/${req.file.filename}` : null;
  const langStr = Array.isArray(JSON.parse(languages || '[]')) ? JSON.parse(languages || '[]').join(',') : null;
  const facStr = Array.isArray(JSON.parse(facilities || '[]')) ? JSON.parse(facilities || '[]').join(',') : null;
  const typeVal = type === 'evento' ? 'evento' : 'visita';
  const result = db.prepare(`
    INSERT INTO experiences (name_it, name_en, description_it, description_en, included_it, included_en, price_cents, duration_minutes, max_guests, image_url, sort_order, languages, facilities, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name_it.trim(), name_en.trim(), description_it?.trim() || null, description_en?.trim() || null,
         included_it?.trim() || null, included_en?.trim() || null,
         parseInt(price_cents), parseInt(duration_minutes) || 90, parseInt(max_guests) || 10, image_url, parseInt(sort_order) || 0,
         langStr, facStr, typeVal);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/experiences/:id', authAdmin, uploadExpImage.single('image'), (req, res) => {
  const fields = ['name_it', 'name_en', 'description_it', 'description_en', 'included_it', 'included_en', 'price_cents', 'duration_minutes', 'max_guests', 'sort_order', 'active'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (req.body.languages !== undefined) { updates.push('languages = ?'); params.push(JSON.parse(req.body.languages || '[]').join(',') || null); }
  if (req.body.facilities !== undefined) { updates.push('facilities = ?'); params.push(JSON.parse(req.body.facilities || '[]').join(',') || null); }
  if (req.file) { updates.push('image_url = ?'); params.push(`/uploads/experiences/${req.file.filename}`); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE experiences SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/experiences/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM slots WHERE experience_id = ?').run(req.params.id);
  db.prepare('DELETE FROM experience_images WHERE experience_id = ?').run(req.params.id);
  db.prepare('DELETE FROM experience_products WHERE experience_id = ?').run(req.params.id);
  db.prepare('DELETE FROM experience_availability WHERE experience_id = ?').run(req.params.id);
  db.prepare('DELETE FROM experiences WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Galleria immagini
app.post('/api/admin/experiences/:id/images', authAdmin, uploadExpImage.array('images', 12), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Carica almeno un\'immagine.' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),-1) AS m FROM experience_images WHERE experience_id = ?').get(req.params.id).m;
  const insert = db.prepare('INSERT INTO experience_images (experience_id, image_url, sort_order) VALUES (?, ?, ?)');
  req.files.forEach((f, i) => insert.run(req.params.id, `/uploads/experiences/${f.filename}`, maxOrder + 1 + i));
  res.json({ success: true });
});
app.delete('/api/admin/experiences/:id/images/:imageId', authAdmin, (req, res) => {
  db.prepare('DELETE FROM experience_images WHERE id = ? AND experience_id = ?').run(req.params.imageId, req.params.id);
  res.json({ success: true });
});

// Prodotti in degustazione
app.put('/api/admin/experiences/:id/products', authAdmin, (req, res) => {
  const { product_ids } = req.body || {};
  if (!Array.isArray(product_ids)) return res.status(400).json({ error: 'Elenco prodotti non valido.' });
  db.prepare('DELETE FROM experience_products WHERE experience_id = ?').run(req.params.id);
  const insert = db.prepare('INSERT OR IGNORE INTO experience_products (experience_id, product_id) VALUES (?, ?)');
  for (const pid of product_ids) insert.run(req.params.id, pid);
  res.json({ success: true });
});

// Disponibilità ricorrente per esperienza: genera slot per una finestra scorrevole di giorni
function generateSlotsFromAvailability(experienceId, windowDays = 90) {
  const patterns = db.prepare('SELECT * FROM experience_availability WHERE experience_id = ?').all(experienceId);
  if (!patterns.length) return 0;
  const insert = db.prepare('INSERT INTO slots (experience_id, date, time, capacity) VALUES (?, ?, ?, ?)');
  const exists = db.prepare('SELECT id FROM slots WHERE experience_id = ? AND date = ? AND time = ?');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let created = 0;
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const p of patterns) {
      if (p.day_of_week !== d.getDay()) continue;
      if (!exists.get(experienceId, dateStr, p.time)) {
        insert.run(experienceId, dateStr, p.time, p.capacity);
        created++;
      }
    }
  }
  return created;
}

app.get('/api/admin/experiences/:id/availability', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM experience_availability WHERE experience_id = ? ORDER BY day_of_week, time').all(req.params.id));
});
app.put('/api/admin/experiences/:id/availability', authAdmin, (req, res) => {
  const { pattern } = req.body || {};
  if (!Array.isArray(pattern)) return res.status(400).json({ error: 'Pattern non valido.' });
  db.prepare('DELETE FROM experience_availability WHERE experience_id = ?').run(req.params.id);
  const insert = db.prepare('INSERT INTO experience_availability (experience_id, day_of_week, time, capacity) VALUES (?, ?, ?, ?)');
  for (const p of pattern) insert.run(req.params.id, parseInt(p.day_of_week), p.time, parseInt(p.capacity) || 10);
  const slotsCreated = generateSlotsFromAvailability(req.params.id);
  res.json({ success: true, slotsCreated });
});

// ── Admin: slots / availability ───────────────────────────────────────────────
app.get('/api/admin/slots', authAdmin, (req, res) => {
  const { experience_id, from, to } = req.query;
  let sql = `SELECT s.*, e.name_it AS experience_name FROM slots s JOIN experiences e ON e.id = s.experience_id WHERE 1=1`;
  const params = [];
  if (experience_id) { sql += ' AND s.experience_id = ?'; params.push(experience_id); }
  if (from) { sql += ' AND s.date >= ?'; params.push(from); }
  if (to)   { sql += ' AND s.date <= ?'; params.push(to); }
  sql += ' ORDER BY s.date, s.time';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(s => ({ ...s, available: slotAvailability(s.id).available })));
});

app.post('/api/admin/slots', authAdmin, (req, res) => {
  const { experience_id, date, time, capacity } = req.body || {};
  const exp = getExperience(experience_id);
  if (!exp) return res.status(404).json({ error: 'Esperienza non trovata.' });
  if (!date || !time) return res.status(400).json({ error: 'Data e ora sono obbligatorie.' });
  const result = db.prepare('INSERT INTO slots (experience_id, date, time, capacity) VALUES (?, ?, ?, ?)')
    .run(exp.id, date, time, parseInt(capacity) || exp.max_guests);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Bulk-generate recurring slots: { experience_id, start_date, end_date, days_of_week: [0-6], times: ["11:00"], capacity }
app.post('/api/admin/slots/bulk', authAdmin, (req, res) => {
  const { experience_id, start_date, end_date, days_of_week, times, capacity } = req.body || {};
  const exp = getExperience(experience_id);
  if (!exp) return res.status(404).json({ error: 'Esperienza non trovata.' });
  if (!start_date || !end_date || !Array.isArray(days_of_week) || !Array.isArray(times) || !times.length) {
    return res.status(400).json({ error: 'Parametri mancanti.' });
  }
  const cap = parseInt(capacity) || exp.max_guests;
  const insert = db.prepare('INSERT INTO slots (experience_id, date, time, capacity) VALUES (?, ?, ?, ?)');
  const exists = db.prepare('SELECT id FROM slots WHERE experience_id = ? AND date = ? AND time = ?');

  let created = 0;
  const d0 = new Date(start_date + 'T00:00:00');
  const d1 = new Date(end_date + 'T00:00:00');
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    if (!days_of_week.includes(d.getDay())) continue;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const time of times) {
      if (!exists.get(exp.id, dateStr, time)) {
        insert.run(exp.id, dateStr, time, cap);
        created++;
      }
    }
  }
  res.json({ success: true, created });
});

app.patch('/api/admin/slots/:id', authAdmin, (req, res) => {
  const { date, time, capacity, active } = req.body || {};
  const updates = [], params = [];
  if (date !== undefined) { updates.push('date = ?'); params.push(date); }
  if (time !== undefined) { updates.push('time = ?'); params.push(time); }
  if (capacity !== undefined) { updates.push('capacity = ?'); params.push(parseInt(capacity)); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE slots SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/slots/:id', authAdmin, (req, res) => {
  const hasBookings = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE slot_id = ? AND status != 'annullata'").get(req.params.id).c;
  if (hasBookings > 0) return res.status(409).json({ error: 'Lo slot ha prenotazioni attive: annullale prima di eliminarlo.' });
  db.prepare('DELETE FROM slots WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Admin: bookings ────────────────────────────────────────────────────────────
app.get('/api/admin/bookings', authAdmin, (req, res) => {
  const { status, q, experience_id, from, to } = req.query;
  let sql = `
    SELECT b.*, s.date, s.time, e.name_it AS experience_name, e.duration_minutes, o.name AS operator_name
    FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN experiences e ON e.id = b.experience_id
    LEFT JOIN operators o ON o.id = b.operator_id
    WHERE 1=1`;
  const params = [];
  if (status && status !== 'all') { sql += ' AND b.status = ?'; params.push(status); }
  if (experience_id) { sql += ' AND b.experience_id = ?'; params.push(experience_id); }
  if (from) { sql += ' AND s.date >= ?'; params.push(from); }
  if (to)   { sql += ' AND s.date <= ?'; params.push(to); }
  if (q) {
    sql += ' AND (b.customer_name LIKE ? OR b.email LIKE ?)';
    const like = `%${q}%`; params.push(like, like);
  }
  sql += ' ORDER BY s.date DESC, s.time DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/admin/bookings/manual', authAdmin, async (req, res) => {
  const { experience_id, slot_id, customer_name, email, phone, guests, notes, status, send_email } = req.body || {};
  const exp = getExperience(experience_id);
  const slot = getSlot(slot_id);
  if (!exp || !slot || !customer_name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti.' });
  }
  const guestCount = Math.max(1, parseInt(guests) || 1);
  const statusVal = ['confermata', 'in_attesa'].includes(status) ? status : 'confermata';
  const amountCents = exp.price_cents * guestCount;
  const emailClean = email.toLowerCase().trim();
  const b2cCustomerId = findOrCreateB2CCustomer(customer_name.trim(), emailClean, phone?.trim());

  const result = db.prepare(`
    INSERT INTO bookings (slot_id, experience_id, customer_name, email, phone, guests, notes, status, amount_cents, b2c_customer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(slot.id, exp.id, customer_name.trim(), emailClean, phone?.trim() || null, guestCount, notes?.trim() || null, statusVal, amountCents, b2cCustomerId);

  const full = bookingWithDetails(result.lastInsertRowid);
  if (send_email) {
    try { await sendBookingEmail(full); } catch (e) { console.error('Email error:', e.message); }
  }
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/bookings/:id', authAdmin, (req, res) => {
  const fields = ['customer_name', 'email', 'phone', 'guests', 'notes', 'status', 'operator_id'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.post('/api/admin/bookings/confirm/:id', authAdmin, async (req, res) => {
  const force = req.query.force === '1';
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Prenotazione non trovata.' });
  if (booking.status === 'confermata') return res.status(400).json({ error: 'Già confermata.' });

  let paymentIntentId = booking.payment_intent_id;
  if (!force && stripe && booking.stripe_session_id && !paymentIntentId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
      if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Pagamento non ancora ricevuto su Stripe.' });
      paymentIntentId = session.payment_intent || null;
    } catch (e) { console.error('Stripe retrieve error:', e.message); }
  }

  db.prepare("UPDATE bookings SET status = 'confermata', payment_intent_id = ? WHERE id = ?").run(paymentIntentId, booking.id);
  try { await sendBookingEmail(bookingWithDetails(booking.id)); } catch (e) { console.error('Email error:', e.message); }
  res.json({ success: true });
});

app.post('/api/admin/bookings/reject/:id', authAdmin, async (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Prenotazione non trovata.' });
  if (booking.status === 'annullata') return res.status(400).json({ error: 'Già annullata.' });

  let refundId = null, refundError = null;
  if (stripe) {
    let paymentIntentId = booking.payment_intent_id;
    if (!paymentIntentId && booking.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id);
        if (session.payment_status === 'paid') paymentIntentId = session.payment_intent;
      } catch (e) { refundError = 'Impossibile recuperare sessione Stripe: ' + e.message; }
    }
    if (paymentIntentId) {
      try {
        const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
        refundId = refund.id;
      } catch (e) { refundError = 'Rimborso Stripe fallito: ' + e.message; }
    }
  }

  db.prepare("UPDATE bookings SET status = 'annullata' WHERE id = ?").run(booking.id);
  res.json({ success: true, refund_id: refundId, refund_error: refundError });
});

app.post('/api/admin/bookings/checkin/:id', authAdmin, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Prenotazione non trovata.' });
  if (booking.status !== 'confermata') return res.status(400).json({ error: 'Solo le prenotazioni confermate possono fare check-in.' });
  const newState = booking.checked_in ? 0 : 1;
  const now = newState ? new Date().toISOString() : null;
  db.prepare('UPDATE bookings SET checked_in = ?, checked_in_at = ? WHERE id = ?').run(newState, now, booking.id);
  res.json({ success: true, checked_in: newState });
});

app.delete('/api/admin/bookings/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/export', authAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, s.date, s.time, e.name_it AS experience_name
    FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN experiences e ON e.id = b.experience_id
    ORDER BY s.date DESC, s.time DESC
  `).all();
  const headers = ['ID', 'Stato', 'Esperienza', 'Data', 'Ora', 'Nome', 'Email', 'Telefono', 'Ospiti', 'Totale (€)', 'Codice Sconto', 'Creato il'];
  const csv = [
    headers.join(';'),
    ...rows.map(r => [
      r.id, r.status, `"${r.experience_name}"`, r.date, r.time, `"${r.customer_name}"`, `"${r.email}"`,
      `"${r.phone || ''}"`, r.guests, fmtPrice(r.amount_cents), r.discount_code || '', r.created_at
    ].join(';'))
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="prenotazioni.csv"');
  res.send('﻿' + csv);
});

app.post('/api/admin/sync-payments', authAdmin, async (req, res) => {
  if (!stripe) return res.json({ synced: 0, total: 0 });
  const pending = db.prepare(`
    SELECT id, stripe_session_id FROM bookings
    WHERE stripe_session_id IS NOT NULL AND (stripe_payment_status IS NULL OR stripe_payment_status = 'unpaid')
  `).all();
  let synced = 0;
  for (const b of pending) {
    try {
      const session = await stripe.checkout.sessions.retrieve(b.stripe_session_id);
      db.prepare('UPDATE bookings SET stripe_payment_status = ?, payment_intent_id = COALESCE(payment_intent_id, ?) WHERE id = ?')
        .run(session.payment_status, session.payment_intent || null, b.id);
      if (session.payment_status === 'paid') synced++;
    } catch { /* ignore */ }
  }
  res.json({ synced, total: pending.length });
});

// ── Admin: discount codes ─────────────────────────────────────────────────────
app.get('/api/admin/discount-codes', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM discount_codes ORDER BY created_at DESC').all());
});

app.post('/api/admin/discount-codes', authAdmin, (req, res) => {
  const { code, type, value, max_uses, valid_from, valid_to } = req.body || {};
  if (!code?.trim() || !['percent', 'fixed'].includes(type) || !value) {
    return res.status(400).json({ error: 'Codice, tipo e valore sono obbligatori.' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO discount_codes (code, type, value, max_uses, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(code.trim().toUpperCase(), type, parseInt(value), max_uses ? parseInt(max_uses) : null, valid_from || null, valid_to || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Codice già esistente.' });
  }
});

app.patch('/api/admin/discount-codes/:id', authAdmin, (req, res) => {
  const fields = ['type', 'value', 'max_uses', 'valid_from', 'valid_to', 'active'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE discount_codes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/discount-codes/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM discount_codes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Admin: reviews ─────────────────────────────────────────────────────────────
app.get('/api/admin/reviews', authAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT r.*, e.name_it AS experience_name FROM reviews r
    LEFT JOIN experiences e ON e.id = r.experience_id ORDER BY r.created_at DESC
  `).all());
});

app.patch('/api/admin/reviews/:id', authAdmin, (req, res) => {
  const { approved } = req.body || {};
  db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(approved ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/reviews/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Admin: newsletter ──────────────────────────────────────────────────────────
app.get('/api/admin/newsletter', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM newsletter ORDER BY created_at DESC').all());
});

app.get('/api/admin/newsletter/export', authAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM newsletter ORDER BY created_at DESC').all();
  const csv = ['Email;Iscritto il', ...rows.map(r => `${r.email};${r.created_at}`)].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="newsletter.csv"');
  res.send('﻿' + csv);
});

app.delete('/api/admin/newsletter/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM newsletter WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// Enoturismo — Operatori & CRM B2C
// ══════════════════════════════════════════════════════════════════════════════

// ── Operatori addetti alle visite ─────────────────────────────────────────────
// Operatori: sola lettura — sono uno specchio automatico degli utenti del portale
// (vedi syncOperatorForPortalUser). Per crearne/modificarne/disattivarne uno si passa
// da Impostazioni → Utenti del portale, non da qui.
app.get('/api/admin/operators', authAdmin, (req, res) => {
  const operators = db.prepare('SELECT * FROM operators ORDER BY name').all();
  const visitCount = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE operator_id = ? AND status != 'annullata'");
  res.json(operators.map(o => ({ ...o, visitCount: visitCount.get(o.id).c })));
});

// ── Enoturismo: eventi terzi (affitto struttura) — lato operativo ─────────────
const VENUE_EVENT_STATUSES = ['richiesta', 'confermato', 'completato', 'annullato'];

app.get('/api/admin/venue-events', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM venue_events ORDER BY event_date DESC, id DESC').all());
});

app.get('/api/admin/venue-events/:id', authAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM venue_events WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Evento non trovato.' });
  res.json(row);
});

app.post('/api/admin/venue-events', authAdmin, (req, res) => {
  const { title, organizer_name, organizer_email, organizer_phone, event_date, start_time, end_time,
    guests_estimate, rental_fee_cents, deposit_cents, deposit_paid, status, notes } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Il titolo dell\'evento è obbligatorio.' });
  if (!organizer_name?.trim()) return res.status(400).json({ error: 'Il nome dell\'organizzatore è obbligatorio.' });
  if (!event_date) return res.status(400).json({ error: 'La data dell\'evento è obbligatoria.' });
  const finalStatus = VENUE_EVENT_STATUSES.includes(status) ? status : 'richiesta';
  const result = db.prepare(`
    INSERT INTO venue_events (title, organizer_name, organizer_email, organizer_phone, event_date, start_time, end_time,
      guests_estimate, rental_fee_cents, deposit_cents, deposit_paid, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(), organizer_name.trim(), organizer_email?.trim() || null, organizer_phone?.trim() || null,
    event_date, start_time || null, end_time || null,
    guests_estimate || null, rental_fee_cents || 0, deposit_cents || 0, deposit_paid ? 1 : 0,
    finalStatus, notes?.trim() || null
  );
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/venue-events/:id', authAdmin, (req, res) => {
  const fields = ['title', 'organizer_name', 'organizer_email', 'organizer_phone', 'event_date', 'start_time', 'end_time',
    'guests_estimate', 'rental_fee_cents', 'deposit_cents', 'deposit_paid', 'status', 'notes'];
  if (req.body.status !== undefined && !VENUE_EVENT_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: 'Stato non valido.' });
  }
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE venue_events SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/venue-events/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM venue_events WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Controllo rapido di conflitto: eventi terzi attivi nella stessa data (evita doppie prenotazioni della struttura)
app.get('/api/admin/venue-events/conflicts/:date', authAdmin, (req, res) => {
  const excludeId = req.query.excludeId || 0;
  const rows = db.prepare(`
    SELECT id, title, organizer_name, status FROM venue_events
    WHERE event_date = ? AND status != 'annullato' AND id != ?
  `).all(req.params.date, excludeId);
  res.json(rows);
});

// ── Enoturismo: negozio fisico (cassa) ─────────────────────────────────────────
const SHOP_SALE_CONTEXTS = ['negozio', 'post_visita', 'post_evento'];
const SHOP_PAYMENT_METHODS = ['contanti', 'carta', 'altro'];

app.get('/api/admin/shop-sales', authAdmin, (req, res) => {
  const { from, to, context } = req.query;
  let sql = `
    SELECT s.*, (SELECT COUNT(*) FROM shop_sale_items i WHERE i.sale_id = s.id) AS items_count
    FROM shop_sales s WHERE 1=1
  `;
  const params = [];
  if (from) { sql += ' AND date(s.created_at) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(s.created_at) <= date(?)'; params.push(to); }
  if (context && SHOP_SALE_CONTEXTS.includes(context)) { sql += ' AND s.sale_context = ?'; params.push(context); }
  sql += ' ORDER BY s.created_at DESC, s.id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/admin/shop-sales/:id', authAdmin, (req, res) => {
  const sale = db.prepare('SELECT * FROM shop_sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Vendita non trovata.' });
  sale.items = db.prepare('SELECT * FROM shop_sale_items WHERE sale_id = ? ORDER BY id').all(sale.id);
  res.json(sale);
});

app.post('/api/admin/shop-sales', authAdmin, (req, res) => {
  const { customer_name, customer_email, customer_phone, sale_context, payment_method, discount_cents, notes, operator_id, items } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Aggiungi almeno una bottiglia alla vendita.' });
  for (const it of items) {
    if (!it.product_name?.trim() || !it.quantity || it.quantity < 1) return res.status(400).json({ error: 'Riga vendita non valida.' });
  }
  const context = SHOP_SALE_CONTEXTS.includes(sale_context) ? sale_context : 'negozio';
  const method = SHOP_PAYMENT_METHODS.includes(payment_method) ? payment_method : 'contanti';
  const emailClean = customer_email?.trim().toLowerCase() || null;

  let b2cCustomerId = null;
  if (emailClean) {
    b2cCustomerId = findOrCreateB2CCustomer(customer_name?.trim() || emailClean, emailClean, customer_phone?.trim() || null);
  } else if (customer_name?.trim()) {
    b2cCustomerId = db.prepare('INSERT INTO b2c_customers (name, phone) VALUES (?, ?)').run(customer_name.trim(), customer_phone?.trim() || null).lastInsertRowid;
  }

  const itemsTotal = items.reduce((sum, it) => sum + (it.quantity * it.unit_price_cents), 0);
  const discount = Math.max(0, parseInt(discount_cents) || 0);
  const total = Math.max(0, itemsTotal - discount);

  const saleResult = db.prepare(`
    INSERT INTO shop_sales (customer_name, customer_email, customer_phone, b2c_customer_id, sale_context, payment_method, discount_cents, total_cents, operator_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    customer_name?.trim() || null, emailClean, customer_phone?.trim() || null, b2cCustomerId || null,
    context, method, discount, total, operator_id || null, notes?.trim() || null
  );
  const saleId = saleResult.lastInsertRowid;

  const insertItem = db.prepare('INSERT INTO shop_sale_items (sale_id, product_id, product_name, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?)');
  const decrementStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity IS NOT NULL');
  for (const it of items) {
    insertItem.run(saleId, it.product_id || null, it.product_name.trim(), it.quantity, it.unit_price_cents || 0, it.quantity * (it.unit_price_cents || 0));
    if (it.product_id) decrementStock.run(it.quantity, it.product_id);
  }

  res.json({ success: true, id: saleId });
});

app.delete('/api/admin/shop-sales/:id', authAdmin, (req, res) => {
  const items = db.prepare('SELECT * FROM shop_sale_items WHERE sale_id = ?').all(req.params.id);
  const restoreStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND stock_quantity IS NOT NULL');
  for (const it of items) if (it.product_id) restoreStock.run(it.quantity, it.product_id);
  db.prepare('DELETE FROM shop_sale_items WHERE sale_id = ?').run(req.params.id);
  db.prepare('DELETE FROM shop_sales WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Negozio online: ritiri in cantina (admin) ─────────────────────────────────
app.get('/api/admin/pickup-orders', authAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, (SELECT COUNT(*) FROM pickup_order_items i WHERE i.order_id = o.id) AS items_count
    FROM pickup_orders o ORDER BY o.created_at DESC, o.id DESC
  `).all();
  res.json(rows);
});

app.get('/api/admin/pickup-orders/:id', authAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM pickup_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato.' });
  order.items = db.prepare('SELECT * FROM pickup_order_items WHERE order_id = ? ORDER BY id').all(order.id);
  res.json(order);
});

app.post('/api/admin/pickup-orders/:id/pickup', authAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM pickup_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato.' });
  if (order.status !== 'da_ritirare') return res.status(409).json({ error: 'Solo un ordine pagato e in attesa di ritiro può essere segnato come ritirato.' });
  db.prepare("UPDATE pickup_orders SET status = 'ritirato', picked_up_at = datetime('now','localtime') WHERE id = ?").run(order.id);
  res.json({ success: true });
});

app.delete('/api/admin/pickup-orders/:id', authAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM pickup_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato.' });
  if (order.status === 'da_ritirare') {
    const items = db.prepare('SELECT * FROM pickup_order_items WHERE order_id = ?').all(order.id);
    const restoreStock = db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND stock_quantity IS NOT NULL');
    for (const it of items) if (it.product_id) restoreStock.run(it.quantity, it.product_id);
  }
  db.prepare('DELETE FROM pickup_order_items WHERE order_id = ?').run(order.id);
  db.prepare('DELETE FROM pickup_orders WHERE id = ?').run(order.id);
  res.json({ success: true });
});

// ── CRM B2C: clienti (visitatori + negozio + e-commerce) ──────────────────────
app.get('/api/admin/b2c-customers', authAdmin, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM b2c_customers WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR email LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
  sql += ' ORDER BY name';
  const customers = db.prepare(sql).all(...params);

  const visitStats = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE b2c_customer_id = ? AND status != 'annullata'");
  const orderStats = db.prepare("SELECT channel, COUNT(*) AS c, COALESCE(SUM(amount_cents),0) AS total FROM b2c_orders WHERE customer_id = ? GROUP BY channel");
  const cassaStats = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(total_cents),0) AS total FROM shop_sales WHERE b2c_customer_id = ?');

  res.json(customers.map(c => {
    const orders = orderStats.all(c.id);
    const ecommerce = orders.find(o => o.channel === 'ecommerce') || { c: 0, total: 0 };
    const negozio = orders.find(o => o.channel === 'negozio') || { c: 0, total: 0 };
    const cassa = cassaStats.get(c.id);
    return {
      ...c,
      visitCount: visitStats.get(c.id).c,
      ecommerceCount: ecommerce.c, ecommerceTotalCents: ecommerce.total,
      negozioCount: negozio.c + cassa.c, negozioTotalCents: negozio.total + cassa.total,
    };
  }));
});

app.get('/api/admin/b2c-customers/:id', authAdmin, (req, res) => {
  const customer = db.prepare('SELECT * FROM b2c_customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente non trovato.' });
  const visits = db.prepare(`
    SELECT b.id, b.status, b.guests, b.amount_cents, s.date, s.time, e.name_it AS experience_name, o.name AS operator_name
    FROM bookings b JOIN slots s ON s.id = b.slot_id JOIN experiences e ON e.id = b.experience_id
    LEFT JOIN operators o ON o.id = b.operator_id
    WHERE b.b2c_customer_id = ? ORDER BY s.date DESC
  `).all(customer.id);
  const orders = db.prepare('SELECT * FROM b2c_orders WHERE customer_id = ? ORDER BY order_date DESC').all(customer.id);
  const shopSales = db.prepare('SELECT * FROM shop_sales WHERE b2c_customer_id = ? ORDER BY created_at DESC').all(customer.id);
  const itemsBySale = db.prepare('SELECT * FROM shop_sale_items WHERE sale_id = ? ORDER BY id');
  for (const s of shopSales) s.items = itemsBySale.all(s.id);
  const pickupOrders = db.prepare('SELECT * FROM pickup_orders WHERE b2c_customer_id = ? ORDER BY created_at DESC').all(customer.id);
  const itemsByOrder = db.prepare('SELECT * FROM pickup_order_items WHERE order_id = ? ORDER BY id');
  for (const o of pickupOrders) o.items = itemsByOrder.all(o.id);
  res.json({ ...customer, visits, orders, shopSales, pickupOrders });
});

app.post('/api/admin/b2c-customers', authAdmin, (req, res) => {
  const { name, email, phone, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome del cliente è obbligatorio.' });
  try {
    const result = db.prepare('INSERT INTO b2c_customers (name, email, phone, notes) VALUES (?, ?, ?, ?)')
      .run(name.trim(), email?.trim().toLowerCase() || null, phone?.trim() || null, notes?.trim() || null);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Esiste già un cliente con questa email.' });
  }
});

app.patch('/api/admin/b2c-customers/:id', authAdmin, (req, res) => {
  const fields = ['name', 'email', 'phone', 'notes'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] || null); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE b2c_customers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/b2c-customers/:id', authAdmin, (req, res) => {
  db.prepare('UPDATE bookings SET b2c_customer_id = NULL WHERE b2c_customer_id = ?').run(req.params.id);
  db.prepare('DELETE FROM b2c_orders WHERE customer_id = ?').run(req.params.id);
  db.prepare('DELETE FROM b2c_customers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── CRM B2C: ordini (e-commerce / negozio fisico) ─────────────────────────────
app.post('/api/admin/b2c-orders', authAdmin, (req, res) => {
  const { customer_id, channel, order_number, amount_cents, order_date, notes } = req.body || {};
  if (!customer_id || !['ecommerce', 'negozio'].includes(channel)) {
    return res.status(400).json({ error: 'Cliente e canale (ecommerce/negozio) sono obbligatori.' });
  }
  const result = db.prepare(`
    INSERT INTO b2c_orders (customer_id, channel, order_number, amount_cents, order_date, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(customer_id, channel, order_number?.trim() || null, parseInt(amount_cents) || 0,
         order_date || new Date().toISOString().slice(0, 10), notes?.trim() || null);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/b2c-orders/:id', authAdmin, (req, res) => {
  const fields = ['channel', 'order_number', 'amount_cents', 'order_date', 'notes'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE b2c_orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/b2c-orders/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM b2c_orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// ERP — Commerciale / Produzione / Magazzino (portale interno)
// ══════════════════════════════════════════════════════════════════════════════

// ── Settings (email di alert) ─────────────────────────────────────────────────
const COMPANY_FIELDS = [
  'company_name', 'company_address', 'company_postal_code', 'company_city', 'company_province', 'company_country',
  'company_vat_number', 'company_fiscal_code', 'company_sdi_code', 'company_pec', 'company_phone', 'company_email',
];

app.get('/api/admin/settings', authAdmin, (req, res) => {
  const company = {};
  for (const f of COMPANY_FIELDS) company[f] = getSetting(f, '');
  res.json({
    commercial_alert_email: getSetting('commercial_alert_email', ''),
    procurement_alert_email: getSetting('procurement_alert_email', ''),
    active_months_threshold: getSetting('active_months_threshold', '6'),
    semi_active_months_threshold: getSetting('semi_active_months_threshold', '12'),
    shop_price_list_id: getSetting('shop_price_list_id', ''),
    ...company,
  });
});
const DASHBOARD_WIDGET_CATALOG = {
  commerciale: [
    { key: 'orders_total', label: 'Ordini totali' },
    { key: 'revenue_total', label: 'Ricavo totale' },
    { key: 'revenue_by_channel', label: 'Ricavo per canale' },
    { key: 'revenue_by_pricelist', label: 'Ricavo per listino' },
    { key: 'top_products', label: 'Top prodotti' },
  ],
  produzione: [
    { key: 'bottles_to_produce', label: 'Bottiglie da produrre' },
    { key: 'pending_lines', label: 'Righe ordine in sospeso' },
    { key: 'top_customers_volume', label: 'Top clienti per volume' },
  ],
  magazzino: [
    { key: 'orders_by_status', label: 'Ordini per stato' },
    { key: 'finished_below_threshold', label: 'Prodotti finiti sotto soglia' },
    { key: 'raw_below_threshold', label: 'Materie prime sotto soglia' },
  ],
  crm: [
    { key: 'customers_by_status', label: 'Clienti per stato attività' },
    { key: 'agents_count', label: 'Agenti attivi' },
    { key: 'importers_count', label: 'Importatori' },
    { key: 'suppliers_count', label: 'Fornitori' },
    { key: 'open_deals', label: 'Affari aperti' },
    { key: 'open_tasks', label: 'Compiti aperti' },
  ],
  enoturismo: [
    { key: 'bookings_confirmed', label: 'Prenotazioni confermate' },
    { key: 'guests_total', label: 'Ospiti totali' },
    { key: 'revenue', label: 'Ricavo' },
    { key: 'pending', label: 'In attesa' },
    { key: 'future_bookings', label: 'Prenotazioni future' },
    { key: 'newsletter_subscribers', label: 'Iscritti newsletter' },
    { key: 'reviews_to_moderate', label: 'Recensioni da moderare' },
    { key: 'revenue_by_experience', label: 'Ricavi per esperienza' },
  ],
};

app.get('/api/admin/dashboard-widgets', authAdmin, (req, res) => {
  const stored = getSetting('dashboard_widgets', null);
  const enabled = stored ? JSON.parse(stored) : null;
  const result = {};
  for (const ws of Object.keys(DASHBOARD_WIDGET_CATALOG)) {
    result[ws] = DASHBOARD_WIDGET_CATALOG[ws].map(w => ({
      ...w,
      enabled: enabled ? (enabled[ws] || []).includes(w.key) : true,
    }));
  }
  res.json(result);
});

app.post('/api/admin/dashboard-widgets', authAdmin, (req, res) => {
  const { workspace, enabledKeys } = req.body || {};
  if (!DASHBOARD_WIDGET_CATALOG[workspace]) return res.status(400).json({ error: 'Workspace non valido.' });
  const stored = getSetting('dashboard_widgets', null);
  const current = stored ? JSON.parse(stored) : {};
  for (const ws of Object.keys(DASHBOARD_WIDGET_CATALOG)) {
    if (!current[ws]) current[ws] = DASHBOARD_WIDGET_CATALOG[ws].map(w => w.key);
  }
  current[workspace] = Array.isArray(enabledKeys) ? enabledKeys : [];
  setSetting('dashboard_widgets', JSON.stringify(current));
  res.json({ success: true });
});

app.post('/api/admin/settings', authAdmin, (req, res) => {
  const { commercial_alert_email, procurement_alert_email, active_months_threshold, semi_active_months_threshold, shop_price_list_id } = req.body || {};
  if (commercial_alert_email !== undefined) setSetting('commercial_alert_email', commercial_alert_email);
  if (procurement_alert_email !== undefined) setSetting('procurement_alert_email', procurement_alert_email);
  if (shop_price_list_id !== undefined) setSetting('shop_price_list_id', shop_price_list_id);
  if (active_months_threshold !== undefined) {
    const n = parseInt(active_months_threshold);
    if (!n || n < 1) return res.status(400).json({ error: 'La soglia clienti attivi deve essere un numero di mesi valido.' });
    setSetting('active_months_threshold', String(n));
  }
  if (semi_active_months_threshold !== undefined) {
    const n = parseInt(semi_active_months_threshold);
    if (!n || n < 1) return res.status(400).json({ error: 'La soglia clienti semi attivi deve essere un numero di mesi valido.' });
    setSetting('semi_active_months_threshold', String(n));
  }
  for (const f of COMPANY_FIELDS) {
    if (req.body[f] !== undefined) setSetting(f, req.body[f].trim());
  }
  res.json({ success: true });
});

// ── Prodotti (bottiglie) ───────────────────────────────────────────────────────
app.get('/api/admin/products', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY name').all());
});

app.post('/api/admin/products', authAdmin, upload.single('image'), (req, res) => {
  const { sku, name, vintage, varietal, description, wine_type, stock_quantity } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome della bottiglia è obbligatorio.' });
  const image_url = req.file ? `/uploads/products/${req.file.filename}` : null;
  try {
    const result = db.prepare(`
      INSERT INTO products (sku, name, vintage, varietal, description, image_url, wine_type, stock_quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sku?.trim() || null, name.trim(), vintage?.trim() || null, varietal?.trim() || null, description?.trim() || null, image_url, wine_type || null, stock_quantity === '' || stock_quantity === undefined ? null : parseInt(stock_quantity));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'SKU già esistente.' });
  }
});

app.patch('/api/admin/products/:id', authAdmin, upload.single('image'), (req, res) => {
  const fields = ['sku', 'name', 'vintage', 'varietal', 'description', 'active', 'wine_type', 'stock_quantity'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(f === 'stock_quantity' && req.body[f] === '' ? null : req.body[f]);
    }
  }
  if (req.file) { updates.push('image_url = ?'); params.push(`/uploads/products/${req.file.filename}`); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM price_list_items WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM warehouse_finished WHERE product_id = ?').run(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Listini ────────────────────────────────────────────────────────────────────
app.get('/api/admin/price-lists', authAdmin, (req, res) => {
  const lists = db.prepare('SELECT * FROM price_lists ORDER BY name').all();
  const items = db.prepare(`
    SELECT pli.*, p.name AS product_name FROM price_list_items pli JOIN products p ON p.id = pli.product_id
  `).all();
  res.json(lists.map(l => ({ ...l, items: items.filter(i => i.price_list_id === l.id) })));
});

app.post('/api/admin/price-lists', authAdmin, (req, res) => {
  const { name, currency } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome del listino è obbligatorio.' });
  try {
    const result = db.prepare('INSERT INTO price_lists (name, currency) VALUES (?, ?)').run(name.trim(), currency?.trim() || 'EUR');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Listino già esistente.' });
  }
});

app.patch('/api/admin/price-lists/:id', authAdmin, (req, res) => {
  const fields = ['name', 'currency', 'active'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE price_lists SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/price-lists/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM price_list_items WHERE price_list_id = ?').run(req.params.id);
  db.prepare('DELETE FROM price_lists WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/price-lists/:id/items', authAdmin, (req, res) => {
  const { product_id, price_cents } = req.body || {};
  if (!product_id || price_cents == null) return res.status(400).json({ error: 'Prodotto e prezzo sono obbligatori.' });
  db.prepare(`
    INSERT INTO price_list_items (price_list_id, product_id, price_cents) VALUES (?, ?, ?)
    ON CONFLICT(price_list_id, product_id) DO UPDATE SET price_cents = excluded.price_cents
  `).run(req.params.id, product_id, parseInt(price_cents));
  res.json({ success: true });
});

app.delete('/api/admin/price-lists/:id/items/:productId', authAdmin, (req, res) => {
  db.prepare('DELETE FROM price_list_items WHERE price_list_id = ? AND product_id = ?').run(req.params.id, req.params.productId);
  res.json({ success: true });
});

// ── Ordini commerciali ─────────────────────────────────────────────────────────
app.get('/api/admin/orders', authAdmin, (req, res) => {
  const { q, from, to, status, customer_id, agent_id } = req.query;
  let sql = `
    SELECT o.*, a.name AS agent_name, bc.name AS billing_customer_name
    FROM orders o LEFT JOIN agents a ON a.id = o.agent_id LEFT JOIN customers bc ON bc.id = o.billing_customer_id
    WHERE 1=1`;
  const params = [];
  if (customer_id) { sql += ' AND o.customer_id = ?'; params.push(customer_id); }
  if (agent_id) { sql += ' AND o.agent_id = ?'; params.push(agent_id); }
  if (status && status !== 'all') { sql += ' AND o.status = ?'; params.push(status); }
  if (from) { sql += ' AND o.order_date >= ?'; params.push(from); }
  if (to)   { sql += ' AND o.order_date <= ?'; params.push(to); }
  if (q) { sql += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
  sql += ' ORDER BY o.order_date DESC, o.id DESC';
  const orders = db.prepare(sql).all(...params);
  const itemCount = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(quantity),0) AS q FROM order_items WHERE order_id = ?');
  res.json(orders.map(o => ({ ...o, ...itemCount.get(o.id) })));
});

app.get('/api/admin/orders/:id', authAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Ordine non trovato.' });
  const items = db.prepare(`
    SELECT oi.*, p.name AS product_name FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?
  `).all(order.id);
  res.json({ ...order, items });
});

app.patch('/api/admin/orders/:id', authAdmin, (req, res) => {
  const { status, warehouse_note } = req.body || {};
  const updates = [], params = [];
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (warehouse_note !== undefined) { updates.push('warehouse_note = ?'); params.push(warehouse_note || null); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/orders/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Import ordini da un file Excel esportato dal gestionale.
// Colonne attese (case-insensitive): order_number, order_date, customer_name, customer_country,
// channel, price_list, product_sku, product_name, label_variant, quantity, unit_price
const excelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/admin/orders/import', authAdmin, excelUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato.' });
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'Impossibile leggere il file Excel: ' + e.message });
  }
  if (!rows.length) return res.status(400).json({ error: 'Il file non contiene righe.' });

  const norm = (row) => {
    const out = {};
    for (const k of Object.keys(row)) out[k.toString().trim().toLowerCase().replace(/\s+/g, '_')] = row[k];
    return out;
  };

  const grouped = new Map();
  for (const raw of rows) {
    const r = norm(raw);
    const orderNumber = String(r.order_number || r.ordine || '').trim() || `AUTO-${Date.now()}-${grouped.size}`;
    if (!grouped.has(orderNumber)) {
      grouped.set(orderNumber, {
        order_number: orderNumber,
        customer_name: String(r.customer_name || r.cliente || '').trim(),
        customer_country: String(r.customer_country || r.paese || '').trim(),
        channel: String(r.channel || r.canale || '').trim(),
        price_list_name: String(r.price_list || r.listino || '').trim(),
        order_date: String(r.order_date || r.data || '').trim() || new Date().toISOString().slice(0, 10),
        items: [],
      });
    }
    const productName = String(r.product_name || r.prodotto || '').trim();
    const sku = String(r.product_sku || r.sku || '').trim();
    const qty = parseInt(r.quantity || r.quantita || 1) || 1;
    const unitPriceEuro = parseFloat(r.unit_price || r.prezzo_unitario || 0) || 0;
    const product = sku ? db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) : null;
    grouped.get(orderNumber).items.push({
      product_id: product?.id || null,
      product_name_raw: productName || sku || 'Prodotto sconosciuto',
      label_variant: String(r.label_variant || r.etichetta || '').trim() || null,
      quantity: qty,
      unit_price_cents: Math.round(unitPriceEuro * 100),
    });
  }

  const insertOrder = db.prepare(`
    INSERT INTO orders (order_number, customer_name, customer_country, channel, price_list_name, order_date, total_cents, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'excel_import')
  `);
  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name_raw, label_variant, quantity, unit_price_cents)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let created = 0;
  for (const order of grouped.values()) {
    const total = order.items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0);
    const result = insertOrder.run(order.order_number, order.customer_name, order.customer_country, order.channel, order.price_list_name, order.order_date, total);
    for (const item of order.items) {
      insertItem.run(result.lastInsertRowid, item.product_id, item.product_name_raw, item.label_variant, item.quantity, item.unit_price_cents);
    }
    created++;
  }

  res.json({ success: true, orders_created: created, rows_processed: rows.length });
});

// ══════════════════════════════════════════════════════════════════════════════
// Commerciale: aree di interesse (configurabili da Impostazioni → Regole) e obiettivi
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/admin/sales-target-areas', authAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM sales_target_areas ORDER BY sort_order, name').all();
  res.json(rows.map(r => ({ ...r, countries: JSON.parse(r.countries || '[]') })));
});
app.post('/api/admin/sales-target-areas', authAdmin, (req, res) => {
  const { name, countries, sort_order } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome dell\'area è obbligatorio.' });
  try {
    const result = db.prepare('INSERT INTO sales_target_areas (name, countries, sort_order) VALUES (?, ?, ?)')
      .run(name.trim(), JSON.stringify(Array.isArray(countries) ? countries : []), sort_order || 0);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Esiste già un\'area con questo nome.' });
  }
});
app.patch('/api/admin/sales-target-areas/:id', authAdmin, (req, res) => {
  const { name, countries, sort_order, active } = req.body || {};
  const updates = [], params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (countries !== undefined) { updates.push('countries = ?'); params.push(JSON.stringify(Array.isArray(countries) ? countries : [])); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
  if (active !== undefined) { updates.push('active = ?'); params.push(active ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE sales_target_areas SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/sales-target-areas/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM sales_targets WHERE area_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sales_target_areas WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Obiettivi: un set = (anno, area, prodotto) con 12 valori mensili. product_id 0 = totale.
app.get('/api/admin/sales-targets', authAdmin, (req, res) => {
  const { year, area_id, product_id } = req.query;
  if (!year || !area_id) return res.status(400).json({ error: 'year e area_id sono obbligatori.' });
  const pid = product_id ? parseInt(product_id) : 0;
  const rows = db.prepare('SELECT month, target_bottles FROM sales_targets WHERE year = ? AND area_id = ? AND product_id = ?').all(year, area_id, pid);
  const months = Array(12).fill(0);
  rows.forEach(r => { months[r.month - 1] = r.target_bottles; });
  res.json({ months });
});

app.get('/api/admin/sales-targets/list', authAdmin, (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const rows = db.prepare(`
    SELECT st.area_id, a.name AS area_name, st.product_id, COALESCE(p.name, 'Totale') AS product_name,
      SUM(st.target_bottles) AS total_bottles
    FROM sales_targets st
    JOIN sales_target_areas a ON a.id = st.area_id
    LEFT JOIN products p ON p.id = st.product_id AND st.product_id != 0
    WHERE st.year = ?
    GROUP BY st.area_id, st.product_id
    ORDER BY a.sort_order, st.product_id
  `).all(year);
  res.json(rows);
});

app.post('/api/admin/sales-targets', authAdmin, (req, res) => {
  const { year, area_id, product_id, months } = req.body || {};
  if (!year || !area_id || !Array.isArray(months) || months.length !== 12) {
    return res.status(400).json({ error: 'year, area_id e 12 valori mensili sono obbligatori.' });
  }
  const pid = product_id || 0;
  const upsert = db.prepare(`
    INSERT INTO sales_targets (year, area_id, product_id, month, target_bottles) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(year, area_id, product_id, month) DO UPDATE SET target_bottles = excluded.target_bottles
  `);
  months.forEach((v, i) => upsert.run(year, area_id, pid, i + 1, v || 0));
  res.json({ success: true });
});

app.delete('/api/admin/sales-targets', authAdmin, (req, res) => {
  const { year, area_id, product_id } = req.query;
  if (!year || !area_id) return res.status(400).json({ error: 'year e area_id sono obbligatori.' });
  const pid = product_id ? parseInt(product_id) : 0;
  db.prepare('DELETE FROM sales_targets WHERE year = ? AND area_id = ? AND product_id = ?').run(year, area_id, pid);
  res.json({ success: true });
});

function periodRange(periodo) {
  const now = new Date();
  let start;
  if (periodo === 'trimestre') { const q = Math.floor(now.getMonth() / 3); start = new Date(now.getFullYear(), q * 3, 1); }
  else if (periodo === 'annata') { start = new Date(now.getFullYear(), 0, 1); }
  else { start = new Date(now.getFullYear(), now.getMonth(), 1); }
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

function trailingMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({ start: d.toISOString().slice(0, 10), end: endD.toISOString().slice(0, 10), label: d.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '') });
  }
  return out;
}

app.get('/api/admin/commercial/dashboard', authAdmin, (req, res) => {
  const periodo = ['mese', 'trimestre', 'annata'].includes(req.query.periodo) ? req.query.periodo : 'mese';
  const { start, end } = periodRange(periodo);
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();

  // KPI del periodo + sparkline (8 mesi trascorsi, indipendente dal periodo selezionato)
  const months8 = trailingMonths(8);
  const revenueInRange = (s, e) => db.prepare('SELECT COALESCE(SUM(total_cents),0) AS c, COUNT(*) AS n FROM orders WHERE order_date >= ? AND order_date < ?').get(s, e);
  const bottlesShippedInRange = (s, e) => db.prepare(`
    SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.production_status = 'completato' AND o.order_date >= ? AND o.order_date < ?
  `).get(s, e).q;
  const bottlesPlannedInRange = (s, e) => db.prepare(`
    SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.order_date >= ? AND o.order_date < ?
  `).get(s, e).q;
  const overdueCreditsInRange = (s, e) => db.prepare(`
    SELECT COALESCE(SUM(total_cents),0) AS c, COUNT(DISTINCT customer_id) AS n FROM orders
    WHERE payment_status != 'pagato' AND payment_due_date >= ? AND payment_due_date < ? AND payment_due_date < ?
  `).get(s, e, today);

  const endExclusive = new Date(new Date(end).getTime() + 86400000).toISOString().slice(0, 10);
  const revenueNow = revenueInRange(start, endExclusive);
  const bottlesEvase = bottlesShippedInRange(start, endExclusive);
  const bottlesPianificate = bottlesPlannedInRange(start, endExclusive);
  const overdueNow = db.prepare(`
    SELECT COALESCE(SUM(total_cents),0) AS c, COUNT(DISTINCT customer_id) AS n FROM orders
    WHERE payment_status != 'pagato' AND payment_due_date IS NOT NULL AND payment_due_date < ?
  `).get(today);

  const kpi = {
    fatturato_cents: revenueNow.c,
    fatturato_spark: months8.map(m => revenueInRange(m.start, m.end).c),
    bottiglie_evase: bottlesEvase,
    bottiglie_pianificate: bottlesPianificate,
    bottiglie_spark: months8.map(m => bottlesShippedInRange(m.start, m.end)),
    ordine_medio_cents: revenueNow.n ? Math.round(revenueNow.c / revenueNow.n) : 0,
    numero_ordini: revenueNow.n,
    ordine_medio_spark: months8.map(m => { const r = revenueInRange(m.start, m.end); return r.n ? Math.round(r.c / r.n) : 0; }),
    crediti_scaduti_cents: overdueNow.c,
    crediti_scaduti_clienti: overdueNow.n,
    crediti_scaduti_spark: months8.map(m => overdueCreditsInRange(m.start, m.end).c),
  };

  // Serie mensile Italia/Export (12 mesi)
  const months12 = trailingMonths(12);
  const serieMensile = months12.map(m => {
    const italia = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.order_date >= ? AND o.order_date < ? AND (o.customer_country = 'Italia' OR o.customer_country IS NULL OR o.customer_country = '')
    `).get(m.start, m.end).q;
    const exportQ = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.order_date >= ? AND o.order_date < ? AND o.customer_country IS NOT NULL AND o.customer_country != '' AND o.customer_country != 'Italia'
    `).get(m.start, m.end).q;
    return { mese: m.label, bottiglieItalia: italia, bottiglieExport: exportQ };
  });

  // Obiettivi annata per area (sempre sull'anno corrente, indipendente dal periodo selezionato)
  const areas = db.prepare('SELECT * FROM sales_target_areas WHERE active = 1 ORDER BY sort_order, name').all();
  const yearStart = `${year}-01-01`;
  const yearEndExclusive = today;
  let totalRemaining = 0;
  const obiettivi = areas.map(a => {
    const countries = JSON.parse(a.countries || '[]');
    let consegnate = 0;
    if (countries.length) {
      const placeholders = countries.map(() => '?').join(',');
      consegnate = db.prepare(`
        SELECT COALESCE(SUM(oi.quantity),0) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.order_date >= ? AND o.order_date <= ? AND o.customer_country IN (${placeholders})
      `).get(yearStart, yearEndExclusive, ...countries).q;
    }
    const target = db.prepare('SELECT COALESCE(SUM(target_bottles),0) AS t FROM sales_targets WHERE year = ? AND area_id = ? AND product_id = 0').get(year, a.id).t;
    if (target > consegnate) totalRemaining += (target - consegnate);
    return { area: a.name, consegnate, target, pct: target ? Math.round((consegnate / target) * 100) : 0 };
  });
  const monthsRemaining = 12 - new Date().getMonth() - 1;

  // Etichette più vendute (periodo selezionato)
  const topEtichette = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name_raw) AS nome, p.wine_type AS tipologia, SUM(oi.quantity) AS bottiglie
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.order_date >= ? AND o.order_date < ?
    GROUP BY COALESCE(p.id, oi.product_name_raw) ORDER BY bottiglie DESC LIMIT 4
  `).all(start, endExclusive);
  const maxBottiglie = topEtichette.length ? topEtichette[0].bottiglie : 1;

  // Per canale (periodo selezionato)
  const canali = db.prepare(`
    SELECT COALESCE(NULLIF(channel,''),'Non specificato') AS nome, COALESCE(SUM(total_cents),0) AS fatturato
    FROM orders WHERE order_date >= ? AND order_date < ? GROUP BY channel ORDER BY fatturato DESC
  `).all(start, endExclusive);

  // Richiede attenzione
  const attenzione = [];
  const sospesi = db.prepare(`SELECT id, order_number FROM orders WHERE status = 'sospeso' ORDER BY order_date ASC LIMIT 3`).all();
  sospesi.forEach(o => attenzione.push({ testo: `${o.order_number} sospeso`, gravita: 'danger', href: null }));
  const exportDaConfermare = db.prepare(`
    SELECT COUNT(*) AS c FROM orders WHERE status = 'nuovo' AND customer_country IS NOT NULL AND customer_country != '' AND customer_country != 'Italia'
  `).get().c;
  if (exportDaConfermare > 0) attenzione.push({ testo: `${exportDaConfermare} ${exportDaConfermare === 1 ? 'ordine export da confermare' : 'ordini export da confermare'}`, gravita: 'warning', href: null });
  const sottoSoglia = db.prepare(`
    SELECT p.name FROM warehouse_finished wf JOIN products p ON p.id = wf.product_id WHERE wf.below_threshold = 1 LIMIT 3
  `).all();
  sottoSoglia.forEach(p => attenzione.push({ testo: `${p.name} sotto soglia`, gravita: 'warning', href: null }));
  const clientiFermi = db.prepare(`
    SELECT c.name, MAX(o.order_date) AS last_order, CAST(julianday(?) - julianday(MAX(o.order_date)) AS INTEGER) AS days
    FROM customers c JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id HAVING days >= 60 ORDER BY days DESC LIMIT 2
  `).all(today);
  clientiFermi.forEach(c => attenzione.push({ testo: `${c.name} fermo da ${c.days} gg`, gravita: 'neutro', href: null }));

  res.json({
    periodo, aggiornatoAlle: new Date().toISOString(),
    kpi, serieMensile,
    obiettivi: { aree: obiettivi, mesiRestanti: monthsRemaining, totaleRestante: totalRemaining },
    topEtichette: topEtichette.map(t => ({ ...t, pct: Math.round((t.bottiglie / maxBottiglie) * 100) })),
    canali,
    attenzione: attenzione.slice(0, 6),
  });
});

app.get('/api/admin/commercial/stats', authAdmin, (req, res) => {
  const totals = db.prepare('SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenue_cents FROM orders').get();
  const byChannel = db.prepare(`
    SELECT COALESCE(NULLIF(channel,''),'Non specificato') AS channel, COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenue_cents
    FROM orders GROUP BY channel ORDER BY revenue_cents DESC
  `).all();
  const byPriceList = db.prepare(`
    SELECT COALESCE(NULLIF(price_list_name,''),'Non specificato') AS price_list, COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenue_cents
    FROM orders GROUP BY price_list_name ORDER BY revenue_cents DESC
  `).all();
  const topProducts = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name_raw) AS product_name, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
    GROUP BY COALESCE(p.id, oi.product_name_raw) ORDER BY revenue_cents DESC LIMIT 10
  `).all();
  res.json({ totals, byChannel, byPriceList, topProducts });
});

app.get('/api/admin/crm/dashboard', authAdmin, (req, res) => {
  const customers = db.prepare(`
    SELECT c.id, (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order_date FROM customers c
  `).all();
  const customersByStatus = { attivo: 0, semi_attivo: 0, inattivo: 0 };
  customers.forEach(c => { customersByStatus[customerActivityStatus(c.last_order_date)]++; });

  const agentsCount = db.prepare('SELECT COUNT(*) AS c FROM agents WHERE active = 1').get().c;
  const importersCount = db.prepare('SELECT COUNT(*) AS c FROM importers').get().c;
  const suppliersCount = db.prepare('SELECT COUNT(*) AS c FROM suppliers').get().c;
  const openDeals = db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(value_cents),0) AS value_cents FROM crm_deals WHERE stage NOT IN ('vinto','perso')`).get();
  const openTasks = db.prepare(`SELECT COUNT(*) AS c FROM crm_tasks WHERE status = 'aperto'`).get().c;

  res.json({ customersByStatus, agentsCount, importersCount, suppliersCount, openDeals, openTasks });
});

app.get('/api/admin/magazzino/dashboard', authAdmin, (req, res) => {
  const ordersByStatus = {};
  db.prepare(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`).all().forEach(r => { ordersByStatus[r.status] = r.c; });
  const finishedBelowThreshold = db.prepare('SELECT COUNT(*) AS c FROM warehouse_finished WHERE below_threshold = 1').get().c;
  const rawBelowThreshold = db.prepare('SELECT COUNT(*) AS c FROM warehouse_raw WHERE below_threshold = 1').get().c;
  res.json({ ordersByStatus, finishedBelowThreshold, rawBelowThreshold });
});

app.get('/api/admin/produzione/dashboard', authAdmin, (req, res) => {
  const bottlesToProduce = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(p.id, oi.product_name_raw)) AS c
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.production_status != 'completato'
  `).get().c;
  const pendingLines = db.prepare(`SELECT COUNT(*) AS c FROM order_items WHERE production_status != 'completato'`).get().c;
  const topCustomers = db.prepare(`
    SELECT o.customer_name, SUM(oi.quantity) AS quantity
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.production_status != 'completato'
    GROUP BY o.customer_name ORDER BY quantity DESC LIMIT 5
  `).all();
  res.json({ bottlesToProduce, pendingLines, topCustomers });
});

app.get('/api/admin/home/dashboard', authAdmin, (req, res) => {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = now.toISOString().slice(0, 10);

  const revenueMonth = db.prepare(`SELECT COALESCE(SUM(total_cents),0) AS cents FROM orders WHERE order_date >= ?`).get(monthStart);
  const revenueMonthForeign = db.prepare(`
    SELECT COALESCE(SUM(total_cents),0) AS cents FROM orders
    WHERE order_date >= ? AND customer_country IS NOT NULL AND customer_country != '' AND customer_country != 'Italia'
  `).get(monthStart);
  const foreignPct = revenueMonth.cents > 0 ? Math.round((revenueMonthForeign.cents / revenueMonth.cents) * 100) : 0;

  const bottlesShipped = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.production_status = 'completato' AND o.order_date >= ?
  `).get(monthStart).qty;
  const bottlesPlanned = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity),0) AS qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.order_date >= ?
  `).get(monthStart).qty;

  const overdueCredits = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) AS customers, COALESCE(SUM(total_cents),0) AS cents FROM orders
    WHERE payment_status != 'pagato' AND payment_due_date IS NOT NULL AND payment_due_date < ? AND customer_id IS NOT NULL
  `).get(today);

  const decisionOrder = db.prepare(`
    SELECT o.id, o.order_number, o.customer_name, o.warehouse_note, o.payment_due_date,
      CAST(julianday(?) - julianday(o.order_date) AS INTEGER) AS days_open
    FROM orders o WHERE o.status = 'sospeso'
    ORDER BY o.order_date ASC LIMIT 1
  `).get(today);

  const lowStock = db.prepare(`
    SELECT wf.quantity, p.name FROM warehouse_finished wf JOIN products p ON p.id = wf.product_id
    WHERE wf.below_threshold = 1 ORDER BY wf.quantity ASC LIMIT 5
  `).all();

  const upcomingFairs = db.prepare(`
    SELECT id, name, location, start_date, end_date, responsible_name FROM fairs
    WHERE end_date IS NULL OR end_date >= ? ORDER BY start_date ASC LIMIT 5
  `).all(today);

  res.json({
    date: today,
    revenueMonthCents: revenueMonth.cents,
    revenueForeignPct: foreignPct,
    bottlesShipped, bottlesPlanned,
    overdueCredits,
    decisionOrder,
    lowStock,
    upcomingFairs,
  });
});

// ── CRM: agenti ─────────────────────────────────────────────────────────────────
app.get('/api/admin/agents', authAdmin, (req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY name').all();
  res.json(agents.map(agentWithStats));
});

app.get('/api/admin/agents/:id', authAdmin, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente non trovato.' });
  res.json(agentWithStats(agent));
});

const AGENT_EXTENDED_FIELDS = [
  'mobile', 'address', 'city', 'business_province', 'postal_code', 'country',
  'vat_number', 'sdi_code', 'pec', 'iban', 'fiscal_code', 'payment_terms', 'commission_percent',
];

app.post('/api/admin/agents', authAdmin, (req, res) => {
  const { name, email, phone, code, gender, provinces } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome dell\'agente è obbligatorio.' });
  const token = generateAgentToken();
  const username = generateAgentUsername(name);
  const password = generateAgentPassword();
  const passwordHash = hashPassword(password);
  const result = db.prepare('INSERT INTO agents (name, email, phone, code, gender, token, username, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), email?.trim() || null, phone?.trim() || null, code?.trim() || null, gender || null, token, username, passwordHash);
  const agentId = result.lastInsertRowid;
  if (Array.isArray(provinces)) {
    const insertProv = db.prepare('INSERT OR IGNORE INTO agent_provinces (agent_id, province) VALUES (?, ?)');
    for (const p of provinces) insertProv.run(agentId, p);
  }
  const extUpdates = [], extParams = [];
  for (const f of AGENT_EXTENDED_FIELDS) {
    if (req.body[f] !== undefined && req.body[f] !== '') { extUpdates.push(`${f} = ?`); extParams.push(req.body[f]); }
  }
  if (extUpdates.length) { extParams.push(agentId); db.prepare(`UPDATE agents SET ${extUpdates.join(', ')} WHERE id = ?`).run(...extParams); }
  res.json({ success: true, id: agentId, token, username, password });
});

app.patch('/api/admin/agents/:id', authAdmin, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente non trovato.' });

  const fields = ['name', 'email', 'phone', 'code', 'active', 'username', 'gender', ...AGENT_EXTENDED_FIELDS];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  }
  if (updates.length) {
    params.push(req.params.id);
    db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  if (Array.isArray(req.body.provinces)) {
    db.prepare('DELETE FROM agent_provinces WHERE agent_id = ?').run(req.params.id);
    const insertProv = db.prepare('INSERT OR IGNORE INTO agent_provinces (agent_id, province) VALUES (?, ?)');
    for (const p of req.body.provinces) insertProv.run(req.params.id, p);
  }
  res.json({ success: true });
});

app.post('/api/admin/agents/:id/regenerate-password', authAdmin, (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agente non trovato.' });
  const password = generateAgentPassword();
  const username = agent.username || generateAgentUsername(agent.name);
  db.prepare('UPDATE agents SET password_hash = ?, username = ? WHERE id = ?').run(hashPassword(password), username, req.params.id);
  res.json({ success: true, username, password });
});

app.post('/api/admin/agents/:id/regenerate-token', authAdmin, (req, res) => {
  const token = generateAgentToken();
  db.prepare('UPDATE agents SET token = ? WHERE id = ?').run(token, req.params.id);
  res.json({ success: true, token });
});

app.delete('/api/admin/agents/:id', authAdmin, (req, res) => {
  db.prepare('UPDATE customers SET agent_id = NULL WHERE agent_id = ?').run(req.params.id);
  db.prepare('DELETE FROM agent_provinces WHERE agent_id = ?').run(req.params.id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/agents/:id/tracked-customers', authAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.city, c.province, c.country,
      (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order_date,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
      (SELECT COALESCE(SUM(o.total_cents),0) FROM orders o WHERE o.customer_id = c.id) AS revenue_cents
    FROM customers c
    WHERE c.agent_id = ?
    ORDER BY c.name
  `).all(req.params.id);
  res.json(rows.map(r => ({ ...r, status: customerActivityStatus(r.last_order_date) })));
});

// ── CRM: clienti ──────────────────────────────────────────────────────────────
const CUSTOMER_FIELDS = [
  'name', 'email', 'phone', 'address', 'country', 'province', 'agent_id', 'notes',
  'city', 'postal_code', 'zone', 'mobile', 'fax', 'pec', 'sdi_code', 'vat_number',
  'fiscal_code', 'iban', 'payment_terms', 'price_list_id', 'category', 'closing_days', 'delivery_notes',
  'discount_code', 'discount_percent',
  'contact_person', 'contact_person_secondary', 'newsletter_subscribed', 'website',
  'shipping_address', 'shipping_city', 'shipping_province', 'shipping_postal_code', 'shipping_country',
  'estimated_volume_cents', 'source_fair_id',
];

app.get('/api/admin/customers', authAdmin, (req, res) => {
  const { q, agent_id } = req.query;
  let sql = `
    SELECT c.*, a.name AS agent_name, pl.name AS price_list_name,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
      (SELECT COALESCE(SUM(o.total_cents),0) FROM orders o WHERE o.customer_id = c.id) AS revenue_cents
    FROM customers c LEFT JOIN agents a ON a.id = c.agent_id LEFT JOIN price_lists pl ON pl.id = c.price_list_id
    WHERE 1=1`;
  const params = [];
  if (agent_id) { sql += ' AND c.agent_id = ?'; params.push(agent_id); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.email LIKE ? OR c.vat_number LIKE ?)'; const like = `%${q}%`; params.push(like, like, like); }
  sql += ' ORDER BY c.name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/admin/customers', authAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) return res.status(400).json({ error: 'Il nome (ragione sociale) del cliente è obbligatorio.' });
  const cols = [], placeholders = [], values = [];
  for (const f of CUSTOMER_FIELDS) {
    if (body[f] !== undefined && body[f] !== '') {
      cols.push(f); placeholders.push('?');
      values.push(typeof body[f] === 'string' ? body[f].trim() : body[f]);
    }
  }
  const result = db.prepare(`INSERT INTO customers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
  if (body.source_fair_id) addFairEncounterNote('customer', result.lastInsertRowid, body.source_fair_id);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/customers/:id', authAdmin, (req, res) => {
  const updates = [], params = [];
  for (const f of CUSTOMER_FIELDS) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/customers/:id', authAdmin, (req, res) => {
  db.prepare('UPDATE orders SET customer_id = NULL WHERE customer_id = ?').run(req.params.id);
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/customers/:id', authAdmin, (req, res) => {
  const c = db.prepare(`
    SELECT c.*, a.name AS agent_name,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
      (SELECT COALESCE(SUM(o.total_cents),0) FROM orders o WHERE o.customer_id = c.id) AS revenue_cents,
      (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order_date
    FROM customers c LEFT JOIN agents a ON a.id = c.agent_id WHERE c.id = ?
  `).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente non trovato.' });
  c.activity_status = customerActivityStatus(c.last_order_date);
  Object.assign(c, crmSalesStats('customer_id', c.id), crmCounts('customer', c.id));
  res.json(c);
});

// ══════════════════════════════════════════════════════════════════════════════
// Commerciale: Fiere
// ══════════════════════════════════════════════════════════════════════════════
const fairAttachmentsDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname, 'fair-attachments');
fs.mkdirSync(fairAttachmentsDir, { recursive: true });
const uploadFairAttachment = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, fairAttachmentsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.get('/api/admin/fairs', authAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM customers c WHERE c.source_fair_id = f.id) AS customers_count,
      (SELECT COUNT(*) FROM contacts ct WHERE ct.source_fair_id = f.id) AS contacts_count,
      (SELECT COUNT(*) FROM fair_attachments fa WHERE fa.fair_id = f.id) AS attachments_count
    FROM fairs f ORDER BY f.start_date DESC, f.id DESC
  `).all());
});

app.get('/api/admin/fairs/:id', authAdmin, (req, res) => {
  const fair = db.prepare('SELECT * FROM fairs WHERE id = ?').get(req.params.id);
  if (!fair) return res.status(404).json({ error: 'Fiera non trovata.' });
  fair.customers = db.prepare('SELECT id, name, city, province FROM customers WHERE source_fair_id = ? ORDER BY name').all(fair.id);
  fair.contacts = db.prepare(`
    SELECT ct.*,
      CASE ct.entity_type
        WHEN 'customer' THEN (SELECT name FROM customers WHERE id = ct.entity_id)
        WHEN 'agent' THEN (SELECT name FROM agents WHERE id = ct.entity_id)
        WHEN 'importer' THEN (SELECT name FROM importers WHERE id = ct.entity_id)
        WHEN 'supplier' THEN (SELECT name FROM suppliers WHERE id = ct.entity_id)
      END AS entity_name
    FROM contacts ct WHERE ct.source_fair_id = ? ORDER BY ct.name
  `).all(fair.id);
  fair.attachments = db.prepare('SELECT * FROM fair_attachments WHERE fair_id = ? ORDER BY uploaded_at DESC').all(fair.id);
  res.json(fair);
});

app.post('/api/admin/fairs', authAdmin, (req, res) => {
  const { name, location, start_date, end_date, responsible_name, status } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome della fiera è obbligatorio.' });
  const result = db.prepare('INSERT INTO fairs (name, location, start_date, end_date, responsible_name, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), location?.trim() || null, start_date || null, end_date || null, responsible_name?.trim() || null, status || 'pianificata');
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/fairs/:id', authAdmin, (req, res) => {
  const fields = ['name', 'location', 'start_date', 'end_date', 'responsible_name', 'status', 'report_notes'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE fairs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

app.delete('/api/admin/fairs/:id', authAdmin, (req, res) => {
  const attachments = db.prepare('SELECT * FROM fair_attachments WHERE fair_id = ?').all(req.params.id);
  for (const a of attachments) { try { fs.unlinkSync(path.join(fairAttachmentsDir, a.filename)); } catch {} }
  db.prepare('DELETE FROM fair_attachments WHERE fair_id = ?').run(req.params.id);
  db.prepare('UPDATE customers SET source_fair_id = NULL WHERE source_fair_id = ?').run(req.params.id);
  db.prepare('UPDATE contacts SET source_fair_id = NULL WHERE source_fair_id = ?').run(req.params.id);
  db.prepare('DELETE FROM fairs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/fairs/:id/attachments', authAdmin, uploadFairAttachment.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Carica un file.' });
  const result = db.prepare('INSERT INTO fair_attachments (fair_id, filename, original_name) VALUES (?, ?, ?)')
    .run(req.params.id, req.file.filename, req.file.originalname);
  res.json({ success: true, id: result.lastInsertRowid, filename: req.file.filename });
});
app.get('/api/admin/fairs/attachments/:id/download', authAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM fair_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Allegato non trovato.' });
  res.download(path.join(fairAttachmentsDir, a.filename), a.original_name || a.filename);
});
app.get('/api/admin/fairs/attachments/:id/view', authAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM fair_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Allegato non trovato.' });
  res.sendFile(path.join(fairAttachmentsDir, a.filename));
});
app.delete('/api/admin/fairs/attachments/:id', authAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM fair_attachments WHERE id = ?').get(req.params.id);
  if (a) { try { fs.unlinkSync(path.join(fairAttachmentsDir, a.filename)); } catch {} }
  db.prepare('DELETE FROM fair_attachments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRM: Importatori
// ══════════════════════════════════════════════════════════════════════════════
const IMPORTER_FIELDS = [
  'name', 'contact_person', 'contact_person_secondary', 'newsletter_subscribed', 'phone', 'mobile', 'email', 'website',
  'address', 'city', 'province', 'postal_code', 'country',
  'shipping_address', 'shipping_city', 'shipping_province', 'shipping_postal_code', 'shipping_country',
  'discount_code', 'discount_percent', 'payment_terms', 'sdi_code', 'vat_number', 'estimated_volume_cents',
  'agent_id', 'notes', 'iban', 'pec', 'fiscal_code',
];

app.get('/api/admin/importers', authAdmin, (req, res) => {
  const { q } = req.query;
  let sql = `SELECT i.*, a.name AS agent_name FROM importers i LEFT JOIN agents a ON a.id = i.agent_id WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (i.name LIKE ? OR i.email LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
  sql += ' ORDER BY i.name';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/admin/importers/:id', authAdmin, (req, res) => {
  const row = db.prepare('SELECT i.*, a.name AS agent_name FROM importers i LEFT JOIN agents a ON a.id = i.agent_id WHERE i.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Importatore non trovato.' });
  Object.assign(row, crmCounts('importer', row.id));
  res.json(row);
});
app.post('/api/admin/importers', authAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) return res.status(400).json({ error: 'La ragione sociale è obbligatoria.' });
  const cols = [], placeholders = [], values = [];
  for (const f of IMPORTER_FIELDS) {
    if (body[f] !== undefined && body[f] !== '') { cols.push(f); placeholders.push('?'); values.push(typeof body[f] === 'string' ? body[f].trim() : body[f]); }
  }
  const result = db.prepare(`INSERT INTO importers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/importers/:id', authAdmin, (req, res) => {
  const updates = [], params = [];
  for (const f of IMPORTER_FIELDS) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE importers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/importers/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM importers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRM: Fornitori
// ══════════════════════════════════════════════════════════════════════════════
const SUPPLIER_FIELDS = [
  'name', 'contact_person', 'contact_person_secondary', 'newsletter_subscribed', 'phone', 'mobile', 'email', 'website',
  'address', 'city', 'province', 'postal_code', 'country',
  'shipping_address', 'shipping_city', 'shipping_province', 'shipping_postal_code', 'shipping_country',
  'category', 'discount_code', 'discount_percent', 'payment_terms', 'sdi_code', 'vat_number', 'estimated_volume_cents', 'notes',
  'iban', 'pec', 'fiscal_code',
];

app.get('/api/admin/suppliers', authAdmin, (req, res) => {
  const { q } = req.query;
  let sql = `SELECT * FROM suppliers WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR email LIKE ?)'; const like = `%${q}%`; params.push(like, like); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});
app.get('/api/admin/suppliers/:id', authAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Fornitore non trovato.' });
  Object.assign(row, crmCounts('supplier', row.id));
  res.json(row);
});
app.post('/api/admin/suppliers', authAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) return res.status(400).json({ error: 'La ragione sociale è obbligatoria.' });
  const cols = [], placeholders = [], values = [];
  for (const f of SUPPLIER_FIELDS) {
    if (body[f] !== undefined && body[f] !== '') { cols.push(f); placeholders.push('?'); values.push(typeof body[f] === 'string' ? body[f].trim() : body[f]); }
  }
  const result = db.prepare(`INSERT INTO suppliers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/suppliers/:id', authAdmin, (req, res) => {
  const updates = [], params = [];
  for (const f of SUPPLIER_FIELDS) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/suppliers/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// CRM: attività collegate a un record (note, allegati, riunioni, compiti, affari, email)
// ══════════════════════════════════════════════════════════════════════════════
const CRM_ENTITY_TYPES = ['customer', 'agent', 'importer', 'supplier'];
function validEntityType(t) { return CRM_ENTITY_TYPES.includes(t); }

function addFairEncounterNote(entityType, entityId, fairId) {
  const fair = db.prepare('SELECT * FROM fairs WHERE id = ?').get(fairId);
  if (!fair) return;
  const when = fair.start_date ? new Date(fair.start_date + 'T00:00:00').toLocaleDateString('it-IT') : 'data non specificata';
  const body = `Incontrato alla fiera "${fair.name}"${fair.location ? ' a ' + fair.location : ''} (${when}).`;
  db.prepare('INSERT INTO crm_notes (entity_type, entity_id, body) VALUES (?, ?, ?)').run(entityType, entityId, body);
}

const crmAttachmentsDir = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname, 'crm-attachments');
fs.mkdirSync(crmAttachmentsDir, { recursive: true });
const uploadCrmAttachment = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, crmAttachmentsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Note
app.get('/api/admin/crm/:entityType/:entityId/notes', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM crm_notes WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/notes', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  if (!req.body?.body?.trim()) return res.status(400).json({ error: 'La nota non può essere vuota.' });
  const result = db.prepare('INSERT INTO crm_notes (entity_type, entity_id, body) VALUES (?, ?, ?)').run(req.params.entityType, req.params.entityId, req.body.body.trim());
  res.json({ success: true, id: result.lastInsertRowid });
});
app.delete('/api/admin/crm/notes/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM crm_notes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Bottiglie vendute per tipologia (scheda CRM), filtrabile per anno/mese.
// Gli ordini sono collegati solo a clienti e agenti (customer_id/agent_id) — non esiste
// ancora un legame ordine→importatore nel gestionale, quindi per gli importatori si
// risponde con supported:false invece di mostrare un dato falso.
const CRM_SOLD_COLUMN_BY_TYPE = { customer: 'customer_id', agent: 'agent_id' };
app.get('/api/admin/crm/:entityType/:entityId/sold', authAdmin, (req, res) => {
  const { entityType, entityId } = req.params;
  if (!validEntityType(entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const column = CRM_SOLD_COLUMN_BY_TYPE[entityType];
  if (!column) return res.json({ supported: false, rows: [], availableYears: [] });

  const { year, month } = req.query;
  let sql = `
    SELECT COALESCE(p.name, oi.product_name_raw) AS product_name, p.wine_type AS wine_type,
      SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.${column} = ?`;
  const params = [entityId];
  if (year) { sql += ` AND strftime('%Y', o.order_date) = ?`; params.push(String(year)); }
  if (month) { sql += ` AND strftime('%m', o.order_date) = ?`; params.push(String(month).padStart(2, '0')); }
  sql += ' GROUP BY COALESCE(p.id, oi.product_name_raw) ORDER BY quantity DESC';
  const rows = db.prepare(sql).all(...params);

  const availableYears = db.prepare(`SELECT DISTINCT strftime('%Y', o.order_date) AS y FROM orders o WHERE o.${column} = ? AND o.order_date IS NOT NULL ORDER BY y DESC`)
    .all(entityId).map(r => r.y).filter(Boolean);

  res.json({ supported: true, rows, availableYears });
});

// Attività unificata (note + riunioni + compiti + email + ordini) per la scheda CRM
app.get('/api/admin/crm/:entityType/:entityId/activity', authAdmin, (req, res) => {
  const { entityType, entityId } = req.params;
  if (!validEntityType(entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const limit = Math.min(parseInt(req.query.limit) || 12, 50);

  const notes = db.prepare('SELECT id, body, created_at FROM crm_notes WHERE entity_type = ? AND entity_id = ?').all(entityType, entityId)
    .map(n => ({ kind: 'nota', title: 'Nota', detail: n.body, at: n.created_at }));
  const meetings = db.prepare('SELECT id, title, outcome, meeting_date, created_at FROM crm_meetings WHERE entity_type = ? AND entity_id = ?').all(entityType, entityId)
    .map(m => ({ kind: 'riunione', title: m.title, detail: m.outcome || null, at: m.meeting_date || m.created_at }));
  const tasks = db.prepare('SELECT id, title, status, due_date, created_at FROM crm_tasks WHERE entity_type = ? AND entity_id = ?').all(entityType, entityId)
    .map(t => ({ kind: 'compito', title: t.title, detail: t.status === 'chiuso' ? 'Completato' : (t.due_date ? 'Scadenza ' + t.due_date : null), at: t.created_at }));
  const emails = db.prepare('SELECT id, subject, direction, sent_at, created_at FROM crm_emails WHERE entity_type = ? AND entity_id = ?').all(entityType, entityId)
    .map(e => ({ kind: 'email', title: (e.direction === 'in' ? 'Email ricevuta' : 'Email inviata'), detail: e.subject || null, at: e.sent_at || e.created_at }));

  let orders = [];
  const orderColumn = entityType === 'customer' ? 'customer_id' : entityType === 'agent' ? 'agent_id' : null;
  if (orderColumn) {
    orders = db.prepare(`SELECT order_number, order_date, imported_at FROM orders WHERE ${orderColumn} = ? ORDER BY imported_at DESC LIMIT ?`).all(entityId, limit)
      .map(o => ({ kind: 'ordine', title: 'Ordine inserito', detail: o.order_number, at: o.imported_at || o.order_date }));
  }

  const all = [...notes, ...meetings, ...tasks, ...emails, ...orders]
    .filter(a => a.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
  res.json(all);
});

// Contatti (persone collegate all'anagrafica)
app.get('/api/admin/crm/:entityType/:entityId/contacts', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM contacts WHERE entity_type = ? AND entity_id = ? ORDER BY name').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/contacts', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const { name, role, email, phone, mobile, notes, source_fair_id } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome del contatto è obbligatorio.' });
  let finalNotes = notes?.trim() || null;
  if (source_fair_id) {
    const fair = db.prepare('SELECT * FROM fairs WHERE id = ?').get(source_fair_id);
    if (fair) {
      const when = fair.start_date ? new Date(fair.start_date + 'T00:00:00').toLocaleDateString('it-IT') : 'data non specificata';
      const autoNote = `Incontrato alla fiera "${fair.name}"${fair.location ? ' a ' + fair.location : ''} (${when}).`;
      finalNotes = finalNotes ? `${autoNote}\n\n${finalNotes}` : autoNote;
    }
  }
  const result = db.prepare('INSERT INTO contacts (entity_type, entity_id, name, role, email, phone, mobile, notes, source_fair_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.entityType, req.params.entityId, name.trim(), role?.trim() || null, email?.trim() || null, phone?.trim() || null, mobile?.trim() || null, finalNotes, source_fair_id || null);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/crm/contacts/:id', authAdmin, (req, res) => {
  const fields = ['name', 'role', 'email', 'phone', 'mobile', 'notes'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE contacts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/crm/contacts/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Allegati
app.get('/api/admin/crm/:entityType/:entityId/attachments', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM crm_attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/attachments', authAdmin, uploadCrmAttachment.single('file'), (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  if (!req.file) return res.status(400).json({ error: 'Carica un file.' });
  const result = db.prepare('INSERT INTO crm_attachments (entity_type, entity_id, filename, original_name) VALUES (?, ?, ?, ?)')
    .run(req.params.entityType, req.params.entityId, req.file.filename, req.file.originalname);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.get('/api/admin/crm/attachments/:id/download', authAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM crm_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Allegato non trovato.' });
  res.download(path.join(crmAttachmentsDir, a.filename), a.original_name || a.filename);
});
app.delete('/api/admin/crm/attachments/:id', authAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM crm_attachments WHERE id = ?').get(req.params.id);
  if (a) { try { fs.unlinkSync(path.join(crmAttachmentsDir, a.filename)); } catch {} }
  db.prepare('DELETE FROM crm_attachments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Riunioni
app.get('/api/admin/crm/:entityType/:entityId/meetings', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM crm_meetings WHERE entity_type = ? AND entity_id = ? ORDER BY meeting_date DESC').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/meetings', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const { title, meeting_date, participants, outcome, status } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Il titolo è obbligatorio.' });
  const result = db.prepare('INSERT INTO crm_meetings (entity_type, entity_id, title, meeting_date, participants, outcome, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.entityType, req.params.entityId, title.trim(), meeting_date || null, participants?.trim() || null, outcome?.trim() || null, status || 'aperta');
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/crm/meetings/:id', authAdmin, (req, res) => {
  const fields = ['title', 'meeting_date', 'participants', 'outcome', 'status'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE crm_meetings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/crm/meetings/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM crm_meetings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Compiti
app.get('/api/admin/crm/:entityType/:entityId/tasks', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM crm_tasks WHERE entity_type = ? AND entity_id = ? ORDER BY due_date').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/tasks', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const { title, due_date, assignee, status } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Il titolo è obbligatorio.' });
  const result = db.prepare('INSERT INTO crm_tasks (entity_type, entity_id, title, due_date, assignee, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.entityType, req.params.entityId, title.trim(), due_date || null, assignee?.trim() || null, status || 'aperto');
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/crm/tasks/:id', authAdmin, (req, res) => {
  const fields = ['title', 'due_date', 'assignee', 'status'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE crm_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/crm/tasks/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM crm_tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Affari
app.get('/api/admin/crm/:entityType/:entityId/deals', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM crm_deals WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/deals', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const { name, value_cents, stage, expected_close_date, notes } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome dell\'affare è obbligatorio.' });
  const result = db.prepare('INSERT INTO crm_deals (entity_type, entity_id, name, value_cents, stage, expected_close_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.entityType, req.params.entityId, name.trim(), parseInt(value_cents) || 0, stage || 'nuovo', expected_close_date || null, notes?.trim() || null);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/crm/deals/:id', authAdmin, (req, res) => {
  const fields = ['name', 'value_cents', 'stage', 'expected_close_date', 'notes'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE crm_deals SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/crm/deals/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM crm_deals WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Email (log manuale, nessuna sincronizzazione automatica)
app.get('/api/admin/crm/:entityType/:entityId/emails', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  res.json(db.prepare('SELECT * FROM crm_emails WHERE entity_type = ? AND entity_id = ? ORDER BY sent_at DESC, created_at DESC').all(req.params.entityType, req.params.entityId));
});
app.post('/api/admin/crm/:entityType/:entityId/emails', authAdmin, (req, res) => {
  if (!validEntityType(req.params.entityType)) return res.status(400).json({ error: 'Tipo non valido.' });
  const { subject, direction, counterparty, sent_at, body } = req.body || {};
  if (!subject?.trim()) return res.status(400).json({ error: 'L\'oggetto è obbligatorio.' });
  const result = db.prepare('INSERT INTO crm_emails (entity_type, entity_id, subject, direction, counterparty, sent_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.entityType, req.params.entityId, subject.trim(), direction || 'out', counterparty?.trim() || null, sent_at || null, body?.trim() || null);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.delete('/api/admin/crm/emails/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM crm_emails WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// Portale agenti — accesso con username e password
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/agent/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Inserisci username e password.' });
  const agent = db.prepare('SELECT * FROM agents WHERE username = ? AND active = 1').get(username.trim());
  if (!agent || !verifyPassword(password, agent.password_hash)) {
    return res.status(401).json({ error: 'Credenziali non valide.' });
  }
  res.json({ success: true, token: agent.token });
});

app.get('/api/agent/:token', authAgent, (req, res) => {
  res.json(agentWithStats(req.agent));
});

app.get('/api/agent/:token/customers', authAgent, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM customers WHERE agent_id = ?';
  const params = [req.agent.id];
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/agent/:token/customers', authAgent, (req, res) => {
  const body = req.body || {};
  if (!body.name?.trim()) return res.status(400).json({ error: 'Il nome (ragione sociale) del cliente è obbligatorio.' });
  const agentFields = ['name', 'email', 'phone', 'mobile', 'address', 'country', 'province', 'city', 'postal_code', 'zone', 'vat_number', 'fiscal_code', 'pec', 'notes', 'discount_code', 'discount_percent'];
  const cols = ['agent_id'], placeholders = ['?'], values = [req.agent.id];
  for (const f of agentFields) {
    if (body[f] !== undefined && body[f] !== '') {
      cols.push(f); placeholders.push('?');
      values.push(typeof body[f] === 'string' ? body[f].trim() : body[f]);
    }
  }
  const result = db.prepare(`INSERT INTO customers (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`).run(...values);
  res.json({ success: true, id: result.lastInsertRowid });
});

app.get('/api/agent/:token/products', authAgent, (req, res) => {
  res.json(db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name').all());
});

app.get('/api/agent/:token/price-lists', authAgent, (req, res) => {
  const lists = db.prepare('SELECT * FROM price_lists WHERE active = 1 ORDER BY name').all();
  const items = db.prepare('SELECT * FROM price_list_items').all();
  res.json(lists.map(l => ({ ...l, items: items.filter(i => i.price_list_id === l.id) })));
});

app.get('/api/agent/:token/orders', authAgent, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE agent_id = ? ORDER BY order_date DESC, id DESC').all(req.agent.id);
  const itemCount = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(quantity),0) AS q FROM order_items WHERE order_id = ?');
  res.json(orders.map(o => ({ ...o, ...itemCount.get(o.id) })));
});

app.post('/api/agent/:token/orders', authAgent, (req, res) => {
  const { customer_id, new_customer, order_date, delivery_date, causale, billing_customer_id, price_list_name, items, notes } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Aggiungi almeno un articolo all\'ordine.' });

  let customer = null;
  if (customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ? AND agent_id = ?').get(customer_id, req.agent.id);
    if (!customer) return res.status(404).json({ error: 'Cliente non trovato.' });
  } else if (new_customer?.name?.trim()) {
    const result = db.prepare(`
      INSERT INTO customers (name, email, phone, address, country, province, vat_number, pec, agent_id, discount_code, discount_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(new_customer.name.trim(), new_customer.email?.trim() || null, new_customer.phone?.trim() || null,
           new_customer.address?.trim() || null, new_customer.country?.trim() || null, new_customer.province?.trim() || null,
           new_customer.vat_number?.trim() || null, new_customer.pec?.trim() || null, req.agent.id,
           new_customer.discount_code?.trim() || null, parseFloat(new_customer.discount_percent) || 0);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  } else {
    return res.status(400).json({ error: 'Seleziona o crea un cliente.' });
  }

  // Il cliente di fatturazione, se non specificato, coincide con il cliente ordinante.
  let billingCustomerId = customer.id;
  if (billing_customer_id) {
    const billingCustomer = db.prepare('SELECT id FROM customers WHERE id = ? AND agent_id = ?').get(billing_customer_id, req.agent.id);
    if (billingCustomer) billingCustomerId = billingCustomer.id;
  }

  const orderNumber = `AG-${req.agent.id}-${Date.now()}`;
  const subtotal = items.reduce((s, i) => s + (parseInt(i.quantity) || 0) * (parseInt(i.unit_price_cents) || 0), 0);
  const discountPercent = customer.discount_percent || 0;
  const discountCents = Math.round(subtotal * (discountPercent / 100));
  const total = subtotal - discountCents;
  const orderDate = order_date || new Date().toISOString().slice(0, 10);
  const termsDays = parsePaymentTermsDays(customer.payment_terms);
  let paymentDueDate = null;
  if (termsDays != null) {
    const due = new Date(orderDate + 'T00:00:00');
    due.setDate(due.getDate() + termsDays);
    paymentDueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  }

  const result = db.prepare(`
    INSERT INTO orders (order_number, customer_name, customer_country, channel, price_list_name, order_date, delivery_date, causale, total_cents, discount_percent, discount_cents, payment_due_date, source, customer_id, billing_customer_id, agent_id)
    VALUES (?, ?, ?, 'Agente', ?, ?, ?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?)
  `).run(orderNumber, customer.name, customer.country, price_list_name || null,
         orderDate, delivery_date || null, causale || 'ORDCLI',
         total, discountPercent, discountCents, paymentDueDate, customer.id, billingCustomerId, req.agent.id);

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, product_name_raw, label_variant, quantity, unit_price_cents)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    const product = item.product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) : null;
    insertItem.run(result.lastInsertRowid, item.product_id || null, product?.name || item.product_name_raw || 'Prodotto',
                    item.label_variant?.trim() || null, parseInt(item.quantity) || 1, parseInt(item.unit_price_cents) || 0);
  }

  res.json({ success: true, order_id: result.lastInsertRowid, order_number: orderNumber });
});

// ── News (Commerciale e portale agenti, contenuto condiviso) ─────────────────
app.get('/api/admin/news', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM news ORDER BY created_at DESC').all());
});
app.post('/api/admin/news', authAdmin, (req, res) => {
  const { title, body } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Il titolo è obbligatorio.' });
  const result = db.prepare('INSERT INTO news (title, body) VALUES (?, ?)').run(title.trim(), body?.trim() || null);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/news/:id', authAdmin, (req, res) => {
  const fields = ['title', 'body', 'active'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE news SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/news/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM news WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Cataloghi PDF (Commerciale e portale agenti, contenuto condiviso) ────────
app.get('/api/admin/catalogs', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM catalogs ORDER BY created_at DESC').all());
});
app.post('/api/admin/catalogs', authAdmin, uploadCatalog.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Carica un file PDF.' });
  const name = req.body.name?.trim() || req.file.originalname.replace(/\.pdf$/i, '');
  const result = db.prepare('INSERT INTO catalogs (name, filename) VALUES (?, ?)').run(name, req.file.filename);
  res.json({ success: true, id: result.lastInsertRowid });
});
app.delete('/api/admin/catalogs/:id', authAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM catalogs WHERE id = ?').get(req.params.id);
  if (cat) { try { fs.unlinkSync(path.join(catalogsDir, cat.filename)); } catch {} }
  db.prepare('DELETE FROM catalogs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});
app.get('/api/catalogs/:id/download', (req, res) => {
  const cat = db.prepare('SELECT * FROM catalogs WHERE id = ? AND active = 1').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Catalogo non trovato.' });
  res.download(path.join(catalogsDir, cat.filename), `${cat.name}.pdf`);
});

// ── Pagamenti ordini (admin) ──────────────────────────────────────────────────
app.patch('/api/admin/orders/:id/payment', authAdmin, (req, res) => {
  const { payment_status, payment_due_date } = req.body || {};
  const updates = [], params = [];
  if (payment_status !== undefined) {
    updates.push('payment_status = ?'); params.push(payment_status);
    updates.push('paid_at = ?'); params.push(payment_status === 'pagato' ? new Date().toISOString() : null);
  }
  if (payment_due_date !== undefined) { updates.push('payment_due_date = ?'); params.push(payment_due_date || null); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// ── Portale agenti: news, cataloghi, recupero crediti, venduto ───────────────
app.get('/api/agent/:token/news', authAgent, (req, res) => {
  res.json(db.prepare('SELECT id, title, body, created_at FROM news WHERE active = 1 ORDER BY created_at DESC').all());
});

app.get('/api/agent/:token/catalogs', authAgent, (req, res) => {
  res.json(db.prepare('SELECT id, name, created_at FROM catalogs WHERE active = 1 ORDER BY created_at DESC').all());
});

app.get('/api/agent/:token/credit-recovery', authAgent, (req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.order_number, o.order_date, o.payment_due_date, o.total_cents, o.customer_name, c.phone, c.email
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.agent_id = ? AND o.payment_status != 'pagato'
    ORDER BY (o.payment_due_date IS NULL), o.payment_due_date ASC
  `).all(req.agent.id);
  const today = new Date().toISOString().slice(0, 10);
  res.json(rows.map(r => ({ ...r, overdue: !!(r.payment_due_date && r.payment_due_date < today) })));
});

app.get('/api/agent/:token/sold', authAgent, (req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name_raw) AS product_name, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price_cents) AS revenue_cents
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.agent_id = ?
    GROUP BY COALESCE(p.name, oi.product_name_raw)
    ORDER BY revenue_cents DESC
  `).all(req.agent.id);
  res.json(rows);
});

app.get('/api/agent/:token/dashboard', authAgent, (req, res) => {
  const byMonth = db.prepare(`
    SELECT substr(order_date,1,7) AS month, COUNT(*) AS orderCount, SUM(total_cents) AS revenueCents
    FROM orders WHERE agent_id = ? GROUP BY month ORDER BY month DESC LIMIT 12
  `).all(req.agent.id);
  const topCustomers = db.prepare(`
    SELECT customer_name, COUNT(*) AS orderCount, SUM(total_cents) AS revenueCents
    FROM orders WHERE agent_id = ? GROUP BY customer_id ORDER BY revenueCents DESC LIMIT 5
  `).all(req.agent.id);
  res.json({ byMonth, topCustomers });
});

// ── Utenti del portale interno ────────────────────────────────────────────────
function generatePortalAccessKey() {
  return crypto.randomBytes(24).toString('hex');
}

app.get('/api/admin/portal-users', authAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT pu.id, pu.name, pu.email, pu.username, pu.active, pu.created_at, pu.role_id, r.name AS role_name
    FROM portal_users pu LEFT JOIN roles r ON r.id = pu.role_id ORDER BY pu.name
  `).all());
});

app.post('/api/admin/portal-users', authAdmin, (req, res) => {
  const { name, email, username, password, role_id } = req.body || {};
  if (!name?.trim() || !email?.trim() || !username?.trim() || !password) {
    return res.status(400).json({ error: 'Nome, email, username e password sono obbligatori.' });
  }
  try {
    const result = db.prepare('INSERT INTO portal_users (name, email, username, password_hash, access_key, role_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), username.trim(), hashPassword(password), generatePortalAccessKey(), role_id || null);
    syncOperatorForPortalUser(db.prepare('SELECT * FROM portal_users WHERE id = ?').get(result.lastInsertRowid));
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Username o email già in uso.' });
  }
});

app.patch('/api/admin/portal-users/:id', authAdmin, (req, res) => {
  const fields = ['name', 'email', 'username', 'active', 'role_id'];
  const updates = [], params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f] === '' ? null : req.body[f]); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  try {
    db.prepare(`UPDATE portal_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    syncOperatorForPortalUser(db.prepare('SELECT * FROM portal_users WHERE id = ?').get(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Username o email già in uso.' });
  }
});

app.delete('/api/admin/portal-users/:id', authAdmin, (req, res) => {
  deactivateOperatorForPortalUser(req.params.id);
  db.prepare('DELETE FROM portal_users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Ruoli e permessi ──────────────────────────────────────────────────────────
app.get('/api/admin/roles', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM roles ORDER BY name').all().map(r => ({ ...r, workspaces: JSON.parse(r.workspaces) })));
});
app.post('/api/admin/roles', authAdmin, (req, res) => {
  const { name, workspaces } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome del ruolo è obbligatorio.' });
  const ws = Array.isArray(workspaces) ? workspaces.filter(w => ALL_WORKSPACES.includes(w)) : [];
  const result = db.prepare('INSERT INTO roles (name, workspaces) VALUES (?, ?)').run(name.trim(), JSON.stringify(ws));
  res.json({ success: true, id: result.lastInsertRowid });
});
app.patch('/api/admin/roles/:id', authAdmin, (req, res) => {
  const { name, workspaces } = req.body || {};
  const updates = [], params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (workspaces !== undefined) {
    const ws = Array.isArray(workspaces) ? workspaces.filter(w => ALL_WORKSPACES.includes(w)) : [];
    updates.push('workspaces = ?'); params.push(JSON.stringify(ws));
  }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.params.id);
  db.prepare(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});
app.delete('/api/admin/roles/:id', authAdmin, (req, res) => {
  db.prepare('UPDATE portal_users SET role_id = NULL WHERE role_id = ?').run(req.params.id);
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/me', authAdmin, (req, res) => {
  const permittedWorkspaces = permittedWorkspacesFor(req);
  res.json({
    isMaster: !!req.isMasterKey,
    name: req.portalUser?.name || (req.isMasterKey ? 'Amministratore' : null),
    roleName: req.portalUser?.role_id ? db.prepare('SELECT name FROM roles WHERE id = ?').get(req.portalUser.role_id)?.name : null,
    permittedWorkspaces, // null = accesso completo a tutti i workspace
  });
});

app.get('/api/admin/my-profile', authAdmin, (req, res) => {
  if (req.isMasterKey) return res.json({ isMaster: true });
  const { name, email, username } = req.portalUser;
  res.json({ isMaster: false, name, email, username });
});

app.patch('/api/admin/my-profile', authAdmin, (req, res) => {
  if (req.isMasterKey) return res.status(400).json({ error: 'La chiave amministratore non è un account personale.' });
  const { name, email, username } = req.body || {};
  const updates = [], params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (email !== undefined) { updates.push('email = ?'); params.push(email.trim().toLowerCase()); }
  if (username !== undefined) { updates.push('username = ?'); params.push(username.trim()); }
  if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });
  params.push(req.portalUser.id);
  try {
    db.prepare(`UPDATE portal_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Username o email già in uso.' });
  }
});

app.post('/api/admin/my-profile/password', authAdmin, (req, res) => {
  if (req.isMasterKey) return res.status(400).json({ error: 'La chiave amministratore non è un account personale.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Inserisci la password attuale e quella nuova.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'La nuova password deve avere almeno 6 caratteri.' });
  if (!verifyPassword(currentPassword, req.portalUser.password_hash)) return res.status(400).json({ error: 'Password attuale non corretta.' });
  db.prepare('UPDATE portal_users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.portalUser.id);
  res.json({ success: true });
});

app.post('/api/portal-users/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Inserisci username e password.' });
  const user = db.prepare('SELECT * FROM portal_users WHERE username = ? AND active = 1').get(username.trim());
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Credenziali non valide.' });
  res.json({ success: true, key: user.access_key });
});

app.post('/api/portal-users/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email?.trim()) return res.status(400).json({ error: 'Inserisci la tua email.' });
  const user = db.prepare('SELECT * FROM portal_users WHERE email = ? AND active = 1').get(email.trim().toLowerCase());
  if (user) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE portal_users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);
    const resetUrl = `${req.protocol}://${req.get('host')}/admin.html?reset=${token}`;
    try {
      await sendMail({
        to: user.email,
        subject: `Reimposta la tua password — ${CANTINA_NAME}`,
        html: `<p>Ciao ${user.name},</p><p>Hai richiesto di reimpostare la password per il portale interno ${CANTINA_NAME}.</p><p><a href="${resetUrl}">Clicca qui per impostare una nuova password</a> (valido 1 ora).</p><p>Se non hai richiesto tu questa modifica, ignora questa email.</p>`,
      });
    } catch (e) { console.error('Errore invio email reset password:', e.message); }
  }
  res.json({ success: true });
});

app.post('/api/portal-users/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Richiesta non valida.' });
  const user = db.prepare('SELECT * FROM portal_users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expires || new Date(user.reset_expires) < new Date()) {
    return res.status(400).json({ error: 'Link scaduto o non valido. Richiedine uno nuovo.' });
  }
  db.prepare('UPDATE portal_users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hashPassword(password), user.id);
  res.json({ success: true });
});

// ── Produzione ─────────────────────────────────────────────────────────────────
app.get('/api/admin/production/summary', authAdmin, (req, res) => {
  const { from, to, status } = req.query;
  let where = '1=1';
  const params = [];
  if (from) { where += ' AND o.order_date >= ?'; params.push(from); }
  if (to)   { where += ' AND o.order_date <= ?'; params.push(to); }
  if (status && status !== 'all') { where += ' AND oi.production_status = ?'; params.push(status); }

  const byProduct = db.prepare(`
    SELECT COALESCE(p.name, oi.product_name_raw) AS product_name, oi.label_variant,
           SUM(oi.quantity) AS quantity, COUNT(DISTINCT o.id) AS orders
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE ${where}
    GROUP BY COALESCE(p.id, oi.product_name_raw), oi.label_variant
    ORDER BY quantity DESC
  `).all(...params);

  const byCustomer = db.prepare(`
    SELECT o.customer_name, COALESCE(p.name, oi.product_name_raw) AS product_name, oi.label_variant,
           SUM(oi.quantity) AS quantity
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE ${where}
    GROUP BY o.customer_name, COALESCE(p.id, oi.product_name_raw), oi.label_variant
    ORDER BY o.customer_name, quantity DESC
  `).all(...params);

  res.json({ byProduct, byCustomer });
});

app.get('/api/admin/production/items', authAdmin, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT oi.*, o.order_number, o.customer_name, o.customer_country, o.order_date,
           COALESCE(p.name, oi.product_name_raw) AS product_name
    FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
    WHERE 1=1`;
  const params = [];
  if (status && status !== 'all') { sql += ' AND oi.production_status = ?'; params.push(status); }
  sql += ' ORDER BY o.order_date DESC';
  res.json(db.prepare(sql).all(...params));
});

app.patch('/api/admin/production/items/:id', authAdmin, (req, res) => {
  const { production_status } = req.body || {};
  if (!['da_produrre', 'in_produzione', 'completato'].includes(production_status)) {
    return res.status(400).json({ error: 'Stato non valido.' });
  }
  db.prepare('UPDATE order_items SET production_status = ? WHERE id = ?').run(production_status, req.params.id);
  res.json({ success: true });
});

// ── Magazzino: prodotti finiti ─────────────────────────────────────────────────
app.get('/api/admin/warehouse/finished', authAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT wf.*, p.name AS product_name, p.sku FROM warehouse_finished wf JOIN products p ON p.id = wf.product_id
    ORDER BY p.name
  `).all());
});

app.post('/api/admin/warehouse/finished', authAdmin, async (req, res) => {
  const { product_id, quantity, threshold, alert_email } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Prodotto non trovato.' });
  try {
    const result = db.prepare(`
      INSERT INTO warehouse_finished (product_id, quantity, threshold, alert_email) VALUES (?, ?, ?, ?)
    `).run(product_id, parseInt(quantity) || 0, parseInt(threshold) || 0, alert_email?.trim() || null);
    await checkStockThreshold({
      table: 'warehouse_finished', id: result.lastInsertRowid, name: product.name,
      quantity: parseInt(quantity) || 0, threshold: parseInt(threshold) || 0,
      alertEmail: alert_email?.trim() || null, defaultEmailKey: 'commercial_alert_email', kind: 'finished',
    });
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ error: 'Prodotto già presente in magazzino.' });
  }
});

app.patch('/api/admin/warehouse/finished/:id', authAdmin, async (req, res) => {
  const row = db.prepare(`
    SELECT wf.*, p.name AS product_name FROM warehouse_finished wf JOIN products p ON p.id = wf.product_id WHERE wf.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Voce di magazzino non trovata.' });

  const quantity = req.body.quantity !== undefined ? parseInt(req.body.quantity) : row.quantity;
  const threshold = req.body.threshold !== undefined ? parseInt(req.body.threshold) : row.threshold;
  const alertEmail = req.body.alert_email !== undefined ? (req.body.alert_email?.trim() || null) : row.alert_email;

  db.prepare('UPDATE warehouse_finished SET quantity = ?, threshold = ?, alert_email = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
    .run(quantity, threshold, alertEmail, row.id);

  await checkStockThreshold({
    table: 'warehouse_finished', id: row.id, name: row.product_name, quantity, threshold,
    alertEmail, defaultEmailKey: 'commercial_alert_email', kind: 'finished',
  });
  res.json({ success: true });
});

app.delete('/api/admin/warehouse/finished/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM warehouse_finished WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Magazzino: materie prime ───────────────────────────────────────────────────
app.get('/api/admin/warehouse/raw', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM warehouse_raw ORDER BY name').all());
});

app.post('/api/admin/warehouse/raw', authAdmin, async (req, res) => {
  const { sku, name, unit, quantity, threshold, alert_email } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Il nome della referenza è obbligatorio.' });
  const result = db.prepare(`
    INSERT INTO warehouse_raw (sku, name, unit, quantity, threshold, alert_email) VALUES (?, ?, ?, ?, ?, ?)
  `).run(sku?.trim() || null, name.trim(), unit?.trim() || 'pz', parseInt(quantity) || 0, parseInt(threshold) || 0, alert_email?.trim() || null);
  await checkStockThreshold({
    table: 'warehouse_raw', id: result.lastInsertRowid, name: name.trim(),
    quantity: parseInt(quantity) || 0, threshold: parseInt(threshold) || 0,
    alertEmail: alert_email?.trim() || null, defaultEmailKey: 'procurement_alert_email', kind: 'raw',
  });
  res.json({ success: true, id: result.lastInsertRowid });
});

app.patch('/api/admin/warehouse/raw/:id', authAdmin, async (req, res) => {
  const row = db.prepare('SELECT * FROM warehouse_raw WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Referenza non trovata.' });

  const fields = ['sku', 'name', 'unit'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  const quantity = req.body.quantity !== undefined ? parseInt(req.body.quantity) : row.quantity;
  const threshold = req.body.threshold !== undefined ? parseInt(req.body.threshold) : row.threshold;
  const alertEmail = req.body.alert_email !== undefined ? (req.body.alert_email?.trim() || null) : row.alert_email;
  updates.push('quantity = ?', 'threshold = ?', 'alert_email = ?', "updated_at = datetime('now','localtime')");
  params.push(quantity, threshold, alertEmail, req.params.id);

  db.prepare(`UPDATE warehouse_raw SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  await checkStockThreshold({
    table: 'warehouse_raw', id: row.id, name: req.body.name || row.name, quantity, threshold,
    alertEmail, defaultEmailKey: 'procurement_alert_email', kind: 'raw',
  });
  res.json({ success: true });
});

app.delete('/api/admin/warehouse/raw/:id', authAdmin, (req, res) => {
  db.prepare('DELETE FROM warehouse_raw WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🍷 ${CANTINA_NAME}  →  http://localhost:${PORT}`);
  console.log(`   Admin panel      →  http://localhost:${PORT}/admin.html?key=${ADMIN_PASSWORD}`);
  console.log(`   Stripe           →  ${stripe ? '✓ configurato' : '✗ non configurato (modalità richiesta di prenotazione)'}`);
  const emailProvider = gmailTransporter ? `✓ Gmail (${process.env.GMAIL_USER})` : resend ? '✓ Resend' : '✗ Nessun provider email';
  console.log(`   Email            →  ${emailProvider}\n`);
});
