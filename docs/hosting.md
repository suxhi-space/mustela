# Hosting a Mustela server

A Mustela server keeps what Stoat has no place for: decorations, frames, effects, nameplates, profile colours,
per-server banners, and what people are playing. This puts one online on your own domain, with HTTPS, on a small
rented server (about $5 a month). 50 to 100 people at once is light work for it. About 15 minutes.

You need: your domain, a Vultr account (or Hetzner or DigitalOcean, the steps are the same), and the Mustela code on
GitHub (push it first; that doesn't publish a release).

## 1. Rent the server (Vultr)

vultr.com > **Deploy +** > **Deploy New Server**:

| Setting | Pick |
|---|---|
| Type | **Cloud Compute**, **Shared CPU** |
| Location | **Chicago** (or wherever's closest to most of your people) |
| Image | **Ubuntu 24.04** |
| Plan | **1 vCPU / 1 GB** (about $5/month). Not the 512 MB one, it's too small |
| Auto backups | **Off** (the setup keeps its own daily backup) |
| SSH keys | Skip (you'll log in with the password) |
| Hostname | `mustela` |

Then **Deploy**. When it says **Running**, open it and copy the **IP Address** and the **Password** (eye icon).

## 2. Point your domain at it

In your domain's DNS settings (where you bought it), add a record:

| Type | Name | Value |
|---|---|---|
| A | `servers` | the IP address from step 1 |

That makes `servers.yourdomain.com`. It can take a few minutes to start working.

## 3. Log in

In PowerShell (Windows) or Terminal (Mac):

```
ssh root@THE_IP
```

Type `yes` the first time, then paste the password (nothing shows while you paste or type it, that's normal) and press
Enter.

## 4. Set it up

On the server, one line at a time:

```
git clone https://github.com/suxhi-space/mustela.git
```
```
cd mustela/server/deploy
```
```
sudo ./setup.sh servers.yourdomain.com
```

It installs Docker, opens the web ports, starts the server with HTTPS (a free certificate that renews by itself),
restarts it after reboots, and keeps a daily backup of its data (the last 14 days, in `backups`).

## 5. Check it

1. In a browser, open `https://servers.yourdomain.com/v1/health`. It should show a short line like
   `{"name":"Mustela server","version":"1.3.0",...}`.
   - Doesn't load yet? The DNS record may need a few more minutes. Then run the setup line again
     (`sudo ./setup.sh servers.yourdomain.com`) so the certificate gets made.
2. In Mustela: **Settings > Sync & servers**, put `https://servers.yourdomain.com` in the server box > **Add server** >
   **Link**.
3. Have a friend do the same. You'll see each other's decorations and what you're playing.

## Later

All from the `mustela/server/deploy` folder after logging in (`ssh root@THE_IP`, then `cd mustela/server/deploy`):

| To | Run |
|---|---|
| Update the server (after a Mustela release changes it) | `./update.sh` |
| See what it's doing | `sudo docker compose logs --tail 50 mustela` |
| Restart it | `sudo docker compose restart` |
| Restore a backup | `sudo docker compose down`, then `sudo tar xzf backups/data-DATE.tgz`, then `sudo docker compose up -d` |

## Good to know

- **Sign-ins:** when someone links the server, Mustela sends it their Stoat sign-in once, so it can ask Stoat whose
  account it is. The server uses it for that one request and never stores or logs it. Its logs never contain sign-ins
  or what people send.
- **What it keeps:** profile settings and per-server banners (pictures, 512 KB at most) in `data/`, and what people are
  playing (in memory only, gone after 3 minutes or a restart).
- **Cost:** only the server rent. The HTTPS certificate is free and renews by itself.
- **Free option:** Oracle Cloud's "Always Free" machine also works, but it's often "out of capacity". See
  [hosting-oracle.md](hosting-oracle.md).
