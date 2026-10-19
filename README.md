# Radar SIE Perú — Dashboard público

Sitio estático para GitHub Pages. No subas `*.db`, archivos originales CONOSCE ni documentos internos.

## Exportar desde tu proyecto local

Copia la carpeta `radar_sie_dashboard` dentro de `C:\radar_sie_peru`, y ejecuta:

```powershell
python -B .\radar_sie_dashboard\scripts\exportar_dashboard.py
```

Genera `radar_sie_dashboard/docs/data/dashboard.json` desde `data/processed/radar_sie_historico.db` **en modo solo lectura**. Si los conteos o el control de precios difieren, detiene la exportación.

## Probar localmente

```powershell
cd .\radar_sie_dashboard\docs
python -m http.server 8000
```

Abre http://localhost:8000 . No abras directamente `index.html` porque `fetch()` necesita un servidor.

## Publicar en GitHub Pages

Desde `C:\radar_sie_peru\radar_sie_dashboard` (si es un repositorio independiente):

```powershell
git init
git add README.md .gitignore docs scripts
git commit -m "Dashboard público Radar SIE Perú V1"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Crea previamente un repositorio público **vacío** en GitHub, y reemplaza `TU_USUARIO/TU_REPOSITORIO` por el nombre real. En GitHub: Settings → Pages → Deploy from a branch → `main` → `/docs` → Save.

## Advertencias

- Montos adjudicados históricos no son precios unitarios comparables.
- Los rankings de productos agrupan descripciones originales literales, no fichas CUBSO homologadas.
- Solo se exportan agregados, no filas individuales, RUC ni IDs de proveedores.
- No subir la base SQLite ni fuentes crudas al repositorio público.
