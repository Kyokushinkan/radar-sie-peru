import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from actualizar_mercado_conosce import (
    read_excel, key, txt, decimal_text, fecha, cents, FIELDS
)


def transform(row, identity):
    result = {
        "codigo_convocatoria": identity[0],
        "numero_item": identity[1],
    }
    for field, column in FIELDS.items():
        value = row.get(column)
        if field == "cantidad_decimal":
            value = decimal_text(value)
        elif field == "fecha_buenapro":
            value = fecha(value)
        else:
            value = txt(value)
        result[field] = value

    result["monto_adjudicado_centimos"] = cents(
        row["MONTO_ADJUDICADO_ITEM_SOLES"]
    )
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", required=True)
    parser.add_argument("--json", required=True)
    parser.add_argument("--auditoria", required=True)
    parser.add_argument("--aplicar", action="store_true")
    args = parser.parse_args()

    path = Path(args.json)
    audit_path = Path(args.auditoria)

    with path.open(encoding="utf-8-sig") as file:
        doc = json.load(file)

    records = doc["datos"]
    if not isinstance(records, list) or len(records) < 6209:
        raise ValueError("Historial inicial incompleto")

    if not isinstance(doc.get("resumen"), dict):
        raise ValueError("Resumen JSON invalido")

    original = {}
    providers = {}
    max_provider = 0

    for record in records:
        identity = key(
            record["codigo_convocatoria"],
            record["numero_item"]
        )
        if identity in original:
            raise ValueError("Duplicado historico: " + str(identity))
        original[identity] = record

        name = txt(record.get("proveedor_nombre_original"))
        pid = record.get("proveedor_id")
        if pid is not None:
            pid = int(pid)
            max_provider = max(max_provider, pid)
            if name:
                providers.setdefault(name, pid)

    source = read_excel(Path(args.excel))

    overlap = set(original) & set(source)
    absent = set(original) - set(source)
    added = set(source) - set(original)

    if len(source) < 6209 or len(overlap) < 6000:
        raise ValueError("Fuente insuficiente: publicacion bloqueada")

    if len(absent) > 100:
        raise ValueError("Demasiados registros ausentes")

    updates = []
    additions = []
    changes = []

    def provider_id(name):
        nonlocal max_provider
        if name not in providers:
            max_provider += 1
            providers[name] = max_provider
        return providers[name]

    for identity in sorted(source):
        incoming = transform(source[identity], identity)

        if identity not in original:
            incoming["proveedor_id"] = provider_id(
                incoming["proveedor_nombre_original"]
            )
            additions.append(incoming)
            continue

        old = original[identity]
        differences = {}

        for field, value in incoming.items():
            if field in ("codigo_convocatoria", "numero_item"):
                continue
            if old.get(field) != value:
                differences[field] = {
                    "antes": old.get(field),
                    "despues": value,
                }

        if differences:
            if "proveedor_nombre_original" in differences:
                incoming["proveedor_id"] = provider_id(
                    incoming["proveedor_nombre_original"]
                )

            updates.append((identity, incoming))
            changes.append({
                "codigo_convocatoria": identity[0],
                "numero_item": identity[1],
                "diferencias": differences,
            })

    print("=== RADAR SIE V2.23 ===")
    print("HISTORICOS=", len(original))
    print("FUENTE_ACTUAL=", len(source))
    print("NUEVOS=", len(additions))
    print("HISTORICOS_CONSERVADOS=", len(absent))
    print("ITEMS_CON_CAMBIOS=", len(updates))
    print("TOTAL_RESULTANTE=", len(records) + len(additions))

    by_field = {}
    for change in changes:
        for field in change["diferencias"]:
            by_field[field] = by_field.get(field, 0) + 1
    print("CAMBIOS_POR_CAMPO=", json.dumps(
        by_field, sort_keys=True
    ))

    if not args.aplicar:
        print("MODO=SIMULACION")
        print("ARCHIVOS_MODIFICADOS=NO")
        print("RESULTADO=PASS_DRY_RUN")
        return

    if not updates and not additions:
        print("RESULTADO=SIN_CAMBIOS")
        return

    previous_audit = []
    if audit_path.exists():
        with audit_path.open(encoding="utf-8") as file:
            previous_audit = json.load(file)
        if not isinstance(previous_audit, list):
            raise ValueError("Auditoria existente invalida")

    timestamp = datetime.now(timezone.utc).isoformat()

    audit_entry = {
        "fecha_utc": timestamp,
        "fuente": "CONOSCE_ADJUDICACIONES_SIE2026_0.xlsx",
        "nuevos": len(additions),
        "actualizados": len(updates),
        "historicos_ausentes_conservados": len(absent),
        "cambios": changes,
        "claves_nuevas": [
            {
                "codigo_convocatoria": r["codigo_convocatoria"],
                "numero_item": r["numero_item"],
            }
            for r in additions
        ],
    }

    # Build the new JSON entirely in memory first.
    revised = []
    update_map = dict(updates)

    for record in records:
        identity = key(
            record["codigo_convocatoria"],
            record["numero_item"]
        )
        if identity not in update_map:
            revised.append(record)
            continue

        updated = dict(record)
        updated.update(update_map[identity])
        revised.append(updated)

    revised.extend(additions)

    identities = [
        key(r["codigo_convocatoria"], r["numero_item"])
        for r in revised
    ]

    if len(identities) != len(set(identities)):
        raise ValueError("Duplicados en resultado")

    if len(revised) != len(records) + len(additions):
        raise ValueError("Conteo final incorrecto")

    doc["datos"] = revised
    doc["resumen"]["items"] = len(revised)

    # Stage files only; the workflow will validate before committing.
    for target in (path, audit_path):
        if target.with_name(target.name + ".tmp").exists():
            raise ValueError("Temporal preexistente: " + str(target))

    temp_json = path.with_name(path.name + ".tmp")
    temp_audit = audit_path.with_name(audit_path.name + ".tmp")

    try:
        with temp_json.open("w", encoding="utf-8") as file:
            json.dump(doc, file, ensure_ascii=False, separators=(",", ":"))
            file.write("\n")

        with temp_audit.open("w", encoding="utf-8") as file:
            json.dump(
                previous_audit + [audit_entry],
                file,
                ensure_ascii=False,
                indent=2,
            )
            file.write("\n")

        # Validate both staged documents before replacing anything.
        with temp_json.open(encoding="utf-8") as file:
            checked = json.load(file)
        with temp_audit.open(encoding="utf-8") as file:
            checked_audit = json.load(file)

        if checked["resumen"]["items"] != len(checked["datos"]):
            raise ValueError("Resumen inconsistente")
        if not checked_audit:
            raise ValueError("Auditoria vacia")

        temp_json.replace(path)
        temp_audit.replace(audit_path)

    finally:
        for temp in (temp_json, temp_audit):
            if temp.exists():
                temp.unlink()

    print("RESULTADO=ACTUALIZACION_VALIDADA")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("RESULTADO=BLOQUEADO", file=sys.stderr)
        print("ERROR=", str(exc), file=sys.stderr)
        sys.exit(1)