# Rawendpaneel

Je eigen paneel op je eigen server. Je opent het in je browser of als app op je gsm, thuis of onderweg.
Wit, blauw en koraal, met je server als **levende kern** in het midden van het overzicht. Licht of donker zoals je toestel, en volledig gemaakt voor de gsm.

## Wat kan het?

**Je dag**
- **Dashboard**: je planning van vandaag, taken, aftellen, meldingen, een snelle notitie en live je server
  (processor, geheugen, temperatuur, opslag). Met *Dashboard aanpassen* kies je wat je ziet.
- **Snel toevoegen** (de + knop of `Ctrl K`): typ zoals je praat. `vrijdag 7-15 werk`, `morgen 14u tandarts`,
  `elke dinsdag vuilbak buiten`, `€12,50 broodjes`, `examen 19 januari aftellen`, `notitie: wifi-code 1234`.
- **Agenda**: dag, 3 dagen, week, maand, jaar en lijst. Slepen om te verplaatsen, onderkant slepen om langer te maken.
  Herhalen (ook "om de 2 weken", "laatste vrijdag van de maand"), herinneringen, reistijd, meeneemlijst, kleuren,
  werkdiensten met 1 tik, Belgische feestdagen, abonnementen (bv. je lessenrooster) en agenda's delen met een link.
- **Synchroniseren met je gsm**: je agenda en taken verschijnen in de Agenda- en Herinneringen-app van je iPhone
  of (met DAVx⁵) op Android. Uitleg staat in *Instellingen → Gsm koppelen*.
- **Morgen klaarleggen**: wat je morgen hebt, wanneer je moet vertrekken en wat je moet meenemen (afvinken).
  Elke avond om **21:00** krijg je daar een melding van.
- **Taken** met subtaken, herhalen, belangrijk, lijsten en herinneringen. **Notities** als kaartjes
  met kleuren, vastpinnen, mappen, opmaakbalk en afvinklijstjes. **Aftellen**. **Delen**: gedeeld klembord tussen gsm en
  laptop en bestanden delen met een link die vanzelf vervalt.
- **Pushmeldingen** op je gsm (herinneringen, avondoverzicht, site offline, server te warm).

**Je server**
- **Websites**: sleep gewoon de **hele map van je project** (of een .zip). Het paneel ziet zelf wat het is:
  een kant-en-klare website, een Angular/React/Vue/Vite-project (dan doet de server zelf `npm ci` + `npm run build`
  en zet enkel het resultaat online) of een app met `docker-compose.yml`.
  Bijwerken = map op de kaart slepen. Automatische backup + terugzetten, domeinen + https via Caddy,
  domein-check, live logs, onderhoudsmodus ("we zijn zo terug").
- **Server**: live grafieken en widgets die je zelf kiest, **elke schijf en elk deel (partitie) apart**, processen,
  opruimen, snelheidstest, OpenCloud, server **herstarten** en een **terminal** in je browser.
- **Containers**: alles wat in Docker draait, live.
- **Terminal** (ook buiten thuis, via je https-domein): meerdere tabbladen, een shell rechtstreeks in een container,
  snelle commando's met één tik (zelf aan te passen) en een toetsenrij voor je gsm (Esc, Tab, Ctrl, pijltjes).
- **Bestanden**: je hele home-map bekijken, bewerken (met kopie vooraf), uploaden, downloaden (mappen als zip),
  hernoemen en rechten aanpassen. Verwijderen gaat naar een prullenbak in `~/.serverpaneel/prullenbak`.
- **Apps-winkel**: Jellyfin, Vaultwarden, Uptime Kuma, Home Assistant, Pi-hole, Nextcloud, Syncthing, VS Code,
  PostgreSQL, MariaDB en een Minecraft-server met één klik. Ze komen in `~/apps/<naam>` en staan daarna gewoon bij je websites.
- **Databases**: PostgreSQL en MySQL/MariaDB in Docker en SQLite-bestanden van je sites. Tabellen bekijken, query's
  (standaard alleen lezen), CSV-export en backups (`~/.serverpaneel/backups/_databases`).
- **Firewall**: ufw met één klik aan (SSH en het paneel blijven altijd bereikbaar van thuis en via Tailscale),
  poorten open/dicht per regel, wat er op je server luistert en wat er tegengehouden werd.
- **Apparaten**: wie er op je netwerk zit (melding bij een nieuw apparaat) en computers aanzetten met Wake-on-LAN.
- **Energie**: verbruik nu, per dag/week/maand/jaar en wat het kost. Geschat via de processor, of exact met een
  Shelly- of Tasmota-stekker.
- **Netwerk**: alle snelheden in **MB/s** (1 MB/s = 8 Mbit/s). Snelheidstest met 8 verbindingen tegelijk (± 20 s),
  de snelheid van je kabel (bv. 1 Gbit/s = max 125 MB/s), fouten op de kabel, DNS, en **wie er op je netwerk zit met een naam**:
  de naam die het toestel zelf doorgeeft, de Windows-naam, de naam van je router of het merk (officiële IEEE-lijst, één keer
  gedownload). Onbekende apparaten geef je zelf een naam.
- **Zoeken overal** (`Ctrl K`): sites, containers, databases, bestanden, notities en acties in één zoekvak.
  Typ `>` voor enkel acties. Gewoon iets typen en Enter kan ook nog altijd als *Snel toevoegen*.
- **Beveiliging**: wachtwoord, 2FA, **Face ID / vingerafdruk**, en voor gevaarlijke dingen (terminal, herstarten,
  agenda verwijderen) vraagt het paneel eerst nog eens wie je bent.

## Eerst lokaal testen op je laptop (demo)

Wil je eerst zien hoe het eruitziet? Dat kan op je eigen Windows-laptop. Er gebeurt niets op je server.

1. Installeer **Node.js** (de LTS-versie) van <https://nodejs.org> als je dat nog niet hebt.
2. Pak `serverpaneel.zip` uit en dubbelklik op **`start-demo.cmd`**.
3. Je browser opent `http://localhost:3000`. Het wachtwoord is **`demo123456`**.

In de demo staan al een paar voorbeeldsites. Je kan er alles mee uitproberen: nieuwe sites online zetten, bijwerken,
domeinen instellen, terugzetten en bestaande projecten toevoegen. Docker wordt nagebootst.
Alles komt in de map `demo-data`. Wis die map om opnieuw te beginnen. Sluit het zwarte venster om de demo te stoppen.

Ook je gsm kan meekijken als die op dezelfde wifi zit: `http://<ip-van-je-laptop>:3000`.

## Installeren (eenmalig)

Doe dit vanaf je laptop in PowerShell, in de map waar `serverpaneel.zip` staat:

```powershell
scp serverpaneel.zip gebruiker@jouwserver:~
ssh gebruiker@jouwserver
```

Dan op de server:

```bash
sudo apt install -y unzip rsync
unzip serverpaneel.zip && cd serverpaneel
bash install.sh
```

Het script vindt je Caddy zelf en stelt een paar vragen:

- **Poort**: laat `3000` staan.
- **Map voor nieuwe sites**: laat `~/sites` staan.
- **Domein voor het paneel**: bv. `paneel-jouwnaam.duckdns.org`. Dit is voor buiten thuis. Laat het leeg als je alleen Tailscale wil.

Open daarna **thuis** `http://<lokaal-ip>:3000`. Het script toont het juiste adres. Kies daar je wachtwoord.
Om veiligheidsredenen kan het eerste wachtwoord alleen vanaf je thuisnetwerk of via Tailscale ingesteld worden.
Zet daarna meteen **2FA** aan via Instellingen.

## Bereikbaar thuis én buiten thuis

| Waar | Adres |
|---|---|
| Thuis (zelfde wifi) | `http://192.168.x.x:3000` (lokaal IP van je server) |
| Buiten thuis via internet | `https://paneel-jouwnaam.duckdns.org` (via Caddy + DuckDNS, met https) |
| Buiten thuis via Tailscale | `http://jouwserver:3000` (installeer Tailscale op server én laptop/gsm) |

**Voor het domein (buiten thuis via internet):**

1. Maak de naam aan op duckdns.org en voeg ze toe aan je DuckDNS-updater.
2. In je router moeten poort **80 en 443** doorgestuurd zijn naar je server. Waarschijnlijk staat dat al goed voor Caddy.
3. Stuur poort **3000 niet** door in je router. Buiten thuis ga je altijd via https.

**Tailscale (extra veilig):** op de server `curl -fsSL https://tailscale.com/install.sh | sh` en daarna
`sudo tailscale up`. Installeer de Tailscale-app op je laptop en gsm en log in met hetzelfde account.

## Op je gsm

Het paneel werkt ook volledig op je gsm. Het menu staat dan onderaan en vensters schuiven van onderen open.
Tik op een grafiek om de waarde op dat moment te zien, en veeg opzij om door de tijd te gaan.

- **Als app op je beginscherm**: open het paneel in Safari (iPhone) of Chrome (Android) → *Deel* / *⋮* →
  **Zet op beginscherm**. Dan opent het als een echte app, zonder adresbalk.
- **Website uploaden vanaf je gsm**: op een gsm kan je geen map kiezen. Gebruik een **.zip** van je website
  (maak die op je computer, of met de Bestanden-app), of kies losse bestanden voor een simpele site zonder submappen.

## Een website online zetten

1. Klik **+ Nieuwe site** en geef een naam (bv. `portfolio`).
2. Sleep de map met je `index.html` erin, of kies een zip.
3. Optioneel: vul een domein in (bv. `portfolio-jouwnaam.duckdns.org`). Maak die naam ook aan op DuckDNS.
4. Klik **Uploaden en online zetten**. In het verslag zie je live wat er gebeurt.

Voor een **Docker-app** doe je hetzelfde, met je projectmap waar een `docker-compose.yml` in zit.
Vul bij "Poort" de poort in die links staat bij `ports:` in je compose-bestand (bij `"8080:80"` is dat `8080`).

`node_modules` en `.git` worden automatisch overgeslagen bij het uploaden.

## Paneel zelf updaten

**Makkelijkst:** open het paneel → **Websites** → kaart **serverpaneel** → **Bijwerken** en kies `serverpaneel.zip`.
Het paneel bouwt zichzelf opnieuw en herstart. Start de nieuwe versie niet goed, dan komt de vorige vanzelf terug.

**Of via de terminal** (op de server, in de map waar de zip staat):

```bash
unzip -o serverpaneel.zip && cd serverpaneel && bash install.sh
```

Je instellingen, wachtwoord, sites en agenda blijven behouden. De eerste update naar deze versie duurt langer
(5 à 10 minuten): de agenda-dienst wordt dan mee geïnstalleerd.

## De AI-assistent is eruit (oktober 2026)

Het paneel heeft geen AI-assistent meer. Bij het bijwerken wordt de AI-container (`serverpaneel-ai`) vanzelf gestopt
en verwijderd. De gedownloade AI-modellen (± 2 GB) blijven nog op je server staan. Wil je die plaats terug, doe dan op de server:

```bash
sudo rm -rf ~/serverpaneel/data/ollama
docker image rm ollama/ollama
```

## Datum en uur

Overal in het paneel staan datums als **14/10/2026** en uren als **14:30** (24 uur, geen AM/PM),
ook als je laptop of gsm in het Engels staat. Typen mag kort: `20112026`, `20/11` (dit jaar), `930` of `14u30`.
In een datumvak kan je ook op het kalendertje klikken, of met de pijltjes een dag/5 minuten verschuiven.

## Automatisch opstarten (bv. na een stroomonderbreking)

Valt de stroom uit en zet je de server weer aan, dan komt alles vanzelf terug online. Je hoeft niet in te loggen.
- Docker start mee op met je server (in het paneel: **Server → Over deze server → Docker start mee bij opstarten**).
- Het paneel zorgt dat elke container van je sites een herstartregel heeft (*unless-stopped*). Op elke kaart zie je
  **Start automatisch**. Staat er **Start niet automatisch**, dan regelt het paneel dat binnen enkele seconden.
- Een container die jij zelf stopt, blijft gestopt (ook na een herstart). Zo heb je zelf de controle.

## Waarom "website" én "container"?

Op je server draait alles in Docker, ook het paneel zelf. Het verschil zit alleen in wie de site toont:

- Een **gewone website** (alleen HTML, CSS en afbeeldingen) heeft geen eigen container nodig. Het paneel toont ze zelf, vanuit zijn eigen container.
- Een site **met een `docker-compose.yml`** heeft een eigen container. Het paneel bouwt en herstart die bij elke update.

Je hoeft dit nergens te kiezen: het paneel ziet het zelf.

## Problemen?

- **Geen temperatuur te zien**: doe op de server `sudo apt install lm-sensors` en `sudo sensors-detect` (overal Enter), en herstart het paneel (`docker restart serverpaneel`).

- **Domein werkt niet**: kijk met `docker logs caddy` of Caddy een certificaat kon halen. Dat mislukt meestal omdat
  poort 80/443 niet doorgestuurd is of de DuckDNS-naam nog niet naar je IP wijst.
- **"Toegang geweigerd" bij updaten van een bestaande map**: sommige bestanden zijn door Docker als root gemaakt.
  Los het op met `sudo chown -R $USER:$USER ~/vakantie-planner` of zet die map bij *Instellingen → Geavanceerd → Nooit overschrijven*.
- **Caddy bereikt het paneel niet** (bij gebruik van ufw): `sudo ufw allow from 172.16.0.0/12 to any port 3000`.
- **Logs van het paneel zelf**: `docker logs serverpaneel`
- **Meldingen op iPhone**: open het paneel via je https-domein in Safari → Deel → *Zet op beginscherm*, open het van daar en zet meldingen aan.

## Waar staat alles op de server?

| Wat | Waar |
|---|---|
| Paneel + instellingen | `~/serverpaneel` (`.env`, `data/`) |
| Agenda en taken | `~/serverpaneel/data/radicale/` |
| Gebouwde projecten (cache) | `~/.serverpaneel/build/<naam>/` |
| Nieuwe sites | `~/sites/<naam>` |
| Backups | `~/.serverpaneel/backups/<naam>/` |
| Verwijderde sites | `~/.serverpaneel/backups/_verwijderd/` (kan je zelf wissen) |
| Caddy-instellingen per site | `site-<naam>.caddy` (map wordt getoond door install.sh) |
