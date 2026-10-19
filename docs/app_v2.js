/* Radar SIE V2: isolated explorer, leaves V1 intact. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const labels = {convocatorias:'Convocatorias',pac:'PAC',desiertos:'Desiertos',nulos:'Nulos'};
const notes = {
 convocatorias:'Convocatorias SIE vinculadas por código de convocatoria e ítem con la adjudicación histórica en SQLite. Una fila representa un ítem, no necesariamente un procedimiento único.',
 pac:'PAC: planificación de contrataciones. No equivale a una convocatoria abierta, adjudicación ni oportunidad vigente. Las versiones del PAC pueden representar actualizaciones.',
 desiertos:'Ítems registrados como desiertos en la fuente CONOSCE. Su condición histórica no acredita que estén disponibles para postular hoy.',
 nulos:'Ítems registrados como nulos en la fuente CONOSCE. Se requiere verificar en SEACE cualquier actuación posterior.'
};
const fmt = n => new Intl.NumberFormat('es-PE').format(n);
const money = cents => cents === null || cents === undefined || cents === '' ? 'No informado' : 'S/ ' + new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(cents)/100);
const text = v => v === null || v === undefined || v === '' ? 'No indicado' : String(v);
const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
const asMoney = value => {
  if (value === '' || value === null || value === undefined)
    return 'No informado';
  const n = Number(value);
  return Number.isFinite(n)
    ? 'S/ ' + new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(n)
    : text(value);
};

const asDate = value => {
  if (value === '' || value === null || value === undefined)
    return 'No indicado';

  const raw = String(value).trim();

  if (/^\d{5}(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    const millis = Date.UTC(1899, 11, 30) +
      Math.floor(serial) * 86400000;
    const d = new Date(millis);

    if (!Number.isNaN(d.getTime())) {
      return [
        String(d.getUTCDate()).padStart(2, '0'),
        String(d.getUTCMonth() + 1).padStart(2, '0'),
        d.getUTCFullYear()
      ].join('/');
    }
  }

  return raw;
};

const displayValue = (key, value) => {
  if (key.endsWith('_centimos'))
    return money(value);

  if (/fecha/i.test(key))
    return asDate(value);

  if (/monto|referencial/i.test(key))
    return asMoney(value);

  return text(value);
};
const fields = {
 convocatorias:[['codigoconvocatoria','Código'],['n_item','Ítem'],['entidad','Entidad'],['descripcion_item','Descripción del ítem'],['departamento_item','Departamento'],['estadoitem','Estado'],['adjudicacion.monto_adjudicado_centimos','Adjudicado (S/)']],
 pac:[['n_referencia','Referencia PAC'],['n_item','Ítem'],['entidad','Entidad'],['descripcion_item','Descripción del ítem'],['departamento','Departamento'],['mes_previsto','Mes previsto'],['version','Versión']],
 desiertos:[['codigoconvocatoria','Código'],['n_item','Ítem'],['entidad','Entidad'],['descripcion_item','Descripción del ítem'],['departamento_item','Departamento'],['estadoitem','Estado'],['monto_referencial_item_soles','Referencial (S/)']],
 nulos:[['codigoconvocatoria','Código'],['n_item','Ítem'],['entidad','Entidad'],['descripcion_item','Descripción del ítem'],['departamento_item','Departamento'],['estadoitem','Estado'],['monto_referencial_item_soles','Referencial (S/)']]
};
let payload=null, tab='convocatorias', filtered=[], page=0;
const PAGE_SIZE=25;
const get=(obj,path)=>path.split('.').reduce((o,k)=>o?.[k],obj);
function showMessage(msg){$('v2-context').textContent=msg;}
function options(){const rows=payload.datos[tab]||[];const deptKey=tab==='pac'?'departamento':'departamento_item';const depts=[...new Set(rows.map(r=>r[deptKey]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));const states=[...new Set(rows.map(r=>r.estadoitem).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));for(const [id,vals,placeholder] of [['v2-department',depts,'Todos los departamentos'],['v2-state',states,'Todos los estados']]){const select=$(id);select.replaceChildren();const opt=document.createElement('option');opt.value='';opt.textContent=placeholder;select.append(opt);for(const val of vals){const o=document.createElement('option');o.value=val;o.textContent=val;select.append(o);}select.disabled=vals.length===0;}}
function apply(reset=true){if(!payload)return;if(reset)page=0;const q=norm($('v2-search').value.trim());const dept=$('v2-department').value;const state=$('v2-state').value;const deptKey=tab==='pac'?'departamento':'departamento_item';filtered=payload.datos[tab].filter(row=>(!dept||row[deptKey]===dept)&&(!state||row.estadoitem===state)&&(!q||[row.entidad,row.descripcion_item,row.descripcion_proceso,row.codigoconvocatoria,row.n_referencia,row.itemcubso,row.codigoitem,row.entidad_ruc,row.ruc_entidad,row.departamento_item,row.departamento,row.adjudicacion?.proveedor_adjudicado].some(v=>norm(v).includes(q))));render();}
function cell(value,cls){const td=document.createElement('td');if(cls)td.className=cls;td.textContent=text(value);return td;}
function render(){const columns=fields[tab];const thead=$('v2-head');thead.replaceChildren();const head=document.createElement('tr');for(const [,label] of columns){const th=document.createElement('th');th.textContent=label;head.append(th);}const action=document.createElement('th');action.textContent='Acción';head.append(action);thead.append(head);const body=$('v2-body');body.replaceChildren();const start=page*PAGE_SIZE;for(const [offset,row] of filtered.slice(start,start+PAGE_SIZE).entries()){const tr=document.createElement('tr');for(const [path,label] of columns){let val=get(row,path);if(path==='adjudicacion.monto_adjudicado_centimos')val=money(val);else if(label==='Referencial (S/)')val=asMoney(val);else if(/fecha/i.test(path))val=asDate(val);tr.append(cell(val,label.includes('Descripción')?'v2-description':label.includes('(S/)')?'v2-money':''));}const td=document.createElement('td');const btn=document.createElement('button');btn.type='button';btn.className='v2-link';btn.textContent='Ver detalle';btn.addEventListener('click',()=>details(filtered[start+offset]));td.append(btn);tr.append(td);body.append(tr);}if(!filtered.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=columns.length+1;td.className='empty';td.textContent='No hay registros que coincidan con los filtros.';tr.append(td);body.append(tr);}$('v2-title').textContent=labels[tab].toUpperCase()+' · SIE 2026';$('v2-counter').textContent=`${fmt(filtered.length)} de ${fmt(payload.datos[tab].length)} registros`;$('v2-page-info').textContent=filtered.length?`Mostrando ${fmt(start+1)}–${fmt(Math.min(start+PAGE_SIZE,filtered.length))} · Página ${fmt(page+1)} de ${fmt(Math.ceil(filtered.length/PAGE_SIZE))}`:'Sin resultados';$('v2-prev').disabled=page===0;$('v2-next').disabled=start+PAGE_SIZE>=filtered.length;showMessage(notes[tab]);}
function details(row){const dl=document.createElement('dl');dl.className='v2-detail-grid';for(const [k,v] of Object.entries(row)){if(v&&typeof v==='object'&&!Array.isArray(v)){for(const [sub,val] of Object.entries(v))add(k+' · '+sub,val);}else add(k,v);}function add(key,value){const dt=document.createElement('dt');dt.textContent=key.replaceAll('_',' ');const dd=document.createElement('dd');dd.textContent=displayValue(key,value);dl.append(dt,dd);}$('v2-detail-body').replaceChildren(dl);$('v2-detail').showModal();}
function csv(){if(!filtered.length)return;const keys=Object.keys(filtered[0]).filter(k=>typeof filtered[0][k]!=='object');if(tab==='convocatorias')keys.push('proveedor_adjudicado','monto_adjudicado_centimos','fecha_buenapro');const escape=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[keys.map(escape).join(';')];for(const row of filtered){lines.push(keys.map(k=>escape(k in row?row[k]:row.adjudicacion?.[k])).join(';'));}const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`radar_sie_${tab}_filtrado.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
for(const b of document.querySelectorAll('[data-v2tab]'))b.addEventListener('click',()=>{if(!payload)return;tab=b.dataset.v2tab;document.querySelectorAll('[data-v2tab]').forEach(x=>x.classList.toggle('active',x===b));$('v2-search').value='';options();apply();});
$('v2-search').addEventListener('input',()=>apply());$('v2-department').addEventListener('change',()=>apply());$('v2-state').addEventListener('change',()=>apply());$('v2-clear').addEventListener('click',()=>{$('v2-search').value='';$('v2-department').value='';$('v2-state').value='';apply();});$('v2-prev').addEventListener('click',()=>{if(page>0){page--;render();}});$('v2-next').addEventListener('click',()=>{if((page+1)*PAGE_SIZE<filtered.length){page++;render();}});$('v2-csv').addEventListener('click',csv);$('v2-close').addEventListener('click',()=>$('v2-detail').close());$('v2-detail').addEventListener('click',e=>{if(e.target===$('v2-detail'))$('v2-detail').close();});
(async()=>{try{const response=await fetch('data/dashboard_v2.json',{cache:'no-cache'});if(!response.ok)throw Error(`HTTP ${response.status} al cargar dashboard_v2.json`);payload=await response.json();for(const [k,label] of Object.entries(labels)){if(!Array.isArray(payload?.datos?.[k]))throw Error('Falta el conjunto '+label);$('v2-count-'+k).textContent=`(${fmt(payload.datos[k].length)})`;}options();apply();}catch(err){showMessage('No se pudieron cargar los datos V2: '+err.message+' · Verifica la exportación y utiliza un servidor HTTP local.');$('v2-counter').textContent='Error de carga';}})();
})();
