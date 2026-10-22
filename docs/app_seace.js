
function radarSieUrlConsulta(nomenclatura) {
    const base = "https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml";
    const codigo = String(nomenclatura ?? "").trim();

    if (!codigo) {
        return base;
    }

    return base + "?radar_sie_nomenclatura=" + encodeURIComponent(codigo);
}
/* Convocatorias del buscador SEACE, independientes de los items CONOSCE. */
(() => {
  const host = document.getElementById('seace');
  const status = document.getElementById('seace-status');
  const input = document.getElementById('seace-search');
  const cut = document.getElementById('seace-cut');
  const body = document.getElementById('seace-body');
  let rows = [], page = 0;
  // RADAR_SIE_FILTRO_DEPARTAMENTO_V1
  const department = document.getElementById('seace-department');

  const nombresDepartamentos = [
    'Amazonas','Áncash','Apurímac','Arequipa','Ayacucho',
    'Cajamarca','Callao','Cusco','Huancavelica','Huánuco',
    'Ica','Junín','La Libertad','Lambayeque','Lima',
    'Loreto','Madre de Dios','Moquegua','Pasco','Piura',
    'Puno','San Martín','Tacna','Tumbes','Ucayali'
  ];

  function normalizarDepartamento(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function identificarDepartamento(registro) {
    const descripcion = normalizarDepartamento(registro.descripcion);
    const encontrados = nombresDepartamentos.filter(nombre => {
      const patron = normalizarDepartamento(nombre)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const expresion = new RegExp(
        '\\bDEPARTAMENTO\\s+(?:DE|DEL)\\s+' + patron + '\\b'
      );

      return expresion.test(descripcion);
    });

    return encontrados.length === 1 ? encontrados[0] : 'SIN_IDENTIFICAR';
  }
  function render() {
    const q = input.value.trim().toLocaleLowerCase('es');
    const filtered = rows.filter(r => (!cut.checked || r.en_ultimo_corte) &&
      (!department.value || identificarDepartamento(r) === department.value) &&
      [r.entidad, r.nomenclatura, r.descripcion].some(v => v.toLocaleLowerCase('es').includes(q)));
    const pages = Math.max(1, Math.ceil(filtered.length / 25));
    page = Math.min(page, pages - 1);
    body.replaceChildren();
    for (const row of filtered.slice(page * 25, (page + 1) * 25)) {
      const tr = document.createElement('tr');
      for (const key of ['publicado', 'entidad', 'nomenclatura', 'descripcion', 'monto', 'moneda']) {
        const td = document.createElement('td');
        td.textContent = row[key] || '—';
        tr.append(td);
      }
      
      const actions = document.createElement('td');
      actions.className = 'seace-actions';

      const link = document.createElement('a');
      link.href = radarSieUrlConsulta(row.nomenclatura);

      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'seace-action-link';
      link.textContent = 'Consultar en SEACE';
      link.title =
        'Abre SEACE y completa automaticamente la nomenclatura mediante Tampermonkey.';

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'seace-copy-code';
      copy.textContent = 'Copiar nomenclatura';

      copy.addEventListener('click', async () => {
        const value = row.nomenclatura || '';

        try {
          await navigator.clipboard.writeText(value);
          copy.textContent = 'Copiado ?';
          setTimeout(() => {
            copy.textContent = 'Copiar nomenclatura';
          }, 2000);
        } catch (error) {
          copy.textContent = 'No se pudo copiar';
        }
      });

      actions.append(link, copy);
      tr.append(actions);

      body.append(tr);

    }
    document.getElementById('seace-page').textContent = `${filtered.length} procedimientos · Página ${page + 1}/${pages}`;
    document.getElementById('seace-prev').disabled = page === 0;
    document.getElementById('seace-next').disabled = page === pages - 1;
  }
  input.addEventListener('input', () => { page = 0; render(); });
  cut.addEventListener('change', () => { page = 0; render(); });
  department.addEventListener('change', () => { page = 0; render(); });
  document.getElementById('seace-prev').onclick = () => { page--; render(); };
  document.getElementById('seace-next').onclick = () => { page++; render(); };
  fetch('data/seace.json', {cache: 'no-cache'}).then(async response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.procesos)) throw new Error('Formato no reconocido');
    rows = data.procesos;
    status.textContent = `${data.resumen.historico} procedimientos históricos · ${data.resumen.ultimo_corte} en el último corte · Exportado: ${new Date(data.meta.exportado_utc).toLocaleString('es-PE')}`;
    render();
  }).catch(error => {
    status.textContent = 'Convocatorias SEACE pendientes de exportación: ' + error.message;
    host.querySelectorAll('input,button').forEach(el => { el.disabled = true; });
  });
})();
