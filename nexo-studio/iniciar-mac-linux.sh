#!/bin/sh
cd "$(dirname "$0")" || exit 1
node --version || { echo 'Primero instalá Node.js 22 o superior'; exit 1; }
echo 'Abrí http://127.0.0.1:3377 en tu navegador'
npm start
