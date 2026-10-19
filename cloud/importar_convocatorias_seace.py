"""Valida exportaciones SEACE en solo lectura por defecto; --aplicar importa.
La orquestacion de consulta, conversion y dashboard reside en flujo_seace.py.
"""
import argparse
import hashlib
import json
import re
import sqlite3
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
COLS = ['N°', 'Nombre o Sigla de la Entidad', 'Fecha y Hora de Publicacion', 'Nomenclatura', 'Reiniciado Desde', 'Objeto de Contratación', 'Descripción de Objeto', 'VR / VE / Cuantía de la contratación', 'Moneda', 'Versión SEACE']

def leer_xlsx(ruta):
    with zipfile.ZipFile(ruta) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            shared = [''.join(t.text or '' for t in si.findall('.//m:t', NS)) for si in root.findall('m:si', NS)]
        hoja = next((n for n in z.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n)), None)
        if not hoja:
            raise ValueError('No se encontró una hoja XLSX')
        root = ET.fromstring(z.read(hoja))
        filas = []
        for row in root.findall('.//m:sheetData/m:row', NS):
            celdas = {}
            for c in row.findall('m:c', NS):
                if c.find('m:f', NS) is not None:
                    raise ValueError('La exportacion SEACE no debe contener formulas')
                letras = re.match(r'[A-Z]+', c.attrib.get('r', ''))
                if not letras:
                    continue
                idx = 0
                for ch in letras.group():
                    idx = idx * 26 + ord(ch) - 64
                idx -= 1
                v = c.find('m:v', NS)
                if c.attrib.get('t') == 'inlineStr':
                    value = ''.join(x.text or '' for x in c.findall('.//m:t', NS))
                elif v is not None:
                    value = shared[int(v.text)] if c.attrib.get('t') == 's' else (v.text or '')
                else:
                    value = ''
                celdas[idx] = value.strip()
            if any(v for i, v in celdas.items() if i >= 10):
                raise ValueError('Columnas adicionales no reconocidas')
            if celdas:
                filas.append([celdas.get(i, '') for i in range(10)])
        if not filas or filas[0] != COLS:
            raise ValueError('Encabezados no reconocidos; revise el formato del archivo SEACE')
        if len(filas) < 2:
            raise ValueError('Exportacion vacia')
        return filas[1:]

def fecha_iso(valor):
    try:
        return datetime.strptime(valor, '%d/%m/%Y %H:%M').strftime('%Y-%m-%d %H:%M:%S')
    except ValueError:
        return None

def clave(entidad, nomenclatura):
    normal = lambda x: re.sub(r'\s+', ' ', x.strip().upper())
    return hashlib.sha256((normal(entidad) + '\x1f' + normal(nomenclatura)).encode()).hexdigest()

ROOT = Path(__file__).resolve().parent
PRODUCCION = ROOT / 'data/processed/convocatorias_seace_actuales.db'
CAMPOS = ['entidad', 'nomenclatura', 'publicado', 'objeto', 'descripcion',
          'monto', 'moneda', 'version_seace', 'reiniciado_desde']


def huella(campos):
    # Compatible byte por byte con las huellas existentes.
    return hashlib.sha256(json.dumps(campos, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validar(filas, esperado=None):
    if not filas or (esperado is not None and len(filas) != esperado):
        raise ValueError(f'Cantidad de filas inesperada: {len(filas)}; esperado: {esperado}')
    registros, duplicados = {}, 0
    for numero, fila in enumerate(filas, 2):
        if len(fila) != 10:
            raise ValueError(f'Fila {numero}: se requieren diez columnas')
        _, entidad, fecha, nombre, reinicio, objeto, descripcion, monto, moneda, version = fila
        if not entidad or not nombre.upper().startswith('SIE-') or not fecha_iso(fecha):
            raise ValueError(f'Fila {numero}: entidad, nomenclatura SIE o fecha invalida')
        campos = dict(zip(CAMPOS, [entidad, nombre, fecha_iso(fecha), objeto,
                                  descripcion, monto, moneda, version, reinicio]))
        k = clave(entidad, nombre)
        if k in registros:
            if registros[k] != campos:
                raise ValueError(f'Fila {numero}: duplicado contradictorio para {k}')
            duplicados += 1
        registros[k] = campos
    return registros, duplicados


def conectar_lectura(bd):
    return sqlite3.connect(Path(bd).resolve().as_uri() + '?mode=ro', uri=True)


def comparar(registros, bd):
    con = conectar_lectura(bd)
    con.row_factory = sqlite3.Row
    try:
        diferencias, nuevos, iguales = [], [], 0
        for k, campos in registros.items():
            anterior = con.execute('SELECT * FROM procesos WHERE clave=?', (k,)).fetchone()
            if anterior is None:
                nuevos.append(k)
                continue
            delta = {c: {'antes': anterior[c], 'despues': campos[c]}
                     for c in CAMPOS if anterior[c] != campos[c]}
            if delta or anterior['huella'] != huella(campos):
                diferencias.append({'clave': k, 'campos': delta,
                                    'huella_igual': anterior['huella'] == huella(campos)})
            else:
                iguales += 1
        return dict(coincidencias_clave=len(registros)-len(nuevos), iguales=iguales,
                    nuevos=nuevos, modificaciones=diferencias)
    finally:
        con.close()


def proteger_destino(bd, permitir_produccion=False):
    bd = Path(bd).resolve()
    es_produccion = bd == PRODUCCION.resolve() or (
        bd.exists() and PRODUCCION.exists() and bd.samefile(PRODUCCION))
    if es_produccion and not permitir_produccion:
        raise ValueError('Base de produccion protegida; requiere --autorizar-produccion')
    return bd


def importar(archivo, bd, *, esperado=None, permitir_produccion=False):
    bd = proteger_destino(bd, permitir_produccion)
    filas = leer_xlsx(archivo)
    registros, duplicados = validar(filas, esperado)
    bd.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(bd)
    con.row_factory = sqlite3.Row
    ahora = datetime.now().astimezone().isoformat(timespec='microseconds')
    conteos = dict(nuevos=0, modificados=0, iguales=0)
    try:
        con.execute('BEGIN IMMEDIATE')
        con.execute('''CREATE TABLE IF NOT EXISTS procesos (
            clave TEXT PRIMARY KEY, entidad TEXT NOT NULL, nomenclatura TEXT NOT NULL,
            publicado TEXT, objeto TEXT, descripcion TEXT, monto TEXT, moneda TEXT,
            version_seace TEXT, reiniciado_desde TEXT, primera_observacion TEXT NOT NULL,
            ultima_observacion TEXT NOT NULL, huella TEXT NOT NULL)''')
        con.execute('''CREATE TABLE IF NOT EXISTS cambios (
            id INTEGER PRIMARY KEY AUTOINCREMENT, clave TEXT, observado TEXT,
            tipo TEXT, antes TEXT, despues TEXT)''')
        for k, campos in registros.items():
            anterior = con.execute('SELECT * FROM procesos WHERE clave=?', (k,)).fetchone()
            h = huella(campos)
            if anterior is None:
                con.execute('INSERT INTO procesos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                            (k, *campos.values(), ahora, ahora, h))
                tipo = 'NUEVO'
                conteos['nuevos'] += 1
            elif anterior['huella'] != h or any(anterior[c] != campos[c] for c in CAMPOS):
                con.execute('UPDATE procesos SET ' + ','.join(c+'=?' for c in CAMPOS) +
                            ',ultima_observacion=?,huella=? WHERE clave=?',
                            (*campos.values(), ahora, h, k))
                tipo = 'MODIFICADO'
                conteos['modificados'] += 1
            else:
                con.execute('UPDATE procesos SET ultima_observacion=? WHERE clave=?', (ahora, k))
                conteos['iguales'] += 1
                continue
            antes = {c: anterior[c] for c in CAMPOS} if anterior else None
            con.execute('INSERT INTO cambios(clave,observado,tipo,antes,despues) VALUES(?,?,?,?,?)',
                        (k, ahora, tipo, json.dumps(antes, ensure_ascii=False) if antes else None,
                         json.dumps(campos, ensure_ascii=False)))
        total = con.execute('SELECT COUNT(*) FROM procesos').fetchone()[0]
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return dict(estado='PASS', **conteos, filas=len(filas), duplicados=duplicados,
                total_historico=total, bd=str(bd))


def main():
    parser = argparse.ArgumentParser(description='Valida por defecto; importar requiere --aplicar')
    parser.add_argument('archivo', type=Path)
    parser.add_argument('--bd', type=Path, default=PRODUCCION)
    parser.add_argument('--esperado', type=int)
    parser.add_argument('--aplicar', action='store_true')
    parser.add_argument('--autorizar-produccion', action='store_true')
    args = parser.parse_args()
    if args.aplicar:
        resultado = importar(args.archivo, args.bd, esperado=args.esperado,
                             permitir_produccion=args.autorizar_produccion)
    else:
        registros, duplicados = validar(leer_xlsx(args.archivo), args.esperado)
        resultado = dict(comparar(registros, args.bd), duplicados=duplicados, modo='solo_lectura')
    print(json.dumps(resultado, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
