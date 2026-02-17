#!/bin/bash
# Actualiza todos los contenedores que usan ghcr.io/shiftdm/dm_v2:latest
# Busca docker-compose.yml en /DM (o ruta que pases como argumento)

set -e

IMAGE="ghcr.io/shiftdm/dm_v2:latest"
BASE_DIR="${1:-/DM}"

echo "🔍 Buscando contenedores que usan $IMAGE en $BASE_DIR..."
echo ""

find "$BASE_DIR" -maxdepth 3 \( -name "docker-compose.yml" -o -name "docker-compose.yaml" \) 2>/dev/null | while read -r f; do
  if grep -q "shiftdm/dm_v2" "$f" 2>/dev/null; then
    dir=$(dirname "$f")
    echo "📦 Actualizando: $dir"
    (cd "$dir" && docker pull "$IMAGE" && docker compose down && docker compose up -d)
    echo "✅ Listo: $dir"
    echo ""
  fi
done

echo "🎉 Actualización completada."
