# Deploy su AWS (EC2 o Lightsail)

Il backend è un solo processo Node con un database SQLite su file: serve **una macchina con un
disco persistente**, non Lambda/App Runner/Fargate (niente disco locale) e non EFS (i lock di
SQLite su file system di rete non sono affidabili). Una sola istanza: lo scheduler gira dentro
il processo.

```
Internet ──443──▶ Caddy (HTTPS, Let's Encrypt) ──▶ node server.js su 127.0.0.1:3000
                                                    └─ /data (disco EBS): cantina.db, uploads/, catalogs/,
                                                       hr-files/, fair-attachments/, crm-attachments/, backups/
```

File in questa cartella:

| File | Dove va sul server |
|---|---|
| `setup.sh` | prima installazione (Node 22, Caddy, utente `cantina`, disco `/data`, servizio) |
| `cantina.service` | `/etc/systemd/system/cantina.service` |
| `Caddyfile` | `/etc/caddy/Caddyfile` |
| `cantina.env.example` | `/etc/cantina/cantina.env` (da compilare, permessi 600) |
| `update.sh` | ogni deploy successivo, al posto di `railway up` |

## 1. Risorse AWS

1. **Istanza**: Ubuntu 24.04, regione `eu-south-1` (Milano) o `eu-central-1` (Francoforte).
   Lightsail da 2 GB è sufficiente ed è la più semplice; su EC2 un `t4g.small` (ARM) o `t3.small`.
2. **Disco dati**: un volume EBS gp3 separato (es. 20 GB) collegato all'istanza, che diventerà `/data`.
   Separato dal disco di sistema così si può staccare e ricollegare a un'altra istanza.
   (Su Lightsail: "Storage → Create disk" e collegarlo.)
3. **IP statico**: Elastic IP (EC2) o Static IP (Lightsail) assegnato all'istanza.
4. **Firewall / Security group**: in entrata solo 22 (meglio solo dal vostro IP, o usare SSM Session
   Manager e chiudere la 22), 80 e 443. La 3000 resta chiusa.
5. **Backup**: Data Lifecycle Manager (EC2) o snapshot automatici (Lightsail) sul disco dati, ogni
   giorno con 14 copie. SQLite resta coerente anche da snapshot (è crash-safe); in più il server
   copia già il database in `/data/backups/` prima di ogni migrazione.

## 2. Installazione

```bash
ssh ubuntu@<ip>
git clone https://github.com/dantemarramiero/mywinery.git /tmp/mywinery
lsblk                                   # trova il disco dati, es. /dev/nvme1n1 (vuoto, senza partizioni)
sudo REPO_URL=https://github.com/dantemarramiero/mywinery.git DATA_DEVICE=/dev/nvme1n1 \
  bash /tmp/mywinery/deploy/aws/setup.sh
sudo nano /etc/cantina/cantina.env      # valori dalle Variables del servizio Railway
```

Il repository è privato: per il `git clone` sul server serve una deploy key (GitHub → Settings →
Deploy keys, sola lettura) oppure un token. Con la deploy key usare l'URL `git@github.com:...`.

Da `cantina.env` non devono mancare:

- `NODE_ENV=production`: senza (e fuori da Railway) l'archivio HR si genererebbe in silenzio una
  chiave di sviluppo invece di pretendere `HR_FILES_KEY`.
- `HR_FILES_KEY` **identica** a quella su Railway, altrimenti i documenti HR copiati non si decifrano.
- `TRUST_PROXY=loopback`: senza, dietro Caddy tutti gli utenti avrebbero lo stesso IP (il blocco dei
  tentativi di login bloccherebbe tutti insieme) e i link nelle email di reset password e i ritorni
  da Stripe sarebbero `http://` invece di `https://`.
- `ADMIN_PASSWORD`: senza, vale la password di default del codice.
- `DATA_DIR=/data`.

## 3. Copia dei dati da Railway

Fare in un momento senza traffico (sera); da qui in poi le modifiche su Railway andrebbero perse.

```bash
# sul vostro computer, con la CLI di Railway collegata al progetto cantina-marramiero
railway ssh --service cantina-booking --environment production

# dentro il container: copia coerente del database, poi archivio di tutto /data
node -e "new (require('node:sqlite').DatabaseSync)('/data/cantina.db').exec(\"VACUUM INTO '/data/cantina-export.db'\")"
ls -la /data
exit
```

Poi scaricare l'archivio:

```bash
railway ssh --service cantina-booking --environment production -- \
  "tar czf - -C /data --exclude=cantina.db --exclude=cantina.db-wal --exclude=cantina.db-shm ." > railway-data.tgz
tar tzf railway-data.tgz | head          # deve elencare i file senza errori
```

Se l'archivio risulta corrotto (alcune versioni della CLI non passano bene i dati binari), fermarsi:
si può aggiungere un export temporaneo protetto dal portale.

Caricare e installare sul server:

```bash
scp railway-data.tgz ubuntu@<ip>:/tmp/
ssh ubuntu@<ip>
sudo systemctl stop cantina
sudo tar xzf /tmp/railway-data.tgz -C /data
sudo mv /data/cantina-export.db /data/cantina.db
sudo chown -R cantina:cantina /data
sudo systemctl start cantina
journalctl -u cantina -n 30             # "Documenti HR → ✓ archivio cifrato"
rm /tmp/railway-data.tgz                # contiene dati personali
```

## 4. Prova prima del cambio DNS

Senza toccare il DNS, dal vostro computer:

```bash
ssh -L 3000:127.0.0.1:3000 ubuntu@<ip>   # poi aprire http://localhost:3000/portal.html
```

Controllare: login al portale, una prenotazione esistente, una foto prodotto, un catalogo PDF,
un documento HR (si apre = chiave giusta), `sudo -u cantina bash -c 'cd /opt/cantina && DATA_DIR=/data npm run migrate -- status'`.

## 5. Cambio di dominio

1. Abbassare prima il TTL del record DNS di `prenotazioni.marramiero.it` (es. 300 s) e aspettare.
2. Rimuovere il dominio custom dal servizio Railway e puntare il record `A` all'IP statico AWS
   (se oggi è un `CNAME` verso Railway, sostituirlo con un `A`).
3. `sudo systemctl reload caddy`: al primo accesso Caddy ottiene il certificato (`journalctl -u caddy`).
4. **Stripe**: se il dominio resta lo stesso, il webhook `https://prenotazioni.marramiero.it/api/webhook`
   non cambia. Se finora usava il dominio `*.up.railway.app`, aggiornarlo in Dashboard → Developers →
   Webhooks e riportare il nuovo `STRIPE_WEBHOOK_SECRET` in `cantina.env`. Fare una prova con
   "Send test webhook".
5. Lasciare il servizio Railway spento ma non cancellato (e il volume intatto) per una o due
   settimane, come ripiego.

## Aggiornamenti successivi

```bash
ssh ubuntu@<ip> sudo bash /opt/cantina/deploy/aws/update.sh main
```

Scarica il branch, installa le dipendenze, lancia `npm test` (su un database temporaneo) e
riavvia il servizio solo se i test passano. Log: `journalctl -u cantina -f`.
