#!/usr/bin/env bash
# Serverpaneel installeren / updaten. Draai dit OP DE SERVER, in deze map:
#   bash install.sh
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"

c()   { printf '\033[36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m OK\033[0m %s\n' "$*"; }
wrn() { printf '\033[33m !!\033[0m %s\n' "$*"; }
ask() { local q="$1" d="${2:-}" a; read -r -p "$q${d:+ [$d]}: " a </dev/tty; echo "${a:-$d}"; }
yes() { local a; read -r -p "$1 [j/N]: " a </dev/tty; [[ "$a" =~ ^[jJyY] ]]; }

# ---------------------------------------------------------------- controles
command -v docker >/dev/null || { wrn "Docker is niet geinstalleerd."; exit 1; }
if ! docker info >/dev/null 2>&1; then
  wrn "Je gebruiker mag Docker niet gebruiken. Doe:  sudo usermod -aG docker $USER  en log opnieuw in."
  exit 1
fi
docker compose version >/dev/null 2>&1 || { wrn "'docker compose' (v2) ontbreekt. Installeer docker-compose-plugin."; exit 1; }
[ "$(id -u)" = "0" ] && { wrn "Draai dit als je gewone gebruiker (bv. rawend), niet als root."; exit 1; }

# ---------------------------------------------------------------- al geinstalleerd? dan enkel updaten
if [ -f .env ]; then
  c "Bestaande installatie gevonden: alleen updaten (instellingen, wachtwoord en sites blijven)."
  grep -q '^PANEL_DIR=' .env || echo "PANEL_DIR=$DIR" >> .env
  grep -q '^HOST_USER=' .env || echo "HOST_USER=$(id -un)" >> .env
  docker compose up -d --build --remove-orphans
  docker rm -f serverpaneel-ai >/dev/null 2>&1 || true
  ok "Serverpaneel is geupdatet."
  exit 0
fi

# ---------------------------------------------------------------- waarden detecteren
HOME_DIR="$HOME"
PUID="$(id -u)"; PGID="$(id -g)"
DOCKER_GID="$(stat -c %g /var/run/docker.sock)"
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
[ -n "$LAN_IP" ] || LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

c "Serverpaneel installeren voor gebruiker $USER (home: $HOME_DIR, IP: $LAN_IP)"
PANEL_PORT="$(ask 'Poort voor het paneel' 3000)"
if ss -tlnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$PANEL_PORT\$"; then wrn "Poort $PANEL_PORT is al in gebruik. Kies een andere."; exit 1; fi
SITES_ROOT="$(ask 'Map waar nieuwe sites komen' "$HOME_DIR/sites")"
mkdir -p "$SITES_ROOT" data caddy "$HOME_DIR/.serverpaneel/backups"

# ---------------------------------------------------------------- Caddy zoeken
CADDY_CONTAINER="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /caddy/ {print $1; exit}')"
CADDY_SITES_DIR="$DIR/caddy"; CADDY_INLINE=""; CF_FILE=""; UPSTREAM_HOST="172.17.0.1"; PANEL_DOMAIN=""; CADDY_TODO=""; EXTRA_ROOTS=""
if [ -n "$CADDY_CONTAINER" ]; then
  ok "Caddy gevonden: container '$CADDY_CONTAINER'"
  GW="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}' "$CADDY_CONTAINER" | awk '{print $1}')"
  NETMODE="$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CADDY_CONTAINER")"
  if [ "$NETMODE" = "host" ]; then UPSTREAM_HOST="127.0.0.1"; elif [ -n "$GW" ]; then UPSTREAM_HOST="$GW"; fi
  ok "Caddy bereikt het paneel via $UPSTREAM_HOST:$PANEL_PORT"

  CF_FILE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$CADDY_CONTAINER")"
  CF_DIR="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$CADDY_CONTAINER")"
  [ -z "$CF_FILE" ] && [ -n "$CF_DIR" ] && CF_FILE="$CF_DIR/Caddyfile"

  if [ -n "$CF_FILE" ] && [ -f "$CF_FILE" ] && [[ "$CF_FILE" == "$HOME_DIR"/* ]]; then
    # Je Caddyfile staat in je home-map: het paneel zet zijn domeinen in een eigen, gemarkeerd blok onderaan.
    # Je Caddy-container hoeft daarvoor niet aangepast of herstart te worden.
    CADDY_INLINE=1
    cp "$CF_FILE" "$DIR/data/Caddyfile.backup-$(date +%Y%m%d%H%M%S)"
    ok "Caddyfile gevonden: $CF_FILE (backup gemaakt in $DIR/data/)"
    if [ ! -w "$CF_FILE" ]; then
      wrn "Je gebruiker mag $CF_FILE niet aanpassen."
      if yes "Eigenaar veranderen naar $USER (met sudo)?"; then sudo chown "$PUID:$PGID" "$CF_FILE"; else CADDY_INLINE=""; CADDY_TODO="Het paneel kan je Caddyfile niet aanpassen: domeinen worden niet automatisch ingesteld."; fi
    fi
  elif [ -n "$CF_FILE" ]; then
    CADDY_TODO="Je Caddyfile ($CF_FILE) staat buiten je home-map. Domeinen via het paneel werken pas als die in je home-map staat."
  fi

  # mappen die Caddy toont maar buiten je home-map staan (bv. /var/www/portfolio): ook in het paneel beheren
  while IFS= read -r src; do
    [ -z "$src" ] && continue
    [[ "$src" == "$HOME_DIR"* || "$src" == /var/lib/docker* || "$src" == /etc* || "$src" == /run* || "$src" == /proc* || "$src" == /sys* ]] && continue
    [ -d "$src" ] || continue
    EXTRA_ROOTS="${EXTRA_ROOTS:+$EXTRA_ROOTS:}$src"
    ok "Extra websitemap gevonden: $src"
    if [ ! -w "$src" ]; then
      wrn "Je gebruiker mag $src niet aanpassen (nodig om die site via het paneel bij te werken)."
      if yes "Eigenaar van $src veranderen naar $USER (met sudo)?"; then sudo chown -R "$PUID:$PGID" "$src"; ok "$src is nu van $USER"; fi
    fi
  done < <(docker inspect -f '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}{{"\n"}}{{end}}{{end}}' "$CADDY_CONTAINER")

  echo
  echo "Voor 'buiten thuis' heb je een domein nodig, bv. een nieuwe gratis DuckDNS-naam (jouwpaneel.duckdns.org)."
  echo "Laat leeg als je het paneel alleen thuis wilt gebruiken."
  while :; do
    PANEL_DOMAIN="$(ask 'Domein voor het paneel' '')"
    PANEL_DOMAIN="${PANEL_DOMAIN#https://}"; PANEL_DOMAIN="${PANEL_DOMAIN#http://}"; PANEL_DOMAIN="${PANEL_DOMAIN%/}"; PANEL_DOMAIN="${PANEL_DOMAIN,,}"
    [ -z "$PANEL_DOMAIN" ] && break
    [[ "$PANEL_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] && break
    wrn "Dat is geen geldig domein. Voorbeeld: jouwpaneel.duckdns.org"
  done
  if [ -n "$PANEL_DOMAIN" ] && [ -n "$CF_FILE" ] && grep -qE "^[[:space:]]*$PANEL_DOMAIN([[:space:]]|,|\{)" "$CF_FILE"; then
    wrn "$PANEL_DOMAIN staat al in je Caddyfile. Kies een andere naam."; exit 1
  fi
  if [ -n "$PANEL_DOMAIN" ]; then
    cat > "$CADDY_SITES_DIR/panel.caddy" <<EOF
# Serverpaneel zelf (geen gzip: dat zou de live-gegevens ophouden)
$PANEL_DOMAIN {
	reverse_proxy $UPSTREAM_HOST:$PANEL_PORT {
		flush_interval -1
	}
}
EOF
  fi
else
  wrn "Geen Caddy-container gevonden. Het paneel werkt thuis, maar domeinen/https worden niet automatisch ingesteld."
fi

# ---------------------------------------------------------------- .env schrijven
cat > .env <<EOF
# Instellingen Serverpaneel (gemaakt door install.sh op $(date))
PUID=$PUID
PGID=$PGID
DOCKER_GID=$DOCKER_GID
HOME_DIR=$HOME_DIR
PANEL_PORT=$PANEL_PORT
SITES_ROOT=$SITES_ROOT
ALLOWED_ROOT=$HOME_DIR
EXTRA_ROOTS=$EXTRA_ROOTS
BACKUP_ROOT=$HOME_DIR/.serverpaneel/backups
CADDY_CONTAINER=$CADDY_CONTAINER
CADDY_SITES_DIR=$CADDY_SITES_DIR
CADDY_CONFIG=/etc/caddy/Caddyfile
CADDY_INLINE=$CADDY_INLINE
CADDYFILE_HOST=$CF_FILE
UPSTREAM_HOST=$UPSTREAM_HOST
HOST_LAN_IP=$LAN_IP
HOST_NAME=$(hostname)
PANEL_DOMAIN=$PANEL_DOMAIN
PANEL_DIR=$DIR
HOST_USER=$(id -un)
KEEP_BACKUPS=5
EOF
chmod 600 .env

# extra mappen (buiten je home) ook in de paneel-container zichtbaar maken, op hetzelfde pad
if [ -n "$EXTRA_ROOTS" ]; then
  { echo "# automatisch gemaakt door install.sh: extra websitemappen"; echo "services:"; echo "  serverpaneel:"; echo "    volumes:"
    IFS=':' read -ra R <<< "$EXTRA_ROOTS"; for r in "${R[@]}"; do echo "      - $r:$r"; done; } > docker-compose.override.yml
fi

# ---------------------------------------------------------------- starten
c "Paneel bouwen en starten (eerste keer duurt 3 tot 10 minuten)"
docker compose up -d --build
sleep 3
if docker ps --format '{{.Names}}' | grep -qx serverpaneel; then ok "Serverpaneel draait"; else wrn "Het paneel start niet. Kijk met: docker logs serverpaneel"; exit 1; fi
docker logs serverpaneel 2>&1 | grep -iE 'caddy|versie' || true

echo
ok "Klaar!"
echo
echo "  Thuis:          http://$LAN_IP:$PANEL_PORT   <- open dit NU om je wachtwoord te kiezen"
[ -n "$PANEL_DOMAIN" ] && echo "  Buiten thuis:   https://$PANEL_DOMAIN"
if [ -n "$CADDY_TODO" ]; then echo; wrn "$CADDY_TODO"; fi
if [ -n "$PANEL_DOMAIN" ]; then
  echo
  echo "  Voor buiten thuis nog doen:"
  echo "   1. Maak '${PANEL_DOMAIN%%.duckdns.org}' aan op https://www.duckdns.org (als dat nog niet gebeurd is)"
  if [ -d "$HOME_DIR/duckdns" ]; then
    echo "   2. Zet die naam ook in je DuckDNS-updater in $HOME_DIR/duckdns (bij domains=..., komma ertussen)"
  else
    echo "   2. Zet die naam ook in je DuckDNS-updater (zodat hij je IP blijft volgen)"
  fi
  echo "   3. Poort $PANEL_PORT NIET doorsturen in je router: buiten thuis ga je altijd via https"
fi
