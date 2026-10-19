"""Exportación pública CONOSCE SIE 2026 para Radar SIE Perú V2.

No modifica SQLite ni archivos fuente. Requiere solo Python estándar.
"""
import argparse
import datetime as dt
import json
import sqlite3
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
ROOT = Path(__file__).resolve().parents[2]
FILES = {
    'convocatorias': 'CONOSCE_CONVOCATORIAS_SIE2026_0.xlsx',
    'pac': 'CONOSCE_PAC2026_0.xlsx',
    'desiertos': 'CONOSCE_DESIERTOS2026_0.xlsx',
    'nulos': 'CONOSCE_NULOS2026_0.xlsx',
}
EXPECTED = {'convocatorias': 6209, 'pac': 5892, 'desiertos': 1832, 'nulos': 346}
FIELDS = {
    'convocatorias': ['CODIGOCONVOCATORIA','N_ITEM','ENTIDAD','ENTIDAD_RUC','DESCRIPCION_PROCESO','DESCRIPCION_ITEM','ITEMCUBSO','CODIGOITEM','UNIDAD_MEDIDA','ESTADOITEM','MONTOREFERENCIAL','MONTO_REFERENCIAL_ITEM','MONEDA','DEPARTAMENTO_ITEM','PROVINCIA_ITEM','DISTRITO_ITEM','FECHA_CONVOCATORIA','FECHAINTEGRACIONBASES','FECHAPRESENTACIONPROPUESTA'],
    'pac': ['AÑO','CODIGOENTIDAD','RUC_ENTIDAD','ENTIDAD','VERSION','N_REFERENCIA','DESCRIPCION_PROCESO','OBJETOCONTRACTUAL','N_ITEM','DESCRIPCION_ITEM','CANTIDAD','UNIDAD_MEDIDA','DEPARTAMENTO','PROVINCIA','DISTRITO','MES_PREVISTO','FECHA_PUBLICACION'],
    'desiertos': ['CODIGOCONVOCATORIA','N_ITEM','ENTIDAD','ENTIDAD_RUC','DESCRIPCION_PROCESO','DESCRIPCION_ITEM','ITEMCUBSO','CODIGOITEM','UNIDAD_MEDIDA','ESTADOITEM','MONTOREFERENCIAL','MONTO_REFERENCIAL_ITEM_SOLES','DEPARTAMENTO_ITEM','PROVINCIA_ITEM','DISTRITO_ITEM','FECHA_CONVOCATORIA'],
    'nulos': ['CODIGOCONVOCATORIA','N_ITEM','ENTIDAD','ENTIDAD_RUC','DESCRIPCION_PROCESO','DESCRIPCION_ITEM','ITEMCUBSO','CODIGOITEM','UNIDAD_MEDIDA','ESTADOITEM','MONTOREFERENCIAL','MONTO_REFERENCIAL_ITEM_SOLES','DEPARTAMENTO_ITEM','PROVINCIA_ITEM','DISTRITO_ITEM','FECHA_CONVOCATORIA'],
}

def norm(value):
    value = unicodedata.normalize('NFD', str(value or '').strip().casefold())
    return ''.join(c for c in value if unicodedata.category(c) != 'Mn')

def column(ref):
    return ''.join(c for c in ref if c.isalpha())

def xlsx_rows(path):
    with ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            shared = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in root.findall(NS + 'si')]
        headers = None
        with z.open('xl/worksheets/sheet1.xml') as fh:
            for _, elem in ET.iterparse(fh, events=('end',)):
                if elem.tag != NS + 'row':
                    continue
                row = {}
                for c in elem.findall(NS + 'c'):
                    v = c.find(NS + 'v')
                    value = v.text if v is not None else ''
                    if c.get('t') == 's' and value:
                        value = shared[int(value)]
                    elif c.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in c.iter(NS + 't'))
                    row[column(c.get('r', ''))] = value
                if headers is None:
                    headers = row
                else:
                    yield {name: row.get(col, '') for col, name in headers.items()}
                elem.clear()

def key(code, item):
    code = str(code or '').strip()
    item = str(item or '').strip()
    if not code or not item:
        return None
    try:
        return code, int(float(item))
    except ValueError:
        return None

def export(root, out):
    db = root / 'data/processed/radar_sie_historico.db'
    con = sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        assert con.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not con.execute('PRAGMA foreign_key_check').fetchall()
        current = {}
        for r in con.execute('''SELECT codigo_convocatoria, numero_item, entidad_ruc_original,
            proveedor_nombre_original, estado_item, monto_adjudicado_centimos,
            monto_referencial_centimos, fecha_buenapro, fecha_consentimiento
            FROM v_items_actuales'''):
            k = key(r[0], r[1])
            if not k or k in current:
                raise ValueError('Clave SQLite ausente o duplicada')
            current[k] = {
                'proveedor_adjudicado': r[3], 'estado_adjudicacion': r[4],
                'monto_adjudicado_centimos': r[5],
                'monto_referencial_sqlite_centimos': r[6],
                'fecha_buenapro': r[7], 'fecha_consentimiento': r[8],
            }
        if len(current) != 6209:
            raise ValueError(f'Universo SQLite inesperado: {len(current)}')
    finally:
        con.close()

    datasets = {}
    stats = {}
    for category, filename in FILES.items():
        path = root / 'data/raw' / filename
        if not path.is_file():
            raise FileNotFoundError(path)
        data = []
        count = 0
        seen = set()
        duplicates = 0
        matched = 0
        for raw in xlsx_rows(path):
            if norm(raw.get('TIPOPROCESOSELECCION')) != 'subasta inversa electronica':
                continue
            count += 1
            row = {field.lower(): raw.get(field, '') for field in FIELDS[category]}
            if category == 'convocatorias':
                k = key(raw.get('CODIGOCONVOCATORIA'), raw.get('N_ITEM'))
                if not k or k in seen:
                    raise ValueError('Clave de convocatoria ausente o duplicada')
                seen.add(k)
                if k not in current:
                    raise ValueError(f'Convocatoria sin coincidencia SQLite: {k}')
                row['adjudicacion'] = current[k]
                matched += 1
            elif category in ('desiertos', 'nulos'):
                k = key(raw.get('CODIGOCONVOCATORIA'), raw.get('N_ITEM'))
                if k:
                    if k in seen:
                        duplicates += 1
                    seen.add(k)
                # No enlazar estados a adjudicaciones sin verificar la cronología.
            data.append(row)
        if count != EXPECTED[category]:
            raise ValueError(f'{category}: esperado {EXPECTED[category]}, obtenido {count}')
        datasets[category] = data
        stats[category] = {'registros_sie': count, 'claves_repetidas': duplicates}
        if category == 'convocatorias':
            if seen != set(current):
                raise ValueError('Cruce incompleto Excel/SQLite')
            stats[category]['cruces_sqlite'] = matched

    payload = {
        'meta': {
            'titulo': 'Radar SIE Perú V2',
            'exportado_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'fuentes': list(FILES.values()),
            'alcance': 'Registros SIE CONOSCE 2026, separados por fuente',
            'advertencias': [
                'Las filas de diferentes fuentes no representan procedimientos únicos sumables.',
                'El PAC es planificación, no convocatoria abierta ni adjudicación.',
                'Desiertos y nulos son registros históricos; no implican convocatoria vigente.',
                'Los montos adjudicados no son precios unitarios comerciales validados.',
                'ITEMCUBSO es una denominación de origen, no equivalencia validada con ficha CUBSO.',
            ],
        },
        'resumen': stats,
        'datos': datasets,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tmp.replace(out)
    print(json.dumps({'estado': 'PASS_EXPORTACION_V2', 'salida': str(out), 'bytes': out.stat().st_size, 'resumen': stats}, ensure_ascii=False, indent=2))

def exportar_seace(bd, out, claves_corte):
    """Exporta convocatorias SEACE por separado; no mezcla procedimientos con items CONOSCE."""
    claves_corte = set(claves_corte)
    con = sqlite3.connect(Path(bd).resolve().as_uri() + '?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    try:
        if con.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Integridad SQLite fallida')
        rows = [dict(r) for r in con.execute('''SELECT clave, entidad, nomenclatura, publicado,
            objeto, descripcion, monto, moneda, version_seace, reiniciado_desde,
            primera_observacion, ultima_observacion FROM procesos ORDER BY publicado DESC, clave''')]
    finally:
        con.close()
    if not rows or not claves_corte or not claves_corte <= {r['clave'] for r in rows}:
        raise ValueError('Corte SEACE vacio o no conciliado con SQLite')
    for row in rows:
        row['en_ultimo_corte'] = row['clave'] in claves_corte
    payload = {'meta': {'fuente': 'Buscador Publico SEACE',
                        'exportado_utc': dt.datetime.now(dt.timezone.utc).isoformat(),
                        'alcance': 'Procedimientos observados; no acredita vigencia ni adjudicacion'},
               'resumen': {'historico': len(rows), 'ultimo_corte': len(claves_corte)}, 'procesos': rows}
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    tmp.replace(out)
    return payload['resumen']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    out = args.out or root / 'radar_sie_dashboard/docs/data/dashboard_v2.json'
    export(root, out.resolve())

if __name__ == '__main__':
    main()
