"""UI + motor real mediante transporte en memoria, con proveedor de inferencia de QA.
No usa una API de modelos ni sustituye el proveedor en la aplicación entregada.
Requiere Python Playwright y Chromium instalados.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
screens = root / 'replica' / 'clone-screens'
screens.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='orbita-ui-') as data:
    backend = subprocess.Popen(['node', str(root / 'tests/ui-bridge.mjs'), data], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 900})
            def route_handler(route):
                request = route.request
                url = urlsplit(request.url)
                assert url.hostname == 'localhost', 'La prueba no debe contactar servicios externos'
                backend.stdin.write(json.dumps({'method': request.method, 'path': url.path, 'headers': request.headers, 'body': request.post_data}) + '\n')
                backend.stdin.flush()
                output = json.loads(backend.stdout.readline())
                route.fulfill(status=output['status'], headers=output['headers'], body=base64.b64decode(output['body']))
            context.route('**/*', route_handler)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://localhost:3000/')
            expect(page.get_by_role('heading', name='Dale una tarea a Atlas')).to_be_visible()
            page.screenshot(path=str(screens / 'S02-desktop.png'), full_page=True)
            page.get_by_role('button', name='Nuevo bot').click()
            page.get_by_label('Nombre', exact=True).fill('Nora')
            page.get_by_label('Responsabilidad').fill('Revisión de documentos')
            page.get_by_label('Cómo debe trabajar').fill('Verifica cada afirmación')
            page.get_by_role('button', name='Guardar', exact=True).click()
            expect(page.get_by_role('heading', name='Dale una tarea a Nora')).to_be_visible()
            page.get_by_role('textbox', name='Mensaje para Nora').fill('crear archivo de resultado')
            page.get_by_role('button', name='Enviar tarea').click()
            expect(page.get_by_role('button', name='Permitir una vez')).to_be_visible(timeout=8000)
            page.screenshot(path=str(screens / 'S02-approval.png'), full_page=True)
            page.get_by_role('button', name='Permitir una vez').click()
            expect(page.get_by_text('El archivo se ha creado y está disponible en Archivos.', exact=True)).to_be_visible(timeout=8000)
            page.get_by_role('button', name='Archivos', exact=True).click()
            expect(page.get_by_text('resultado.md', exact=True)).to_be_visible()
            with page.expect_download() as result:
                page.get_by_role('button', name='Descargar resultado.md').click()
            downloaded = Path(result.value.path()).read_text()
            assert 'herramienta real' in downloaded
            page.get_by_role('button', name='Skills', exact=True).click()
            page.get_by_role('button', name='Nueva skill').click()
            page.get_by_label('Nombre del proceso').fill('Revisar fuentes')
            page.get_by_label('Pasos, resultado esperado y límites').fill('Comprueba fuentes y marca supuestos.')
            page.get_by_role('button', name='Guardar', exact=True).click()
            expect(page.get_by_role('heading', name='Revisar fuentes')).to_be_visible()
            page.get_by_role('button', name='Rutinas', exact=True).click()
            page.get_by_role('button', name='Nueva rutina').click()
            page.get_by_label('Nombre', exact=True).fill('Revisión diaria')
            page.get_by_label('Tarea que debe ejecutar').fill('Resume lo aprendido')
            page.get_by_role('button', name='Guardar', exact=True).click()
            expect(page.get_by_role('heading', name='Revisión diaria')).to_be_visible()
            page.get_by_role('button', name='Pausar', exact=True).click()
            expect(page.get_by_text('Pausada', exact=True)).to_be_visible()
            page.get_by_role('button', name='Ejecutar', exact=True).click()
            expect(page.get_by_text('Respuesta del proveedor de QA a: Resume lo aprendido', exact=True)).to_be_visible(timeout=8000)
            page.get_by_role('textbox', name='Mensaje para Nora').fill('crear archivo que debe cancelarse')
            page.get_by_role('button', name='Enviar tarea').click()
            expect(page.get_by_role('button', name='Permitir una vez')).to_be_visible(timeout=8000)
            page.get_by_role('button', name='Detener', exact=True).click()
            expect(page.get_by_text('Tarea detenida. Los cambios ya realizados se conservan.', exact=True)).to_be_visible(timeout=8000)
            page.reload()
            expect(page.get_by_role('button', name='Nora Revisión de documentos')).to_be_visible()
            page.set_viewport_size({'width': 390, 'height': 844})
            page.get_by_role('button', name='Abrir menú').click()
            page.get_by_role('button', name='Nora Revisión de documentos').click()
            expect(page.get_by_role('textbox', name='Mensaje para Nora')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(screens / 'S02-mobile.png'), full_page=True)
            assert not errors, errors
            browser.close()
            print('UI: 8 flujos aprobados; escritorio 1440×900, móvil 390×844, sin errores JS. Transporte HTTP en memoria y proveedor de QA.')
    finally:
        if backend.poll() is None:
            backend.stdin.write('{"close":true}\n')
            backend.stdin.flush()
            backend.wait(timeout=10)
