"""Exportador reproducible de Mercado SIE.

Lee SQLite sin modificarla.
Genera JSON en una carpeta de salida independiente.
No verifica vigencia legal de fichas.
"""

import argparse
import json
import sqlite3
from pathlib import Path


def guardar_json(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)

    temporal = ruta.with_suffix(".json.tmp")

    temporal.write_text(
        json.dumps(
            datos,
            ensure_ascii=False,
            separators=(",", ":")
        ),
        encoding="utf-8"
    )

    temporal.replace(ruta)


def exportar(base, salida):
    if not base.is_file():
        raise FileNotFoundError(base)

    con = sqlite3.connect(
        base.resolve().as_uri() + "?mode=ro",
        uri=True
    )

    con.row_factory = sqlite3.Row

    try:
        integridad = con.execute(
            "PRAGMA integrity_check"
        ).fetchone()[0]

        if integridad != "ok":
            raise RuntimeError("Integridad SQLite incorrecta")

        items = con.execute("""
            SELECT
                p.codigo_convocatoria,
                i.numero_item,
                r.descripcion_item,
                r.descripcion_proceso,
                r.entidad_nombre_original,
                r.entidad_departamento_original,
                r.departamento_item_original,
                r.proveedor_nombre_original,
                r.proveedor_id,
                r.cantidad_decimal,
                r.unidad_original,
                r.monto_adjudicado_centimos,
                r.fecha_buenapro,
                r.estado_item
            FROM seleccion_item s
            JOIN item i
                ON i.item_id = s.item_id
            JOIN procedimiento p
                ON p.procedimiento_id = i.procedimiento_id
            JOIN item_revision r
                ON r.revision_id = s.revision_id
            ORDER BY p.codigo_convocatoria, i.numero_item
        """).fetchall()

        fichas = con.execute("""
            SELECT
                fv.denominacion AS producto,
                f.cubso AS codigo,
                fv.version,
                fv.enlace
            FROM ficha_version fv
            JOIN ficha f
                ON f.ficha_id = fv.ficha_id
            ORDER BY f.cubso, fv.version
        """).fetchall()

        if not items or not fichas:
            raise RuntimeError("Universo vacio")

        datos_items = [dict(x) for x in items]

        datos_fichas = [
            {
                "producto": x["producto"],
                "codigo": str(x["codigo"]),
                "version": str(x["version"]),
                "enlace": x["enlace"],
                "vigencia": "Pendiente de verificar"
            }
            for x in fichas
        ]

        mercado = {
            "meta": {
                "fuente": "CONOSCE",
                "tipo": "adjudicaciones_historicas",
                "precios_unitarios_validados": False,
                "correspondencias_fichas_validadas": False
            },
            "resumen": {
                "items": len(datos_items)
            },
            "datos": datos_items
        }

        catalogo = {
            "meta": {
                "fuente": "Catalogo local de fichas SIE",
                "vigencia_verificada": False,
                "total": len(datos_fichas)
            },
            "fichas": datos_fichas
        }

        guardar_json(
            salida / "mercado_items.json",
            mercado
        )

        guardar_json(
            salida / "fichas_sie.json",
            catalogo
        )

        return {
            "estado": "EXPORTACION_COMPLETADA",
            "items": len(datos_items),
            "fichas": len(datos_fichas),
            "salida": str(salida)
        }

    finally:
        con.close()


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--base",
        type=Path,
        required=True
    )

    parser.add_argument(
        "--salida",
        type=Path,
        required=True
    )

    args = parser.parse_args()

    resultado = exportar(args.base, args.salida)

    print(json.dumps(
        resultado,
        ensure_ascii=False,
        indent=2
    ))


if __name__ == "__main__":
    main()
