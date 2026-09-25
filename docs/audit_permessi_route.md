# Audit permessi — Appendice A: inventario completo delle route

Generato il 25/09/2026 dall'introspezione di `app._router.stack` (server.js + modules/), non da grep.
Colonne: metodo · path · middleware · workspace richiesti oggi da `lib/security.js` (`*` = chiunque abbia una sessione) · note.
In tutte le righe con `authAdmin` la chiave master e gli utenti **senza ruolo** passano sempre (accesso completo).

| # | Metodo | Path | Middleware | Workspace oggi | Note |
|---|---|---|---|---|---|
| 1 | POST | `/api/webhook` | rawParser | — | firma Stripe |
| 2 | GET | `/api/config` | - | — | pubblico (sito) |
| 3 | GET | `/api/experiences` | - | — | pubblico (sito) |
| 4 | GET | `/api/experiences/:id/slots` | - | — | pubblico (sito) |
| 5 | POST | `/api/discount/validate` | - | — | pubblico (sito) |
| 6 | POST | `/api/create-checkout-session` | - | — | pubblico (sito) |
| 7 | GET | `/api/shop-products` | - | — | pubblico (sito) |
| 8 | POST | `/api/create-pickup-checkout-session` | - | — | pubblico (sito) |
| 9 | GET | `/api/pickup-orders/verify/:token` | - | — | pubblico (sito) |
| 10 | POST | `/api/pickup-orders/verify/:token/pickup` | - | — | 🟠 solo token QR: chi ha il link segna il ritiro e scarica il magazzino |
| 11 | GET | `/api/reviews` | - | — | pubblico (sito) |
| 12 | POST | `/api/reviews` | - | — | pubblico (sito) |
| 13 | POST | `/api/newsletter` | - | — | pubblico (sito) |
| 14 | GET | `/api/admin/stats` | authAdmin | enoturismo |  |
| 15 | GET | `/api/admin/experiences` | authAdmin | enoturismo |  |
| 16 | GET | `/api/admin/experiences/:id` | authAdmin | enoturismo |  |
| 17 | POST | `/api/admin/experiences` | authAdmin+multerMiddleware | enoturismo | upload |
| 18 | PATCH | `/api/admin/experiences/:id` | authAdmin+multerMiddleware | enoturismo | upload |
| 19 | DELETE | `/api/admin/experiences/:id` | authAdmin | enoturismo |  |
| 20 | POST | `/api/admin/experiences/:id/images` | authAdmin+multerMiddleware | enoturismo | upload |
| 21 | DELETE | `/api/admin/experiences/:id/images/:imageId` | authAdmin | enoturismo |  |
| 22 | PUT | `/api/admin/experiences/:id/products` | authAdmin | enoturismo |  |
| 23 | GET | `/api/admin/experiences/:id/availability` | authAdmin | enoturismo |  |
| 24 | PUT | `/api/admin/experiences/:id/availability` | authAdmin | enoturismo |  |
| 25 | GET | `/api/admin/slots` | authAdmin | enoturismo |  |
| 26 | POST | `/api/admin/slots` | authAdmin | enoturismo |  |
| 27 | POST | `/api/admin/slots/bulk` | authAdmin | enoturismo |  |
| 28 | PATCH | `/api/admin/slots/:id` | authAdmin | enoturismo |  |
| 29 | DELETE | `/api/admin/slots/:id` | authAdmin | enoturismo |  |
| 30 | GET | `/api/admin/bookings` | authAdmin | enoturismo |  |
| 31 | POST | `/api/admin/bookings/manual` | authAdmin | enoturismo |  |
| 32 | PATCH | `/api/admin/bookings/:id` | authAdmin | enoturismo |  |
| 33 | POST | `/api/admin/bookings/confirm/:id` | authAdmin | enoturismo |  |
| 34 | POST | `/api/admin/bookings/reject/:id` | authAdmin | enoturismo |  |
| 35 | POST | `/api/admin/bookings/checkin/:id` | authAdmin | enoturismo |  |
| 36 | DELETE | `/api/admin/bookings/:id` | authAdmin | enoturismo |  |
| 37 | GET | `/api/admin/export` | authAdmin | enoturismo |  |
| 38 | POST | `/api/admin/sync-payments` | authAdmin | enoturismo |  |
| 39 | GET | `/api/admin/discount-codes` | authAdmin | enoturismo |  |
| 40 | POST | `/api/admin/discount-codes` | authAdmin | enoturismo |  |
| 41 | PATCH | `/api/admin/discount-codes/:id` | authAdmin | enoturismo |  |
| 42 | DELETE | `/api/admin/discount-codes/:id` | authAdmin | enoturismo |  |
| 43 | GET | `/api/admin/reviews` | authAdmin | enoturismo |  |
| 44 | PATCH | `/api/admin/reviews/:id` | authAdmin | enoturismo |  |
| 45 | DELETE | `/api/admin/reviews/:id` | authAdmin | enoturismo |  |
| 46 | GET | `/api/admin/newsletter` | authAdmin | enoturismo |  |
| 47 | GET | `/api/admin/newsletter/export` | authAdmin | enoturismo |  |
| 48 | DELETE | `/api/admin/newsletter/:id` | authAdmin | enoturismo |  |
| 49 | GET | `/api/admin/operators` | authAdmin | enoturismo |  |
| 50 | GET | `/api/admin/venue-events` | authAdmin | enoturismo |  |
| 51 | GET | `/api/admin/venue-events/:id` | authAdmin | enoturismo |  |
| 52 | POST | `/api/admin/venue-events` | authAdmin | enoturismo |  |
| 53 | PATCH | `/api/admin/venue-events/:id` | authAdmin | enoturismo |  |
| 54 | DELETE | `/api/admin/venue-events/:id` | authAdmin | enoturismo |  |
| 55 | GET | `/api/admin/venue-events/conflicts/:date` | authAdmin | enoturismo |  |
| 56 | GET | `/api/admin/shop-sales` | authAdmin | enoturismo |  |
| 57 | GET | `/api/admin/shop-sales/:id` | authAdmin | enoturismo |  |
| 58 | POST | `/api/admin/shop-sales` | authAdmin | enoturismo |  |
| 59 | DELETE | `/api/admin/shop-sales/:id` | authAdmin | enoturismo |  |
| 60 | GET | `/api/admin/pickup-orders` | authAdmin | enoturismo |  |
| 61 | GET | `/api/admin/pickup-orders/:id` | authAdmin | enoturismo |  |
| 62 | POST | `/api/admin/pickup-orders/:id/pickup` | authAdmin | enoturismo |  |
| 63 | DELETE | `/api/admin/pickup-orders/:id` | authAdmin | enoturismo |  |
| 64 | GET | `/api/admin/settings` | authAdmin | * |  |
| 65 | GET | `/api/admin/dashboard-widgets` | authAdmin | * |  |
| 66 | POST | `/api/admin/dashboard-widgets` | authAdmin | impostazioni |  |
| 67 | POST | `/api/admin/settings` | authAdmin | impostazioni |  |
| 68 | GET | `/api/admin/option-lists` | authAdmin | * |  |
| 69 | PUT | `/api/admin/option-lists/:name` | authAdmin | impostazioni |  |
| 70 | GET | `/api/admin/wine-club/rule` | authAdmin | impostazioni |  |
| 71 | PUT | `/api/admin/wine-club/rule` | authAdmin | impostazioni |  |
| 72 | POST | `/api/admin/wine-club/apply` | authAdmin | impostazioni |  |
| 73 | GET | `/api/admin/products` | authAdmin | commerciale, magazzino, produzione, enoturismo, crm |  |
| 74 | POST | `/api/admin/products` | authAdmin+multerMiddleware | commerciale | upload |
| 75 | PATCH | `/api/admin/products/:id` | authAdmin+multerMiddleware | commerciale | upload |
| 76 | DELETE | `/api/admin/products/:id` | authAdmin | commerciale |  |
| 77 | GET | `/api/admin/price-lists` | authAdmin | commerciale, crm, enoturismo |  |
| 78 | POST | `/api/admin/price-lists` | authAdmin | commerciale |  |
| 79 | PATCH | `/api/admin/price-lists/:id` | authAdmin | commerciale |  |
| 80 | DELETE | `/api/admin/price-lists/:id` | authAdmin | commerciale |  |
| 81 | POST | `/api/admin/price-lists/:id/items` | authAdmin | commerciale |  |
| 82 | DELETE | `/api/admin/price-lists/:id/items/:productId` | authAdmin | commerciale |  |
| 83 | GET | `/api/admin/orders` | authAdmin | commerciale, magazzino, produzione, crm |  |
| 84 | GET | `/api/admin/orders/:id` | authAdmin | commerciale, magazzino, produzione, crm |  |
| 85 | PATCH | `/api/admin/orders/:id` | authAdmin | commerciale, magazzino |  |
| 86 | DELETE | `/api/admin/orders/:id` | authAdmin | commerciale, magazzino |  |
| 87 | POST | `/api/admin/orders/import` | authAdmin+multerMiddleware | commerciale, magazzino | upload |
| 88 | GET | `/api/admin/sales-target-areas` | authAdmin | commerciale, impostazioni |  |
| 89 | POST | `/api/admin/sales-target-areas` | authAdmin | commerciale, impostazioni |  |
| 90 | PATCH | `/api/admin/sales-target-areas/:id` | authAdmin | commerciale, impostazioni |  |
| 91 | DELETE | `/api/admin/sales-target-areas/:id` | authAdmin | commerciale, impostazioni |  |
| 92 | GET | `/api/admin/sales-targets/years` | authAdmin | commerciale |  |
| 93 | GET | `/api/admin/sales-targets/:year` | authAdmin | commerciale |  |
| 94 | PUT | `/api/admin/sales-targets/:year` | authAdmin | commerciale |  |
| 95 | POST | `/api/admin/sales-targets/:year/copy` | authAdmin | commerciale |  |
| 96 | GET | `/api/admin/commercial/dashboard` | authAdmin | commerciale |  |
| 97 | GET | `/api/admin/commercial/stats` | authAdmin | commerciale |  |
| 98 | GET | `/api/admin/crm/dashboard` | authAdmin | crm, commerciale |  |
| 99 | GET | `/api/admin/magazzino/dashboard` | authAdmin | magazzino |  |
| 100 | GET | `/api/admin/produzione/dashboard` | authAdmin | produzione |  |
| 101 | GET | `/api/admin/home/dashboard` | authAdmin | * |  |
| 102 | GET | `/api/admin/agents` | authAdmin | crm, commerciale |  |
| 103 | GET | `/api/admin/agents/:id` | authAdmin | crm, commerciale |  |
| 104 | POST | `/api/admin/agents` | authAdmin | crm |  |
| 105 | PATCH | `/api/admin/agents/:id` | authAdmin | crm |  |
| 106 | POST | `/api/admin/agents/:id/regenerate-password` | authAdmin | crm |  |
| 107 | POST | `/api/admin/agents/:id/regenerate-token` | authAdmin | crm |  |
| 108 | DELETE | `/api/admin/agents/:id` | authAdmin | crm |  |
| 109 | GET | `/api/admin/agents/:id/tracked-customers` | authAdmin | crm, commerciale |  |
| 110 | GET | `/api/admin/customers` | authAdmin | crm, commerciale, magazzino |  |
| 111 | POST | `/api/admin/customers` | authAdmin | crm, commerciale |  |
| 112 | PATCH | `/api/admin/customers/:id` | authAdmin | crm, commerciale |  |
| 113 | DELETE | `/api/admin/customers/:id` | authAdmin | crm, commerciale |  |
| 114 | GET | `/api/admin/customers/:id` | authAdmin | crm, commerciale, magazzino |  |
| 115 | GET | `/api/admin/people` | authAdmin | crm |  |
| 116 | GET | `/api/admin/people/:id` | authAdmin | crm |  |
| 117 | POST | `/api/admin/people` | authAdmin | crm |  |
| 118 | PATCH | `/api/admin/people/:id` | authAdmin | crm |  |
| 119 | DELETE | `/api/admin/people/:id` | authAdmin | crm |  |
| 120 | GET | `/api/admin/fairs` | authAdmin | commerciale, crm |  |
| 121 | GET | `/api/admin/fairs/:id` | authAdmin | commerciale, crm |  |
| 122 | POST | `/api/admin/fairs` | authAdmin | commerciale |  |
| 123 | PATCH | `/api/admin/fairs/:id` | authAdmin | commerciale |  |
| 124 | DELETE | `/api/admin/fairs/:id` | authAdmin | commerciale |  |
| 125 | POST | `/api/admin/fairs/:id/attachments` | authAdmin+multerMiddleware | commerciale | upload |
| 126 | GET | `/api/admin/fairs/attachments/:id/download` | authAdmin | commerciale, crm |  |
| 127 | GET | `/api/admin/fairs/attachments/:id/view` | authAdmin | commerciale, crm |  |
| 128 | DELETE | `/api/admin/fairs/attachments/:id` | authAdmin | commerciale |  |
| 129 | GET | `/api/admin/importers` | authAdmin | crm, commerciale |  |
| 130 | GET | `/api/admin/importers/:id` | authAdmin | crm, commerciale |  |
| 131 | POST | `/api/admin/importers` | authAdmin | crm |  |
| 132 | PATCH | `/api/admin/importers/:id` | authAdmin | crm |  |
| 133 | DELETE | `/api/admin/importers/:id` | authAdmin | crm |  |
| 134 | GET | `/api/admin/suppliers` | authAdmin | crm, magazzino |  |
| 135 | GET | `/api/admin/suppliers/:id` | authAdmin | crm, magazzino |  |
| 136 | POST | `/api/admin/suppliers` | authAdmin | crm |  |
| 137 | PATCH | `/api/admin/suppliers/:id` | authAdmin | crm |  |
| 138 | DELETE | `/api/admin/suppliers/:id` | authAdmin | crm |  |
| 139 | GET | `/api/admin/crm/:entityType/:entityId/notes` | authAdmin | crm, commerciale |  |
| 140 | POST | `/api/admin/crm/:entityType/:entityId/notes` | authAdmin | crm, commerciale |  |
| 141 | DELETE | `/api/admin/crm/notes/:id` | authAdmin | crm, commerciale |  |
| 142 | GET | `/api/admin/crm/:entityType/:entityId/sold` | authAdmin | crm, commerciale |  |
| 143 | GET | `/api/admin/crm/:entityType/:entityId/activity` | authAdmin | crm, commerciale |  |
| 144 | GET | `/api/admin/crm/:entityType/:entityId/contacts` | authAdmin | crm, commerciale |  |
| 145 | POST | `/api/admin/crm/:entityType/:entityId/contacts` | authAdmin | crm, commerciale |  |
| 146 | PATCH | `/api/admin/crm/:entityType/:entityId/contacts/:personId` | authAdmin | crm, commerciale |  |
| 147 | DELETE | `/api/admin/crm/:entityType/:entityId/contacts/:personId` | authAdmin | crm, commerciale |  |
| 148 | GET | `/api/admin/crm/:entityType/:entityId/attachments` | authAdmin | crm, commerciale |  |
| 149 | POST | `/api/admin/crm/:entityType/:entityId/attachments` | authAdmin+multerMiddleware | crm, commerciale | upload |
| 150 | GET | `/api/admin/crm/attachments/:id/download` | authAdmin | crm, commerciale |  |
| 151 | DELETE | `/api/admin/crm/attachments/:id` | authAdmin | crm, commerciale |  |
| 152 | GET | `/api/admin/crm/:entityType/:entityId/meetings` | authAdmin | crm, commerciale |  |
| 153 | POST | `/api/admin/crm/:entityType/:entityId/meetings` | authAdmin | crm, commerciale |  |
| 154 | PATCH | `/api/admin/crm/meetings/:id` | authAdmin | crm, commerciale |  |
| 155 | DELETE | `/api/admin/crm/meetings/:id` | authAdmin | crm, commerciale |  |
| 156 | GET | `/api/admin/crm/:entityType/:entityId/tasks` | authAdmin | crm, commerciale |  |
| 157 | POST | `/api/admin/crm/:entityType/:entityId/tasks` | authAdmin | crm, commerciale |  |
| 158 | PATCH | `/api/admin/crm/tasks/:id` | authAdmin | crm, commerciale |  |
| 159 | DELETE | `/api/admin/crm/tasks/:id` | authAdmin | crm, commerciale |  |
| 160 | GET | `/api/admin/crm/:entityType/:entityId/deals` | authAdmin | crm, commerciale |  |
| 161 | POST | `/api/admin/crm/:entityType/:entityId/deals` | authAdmin | crm, commerciale |  |
| 162 | PATCH | `/api/admin/crm/deals/:id` | authAdmin | crm, commerciale |  |
| 163 | DELETE | `/api/admin/crm/deals/:id` | authAdmin | crm, commerciale |  |
| 164 | GET | `/api/admin/crm/:entityType/:entityId/emails` | authAdmin | crm, commerciale |  |
| 165 | POST | `/api/admin/crm/:entityType/:entityId/emails` | authAdmin | crm, commerciale |  |
| 166 | DELETE | `/api/admin/crm/emails/:id` | authAdmin | crm, commerciale |  |
| 167 | POST | `/api/agent/login` | - | — | login pubblico |
| 168 | GET | `/api/agent/:token` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 169 | GET | `/api/agent/:token/customers` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 170 | POST | `/api/agent/:token/customers` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 171 | GET | `/api/agent/:token/products` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 172 | GET | `/api/agent/:token/price-lists` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 173 | GET | `/api/agent/:token/orders` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 174 | POST | `/api/agent/:token/orders` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 175 | POST | `/api/admin/orders/manual` | authAdmin | commerciale, magazzino |  |
| 176 | GET | `/api/admin/news` | authAdmin | commerciale |  |
| 177 | POST | `/api/admin/news` | authAdmin | commerciale |  |
| 178 | PATCH | `/api/admin/news/:id` | authAdmin | commerciale |  |
| 179 | DELETE | `/api/admin/news/:id` | authAdmin | commerciale |  |
| 180 | GET | `/api/admin/catalogs` | authAdmin | commerciale |  |
| 181 | POST | `/api/admin/catalogs` | authAdmin+multerMiddleware | commerciale | upload |
| 182 | DELETE | `/api/admin/catalogs/:id` | authAdmin | commerciale |  |
| 183 | GET | `/api/catalogs/:id/download` | - | — | 🔴 **nessun controllo**: PDF scaricabile da chiunque, id sequenziale |
| 184 | PATCH | `/api/admin/orders/:id/payment` | authAdmin | commerciale, magazzino |  |
| 185 | GET | `/api/agent/:token/news` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 186 | GET | `/api/agent/:token/catalogs` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 187 | GET | `/api/agent/:token/credit-recovery` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 188 | GET | `/api/agent/:token/sold` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 189 | GET | `/api/agent/:token/dashboard` | authAgent | — | token agente fisso nel path; filtro agent_id in SQL |
| 190 | GET | `/api/admin/portal-users` | authAdmin | impostazioni |  |
| 191 | POST | `/api/admin/portal-users` | authAdmin | impostazioni |  |
| 192 | PATCH | `/api/admin/portal-users/:id` | authAdmin | impostazioni |  |
| 193 | DELETE | `/api/admin/portal-users/:id` | authAdmin | impostazioni |  |
| 194 | GET | `/api/admin/roles` | authAdmin | impostazioni |  |
| 195 | POST | `/api/admin/roles` | authAdmin | impostazioni |  |
| 196 | PATCH | `/api/admin/roles/:id` | authAdmin | impostazioni |  |
| 197 | DELETE | `/api/admin/roles/:id` | authAdmin | impostazioni |  |
| 198 | GET | `/api/admin/me` | authAdmin | * |  |
| 199 | GET | `/api/admin/my-profile` | authAdmin | * |  |
| 200 | PATCH | `/api/admin/my-profile` | authAdmin | * |  |
| 201 | POST | `/api/admin/my-profile/password` | authAdmin | * |  |
| 202 | POST | `/api/admin/session` | - | NESSUNA_REGOLA(403) | login chiave master (throttle) |
| 203 | POST | `/api/admin/logout` | authAdmin | * |  |
| 204 | GET | `/api/admin/signed-url` | authAdmin | * |  |
| 205 | GET | `/api/admin/audit-log` | authAdmin | impostazioni |  |
| 206 | GET | `/api/admin/notifications` | authAdmin | * |  |
| 207 | POST | `/api/admin/notifications/read` | authAdmin | * |  |
| 208 | POST | `/api/portal-users/login` | - | — | login pubblico |
| 209 | POST | `/api/portal-users/forgot-password` | - | — | login pubblico |
| 210 | POST | `/api/portal-users/reset-password` | - | — | login pubblico |
| 211 | GET | `/api/admin/production/summary` | authAdmin | produzione |  |
| 212 | GET | `/api/admin/production/items` | authAdmin | produzione |  |
| 213 | PATCH | `/api/admin/production/items/:id` | authAdmin | produzione |  |
| 214 | GET | `/api/admin/warehouse/finished` | authAdmin | magazzino |  |
| 215 | POST | `/api/admin/warehouse/finished` | authAdmin | magazzino |  |
| 216 | PATCH | `/api/admin/warehouse/finished/:id` | authAdmin | magazzino |  |
| 217 | DELETE | `/api/admin/warehouse/finished/:id` | authAdmin | magazzino |  |
| 218 | GET | `/api/admin/warehouse/raw` | authAdmin | magazzino |  |
| 219 | POST | `/api/admin/warehouse/raw` | authAdmin | magazzino |  |
| 220 | PATCH | `/api/admin/warehouse/raw/:id` | authAdmin | magazzino |  |
| 221 | DELETE | `/api/admin/warehouse/raw/:id` | authAdmin | magazzino |  |
| 222 | GET | `/api/admin/finance/cost-centers` | authAdmin | finance, people |  |
| 223 | POST | `/api/admin/finance/cost-centers` | authAdmin | finance |  |
| 224 | PATCH | `/api/admin/finance/cost-centers/:id` | authAdmin | finance |  |
| 225 | DELETE | `/api/admin/finance/cost-centers/:id` | authAdmin | finance |  |
| 226 | GET | `/api/admin/finance/cost-objects` | authAdmin | finance |  |
| 227 | GET | `/api/admin/finance/cost-objects/links` | authAdmin | finance |  |
| 228 | POST | `/api/admin/finance/cost-objects` | authAdmin | finance |  |
| 229 | PATCH | `/api/admin/finance/cost-objects/:id` | authAdmin | finance |  |
| 230 | DELETE | `/api/admin/finance/cost-objects/:id` | authAdmin | finance |  |
| 231 | GET | `/api/admin/finance/drivers` | authAdmin | finance |  |
| 232 | POST | `/api/admin/finance/drivers` | authAdmin | finance |  |
| 233 | PATCH | `/api/admin/finance/drivers/:id` | authAdmin | finance |  |
| 234 | GET | `/api/admin/finance/driver-values` | authAdmin | finance |  |
| 235 | PUT | `/api/admin/finance/driver-values` | authAdmin | finance |  |
| 236 | GET | `/api/admin/finance/rules` | authAdmin | finance |  |
| 237 | POST | `/api/admin/finance/rules` | authAdmin | finance |  |
| 238 | PATCH | `/api/admin/finance/rules/:id` | authAdmin | finance |  |
| 239 | DELETE | `/api/admin/finance/rules/:id` | authAdmin | finance |  |
| 240 | GET | `/api/admin/finance/direct-costs` | authAdmin | finance |  |
| 241 | POST | `/api/admin/finance/direct-costs` | authAdmin | finance |  |
| 242 | DELETE | `/api/admin/finance/direct-costs/:id` | authAdmin | finance |  |
| 243 | GET | `/api/admin/finance/cascade/:period` | authAdmin | finance |  |
| 244 | POST | `/api/admin/finance/cascade/:period/simulate` | authAdmin | finance |  |
| 245 | POST | `/api/admin/finance/cascade/:period/confirm` | authAdmin | finance |  |
| 246 | POST | `/api/admin/finance/cascade/:period/cancel` | authAdmin | finance |  |
| 247 | POST | `/api/admin/finance/cascade/:period/rerun` | authAdmin | finance |  |
| 248 | GET | `/api/admin/hr/sites` | authAdmin | people | + livelli HR nel modulo |
| 249 | POST | `/api/admin/hr/sites` | authAdmin | people | + livelli HR nel modulo |
| 250 | PATCH | `/api/admin/hr/sites/:id` | authAdmin | people | + livelli HR nel modulo |
| 251 | GET | `/api/admin/hr/holidays` | authAdmin | people | + livelli HR nel modulo |
| 252 | POST | `/api/admin/hr/holidays` | authAdmin | people | + livelli HR nel modulo |
| 253 | DELETE | `/api/admin/hr/holidays/:id` | authAdmin | people | + livelli HR nel modulo |
| 254 | GET | `/api/admin/hr/directory` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 255 | GET | `/api/admin/hr/employees` | authAdmin | people | + livelli HR nel modulo |
| 256 | GET | `/api/admin/hr/employees/:id` | authAdmin | people | + livelli HR nel modulo |
| 257 | POST | `/api/admin/hr/employees` | authAdmin | people | + livelli HR nel modulo |
| 258 | PATCH | `/api/admin/hr/employees/:id` | authAdmin | people | + livelli HR nel modulo |
| 259 | DELETE | `/api/admin/hr/employees/:id` | authAdmin | people | + livelli HR nel modulo |
| 260 | GET | `/api/admin/hr/employees/:id/approver` | authAdmin | people | + livelli HR nel modulo |
| 261 | GET | `/api/admin/hr/portal-users` | authAdmin | people | + livelli HR nel modulo |
| 262 | PUT | `/api/admin/hr/employees/:id/schedule` | authAdmin | people | + livelli HR nel modulo |
| 263 | GET | `/api/admin/hr/employees/:id/hourly-costs` | authAdmin | people | + livelli HR nel modulo |
| 264 | POST | `/api/admin/hr/employees/:id/hourly-costs` | authAdmin | people | + livelli HR nel modulo |
| 265 | DELETE | `/api/admin/hr/hourly-costs/:id` | authAdmin | people | + livelli HR nel modulo |
| 266 | GET | `/api/admin/hr/teams` | authAdmin | people | + livelli HR nel modulo |
| 267 | POST | `/api/admin/hr/teams` | authAdmin | people | + livelli HR nel modulo |
| 268 | PATCH | `/api/admin/hr/teams/:id` | authAdmin | people | + livelli HR nel modulo |
| 269 | DELETE | `/api/admin/hr/teams/:id` | authAdmin | people | + livelli HR nel modulo |
| 270 | GET | `/api/admin/hr/settings` | authAdmin | people | + livelli HR nel modulo |
| 271 | PUT | `/api/admin/hr/settings` | authAdmin | people | + livelli HR nel modulo |
| 272 | GET | `/api/admin/hr/job-roles` | authAdmin | people | + livelli HR nel modulo |
| 273 | POST | `/api/admin/hr/job-roles` | authAdmin | people | + livelli HR nel modulo |
| 274 | PATCH | `/api/admin/hr/job-roles/:id` | authAdmin | people | + livelli HR nel modulo |
| 275 | GET | `/api/admin/hr/employees/:id/contracts` | authAdmin | people | + livelli HR nel modulo |
| 276 | POST | `/api/admin/hr/employees/:id/contracts` | authAdmin | people | + livelli HR nel modulo |
| 277 | GET | `/api/admin/hr/employees/:id/compensations` | authAdmin | people | + livelli HR nel modulo |
| 278 | POST | `/api/admin/hr/employees/:id/compensations` | authAdmin | people | + livelli HR nel modulo |
| 279 | PUT | `/api/admin/hr/employees/:id/personal` | authAdmin | people | + livelli HR nel modulo |
| 280 | POST | `/api/admin/hr/employees/:id/identity-documents` | authAdmin | people | + livelli HR nel modulo |
| 281 | DELETE | `/api/admin/hr/identity-documents/:id` | authAdmin | people | + livelli HR nel modulo |
| 282 | POST | `/api/admin/hr/employees/:id/skills` | authAdmin | people | + livelli HR nel modulo |
| 283 | DELETE | `/api/admin/hr/skills/:id` | authAdmin | people | + livelli HR nel modulo |
| 284 | GET | `/api/admin/hr/document-types` | authAdmin | people | + livelli HR nel modulo |
| 285 | POST | `/api/admin/hr/employees/:id/documents` | authAdmin+multerMiddleware | people | + livelli HR nel modulo; upload |
| 286 | GET | `/api/admin/hr/documents/:id/download` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 287 | DELETE | `/api/admin/hr/documents/:id` | authAdmin | people | + livelli HR nel modulo |
| 288 | GET | `/api/admin/hr/deadlines` | authAdmin | people | + livelli HR nel modulo |
| 289 | GET | `/api/admin/hr/employees/:id/file` | authAdmin | people | + livelli HR nel modulo |
| 290 | GET | `/api/admin/hr/sensitive-access-log` | authAdmin | people | + livelli HR nel modulo |
| 291 | GET | `/api/admin/hr/safety/settings` | authAdmin | people | + livelli HR nel modulo |
| 292 | PUT | `/api/admin/hr/safety/settings` | authAdmin | people | + livelli HR nel modulo |
| 293 | GET | `/api/admin/hr/training-types` | authAdmin | people | + livelli HR nel modulo |
| 294 | POST | `/api/admin/hr/training-types` | authAdmin | people | + livelli HR nel modulo |
| 295 | PATCH | `/api/admin/hr/training-types/:id` | authAdmin | people | + livelli HR nel modulo |
| 296 | GET | `/api/admin/hr/safety/config` | authAdmin | people | + livelli HR nel modulo |
| 297 | PUT | `/api/admin/hr/job-roles/:id/safety` | authAdmin | people | + livelli HR nel modulo |
| 298 | PUT | `/api/admin/hr/operations/:id/trainings` | authAdmin | people | + livelli HR nel modulo |
| 299 | GET | `/api/admin/hr/employees/:id/assignment-check` | authAdmin | people | + livelli HR nel modulo |
| 300 | GET | `/api/admin/hr/employees/:id/safety` | authAdmin | people | + livelli HR nel modulo |
| 301 | POST | `/api/admin/hr/employees/:id/trainings` | authAdmin+multerMiddleware | people | + livelli HR nel modulo; upload |
| 302 | DELETE | `/api/admin/hr/trainings/:id` | authAdmin | people | + livelli HR nel modulo |
| 303 | POST | `/api/admin/hr/employees/:id/medical-visits` | authAdmin+multerMiddleware | people | + livelli HR nel modulo; upload |
| 304 | DELETE | `/api/admin/hr/medical-visits/:id` | authAdmin | people | + livelli HR nel modulo |
| 305 | POST | `/api/admin/hr/ppe-types` | authAdmin | people | + livelli HR nel modulo |
| 306 | PATCH | `/api/admin/hr/ppe-types/:id` | authAdmin | people | + livelli HR nel modulo |
| 307 | POST | `/api/admin/hr/employees/:id/ppe` | authAdmin+multerMiddleware | people | + livelli HR nel modulo; upload |
| 308 | PATCH | `/api/admin/hr/ppe/:id` | authAdmin | people | + livelli HR nel modulo |
| 309 | DELETE | `/api/admin/hr/ppe/:id` | authAdmin | people | + livelli HR nel modulo |
| 310 | POST | `/api/admin/hr/employees/:id/waivers` | authAdmin | people | + livelli HR nel modulo |
| 311 | POST | `/api/admin/hr/waivers/:id/revoke` | authAdmin | people | + livelli HR nel modulo |
| 312 | GET | `/api/admin/hr/incidents` | authAdmin | people | + livelli HR nel modulo |
| 313 | POST | `/api/admin/hr/incidents` | authAdmin | people | + livelli HR nel modulo |
| 314 | PATCH | `/api/admin/hr/incidents/:id` | authAdmin | people | + livelli HR nel modulo |
| 315 | POST | `/api/admin/hr/tasks/:id/done` | authAdmin | people | + livelli HR nel modulo |
| 316 | GET | `/api/admin/hr/safety/compliance` | authAdmin | people | + livelli HR nel modulo |
| 317 | GET | `/api/admin/hr/absence-settings` | authAdmin | people | + livelli HR nel modulo |
| 318 | PUT | `/api/admin/hr/absence-settings` | authAdmin | people | + livelli HR nel modulo |
| 319 | GET | `/api/admin/hr/absence-types` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 320 | POST | `/api/admin/hr/absence-types` | authAdmin | people | + livelli HR nel modulo |
| 321 | PATCH | `/api/admin/hr/absence-types/:id` | authAdmin | people | + livelli HR nel modulo |
| 322 | GET | `/api/admin/hr/absence-block-periods` | authAdmin | people | + livelli HR nel modulo |
| 323 | POST | `/api/admin/hr/absence-block-periods` | authAdmin | people | + livelli HR nel modulo |
| 324 | PATCH | `/api/admin/hr/absence-block-periods/:id` | authAdmin | people | + livelli HR nel modulo |
| 325 | DELETE | `/api/admin/hr/absence-block-periods/:id` | authAdmin | people | + livelli HR nel modulo |
| 326 | GET | `/api/admin/hr/employees/:id/allowances` | authAdmin | people | + livelli HR nel modulo |
| 327 | PUT | `/api/admin/hr/employees/:id/allowances` | authAdmin | people | + livelli HR nel modulo |
| 328 | POST | `/api/admin/hr/absences` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 329 | POST | `/api/admin/hr/absences/:id/submit` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 330 | DELETE | `/api/admin/hr/absences/:id` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 331 | POST | `/api/admin/hr/absences/:id/approve` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 332 | POST | `/api/admin/hr/absences/:id/reject` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 333 | POST | `/api/admin/hr/absences/:id/acknowledge` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 334 | POST | `/api/admin/hr/absences/:id/cancel` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 335 | GET | `/api/admin/hr/absences` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 336 | GET | `/api/admin/hr/absences/balances` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 337 | POST | `/api/admin/hr/absences/preview` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 338 | GET | `/api/admin/operators/availability` | authAdmin | enoturismo |  |
| 339 | GET | `/api/admin/hr/timesheet/settings` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 340 | PUT | `/api/admin/hr/timesheet/settings` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 341 | GET | `/api/admin/hr/timesheet/options` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 342 | POST | `/api/admin/hr/timesheet/entries` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 343 | PATCH | `/api/admin/hr/timesheet/entries/:id` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 344 | DELETE | `/api/admin/hr/timesheet/entries/:id` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 345 | POST | `/api/admin/hr/timesheet/team` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 346 | POST | `/api/admin/hr/timesheet/proposals/accept` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 347 | POST | `/api/admin/hr/timesheet/proposals/dismiss` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 348 | GET | `/api/admin/hr/timesheet/month` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 349 | GET | `/api/admin/hr/timesheet/overview` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 350 | POST | `/api/admin/hr/timesheet/conflicts/:id/resolve` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 351 | POST | `/api/admin/hr/timesheet/months/submit` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 352 | POST | `/api/admin/hr/timesheet/months/approve` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 353 | POST | `/api/admin/hr/timesheet/months/return` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 354 | POST | `/api/admin/hr/timesheet/adjustments` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 355 | GET | `/api/admin/hr/timesheet/export/:period` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 356 | GET | `/api/admin/hr/timesheet/export/:period/tutti` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 357 | GET | `/api/admin/hr/employees/:id/assets` | authAdmin | people | + livelli HR nel modulo |
| 358 | POST | `/api/admin/hr/employees/:id/assets` | authAdmin | people | + livelli HR nel modulo |
| 359 | PATCH | `/api/admin/hr/assets/:id` | authAdmin | people | + livelli HR nel modulo |
| 360 | DELETE | `/api/admin/hr/assets/:id` | authAdmin | people | + livelli HR nel modulo |
| 361 | GET | `/api/admin/hr/me` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 362 | POST | `/api/admin/hr/me/change-requests` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 363 | POST | `/api/admin/hr/me/change-requests/:id/withdraw` | authAdmin | * | workspace ANY → sé/responsabile/caposquadra/livello nel modulo |
| 364 | GET | `/api/admin/hr/change-requests` | authAdmin | people | + livelli HR nel modulo |
| 365 | POST | `/api/admin/hr/change-requests/:id/approve` | authAdmin | people | + livelli HR nel modulo |
| 366 | POST | `/api/admin/hr/change-requests/:id/reject` | authAdmin | people | + livelli HR nel modulo |
| 367 | GET | `/api/admin/hr/checklist-templates` | authAdmin | people | + livelli HR nel modulo |
| 368 | POST | `/api/admin/hr/checklist-templates` | authAdmin | people | + livelli HR nel modulo |
| 369 | PATCH | `/api/admin/hr/checklist-templates/:id` | authAdmin | people | + livelli HR nel modulo |
| 370 | GET | `/api/admin/hr/employees/:id/checklists` | authAdmin | people | + livelli HR nel modulo |
| 371 | POST | `/api/admin/hr/employees/:id/checklists` | authAdmin | people | + livelli HR nel modulo |
| 372 | POST | `/api/admin/hr/checklist-items/:id` | authAdmin | people | + livelli HR nel modulo |
| 373 | POST | `/api/admin/hr/checklists/:id/complete` | authAdmin | people | + livelli HR nel modulo |
| 374 | POST | `/api/admin/hr/documents/bulk` | authAdmin+multerMiddleware | people | + livelli HR nel modulo; upload |
| 375 | GET | `/api/admin/hr/seasonal` | authAdmin | people | + livelli HR nel modulo |
| 376 | GET | `/api/admin/hr/positions` | authAdmin | people | + livelli HR nel modulo |
| 377 | POST | `/api/admin/hr/positions` | authAdmin | people | + livelli HR nel modulo |
| 378 | PATCH | `/api/admin/hr/positions/:id` | authAdmin | people | + livelli HR nel modulo |
| 379 | GET | `/api/admin/hr/candidates` | authAdmin | people | + livelli HR nel modulo |
| 380 | POST | `/api/admin/hr/candidates` | authAdmin+multerMiddleware | people | + livelli HR nel modulo; upload |
| 381 | PATCH | `/api/admin/hr/candidates/:id` | authAdmin | people | + livelli HR nel modulo |
| 382 | POST | `/api/admin/hr/candidates/:id/convert` | authAdmin | people | + livelli HR nel modulo |
| 383 | GET | `/api/admin/stock/items` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 384 | GET | `/api/admin/stock/movements` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 385 | GET | `/api/admin/stock/valuation` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 386 | GET | `/api/admin/stock/anomalies` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 387 | POST | `/api/admin/stock/loads` | authAdmin | magazzino |  |
| 388 | POST | `/api/admin/stock/issues` | authAdmin | magazzino |  |
| 389 | POST | `/api/admin/stock/movements/:id/reverse` | authAdmin | magazzino |  |
| 390 | GET | `/api/admin/stock/tastings` | authAdmin | magazzino, enoturismo |  |
| 391 | POST | `/api/admin/stock/tastings/:id/confirm` | authAdmin | magazzino, enoturismo |  |
| 392 | POST | `/api/admin/stock/tastings/:id/dismiss` | authAdmin | magazzino, enoturismo |  |
| 393 | GET | `/api/admin/stock/counts` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 394 | GET | `/api/admin/stock/counts/:id` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 395 | POST | `/api/admin/stock/counts` | authAdmin | magazzino |  |
| 396 | PUT | `/api/admin/stock/counts/:id/lines` | authAdmin | magazzino |  |
| 397 | POST | `/api/admin/stock/counts/:id/confirm` | authAdmin | magazzino |  |
| 398 | POST | `/api/admin/stock/counts/:id/cancel` | authAdmin | magazzino |  |
| 399 | GET | `/api/admin/stock/cost-sheet` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 400 | POST | `/api/admin/stock/cost-sheet` | authAdmin+multerMiddleware | magazzino | upload |
| 401 | GET | `/api/admin/stock/reconciliation` | authAdmin | magazzino, commerciale, enoturismo, finance |  |
| 402 | GET | `/api/admin/prd/catalog` | authAdmin | produzione |  |
| 403 | GET | `/api/admin/prd/config` | authAdmin | produzione |  |
| 404 | PATCH | `/api/admin/prd/config/:key` | authAdmin | produzione | + capacità PRD (requireCap) |
| 405 | POST | `/api/admin/prd/config/:key/validate` | authAdmin | produzione | + capacità PRD (requireCap) |
| 406 | GET | `/api/admin/prd/campaigns` | authAdmin | produzione |  |
| 407 | GET | `/api/admin/prd/establishments` | authAdmin | produzione |  |
| 408 | GET | `/api/admin/prd/establishments/:id` | authAdmin | produzione |  |
| 409 | POST | `/api/admin/prd/establishments` | authAdmin | produzione | + capacità PRD (requireCap) |
| 410 | PATCH | `/api/admin/prd/establishments/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 411 | POST | `/api/admin/prd/establishments/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 412 | POST | `/api/admin/prd/establishments/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 413 | GET | `/api/admin/prd/varieties` | authAdmin | produzione |  |
| 414 | GET | `/api/admin/prd/varieties/:id` | authAdmin | produzione |  |
| 415 | POST | `/api/admin/prd/varieties` | authAdmin | produzione | + capacità PRD (requireCap) |
| 416 | PATCH | `/api/admin/prd/varieties/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 417 | POST | `/api/admin/prd/varieties/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 418 | POST | `/api/admin/prd/varieties/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 419 | GET | `/api/admin/prd/appellations` | authAdmin | produzione |  |
| 420 | GET | `/api/admin/prd/appellations/:id` | authAdmin | produzione |  |
| 421 | POST | `/api/admin/prd/appellations` | authAdmin | produzione | + capacità PRD (requireCap) |
| 422 | PATCH | `/api/admin/prd/appellations/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 423 | POST | `/api/admin/prd/appellations/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 424 | POST | `/api/admin/prd/appellations/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 425 | GET | `/api/admin/prd/appellations/:id/rules` | authAdmin | produzione |  |
| 426 | POST | `/api/admin/prd/appellations/:id/rules` | authAdmin | produzione | + capacità PRD (requireCap) |
| 427 | PATCH | `/api/admin/prd/appellation-rules/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 428 | POST | `/api/admin/prd/appellation-rules/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 429 | GET | `/api/admin/prd/analysis-parameters` | authAdmin | produzione |  |
| 430 | GET | `/api/admin/prd/analysis-parameters/:id` | authAdmin | produzione |  |
| 431 | POST | `/api/admin/prd/analysis-parameters` | authAdmin | produzione | + capacità PRD (requireCap) |
| 432 | PATCH | `/api/admin/prd/analysis-parameters/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 433 | POST | `/api/admin/prd/analysis-parameters/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 434 | POST | `/api/admin/prd/analysis-parameters/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 435 | GET | `/api/admin/prd/sian-map` | authAdmin | produzione |  |
| 436 | GET | `/api/admin/prd/sian-map/:id` | authAdmin | produzione |  |
| 437 | POST | `/api/admin/prd/sian-map` | authAdmin | produzione | + capacità PRD (requireCap) |
| 438 | PATCH | `/api/admin/prd/sian-map/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 439 | POST | `/api/admin/prd/sian-map/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 440 | POST | `/api/admin/prd/sian-map/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 441 | POST | `/api/admin/prd/sian-map/:id/validate` | authAdmin | produzione | + capacità PRD (requireCap) |
| 442 | GET | `/api/admin/prd/vineyards` | authAdmin | produzione |  |
| 443 | GET | `/api/admin/prd/vineyards/:id` | authAdmin | produzione |  |
| 444 | POST | `/api/admin/prd/vineyards` | authAdmin | produzione | + capacità PRD (requireCap) |
| 445 | PATCH | `/api/admin/prd/vineyards/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 446 | POST | `/api/admin/prd/vineyards/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 447 | POST | `/api/admin/prd/vineyards/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 448 | GET | `/api/admin/prd/cadastral-parcels` | authAdmin | produzione |  |
| 449 | GET | `/api/admin/prd/cadastral-parcels/:id` | authAdmin | produzione |  |
| 450 | POST | `/api/admin/prd/cadastral-parcels` | authAdmin | produzione | + capacità PRD (requireCap) |
| 451 | PATCH | `/api/admin/prd/cadastral-parcels/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 452 | POST | `/api/admin/prd/cadastral-parcels/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 453 | POST | `/api/admin/prd/cadastral-parcels/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 454 | GET | `/api/admin/prd/parcels` | authAdmin | produzione |  |
| 455 | GET | `/api/admin/prd/parcels/:id` | authAdmin | produzione |  |
| 456 | POST | `/api/admin/prd/parcels` | authAdmin | produzione | + capacità PRD (requireCap) |
| 457 | PATCH | `/api/admin/prd/parcels/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 458 | POST | `/api/admin/prd/parcels/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 459 | POST | `/api/admin/prd/parcels/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 460 | PUT | `/api/admin/prd/parcels/:id/cadastral-links` | authAdmin | produzione | + capacità PRD (requireCap) |
| 461 | PUT | `/api/admin/prd/parcels/:id/appellations` | authAdmin | produzione | + capacità PRD (requireCap) |
| 462 | GET | `/api/admin/prd/equipment` | authAdmin | produzione |  |
| 463 | GET | `/api/admin/prd/equipment/:id` | authAdmin | produzione |  |
| 464 | POST | `/api/admin/prd/equipment` | authAdmin | produzione | + capacità PRD (requireCap) |
| 465 | PATCH | `/api/admin/prd/equipment/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 466 | POST | `/api/admin/prd/equipment/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 467 | POST | `/api/admin/prd/equipment/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 468 | GET | `/api/admin/prd/phyto-products` | authAdmin | produzione |  |
| 469 | GET | `/api/admin/prd/phyto-products/:id` | authAdmin | produzione |  |
| 470 | POST | `/api/admin/prd/phyto-products` | authAdmin | produzione | + capacità PRD (requireCap) |
| 471 | PATCH | `/api/admin/prd/phyto-products/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 472 | POST | `/api/admin/prd/phyto-products/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 473 | POST | `/api/admin/prd/phyto-products/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 474 | GET | `/api/admin/prd/locations` | authAdmin | produzione |  |
| 475 | GET | `/api/admin/prd/locations/:id` | authAdmin | produzione |  |
| 476 | POST | `/api/admin/prd/locations` | authAdmin | produzione | + capacità PRD (requireCap) |
| 477 | PATCH | `/api/admin/prd/locations/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 478 | POST | `/api/admin/prd/locations/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 479 | POST | `/api/admin/prd/locations/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 480 | GET | `/api/admin/prd/vessels` | authAdmin | produzione |  |
| 481 | GET | `/api/admin/prd/vessels/by-token/:token` | authAdmin | produzione |  |
| 482 | GET | `/api/admin/prd/vessels/:id` | authAdmin | produzione |  |
| 483 | POST | `/api/admin/prd/vessels` | authAdmin | produzione | + capacità PRD (requireCap) |
| 484 | PATCH | `/api/admin/prd/vessels/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 485 | POST | `/api/admin/prd/vessels/:id/retire` | authAdmin | produzione | + capacità PRD (requireCap) |
| 486 | POST | `/api/admin/prd/vessels/:id/reactivate` | authAdmin | produzione | + capacità PRD (requireCap) |
| 487 | GET | `/api/admin/prd/protocols` | authAdmin | produzione |  |
| 488 | GET | `/api/admin/prd/protocols/:id` | authAdmin | produzione |  |
| 489 | POST | `/api/admin/prd/protocols` | authAdmin | produzione | + capacità PRD (requireCap) |
| 490 | PATCH | `/api/admin/prd/protocols/:id` | authAdmin | produzione | + capacità PRD (requireCap) |
| 491 | POST | `/api/admin/prd/protocols/:id/archive` | authAdmin | produzione | + capacità PRD (requireCap) |
| 492 | POST | `/api/admin/prd/protocols/:id/restore` | authAdmin | produzione | + capacità PRD (requireCap) |
| 493 | PUT | `/api/admin/prd/protocols/:id/steps` | authAdmin | produzione | + capacità PRD (requireCap) |
| 494 | POST | `/api/admin/prd/protocols/:id/duplicate` | authAdmin | produzione | + capacità PRD (requireCap) |
