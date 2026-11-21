# Hosting a Mustela server on Oracle Cloud (free)

This puts the Mustela server (profiles, decorations, banners, what people are playing) on Oracle Cloud's "Always Free"
machine, on your own domain with HTTPS. 50 to 100 people at once is light work for it. About 30 minutes.

You need: an Oracle Cloud account and your domain. Do the steps in this order: the network first, then the machine.

## 1. Make the network (with the web ports open)

1. cloud.oracle.com > menu ☰ > **Networking** > **Virtual cloud networks**.
2. **Actions** > **Start VCN Wizard** (or the **Start VCN Wizard** button) > **Create VCN with Internet Connectivity** >
   **Start VCN Wizard**.
3. Name: `mustela-vcn`. Leave everything else > **Next** > **Create**. Wait until it says it's done.
4. Open `mustela-vcn` > **Subnets** > `public subnet-mustela-vcn` > **Security** > **Default Security List for
   mustela-vcn** > **Security rules** > **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range `80`
   - **+ Another Ingress Rule**: Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range `443`
   - **Add Ingress Rules**. The list now has 5 rules (22, two ICMP, 80, 443).

## 2. Make the machine

Open a **fresh** create page (it only sees networks that existed when it opened):

1. Menu ☰ > **Compute** > **Instances** > **Create instance**.
2. Name: `mustela`. Availability domain: AD 1.
3. **Image**: **Change image** > **Canonical Ubuntu 24.04**.
4. **Shape**: **Change shape** > **Ampere** > **VM.Standard.A1.Flex**, 1 OCPU, 6 GB memory ("Always Free-eligible").
5. **Next** past **Security** (no changes).
6. **Networking**:
   - Primary network: **Select existing virtual cloud network** > `mustela-vcn`
   - Subnet: **Select existing subnet** > `public subnet-mustela-vcn` (not the private one)
   - **Automatically assign public IPv4 address**: **on** (if it stays greyed out, see "No public IP" below)
   - **Add SSH keys**: **Generate a key pair for me** > **Download private key**. Keep this file safe: it's your only way
     to log in, and Oracle won't show it again.
7. **Next** past **Storage** (no changes) > **Create**.
   - "Out of capacity"? Go back, pick AD 2 or AD 3, and try again. It's common.
8. When it says **Running**, copy the **Public IP address** from the instance page.

**No public IP?** (the switch was greyed out, or the page shows none): instance > **Networking** > **Attached VNICs** >
the VNIC > **IPv4 addresses** > **⋯** > **Edit** > Public IP type **Ephemeral public IP** > **Update**.

## 3. Point your domain at it

In your domain's DNS settings (where you bought it), add:

| Type | Name | Value |
|---|---|---|
| A | `servers` | the Public IP from step 2 |

That makes `servers.yourdomain.com`. It can take a few minutes to start working.

## 4. Log in and set it up

The code must be on GitHub first (push it; that isn't a release). Then on Windows, in PowerShell:

```
ssh -i C:\path\to\the-private-key.key ubuntu@YOUR_PUBLIC_IP
```

Type `yes` the first time. (If it says the key's permissions are too open: right-click the key file > Properties >
Security > Advanced > Disable inheritance > remove everyone except your own user.)

Then on the server, one line at a time:

```
git clone https://github.com/suxhi-space/mustela.git
```
```
cd mustela/server/deploy
```
```
sudo bash setup.sh servers.yourdomain.com
```

It installs Docker, opens the ports inside the machine, starts the server with HTTPS (a free certificate that renews by
itself), restarts it after reboots, and keeps a daily backup of its data (the last 14 days, in `backups`).

## 5. Check it

Open `https://servers.yourdomain.com/v1/health` in a browser. It should show something like
`{"name":"Mustela server","version":"1.3.0",...}`. (If the page doesn't load yet, the DNS record may need a few more
minutes; run `sudo bash setup.sh servers.yourdomain.com` again once it works, so the certificate is made.)

Then in Mustela: **Settings > Sync & servers**, put `https://servers.yourdomain.com` in the box, and **Add server**.

## Using another host instead (Vultr, Hetzner, DigitalOcean: about $4-6 a month)

No capacity problems, ready in a minute. Any small Ubuntu 24.04 server with 1 GB of memory works.

1. Make the server: Ubuntu 24.04, the smallest plan with 1 GB memory, a location near you (e.g. Chicago). No paid
   backups needed (the setup keeps its own). For logging in, add an SSH key or use the root password it shows you.
2. Copy its IP address and add the DNS record from step 3 (A, `servers`, the IP).
3. Log in: `ssh root@THE_IP` (type `yes` the first time, then the password if it asks).
4. Same three lines as step 4 (`git clone ...`, `cd mustela/server/deploy`, `sudo bash setup.sh servers.yourdomain.com`),
   then check it as in step 5. The setup opens the web ports by itself.

## Later

- **Update the server** (after a Mustela release changes it): log in, then `cd mustela/server/deploy && bash update.sh`
- **See what it's doing:** `cd mustela/server/deploy && sudo docker compose logs --tail 50 mustela`
- **Restart it:** `cd mustela/server/deploy && sudo docker compose restart`
- **Backups** are in `mustela/server/deploy/backups`. To restore one: `sudo docker compose down`, then
  `sudo tar xzf backups/data-DATE.tgz`, then `sudo docker compose up -d`.

## Good to know

- When someone links the server, Mustela sends it their Stoat sign-in once, so it can ask Stoat whose account it is.
  The server uses it for that one request and never stores or logs it. Its logs never contain sign-ins or what people send.
- What it keeps: people's profile settings and per-server banners (pictures, 512 KB at most) in `data/`, and what
  they're playing (in memory only, gone after 3 minutes or a restart).
- Oracle may reclaim "Always Free" machines that sit almost completely idle for a week; a server people use isn't idle.
  Upgrading the account to "Pay As You Go" (still free within these limits) avoids that.
