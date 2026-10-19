"""Consulta y descarga SEACE; ensayo aislado por defecto, sin publicar en GitHub."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import time

import importar_convocatorias_seace as imp

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.deps/xlrd-2.0.2-py2.py3-none-any.whl'))
sys.path.insert(0, str(ROOT))
from exportar_dashboard_v2 import exportar_seace

URL = 'https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml'
FORM = 'tbBuscador:idFormBuscarProceso:'


def verificar_excel(path, formato):
    path = Path(path)
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError('Archivo vacio o inexistente')
    if path.stat().st_size > 50 * 1024 * 1024:
        raise ValueError('Archivo excede limite de 50 MB')
    with path.open('rb') as f:
        firma = f.read(512)
    if b'<html' in firma.lower() or b'<!doctype' in firma.lower():
        raise ValueError('Respuesta HTML en lugar de Excel (sesion o error del servidor)')
    esperado = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' if formato == 'xls' else b'PK\x03\x04'
    if not firma.startswith(esperado):
        raise ValueError(f'Firma de archivo {formato} invalida')


def convertir(xls, xlsx):
    verificar_excel(xls, 'xls')
    import xlrd
    from openpyxl import Workbook
    from openpyxl.cell.cell import Cell
    book = xlrd.open_workbook(str(xls), on_demand=True)
    try:
        sheet = book.sheet_by_index(0)
        if sheet.ncols != 10:
            raise ValueError(f'XLS con {sheet.ncols} columnas; se esperaban 10')
        wb = Workbook()
        ws = wb.active
        for r in range(sheet.nrows):
            values = []
            for c in range(sheet.ncols):
                cell = sheet.cell(r, c)
                if cell.ctype == xlrd.XL_CELL_DATE:
                    value = xlrd.xldate_as_datetime(cell.value, book.datemode).strftime('%d/%m/%Y %H:%M')
                elif cell.ctype == xlrd.XL_CELL_NUMBER:
                    value = str(int(cell.value)) if cell.value == int(cell.value) else str(cell.value)
                elif cell.ctype == xlrd.XL_CELL_ERROR:
                    raise ValueError(f'Celda XLS con error en fila {r+1}')
                else:
                    value = str(cell.value)
                # Texto literal: una descripcion que empieza con '=' no es una formula.
                out = Cell(ws, row=r+1, column=c+1, value=value)
                out.data_type = 's'
                values.append(out)
            ws.append(values)
        tmp = Path(xlsx).with_suffix('.tmp.xlsx')
        wb.save(tmp)
        wb.close()
        imp.validar(imp.leer_xlsx(tmp))
        tmp.replace(xlsx)
    finally:
        book.release_resources()


def consultar_descargar(destino, desde, hasta, intentos=3):
    """Consulta SEACE con sesiones independientes y validacion de resultados."""
    from playwright.sync_api import sync_playwright

    inicio = datetime.strptime(desde, '%d/%m/%Y')
    fin = datetime.strptime(hasta, '%d/%m/%Y')

    if inicio > fin or inicio.year != fin.year:
        raise ValueError('Rango invalido; ejecutar cada anio por separado')

    if not 1 <= intentos <= 3:
        raise ValueError('Se permiten entre uno y tres intentos')

    filtros = [
        ('j_idt186', 'Subasta Inversa Electr\u00f3nica', '384'),
        ('j_idt195', 'Bien', '62'),
        ('anioConvocatoria', str(inicio.year), str(inicio.year)),
        ('j_idt221', 'Seace 3', '3'),
    ]

    ultimo_error = None

    for intento in range(1, intentos + 1):
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)

                try:
                    page = browser.new_page(accept_downloads=True)
                    page.set_default_timeout(20000)

                    response = page.goto(
                        URL,
                        wait_until='domcontentloaded',
                        timeout=60000
                    )

                    if response is None or response.status >= 400:
                        raise RuntimeError('SEACE no disponible')

                    tabs = page.get_by_role('tab')

                    tabs.nth(1).wait_for(state='visible')

                    if 'Procedimientos de Selecci' not in tabs.nth(1).inner_text():
                        raise RuntimeError('Pestana de procedimientos no identificada')

                    tabs.nth(1).click()

                    primer_control = page.locator(
                        f'[id="{FORM}j_idt186_label"]'
                    )

                    primer_control.wait_for(state='visible', timeout=20000)

                    for suffix, texto, esperado in filtros:
                        etiqueta = page.locator(
                            f'[id="{FORM}{suffix}_label"]'
                        )

                        etiqueta.wait_for(state='visible')
                        etiqueta.click()

                        panel = page.locator(
                            f'[id="{FORM}{suffix}_panel"]'
                        )

                        panel.wait_for(state='visible')

                        opciones = panel.locator('li[data-label]')

                        coincidentes = [
                            opciones.nth(i)
                            for i in range(opciones.count())
                            if opciones.nth(i).get_attribute('data-label') == texto
                        ]

                        if len(coincidentes) != 1:
                            raise RuntimeError(
                                f'Opcion no identificada: {suffix}'
                            )

                        coincidentes[0].click()

                        valor = page.locator(
                            f'[id="{FORM}{suffix}_input"]'
                        ).input_value()

                        if valor != esperado:
                            raise RuntimeError(
                                f'Valor inesperado en {suffix}: {valor}'
                            )

                    fecha_inicio = page.locator(
                        f'[id="{FORM}dfechaInicio_input"]'
                    )

                    if not fecha_inicio.is_visible():
                        page.get_by_text(
                            'B\u00fasqueda Avanzada',
                            exact=True
                        ).click()

                    fecha_inicio.wait_for(state='visible')
                    fecha_inicio.fill(desde)

                    page.locator(
                        f'[id="{FORM}dfechaFin_input"]'
                    ).fill(hasta)

                    contador = page.locator(
                        f'[id="{FORM}dtProcesos_paginator_bottom"]'
                    )

                    page.get_by_role(
                        'button', name='Buscar', exact=True
                    ).click()

                    # Esperar resultados verificables, no el contador inicial.
                    page.wait_for_function(
                        r"""selector => {
                            const e = document.getElementById(selector);
                            if (!e) return false;
                            const m = e.innerText.match(/del total\s+([\d,]+)/);
                            return m && Number(m[1].replace(/,/g, '')) > 0;
                        }""",
                        arg=f'{FORM}dtProcesos_paginator_bottom',
                        timeout=45000
                    )

                    texto_contador = contador.inner_text()
                    match = re.search(
                        r'del total\s+([\d,]+)',
                        texto_contador
                    )

                    if not match:
                        raise RuntimeError('Contador SEACE no verificable')

                    total = int(match.group(1).replace(',', ''))

                    if total < 1:
                        raise RuntimeError('Consulta sin resultados verificables')

                    with page.expect_download(timeout=60000) as evento:
                        page.get_by_role(
                            'button',
                            name='Exportar a Excel',
                            exact=True
                        ).click()

                    descarga = evento.value

                    if descarga.failure():
                        raise RuntimeError('Fallo la descarga de SEACE')

                    temporal = Path(destino).with_suffix('.part')
                    descarga.save_as(temporal)

                    verificar_excel(temporal, 'xls')
                    temporal.replace(destino)

                    return total

                finally:
                    browser.close()

        except Exception as exc:
            ultimo_error = exc
            print(
                f'INTENTO_SEACE={intento}/{intentos} '
                f'ERROR={type(exc).__name__}: {exc}'
            )

            if intento < intentos:
                time.sleep(2 ** (intento - 1))

    raise RuntimeError(
        'SEACE no pudo completar una consulta verificable; '
        'no se importaron datos'
    ) from ultimo_error



def ejecutar(carpeta, *, xlsx=None, xls=None, desde=None, hasta=None,
             esperado=None, base=imp.PRODUCCION, aplicar=False, autorizar_produccion=False):
    carpeta = Path(carpeta).resolve()
    # Directorio exclusivo: no reutilizar por accidente una descarga anterior.
    carpeta.mkdir(parents=True, exist_ok=False)
    reporte = {'estado': 'INICIADO', 'modo': 'aplicar' if aplicar else 'ensayo',
               'desde': desde, 'hasta': hasta}
    try:
        base = Path(base).resolve()
        if aplicar:
            imp.proteger_destino(base, autorizar_produccion)
        if xlsx and xls:
            raise ValueError('Elegir XLS o XLSX, no ambos')
        archivo = carpeta / 'Lista-Procesos-SIE.xlsx'
        if xlsx:
            verificar_excel(xlsx, 'xlsx')
            shutil.copyfile(xlsx, archivo)
        else:
            raw = carpeta / 'Lista-Procesos-SIE.xls'
            if xls:
                shutil.copyfile(xls, raw)
            else:
                if not desde or not hasta:
                    raise ValueError('La consulta requiere --desde y --hasta')
                total = consultar_descargar(raw, desde, hasta)
                if esperado is not None and total != esperado:
                    raise ValueError(f'SEACE reporto {total}, se esperaba {esperado}')
                esperado = total
                reporte['total_seace'] = total
            convertir(raw, archivo)
            reporte['sha256_xls'] = hashlib.sha256(raw.read_bytes()).hexdigest()
        registros, duplicados = imp.validar(imp.leer_xlsx(archivo), esperado)
        if desde and hasta:
            inicio = datetime.strptime(desde, '%d/%m/%Y').date()
            fin = datetime.strptime(hasta, '%d/%m/%Y').date()
            if any(not inicio <= datetime.fromisoformat(r['publicado']).date() <= fin for r in registros.values()):
                raise ValueError('La exportacion contiene fechas fuera del filtro solicitado')
        reporte.update(filas=len(registros), duplicados=duplicados,
                       sha256_xlsx=hashlib.sha256(archivo.read_bytes()).hexdigest(),
                       comparacion=imp.comparar(registros, base))
        temporal = carpeta / 'ensayo.db'
        origen = imp.conectar_lectura(base)
        destino = sqlite3.connect(temporal)
        try:
            origen.backup(destino)
        finally:
            destino.close()
            origen.close()
        reporte['ensayo'] = imp.importar(archivo, temporal, esperado=esperado)
        # Exportar y verificar antes de habilitar una escritura de produccion.
        exportar_seace(temporal, carpeta / 'dashboard/data/seace.json', registros.keys())
        for name in ('index.html', 'styles.css', 'app.js', 'app_v2.js', 'app_seace.js'):
            shutil.copyfile(ROOT.parent / 'docs' / name, carpeta / 'dashboard' / name)
        for name in ('dashboard.json', 'dashboard_v2.json'):
            source = ROOT.parent / 'docs/data' / name
            if source.exists():
                shutil.copyfile(source, carpeta / 'dashboard/data' / name)
        if aplicar:
            reporte['importacion'] = imp.importar(archivo, base, esperado=esperado,
                                                   permitir_produccion=autorizar_produccion)
            exportar_seace(base, carpeta / 'dashboard/data/seace.json', registros.keys())
        reporte['estado'] = 'PASS'
        return reporte
    except Exception as exc:
        reporte.update(estado='ERROR', error=f'{type(exc).__name__}: {exc}')
        raise
    finally:
        (carpeta / 'resultado.json').write_text(json.dumps(reporte, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    origen = p.add_mutually_exclusive_group()
    origen.add_argument('--xlsx', type=Path)
    origen.add_argument('--xls', type=Path)
    p.add_argument('--desde')
    p.add_argument('--hasta')
    p.add_argument('--esperado', type=int)
    p.add_argument('--base', type=Path, default=imp.PRODUCCION)
    p.add_argument('--salida', type=Path, default=ROOT / 'reports/seace' / datetime.now().strftime('%Y%m%dT%H%M%S%f'))
    p.add_argument('--aplicar', action='store_true')
    p.add_argument('--autorizar-produccion', action='store_true')
    a = p.parse_args()
    print(json.dumps(ejecutar(a.salida, xlsx=a.xlsx, xls=a.xls, desde=a.desde, hasta=a.hasta,
                             esperado=a.esperado, base=a.base, aplicar=a.aplicar,
                             autorizar_produccion=a.autorizar_produccion), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
