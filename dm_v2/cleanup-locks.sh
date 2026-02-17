#!/bin/sh
# cleanup-locks.sh - Elimina bloqueos de Chromium y X11/VNC
# Se ejecuta al inicio del contenedor Y antes de cada login

# 1) Matar cualquier proceso Chrome que use el perfil (evita locks huérfanos)
if [ -n "${LOGIN_USERNAME}" ]; then
  PROFILE_DIR="/app/profiles/${LOGIN_USERNAME}"
  # Matar Chrome que apunte a este perfil (varios patrones por compatibilidad)
  pkill -9 -f "chrome.*${LOGIN_USERNAME}" 2>/dev/null || true
  pkill -9 -f "chromium.*${LOGIN_USERNAME}" 2>/dev/null || true
  pkill -9 -f "profiles/${LOGIN_USERNAME}" 2>/dev/null || true
  sleep 1

  # 2) BLOQUEOS DE CHROMIUM
  rm -f "${PROFILE_DIR}/SingletonLock" 2>/dev/null || true
  rm -f "${PROFILE_DIR}/SingletonCookie" 2>/dev/null || true
  rm -f "${PROFILE_DIR}/SingletonSocket" 2>/dev/null || true
  rm -f "${PROFILE_DIR}/Default/SingletonLock" 2>/dev/null || true
  rm -f "${PROFILE_DIR}/Default/SingletonCookie" 2>/dev/null || true
  rm -f "${PROFILE_DIR}/Default/SingletonSocket" 2>/dev/null || true

  # Limpiar directorios temporales de Chromium
  rm -rf /tmp/.org.chromium.Chromium.scoped_dir.* 2>/dev/null || true
fi

# 3) BLOQUEOS X11/VNC
rm -f /tmp/.X99-lock 2>/dev/null || true
rm -rf /tmp/.X11-unix/X99 2>/dev/null || true
find /tmp -maxdepth 1 -name '.X*-lock' -exec rm -f {} \; 2>/dev/null || true
