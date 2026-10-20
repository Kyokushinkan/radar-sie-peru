console.info("RADAR_SIE_V237_ACTIVO");
"use strict";
(async function(){
const $=id=>document.getElementById(id);
const norm=x=>String(x??"").normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();

const sectores={
 "50":"Alimentos y bebidas",
 "51":"Medicamentos y productos farmaceuticos",
 "47":"Limpieza e higiene",
 "14":"Papeles y cartones",
 "30":"Materiales de construccion",
 "42":"Equipos medicos",
 "43":"Informatica y telecomunicaciones",
 "44":"Oficina y suministros",
 "46":"Seguridad y proteccion",
 "25":"Vehiculos y repuestos",
 "27":"Herramientas",
 "56":"Muebles y mobiliario"
};

const panel=document.createElement("section");
panel.className="panel";
panel.id="consulta-ficha-comercial";
panel.innerHTML=`
<h2>Consulta comercial por ficha tecnica</h2>
<p>Selecciona sector, ficha y departamento para explorar
adjudicaciones historicas y precios por unidad de medida.</p>
<div class="filters">
<label>1. Seleccionar sector
<select id="cf-sector"><option value="">Todos los sectores</option></select>
</label>
<label>2. Buscar ficha tecnica
<input id="cf-buscar" placeholder="Nombre o codigo CUBSO">
</label>
<label>3. Departamento
<select id="cf-depto"><option value="">Todos los departamentos</option></select>
</label>
</div>
<div class="filters" style="margin-top:14px">
<label>Ficha tecnica
<select id="cf-ficha"><option value="">Selecciona una ficha</option></select>
</label>
<button id="cf-consultar">Consultar ficha y adjudicaciones</button>
</div>
<p class="status" id="cf-estado">Cargando biblioteca...</p>
<div id="cf-resumen" class="cards"></div>
<div class="tablewrap">
<table>
<thead><tr>
<th>Entidad / departamento</th>
<th>Proveedor</th>
<th>Producto adjudicado</th>
<th>Cantidad y unidad</th>
<th>Precio unitario calculado</th>
<th>Monto total</th>
<th>Fecha / procedimiento</th>
</tr></thead>
<tbody id="cf-resultados"></tbody>
</table>
</div>
<p class="small" id="cf-limite"></p>
<p class="small">Las coincidencias por descripcion son orientativas,
no acreditan el uso de una ficha CUBSO especifica.
Los precios unitarios requieren verificar que el monto y la cantidad correspondan al producto;
no se comparan unidades ni presentaciones diferentes.</p>`;

const biblioteca=$("biblioteca-fichas");
biblioteca.parentNode.insertBefore(panel,biblioteca);

const [rf,rm]=await Promise.all([
 fetch("fichas_sie.json",{cache:"no-store"}),
 fetch("mercado_items.json",{cache:"no-store"})
]);
if(!rf.ok||!rm.ok)throw Error("No se pudieron cargar las fuentes");

const fichas=(await rf.json()).fichas;
const adjudicaciones=(await rm.json()).datos;

function opcion(select,value,label){
 const o=document.createElement("option");
 o.value=value;o.textContent=label;select.appendChild(o);
}
function depto(r){
 return r.departamento_item_original||
 r.entidad_departamento_original||"No indicado";
}
function soles(n){
 return "S/ "+Number(n).toLocaleString("es-PE",{
 minimumFractionDigits:2,maximumFractionDigits:2});
}
function cargarSectores(){
 const conteo=new Map();
 for(const f of fichas){
  const pref=String(f.codigo||"").slice(0,2);
  const sector=sectores[pref]||"Otros sectores";
  conteo.set(pref,{sector,n:(conteo.get(pref)?.n||0)+1});
 }
 for(const [codigo,d] of [...conteo].sort((a,b)=>
 a[1].sector.localeCompare(b[1].sector,"es"))){
  opcion($("cf-sector"),codigo,d.sector+" ("+d.n+")");
 }
}
function cargarDepartamentos(){
 const lista=[...new Set(adjudicaciones.map(depto))].sort();
 for(const d of lista)opcion($("cf-depto"),d,d);
}
function cargarFichas(){
 const sector=$("cf-sector").value;
 const q=norm($("cf-buscar").value);
 const lista=fichas.filter(f=>
 (!sector||String(f.codigo||"").startsWith(sector))&&
 (!q||norm(f.producto).includes(q)||norm(f.codigo).includes(q))
 );
 const select=$("cf-ficha");
 const previo=select.value;
 select.replaceChildren();
 opcion(select,"","Selecciona una ficha ("+lista.length+")");
 for(const f of lista){
  opcion(select,f.codigo,f.producto+" | "+f.codigo);
 }
 if(lista.some(f=>f.codigo===previo))select.value=previo;
 $("cf-estado").textContent=lista.length+
 " fichas disponibles. Selecciona una para consultar.";
}
function celda(tr,valor){
 const td=document.createElement("td");
 td.textContent=String(valor??"No indicado");
 tr.appendChild(td);
}
function consultar(){
 const codigo=$("cf-ficha").value;
 const ficha=fichas.find(f=>f.codigo===codigo);
 const d=$("cf-depto").value;
 const sector=$("cf-sector").value;
 const q=norm($("cf-buscar").value);

 const nombres=ficha?[]:[...new Set(fichas
  .filter(f=>(!sector||String(f.codigo||"").startsWith(sector))&&
    (!q||norm(f.producto).includes(q)||norm(f.codigo).includes(q)))
  .map(f=>norm(f.producto))
  .filter(x=>x.length>=5))];

 const registros=adjudicaciones.filter(r=>{
  if(d&&depto(r)!==d)return false;
  const descripcion=norm(r.descripcion_item);
  if(ficha)return descripcion.includes(norm(ficha.producto));
  return nombres.some(n=>descripcion.includes(n));
 });
 const body=$("cf-resultados");
 body.replaceChildren();
 const proveedores=new Set();
 const entidades=new Set();
 const precios=new Map();
 for(const r of registros){
  proveedores.add(r.proveedor_nombre_original||"");
  entidades.add(r.entidad_nombre_original||"");
 } $("cf-resumen").replaceChildren();
 for(const [titulo,valor] of [
  ["Coincidencias por descripcion",registros.length],
  ["Entidades",entidades.size],
  ["Proveedores",proveedores.size],
  ["Unidades registradas",new Set(registros.map(r=>r.unidad_original)).size]
 ]){
  const card=document.createElement("div");
  card.className="card";
  const span=document.createElement("span");
  span.textContent=titulo;
  const strong=document.createElement("strong");
  strong.textContent=valor;
  card.append(span,strong);
  $("cf-resumen").appendChild(card);
 }
 for(const r of registros.slice(0,100)){
  const tr=document.createElement("tr");
  const cantidad=Number(r.cantidad_decimal);
  const monto=Number(r.monto_adjudicado_centimos)/100;
  const unidad=r.unidad_original||"No indicada";
  const precio="No verificable";
  celda(tr,(r.entidad_nombre_original||"")+" / "+depto(r));
  celda(tr,r.proveedor_nombre_original);
  celda(tr,r.descripcion_item);
  celda(tr,(r.cantidad_decimal||"")+" "+unidad);
  celda(tr,precio);
  celda(tr,soles(monto));
  celda(tr,(r.fecha_buenapro||"")+" / "+(r.codigo_convocatoria||""));
  body.appendChild(tr);
 }
 $("cf-limite").textContent=registros.length>100?
 "Mostrando 100 de "+registros.length+" coincidencias.":"";
 $("cf-estado").textContent=
 (ficha?"Ficha: "+ficha.producto+" | "+codigo:
 "Sector: "+(sectores[sector]||"Todos los sectores"))+
 " | "+registros.length+
 " coincidencias exploratorias por descripcion. Precios unitarios pendientes de verificacion.";
}
$("cf-sector").addEventListener("change",cargarFichas);
$("cf-buscar").addEventListener("input",cargarFichas);
$("cf-consultar").addEventListener("click",consultar);
cargarSectores();cargarDepartamentos();cargarFichas();
})().catch(e=>{
 const estado=document.getElementById("cf-estado");
 if(estado)estado.textContent="Error: "+e.message;
 console.error(e);
});