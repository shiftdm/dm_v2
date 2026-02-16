# DM v2 - Comandos

## Build
```bash
docker build --platform linux/amd64 -t ghcr.io/shiftdm/dm_v2:latest .
```

## Push
```bash
docker push ghcr.io/shiftdm/dm_v2:latest
```

## Run (ejemplo)
```bash
docker run -d -p 3001:3001 -p 6080:6080 --env-file .env ghcr.io/shiftdm/dm_v2:latest
```
