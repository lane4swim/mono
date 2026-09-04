# Hoster-Optionen für Lane 1 — Vergleich (Stand: September 2026)

**Zweck dieser Liste:** Entscheidungshilfe *vor* der Wahl eines Hosters —
im Unterschied zu `docs/deployment.md` (Hetzner) und
`docs/deployment-netcup.md` (netcup), die jeweils eine vollständige
Schritt-für-Schritt-Anleitung für einen bereits gewählten Hoster sind.
Für jeden hier gelisteten Kandidaten, für den es noch keine eigene
Anleitung gibt, lässt sich `docs/deployment.md` mit minimalen Anpassungen
(Abschnitt 1–2: Produktwahl/Konto/Firewall) direkt weiterverwenden — auf
Betriebssystemebene (Node.js, PostgreSQL, Nginx, PM2, Let's Encrypt) ist
Lane 1 hosterunabhängig.

## Anforderungen, gegen die geprüft wurde

- **Größenordnung:** ein Verein/Team mit einigen Dutzend bis wenigen
  hundert Nutzer:innen (siehe `docs/deployment.md`, Abschnitt 1) — ein
  einzelner kleiner Server mit **2 vCPU / 4 GB RAM** reicht für Node.js-API,
  PostgreSQL und das Ausliefern der PWA gleichzeitig. Kein Cluster, kein
  Kubernetes, keine separate Datenbank-Instanz nötig.
- **Standort:** Rechenzentrum **innerhalb der EU** (idealerweise
  Deutschland) — vereinfacht die DSGVO-Betrachtung (Auftragsverarbeitung,
  Art. 15/17-Funktionen bereits implementiert, siehe README) gegenüber
  einem Anbieter mit Sitz/Rechenzentrum außerhalb der EU.
- **Preis:** ein einzelner kleiner VPS, kein Managed-Kubernetes/PaaS mit
  Enterprise-Aufschlag — die App braucht nur SSH-Root-Zugriff, einen
  Cronjob (Purge/Erinnerungen) und ausgehenden SMTP-Port 587.
- **Betriebsform:** unmanaged/self-managed VPS (root-Zugriff für Nginx,
  PM2, Cron) — kein reiner Static-/PaaS-Host, da das Backend (`apps/api`)
  ein dauerhaft laufender Node-Prozess plus eine eigene PostgreSQL-Instanz
  ist, kein serverloses Deployment.

## Vergleichstabelle

| Hoster | Unternehmenssitz | Rechenzentrum | Passendes Produkt (≈2 vCPU/4 GB) | ca. Preis/Monat | Bemerkung |
|---|---|---|---|---|---|
| **Hetzner** | Deutschland | Nürnberg/Falkenstein (DE) | Cloud CX22/CX23 | **≈ 4–6 €** | Bereits vollständig dokumentiert (`docs/deployment.md`). Bestes Preis-Leistungs-Verhältnis, großer deutscher Anbieter, einfache Konsole. |
| **netcup** | Deutschland | Nürnberg/Karlsruhe (DE) | VPS 1000 (aktuelle Generation) | **≈ 4–11 €** | Bereits vollständig dokumentiert (`docs/deployment-netcup.md`), inkl. automatisiertem Setup-Skript. Gleichwertige Alternative zu Hetzner. |
| **Contabo** | Deutschland | Nürnberg/München (DE), weitere EU-Standorte | Cloud VPS (4 vCPU/8 GB bereits im günstigsten Tarif) | **≈ 4,50–7 €** | Nominell die günstigsten Rohspezifikationen (mehr RAM/vCPU fürs Geld). In Erfahrungsberichten uneinheitlicher Support und teils Overselling der Shared-Ressourcen — für einen Vereinsserver ohne harte SLA-Anforderung vertretbar, aber weniger vorhersagbar als Hetzner/netcup. |
| **IONOS** | Deutschland | Deutschland | VPS S/M | **≈ 5–10 € (Einstiegspreis), Verlängerung spürbar teurer** | Großer, bekannter deutscher Anbieter (ex 1&1) — gute Wahl, wenn ein etablierter Markenname/Rechnung auf Vereinsnamen wichtig ist. Einstiegsrabatte fallen nach dem ersten Jahr deutlich weg, daher Preis nach Verlängerung explizit prüfen. |
| **OVHcloud** | Frankreich | u. a. Straßburg/Gravelines (FR) | VPS-1/VPS-2 | **≈ 6,50–8,50 €** | Solider EU-Anbieter, 2026 spürbare Preiserhöhungen (Speicher-Marktlage). Gute API/Terraform-Unterstützung, falls später Infrastructure-as-Code gewünscht ist. |
| **Scaleway** | Frankreich | Paris/Amsterdam/Warschau (EU) | DEV1-M | **≈ 8–10 €** | Etwas teurer als Hetzner/netcup für vergleichbare Spezifikation, dafür sehr gute Doku/API — eher interessant, falls später mehrere Umgebungen (Staging) automatisiert verwaltet werden sollen. |
| **Uberspace** | Deutschland | Deutschland | „Uberspace 7" (Managed) | **frei wählbar, empfohlen ≈ 6 €** | Managed Hosting mit Spendenmodell, sehr einsteigerfreundlich (kein eigenes Server-Setup nötig). **Wichtige Einschränkung:** PostgreSQL läuft dort nur im Beta-Status und es gibt keinen echten Root-Zugriff für PM2/eigene Systemd-Services — für einen Produktivbetrieb mit den in `docs/deployment.md` beschriebenen Schritten (PM2, eigene DB-Rollen, Cronjobs) nicht ohne Weiteres passend. Eher eine Option für eine spätere, vereinfachte Variante als für den aktuellen Aufbau. |
| **UpCloud** | Finnland | Frankfurt/Amsterdam (EU) u. a. | Cloud Server 2 vCPU/4 GB | **≈ 20–30 €** | Sehr gute Performance/Zuverlässigkeit (eigenes MaxIOPS-Storage), aber für diese Größenordnung deutlich überteuert im Vergleich zu Hetzner/netcup/Contabo — nur relevant, falls Performance/Support wichtiger als Preis wird. |
| Hyperscaler (AWS/Azure/GCP, EU-Region) | USA (mit EU-Rechenzentren) | z. B. Frankfurt | z. B. EC2 t3.medium | **≈ 30–40 €**, plus Komplexität | Nicht empfohlen: für diese Größenordnung unnötig teuer und komplex (IAM, VPC, Abrechnung nach Einzelposten); DSGVO-Betrachtung trotz EU-Region durch US-Mutterkonzern (Cloud Act) aufwendiger als bei einem rein europäischen Anbieter. |

*Preise sind grobe Richtwerte (Stand Herbst 2026, Netto/vor Steuer, kleinste
passende Konfiguration) — wie bei jedem Hoster können sie sich ändern; im
Zweifel aktuelle Preisliste des jeweiligen Anbieters prüfen (siehe auch
den entsprechenden Hinweis in `docs/deployment.md`, Abschnitt 1).*

## Empfehlung

**Erste Wahl: Hetzner oder netcup.** Beide sind deutsche Unternehmen mit
deutschen Rechenzentren, bieten das beste Preis-Leistungs-Verhältnis für
die benötigte Größenordnung (2 vCPU/4 GB reichen deutlich) und sind im
Repo bereits mit einer vollständigen, für Einsteiger:innen geschriebenen
Anleitung hinterlegt (`docs/deployment.md` bzw.
`docs/deployment-netcup.md`, letztere zusätzlich mit automatisiertem
Setup-Skript `scripts/setup-netcup.sh`). Es besteht kein technischer
Grund, einen dieser beiden dem anderen vorzuziehen — beide erlauben ein
späteres Hochskalieren ohne Neuaufsetzen; die Wahl kann sich an
Nebenkriterien orientieren (z. B. ob bereits ein Konto bei einem der
beiden besteht, oder ob eine Storage Box/zusätzliches Produkt des
jeweiligen Anbieters für Offsite-Backups genutzt werden soll, siehe
Abschnitt 12.3 in beiden Anleitungen).

**Falls eine dritte, unabhängige Option gewünscht ist:** Contabo (günstigste
Rohspezifikation, akzeptabel für einen Vereinsserver ohne SLA) oder IONOS
(etablierterer Markenname, dafür teurer nach Ablauf des Einstiegsrabatts).
Für beide lässt sich `docs/deployment.md` direkt als Anleitung
weiterverwenden — nur Abschnitt 1–2 (Produktwahl, Konto-/Firewall-Einrichtung
im jeweiligen Kundenpanel) unterscheidet sich.

**Nicht empfohlen für diese Größenordnung:** Uberspace (PostgreSQL nur
Beta, kein Root-Zugriff für die dokumentierten PM2-/Cron-Schritte),
UpCloud (deutlich teurer ohne Mehrwert für diese Nutzerzahl) und
Hyperscaler (AWS/Azure/GCP — unnötige Komplexität und Kosten für einen
einzelnen kleinen Anwendungsserver).
