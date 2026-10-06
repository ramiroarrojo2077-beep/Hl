#!/usr/bin/env bash
# Trae la versión jugable de cada juego desde su repositorio y la deja en
# portafolio/juegos/<juego>/, lista para servir como sitio estático.
#
#   ./portafolio/armar.sh                 # clona los repos en una carpeta temporal
#   FUENTES=~/repos ./portafolio/armar.sh  # usa clones que ya tengas
#
# Cupi (repo Plot) se compila con Vite, así que hace falta Node y npm.
set -euo pipefail

usuario=ramiroarrojo2077-beep
destino="$(cd "$(dirname "$0")" && pwd)/juegos"
if [ -n "${FUENTES:-}" ]; then
  fuentes=$FUENTES
else
  fuentes=$(mktemp -d)
  trap 'rm -rf "$fuentes"' EXIT
fi

repo() {
  local nombre=$1
  if [ ! -d "$fuentes/$nombre/.git" ]; then
    git clone -q --depth 1 "https://github.com/$usuario/$nombre.git" "$fuentes/$nombre"
  fi
  echo "$fuentes/$nombre"
}

# copiar <repo> <juego> <rutas...>: copia las rutas del repo, conservando su estructura.
copiar() {
  local origen juego=$2
  origen=$(repo "$1")
  shift 2
  rm -rf "${destino:?}/$juego"
  mkdir -p "$destino/$juego"
  (cd "$origen" && cp -R --parents "$@" "$destino/$juego/")
  echo "  $juego"
}

# unico <repo> <juego> <archivo>: juegos empaquetados en un solo HTML.
unico() {
  local origen
  origen=$(repo "$1")
  rm -rf "${destino:?}/$2"
  mkdir -p "$destino/$2"
  cp "$origen/$3" "$destino/$2/index.html"
  echo "  $2"
}

echo "Armando juegos en $destino"
unico F1   gran-premio      granpremio.html
unico Plam cinco-noches     index.html
unico rpg  ecos-del-vacio   game/dist/ecos-del-vacio.html
unico Pl   lavarropas       index.html
copiar F19 f19-grand-prix   index.html css js vendor
copiar Rl  rocket-arena     index.html styles.css src vendor
copiar Ax  gran-premio-3d   index.html css js vendor icons manifest.webmanifest sw.js
copiar Fut doce-pasos       index.html jugador.js mocap.js
copiar Pax pax              Web/index.html
copiar uuu geometry-wave    public

# Pax y Geometry Wave tienen el juego en una subcarpeta: se sube a la raíz del juego.
mv "$destino/pax/Web/index.html" "$destino/pax/index.html" && rmdir "$destino/pax/Web"
# El index de Pax es un fragmento sin <head>: se le agrega para que no salga con mojibake.
sed -i '1i <!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">' "$destino/pax/index.html"
mv "$destino/geometry-wave/public/"* "$destino/geometry-wave/" && rmdir "$destino/geometry-wave/public"

plot=$(repo Plot)
(cd "$plot" && npm ci --no-audit --no-fund --silent && npm run build --silent)
rm -rf "${destino:?}/cupi"
cp -R "$plot/dist" "$destino/cupi"
echo "  cupi"
