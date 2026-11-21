#!/usr/bin/env bash
# Keeps trying to create Oracle Cloud's free Ampere machine until a spot frees up ("Out of capacity" is common).
# Run it in Oracle's Cloud Shell (the >_ button at the top of the Oracle website), after making the network
# (docs/hosting-oracle.md, step 1):
#
#   curl -fsSLO https://raw.githubusercontent.com/suxhi-space/mustela/main/server/deploy/oracle-retry.sh
#   bash oracle-retry.sh
#
# It tries every zone once a minute. Leave the tab open; if Cloud Shell disconnects, run it again (it carries on).
# When it works it prints the machine's public IP, and you can log in from Cloud Shell itself with:  ssh mustela
set -uo pipefail

NAME=mustela
SHAPE=VM.Standard.A1.Flex
OCPUS=${OCPUS:-1}
MEMORY=${MEMORY:-6}
SUBNET_NAME=${SUBNET_NAME:-public subnet-mustela-vcn}
WAIT=${WAIT:-60}

C=${COMPARTMENT_ID:-${OCI_TENANCY:-}}
[ -n "$C" ] || { echo "Couldn't tell which account this is. Run it in Oracle's Cloud Shell."; exit 1; }

echo "== Looking things up"
existing=$(oci compute instance list --compartment-id "$C" --display-name "$NAME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output 2>/dev/null)
if [ -n "$existing" ] && [ "$existing" != "null" ]; then echo "A running machine called $NAME already exists. Nothing to do."; exit 0; fi

SUBNET=$(oci network subnet list --compartment-id "$C" --all --query "data[?\"display-name\"=='$SUBNET_NAME'].id | [0]" --raw-output)
[ -n "$SUBNET" ] && [ "$SUBNET" != "null" ] || { echo "No subnet called '$SUBNET_NAME'. Make the network first (guide, step 1)."; exit 1; }

IMAGE=$(oci compute image list --compartment-id "$C" --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output)
[ -n "$IMAGE" ] && [ "$IMAGE" != "null" ] || { echo "Couldn't find the Ubuntu 24.04 image for $SHAPE."; exit 1; }

mapfile -t ADS < <(oci iam availability-domain list --compartment-id "$C" --query 'data[].name' | jq -r '.[]')
[ ${#ADS[@]} -gt 0 ] || { echo "Couldn't list the zones."; exit 1; }

# A login key kept in Cloud Shell, so you can log in from here with "ssh mustela".
# RSA: Cloud Shell runs in FIPS mode, which doesn't allow ed25519 keys.
mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f ~/.ssh/mustela.pub ] || ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/mustela -C mustela >/dev/null
[ -f ~/.ssh/mustela.pub ] || { echo "Couldn't make the login key in ~/.ssh."; exit 1; }

echo "== Trying (zones: ${ADS[*]}). Ctrl+C to stop."
tries=0
while :; do
  for AD in "${ADS[@]}"; do
    tries=$((tries + 1))
    out=$(oci compute instance launch --availability-domain "$AD" --compartment-id "$C" --display-name "$NAME" \
      --shape "$SHAPE" --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY}" \
      --image-id "$IMAGE" --subnet-id "$SUBNET" --assign-public-ip true \
      --ssh-authorized-keys-file ~/.ssh/mustela.pub --query 'data.id' --raw-output 2>&1)
    if [[ "$out" == ocid1.instance.* ]]; then
      echo "$(date +%H:%M) Got one in $AD. Starting it up..."
      oci compute instance get --instance-id "$out" --wait-for-state RUNNING --max-wait-seconds 900 >/dev/null 2>&1
      IP=$(oci compute instance list-vnics --instance-id "$out" --query 'data[0]."public-ip"' --raw-output)
      grep -q "^Host mustela$" ~/.ssh/config 2>/dev/null || printf 'Host mustela\n  HostName %s\n  User ubuntu\n  IdentityFile ~/.ssh/mustela\n' "$IP" >> ~/.ssh/config
      echo
      echo "Done. Public IP: $IP"
      echo "1. Add the DNS record: A  servers  $IP"
      echo "2. Log in from here:   ssh mustela"
      echo "3. Then follow the guide from step 4 (git clone ... and sudo bash setup.sh servers.yourdomain.com)"
      exit 0
    fi
    if grep -qi "capacity" <<<"$out"; then echo "$(date +%H:%M) try $tries: $AD is full";
    elif grep -qi "TooManyRequests\|LimitExceeded" <<<"$out"; then echo "$(date +%H:%M) Oracle says slow down, waiting longer"; sleep 120;
    else
      why=$(grep -m1 -i '"message"' <<<"$out" | sed 's/^ *//'); [ -n "$why" ] || why=$(grep -v '^\s*$' <<<"$out" | tail -n 2 | tr '\n' ' ')
      echo "$(date +%H:%M) try $tries: $AD: ${why:-no answer}"
    fi
  done
  sleep "$WAIT"
done
