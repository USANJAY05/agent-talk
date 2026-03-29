# TLS Certificates

Place your certificates here:

```
nginx/certs/fullchain.pem   ← certificate chain (cert + intermediates)
nginx/certs/privkey.pem     ← private key
```

## Let's Encrypt (Certbot)

```bash
certbot certonly --standalone -d yourdomain.com
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/certs/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem   nginx/certs/
```

## Self-signed (development only)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/certs/privkey.pem \
  -out nginx/certs/fullchain.pem \
  -subj "/CN=localhost"
```

This directory is gitignored. Never commit private keys.
