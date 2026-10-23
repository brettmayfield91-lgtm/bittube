# Host BitTube on Hetzner Cloud (beginner guide)

This guide takes you from a brand-new Hetzner account to a running BitTube site at your own domain, with HTTPS, video storage, the AI moderation plugin, backups and updates.

It follows the official PeerTube Docker guide (`support/doc/docker.md` in this repo, also at https://docs.joinpeertube.org/install/docker) and the Hetzner docs (https://docs.hetzner.com). BitTube is a fork of PeerTube, so nearly every PeerTube instruction applies.

Time needed: about 1 to 2 hours, plus waiting for DNS. You type commands into a terminal; each block below can be copied as is, after you replace anything in `<ANGLE BRACKETS>`.

> **Important:** pick your domain before you start. PeerTube (and BitTube) cannot change its domain after the first start.

---

## 0. What you need

- A domain name you control (for example `video.example.com`), from any registrar.
- A computer with a terminal (macOS Terminal, Linux, or Windows PowerShell).
- A payment method for Hetzner.
- An API key for an OpenAI-compatible AI service, if you want the moderation plugin.

## 1. Create a Hetzner account (choose USD)

1. Go to https://accounts.hetzner.com/signUp and sign up.
2. During signup, pick **USD** as your billing currency if the form offers it. Hetzner may not let you change the currency later, so check it before you confirm.
3. Confirm your email and complete identity/payment verification. New accounts are sometimes reviewed by hand; this can take a little while.
4. Open the **Hetzner Console** at https://console.hetzner.com and create a **Project** (for example `bittube`).

## 2. Choose a location and server size

**Location.** Hetzner Cloud has US locations (Ashburn, VA `ash` and Hillsboro, OR `hil`) and European ones (Falkenstein `fsn1`, Nuremberg `nbg1`, Helsinki `hel1`). Source: https://docs.hetzner.com/cloud/general/locations/

- **Hetzner Object Storage only exists in Europe** (`fsn1`, `nbg1`, `hel1`). If you want to store videos in Hetzner Object Storage (step 9), the simplest setup is to put the server in the same European location.
- If most of your viewers are in the US and you prefer a US server, that works too: either keep videos on the server's disk or a Hetzner Volume, or point Object Storage at a European bucket and accept some extra delay.
- In US locations, only the shared **AMD** (`CPX`) and dedicated **AMD** (`CCX`) server types are offered.

**Size.** PeerTube's docs ask for at least 1 vCPU and 2 GB RAM for a tiny instance, more for transcoding (converting uploaded videos). For BitTube:

| Use | Suggested type |
| --- | --- |
| Just trying it out, few uploads | CPX21-class (3 vCPU, 4 GB RAM) |
| Real use, regular uploads, building the image on the server | CPX31-class (4 vCPU, 8 GB RAM) or larger |

Building BitTube's Docker image from source (step 6) needs several GB of RAM, so CPX31-class is the comfortable minimum if you build on the server. Exact server names change over time; pick the closest current shared AMD type.

## 3. Create an SSH key (your login key)

An SSH key lets you log in safely without a password.

On your computer:

```bash
ssh-keygen -t ed25519 -C "bittube"
```

Press Enter to accept the default file, and set a passphrase. Then show the public key:

```bash
cat ~/.ssh/id_ed25519.pub
```

Copy the whole line. In Hetzner Console: **Security > SSH Keys > Add SSH key**, paste it, save.

## 4. Create the firewall and the server

**Firewall** (Console > **Firewalls > Create Firewall**). Allow incoming:

| Port | Why |
| --- | --- |
| TCP 22 | SSH (you can restrict it to your own IP) |
| TCP 80 | HTTP (needed for the HTTPS certificate) |
| TCP 443 | HTTPS (the website) |
| TCP 1935 | Live streaming (RTMP); skip if you won't do live |

**Server** (Console > **Servers > Add Server**):

1. Location: from step 2.
2. Image: **Ubuntu 24.04** (the current Ubuntu LTS; pick a newer LTS if listed).
3. Type: from step 2.
4. Networking: keep public IPv4 and IPv6.
5. SSH keys: select the key from step 3.
6. Firewalls: select your firewall.
7. Backups: turn on (see step 11).
8. Name it `bittube` and create it.

Copy the server's **IPv4 address** (and IPv6 if shown).

## 5. Point your domain at the server (DNS)

At your domain registrar (or Hetzner DNS), create:

| Type | Name | Value |
| --- | --- | --- |
| A | `video` (or `@` for the bare domain) | your server IPv4 |
| AAAA | same | your server IPv6 (optional) |

Wait until it works. On your computer:

```bash
ping video.example.com
```

It should answer from your server's IP. DNS can take minutes to hours.

Log in to the server:

```bash
ssh root@<SERVER_IP>
```

Update it and install Docker (official Docker script):

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
docker compose version   # must show 2.x or higher
```

## 6. Get BitTube onto the server

There is **no prebuilt BitTube Docker image yet**. The official `chocobozzz/peertube` image is plain PeerTube, without BitTube's branding or plugin. So you build the image yourself from the fork. This is the honest requirement:

- It takes a while (often 15 to 40 minutes) and needs enough RAM (CPX31-class recommended).
- You repeat it on every update (step 12).

```bash
mkdir -p /opt && cd /opt
git clone --branch develop https://github.com/brettmayfield91-lgtm/bittube.git
cd bittube
docker build -f support/docker/production/Dockerfile -t bittube:develop .
```

Note: `develop` is the fork's active branch and can contain unfinished work. For a stable site, later use a tagged release once the project publishes one.

Prepare the run folder with the official compose and env files from the repo:

```bash
mkdir -p /opt/bittube-run && cd /opt/bittube-run
cp /opt/bittube/support/docker/production/docker-compose.yml .
cp /opt/bittube/support/docker/production/.env .
mkdir -p docker-volume/nginx docker-volume/nginx-logs docker-volume/certbot
cp /opt/bittube/support/nginx/peertube docker-volume/nginx/peertube
```

Tell compose to use your BitTube image. Open the file:

```bash
nano docker-compose.yml
```

In the `peertube:` service, change

```yaml
    image: chocobozzz/peertube:production
```

to

```yaml
    image: bittube:develop
```

Save with Ctrl+O, Enter, then exit with Ctrl+X. Leave the `webserver` image as `chocobozzz/peertube-webserver:latest`; it's only nginx and serves BitTube's files from the `peertube` container.

## 7. Fill in settings (.env)

Create a secret first:

```bash
openssl rand -hex 32
```

Then:

```bash
nano .env
```

Replace these placeholders:

- `<MY POSTGRES USERNAME>`: e.g. `bittube`
- `<MY POSTGRES PASSWORD>`: a long random password
- `<MY DOMAIN>`: e.g. `video.example.com` (no `https://`)
- `<MY EMAIL ADDRESS>`: your email
- `<MY PEERTUBE SECRET>`: the value from `openssl rand -hex 32`

Email: Hetzner blocks outgoing mail ports (25 and 465) on new accounts by default, so the built-in `postfix` relay may not deliver mail. The easiest fix is to use an email provider's SMTP (set `PEERTUBE_SMTP_HOSTNAME`, `PEERTUBE_SMTP_PORT=587`, `PEERTUBE_SMTP_USERNAME`, `PEERTUBE_SMTP_PASSWORD`). See https://docs.hetzner.com/cloud/servers/faq/ for the port policy.

## 8. HTTPS certificate and first start

Get the first free certificate from Let's Encrypt (DNS from step 5 must already work):

```bash
docker run -it --rm --name certbot -p 80:80 \
  -v "$(pwd)/docker-volume/certbot/conf:/etc/letsencrypt" \
  certbot/certbot certonly --standalone
```

Answer the questions (your email, agree, your domain). The compose file's `certbot` container renews it automatically afterwards.

Start everything:

```bash
docker compose up -d
docker compose logs -f peertube
```

Wait until the logs calm down, then press Ctrl+C. Get the admin password:

```bash
docker compose logs peertube | grep -A1 root
```

Open `https://video.example.com`, log in as `root` with that password, and change it right away (or run `docker compose exec -u peertube peertube npm run reset-password -- -u root`).

## 9. Store videos in Hetzner Object Storage (optional, recommended)

Videos fill a disk fast. Object Storage keeps them in Hetzner's S3-compatible storage instead.

1. Console > **Object Storage > Create Bucket**. Pick a location (`fsn1`, `nbg1` or `hel1`). Create two buckets, for example `bittube-streaming` and `bittube-webvideos`. Bucket names must be unique across Hetzner.
2. Set each bucket's visibility to public read, so viewers can load videos.
3. Console > **Security > S3 credentials > Generate credentials**. Save the access key and secret key immediately; the secret can't be shown again. Docs: https://docs.hetzner.com/storage/object-storage/getting-started/generating-s3-keys/

Add to `.env` (replace `fsn1` with your location):

```bash
PEERTUBE_OBJECT_STORAGE_ENABLED=true
PEERTUBE_OBJECT_STORAGE_ENDPOINT=https://fsn1.your-objectstorage.com
PEERTUBE_OBJECT_STORAGE_REGION=fsn1
PEERTUBE_OBJECT_STORAGE_CREDENTIALS_ACCESS_KEY_ID=<ACCESS_KEY>
PEERTUBE_OBJECT_STORAGE_CREDENTIALS_SECRET_ACCESS_KEY=<SECRET_KEY>
PEERTUBE_OBJECT_STORAGE_STREAMING_PLAYLISTS_BUCKET_NAME=bittube-streaming
PEERTUBE_OBJECT_STORAGE_WEB_VIDEOS_BUCKET_NAME=bittube-webvideos
```

Restart:

```bash
docker compose up -d
```

Upload a short test video and check that it plays. If uploads fail with an access error, check the bucket visibility and keys, and see PeerTube's object storage notes: https://docs.joinpeertube.org/admin/remote-storage

## 10. Install and configure the AI moderation plugin

The plugin is already inside your BitTube image at `/app/plugins/peertube-plugin-bittube-moderation`. Install it:

```bash
cd /opt/bittube-run
docker compose exec -u peertube peertube \
  npm run plugin:install -- --plugin-path /app/plugins/peertube-plugin-bittube-moderation
docker compose restart peertube
```

Then in the website: **Administration > Plugins/Themes > Installed > bittube-moderation > Settings**:

- **API base URL:** e.g. `https://api.openai.com/v1`, or any OpenAI-compatible service.
- **API key:** paste your key. It's a private setting, only the server sees it.
- **Model** and **Confidence threshold** (default `0.8`).
- Leave **Hide flagged videos** off at first. Add a **Notify email** if email works.

The plugin never deletes or bans; it flags content for you to review. If the AI service is down, uploads and comments keep working. Details: `plugins/peertube-plugin-bittube-moderation/README.md`.

Note: plugins installed from a local path may need reinstalling after you rebuild the image (step 12). If the plugin disappears after an update, run the install command again.

## 11. Backups

Use more than one kind:

1. **Hetzner server backups** (turned on in step 4): daily copies of the whole server, kept for a few days. Docs: https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/
2. **Snapshot before every update:** Console > your server > **Snapshots > Create snapshot**.
3. **Database dump** (most important). Run on the server, for example daily via cron:

```bash
cd /opt/bittube-run
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' | gzip > backups/db-$(date +%F).sql.gz
```

Copy the `backups` folder, plus `.env` and `docker-volume/config`, somewhere off the server (for example a different Object Storage bucket in another location, using `rclone`; see https://docs.hetzner.com/storage/object-storage/getting-started/using-s3-api-tools/).

Videos in Object Storage live in one location only and are not copied elsewhere automatically. Back them up separately if losing them would hurt.

## 12. Updating BitTube

Before updating, take a snapshot (step 11) and read the PeerTube changelog's IMPORTANT NOTES: https://github.com/Chocobozzz/PeerTube/blob/develop/CHANGELOG.md

```bash
cd /opt/bittube
git pull
docker build -f support/docker/production/Dockerfile -t bittube:develop .

cd /opt/bittube-run
docker compose down -v      # -v clears cached website files; your data in docker-volume stays
cp docker-volume/nginx/peertube docker-volume/nginx/peertube.bak
cp /opt/bittube/support/nginx/peertube docker-volume/nginx/peertube
docker compose up -d
```

Also update Ubuntu now and then:

```bash
apt update && apt upgrade -y
```

## 13. Costs

You pay Hetzner for the server, any backups and snapshots, Object Storage, and traffic above what's included. Prices differ by location and change over time, so check the official pages before choosing:

- Cloud servers: https://www.hetzner.com/cloud/
- Object Storage: https://www.hetzner.com/storage/object-storage/

Your AI moderation provider bills separately, per request. You also pay your registrar for the domain.

## Help

- PeerTube docs (applies to BitTube): https://docs.joinpeertube.org
- Hetzner docs: https://docs.hetzner.com
- BitTube issues: https://github.com/brettmayfield91-lgtm/bittube/issues
