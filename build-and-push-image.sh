#!/bin/bash
# Construye la imagen localmente y la sube a ghcr.io
# Úsalo si la imagen automática no se actualiza correctamente

set -e

IMAGE="ghcr.io/shiftdm/dm_v2:latest"

echo "🔨 Construyendo imagen (sin cache)..."
docker build --no-cache -t "$IMAGE" .

echo ""
echo "📤 Subiendo a ghcr.io (requiere: docker login ghcr.io)..."
docker push "$IMAGE"

echo ""
echo "✅ Imagen actualizada. Ejecuta ./update-dm-containers.sh para reiniciar los contenedores."
