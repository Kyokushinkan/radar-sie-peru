console.info("RADAR_SIE_V249_ACTIVO");
"use strict";
(async function(){
const $=id=>document.getElementById(id);
const norm=x=>String(x??"").normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toUpperCase().trim();

const sectores={
 "10":"Material vegetal y animal vivo",
 "11":"Minerales y materiales no comestibles",
 "12":"Productos quimicos",
 "15":"Combustibles y lubricantes",
 "26":"Maquinaria y accesorios de energia",
 "30":"Materiales de construccion",
 "31":"Componentes de fabricacion",
 "39":"Suministros electricos e iluminacion",
 "40":"Sistemas de distribucion y acondicionamiento",
 "42":"Equipos y suministros medicos",
 "47":"Productos de limpieza",
 "50":"Alimentos y bebidas",
 "51":"Productos farmaceuticos",
 "52":"Enseres y accesorios domesticos",
 "53":"Vestimenta y accesorios",
 "84":"Servicios financieros y seguros"
};

const panel=document.createElement("section");
panel.className="panel";
panel.id="consulta-ficha-comercial";
panel.innerHTML=`
<h2>Consulta comercial por ficha tecnica</h2>
<p>Selecciona sector, ficha y departamento para explorar
adjudicaciones historicas y precios por unidad de medida.</p>
<div class="filters">
<label>1. Segmento CUBSO (clasificacion referencial)
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

<section id="cf-explorador-v244"
 style="margin-top:22px;margin-bottom:22px">

<h3>Explorador de fichas tecnicas por segmento</h3>

<p class="small">
Las fichas corresponden al catalogo historico
registrado en Radar SIE.
La agrupacion utiliza segmentos CUBSO referenciales.
</p>

<p id="cf-explorador-estado" class="status">
Preparando explorador...
</p>

<div class="tablewrap">
<table>
<thead>
<tr>
<th>Producto / ficha tecnica</th>
<th>Codigo CUBSO</th>
<th>Version</th>
<th>Vigencia registrada</th><th>Verificación SEACE</th>
<th>Ficha oficial</th>
<th>Accion comercial</th>
</tr>
</thead>

<tbody id="cf-explorador-resultados"></tbody>
</table>
</div>

<div id="cf-explorador-paginacion"
 style="
 display:flex;
 justify-content:space-between;
 align-items:center;
 gap:12px;
 flex-wrap:wrap;
 margin-top:14px;
 ">

<span id="cf-explorador-pagina"></span>

<div style="display:flex;gap:10px">
<button type="button" id="cf-explorador-anterior">
Anterior
</button>

<button type="button" id="cf-explorador-siguiente">
Siguiente
</button>
</div>

</div>

</section>

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
<th>Acciones</th>
</tr></thead>
<tbody id="cf-resultados"></tbody>
</table>
</div>
<p class="small" id="cf-limite"></p>
<p class="small">Las coincidencias por descripcion son orientativas,
no acreditan el uso de una ficha CUBSO especifica.
Los precios unitarios requieren verificar que el monto y la cantidad correspondan al producto;
no se comparan unidades ni presentaciones diferentes.</p>`;


const contenedor=
 document.getElementById("biblioteca-fichas")||
 document.querySelector("main")||
 document.body;

contenedor.insertAdjacentElement("afterend",panel);

const respuestas=await Promise.all([
 fetch("fichas_sie.json",{cache:"no-store"}),
 fetch("mercado_items.json",{cache:"no-store"})
]);

for(const respuesta of respuestas){
 if(!respuesta.ok){
  throw new Error("HTTP "+respuesta.status+
   " al cargar datos comerciales");
 }
}

const [datosFichas,datosMercado]=
 await Promise.all(respuestas.map(r=>r.json()));

if(!Array.isArray(datosFichas.fichas)){
 throw new Error("Biblioteca de fichas no disponible");
}

if(!Array.isArray(datosMercado.datos)){
 throw new Error("Adjudicaciones no disponibles");
}

const fichas=datosFichas.fichas;
const adjudicaciones=datosMercado.datos;
const detalle=document.createElement("dialog");
detalle.id="cf-detalle-v241";
detalle.setAttribute("aria-label","Detalle de adjudicacion");
detalle.style.cssText=
 "background:#111e31;color:#e8eef8;border:1px solid #39506b;"+
 "border-radius:14px;padding:22px;width:min(820px,94vw);"+
 "max-height:85vh;overflow:auto;";

const detailTitle=document.createElement("h2");
detailTitle.textContent="Detalle historico de adjudicacion";

const detailNote=document.createElement("p");
detailNote.textContent=
 "Informacion registrada en Radar SIE. "+
 "No sustituye el expediente oficial del procedimiento.";

const detailContent=document.createElement("div");

const detailClose=document.createElement("button");
detailClose.type="button";
detailClose.textContent="Cerrar";
detailClose.addEventListener("click",()=>detalle.close());

detalle.append(
 detailTitle,detailNote,detailContent,detailClose
);

document.body.appendChild(detalle);

const SEACE_BUSCADOR=
 "https://prod2.seace.gob.pe/seacebus-uiwd-pub/"+
 "buscadorPublico/buscadorPublico.xhtml";

function dato(valor){
 return valor===null||valor===undefined||valor===""
  ?"No indicado":String(valor);
}

function mostrarDetalle(r){
 detailContent.replaceChildren();

 const tabla=document.createElement("table");
 const cuerpo=document.createElement("tbody");

 const campos=[
  ["Codigo de convocatoria",r.codigo_convocatoria],
  ["Numero de item",r.numero_item],
  ["Entidad",r.entidad_nombre_original],
  ["Departamento",depto(r)],
  ["Proveedor adjudicado",r.proveedor_nombre_original],
  ["Descripcion del producto",r.descripcion_item],
  ["Cantidad",r.cantidad_decimal],
  ["Unidad",r.unidad_original],
  ["Monto adjudicado (centimos)",r.monto_adjudicado_centimos],
  ["Fecha de buena pro",r.fecha_buenapro]
 ];

 for(const [nombre,valor] of campos){
  const tr=document.createElement("tr");
  const th=document.createElement("th");
  const td=document.createElement("td");
  th.textContent=nombre;
  td.textContent=dato(valor);
  tr.append(th,td);
  cuerpo.append(tr);
 }

 tabla.append(cuerpo);
 detailContent.append(tabla);

 const nota=document.createElement("p");
 nota.style.cssText="color:#b9cbe3;margin-top:15px";
 nota.textContent=
  "Precio unitario: no verificable. "+
  "El monto adjudicado puede comprender "+
  "presentaciones o conceptos que requieren revision documental.";
 detailContent.append(nota);

 if(typeof detalle.showModal==="function"){
  detalle.showModal();
 }else{
  detalle.setAttribute("open","");
 }
}

async function copiarCodigo(codigo,boton){
 const original=boton.textContent;

 try{
  if(!codigo)throw Error("Sin codigo");

  if(navigator.clipboard&&window.isSecureContext){
   await navigator.clipboard.writeText(codigo);
  }else{
   const area=document.createElement("textarea");
   area.value=codigo;
   area.style.position="fixed";
   area.style.opacity="0";
   document.body.append(area);
   area.select();
   const ok=document.execCommand("copy");
   area.remove();
   if(!ok)throw Error("No se pudo copiar");
  }

  boton.textContent="Copiado";
 }catch(error){
  boton.textContent="No se pudo copiar";
 }

 setTimeout(()=>{
  boton.textContent=original;
 },1800);
}

function agregarAcciones(tr,r){
 const td=document.createElement("td");
 td.style.minWidth="175px";

 const box=document.createElement("div");
 box.style.cssText=
  "display:flex;flex-direction:column;gap:7px;";

 const ver=document.createElement("button");
 ver.type="button";
 ver.textContent="Ver detalle";
 ver.addEventListener("click",()=>mostrarDetalle(r));

 const codigo=String(r.codigo_convocatoria||"").trim();

 const buscar=document.createElement("button");
 buscar.type="button";
 buscar.textContent="Buscar procedimiento en SEACE";

 buscar.addEventListener("click",()=>{
  // Abrir primero para evitar bloqueo de ventanas emergentes.
  const nomenclatura=String(
   (codigo==="1186344"?"SIE-SIE-1-2026-MPC/OEC-1":"")||
   r.nomenclatura||
   r.nomenclatura_procedimiento||
   r.nomenclatura_convocatoria||
   ""
  ).trim();

  const nomenclaturaValida=
   /[A-Za-z]/.test(nomenclatura)&&
   /[0-9]/.test(nomenclatura);

  const destinoSEACE=nomenclaturaValida
   ? SEACE_BUSCADOR+
     "?radar_sie_nomenclatura="+
     encodeURIComponent(nomenclatura)+
     (codigo
       ? "&radar_sie_identificador_convocatoria="+
         encodeURIComponent(codigo)
       : "")
   : codigo
     ? SEACE_BUSCADOR+
       "?radar_sie_identificador_convocatoria="+
       encodeURIComponent(codigo)
     : SEACE_BUSCADOR;

  const ventana=window.open(
   destinoSEACE,
   "_blank",
   "noopener,noreferrer"
  );

  if(!ventana){
   window.location.href=destinoSEACE;
  }

  // El codigo numerico no se trata como nomenclatura.
  if(codigo){
   navigator.clipboard?.writeText(codigo).catch(()=>{});
  }

  const aviso=document.createElement("p");
  aviso.style.cssText=
   "font-size:12px;color:#b9cbe3;margin:5px 0;";

  aviso.textContent=
   "Codigo de convocatoria: "+(codigo||"No indicado")+
   ". En SEACE, comprobar el campo "+
   "'Identificador Convocatoria'. "+
   "No equivale necesariamente a la nomenclatura.";

  box.querySelector(".cf-aviso-seace")?.remove();
  aviso.className="cf-aviso-seace";
  box.append(aviso);
 });

 const copiar=document.createElement("button");
 copiar.type="button";
 copiar.textContent="Copiar codigo";
 copiar.disabled=!codigo;

 copiar.addEventListener("click",()=>{
  copiarCodigo(codigo,copiar);
 });

 box.append(ver,buscar,copiar);
 td.append(box);
 tr.append(td);
}
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
  const sector=sectores[pref]||"Segmento CUBSO "+pref;
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

const EXPLORADOR_TAMANO=25;

let exploradorPagina=1;
let exploradorLista=[];

function obtenerFichasFiltradas(){
 const sector=$("cf-sector").value;
 const q=norm($("cf-buscar").value);

 return fichas.filter(f=>
  (!sector||
   String(f.codigo||"").startsWith(sector))&&
  (!q||
   norm(f.producto).includes(q)||
   norm(f.codigo).includes(q))
 );
}

function crearBoton(texto,accion){
 const b=document.createElement("button");
 b.type="button";
 b.textContent=texto;
 b.addEventListener("click",accion);
 return b;
}

function renderExplorador(){
 const body=$("cf-explorador-resultados");
 body.replaceChildren();

 const total=exploradorLista.length;

 const paginas=Math.max(
  1,
  Math.ceil(total/EXPLORADOR_TAMANO)
 );

 exploradorPagina=Math.min(
  Math.max(1,exploradorPagina),
  paginas
 );

 const inicio=(exploradorPagina-1)*EXPLORADOR_TAMANO;

 const visibles=exploradorLista.slice(
  inicio,
  inicio+EXPLORADOR_TAMANO
 );

 for(const f of visibles){
  const tr=document.createElement("tr");

  celda(tr,f.producto);
  celda(tr,f.codigo);
  celda(tr,f.version);
  celda(tr,f.vigencia);
const verificacion = window.RADAR_SIE_VERIFICACIONES?.[String(f.codigo)];
const etiqueta = verificacion?.tipo === "VERSION_ACTUALIZADA"
  ? "Aprobada en SEACE - versión actualizada"
  : verificacion?.tipo === "VERSION_REGISTRADA"
    ? "Aprobada en SEACE - versión registrada"
    : "Sin verificación estructurada reciente";
celda(tr,etiqueta);

  const enlaceTd=document.createElement("td");

  if(f.enlace){
   const a=document.createElement("a");
   a.href=f.enlace;
   a.target="_blank";
   a.rel="noopener noreferrer";
   a.textContent="Abrir ficha";
   a.style.color="#77bbff";
   enlaceTd.append(a);
  }else{
   enlaceTd.textContent="Sin enlace registrado";
  }

  tr.append(enlaceTd);

  const accionTd=document.createElement("td");

  const boton=crearBoton(
   "Consultar adjudicaciones",
   ()=>{
    const select=$("cf-ficha");

    const existe=[...select.options].some(
     o=>o.value===String(f.codigo)
    );

    if(!existe){
     $("cf-explorador-estado").textContent=
      "No se pudo seleccionar la ficha.";
     return;
    }

    select.value=String(f.codigo);

    consultar();

    const resultados=$("cf-resultados");

    if(resultados){
     resultados.closest(".tablewrap")
      ?.scrollIntoView({
       behavior:"smooth",
       block:"start"
      });
    }
   }
  );

  accionTd.append(boton);
  tr.append(accionTd);

  body.append(tr);
 }

 $("cf-explorador-estado").textContent=
  total+" fichas encontradas en el filtro actual.";

 $("cf-explorador-pagina").textContent=
  "Pagina "+exploradorPagina+
  " de "+paginas+
  " | "+total+" fichas";

 $("cf-explorador-anterior").disabled=
  exploradorPagina<=1;

 $("cf-explorador-siguiente").disabled=
  exploradorPagina>=paginas;
}

function actualizarExplorador(){
 exploradorLista=obtenerFichasFiltradas();

 exploradorLista.sort((a,b)=>
  String(a.producto||"").localeCompare(
   String(b.producto||""),
   "es"
  )
 );

 exploradorPagina=1;
 renderExplorador();
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
 actualizarExplorador();
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
 for(const r of registros){
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
  agregarAcciones(tr,r);
  body.appendChild(tr);
 }
 $("cf-limite").textContent="";
 $("cf-estado").textContent=
 (ficha?"Ficha: "+ficha.producto+" | "+codigo:
 "Sector: "+(sectores[sector]||"Todos los sectores"))+
 " | "+registros.length+
 " coincidencias exploratorias por descripcion. Precios unitarios pendientes de verificacion.";
}

$("cf-explorador-anterior").addEventListener(
 "click",
 ()=>{
  if(exploradorPagina>1){
   exploradorPagina--;
   renderExplorador();
  }
 }
);

$("cf-explorador-siguiente").addEventListener(
 "click",
 ()=>{
  const paginas=Math.ceil(
   exploradorLista.length/EXPLORADOR_TAMANO
  );

  if(exploradorPagina<paginas){
   exploradorPagina++;
   renderExplorador();
  }
 }
);

$("cf-sector").addEventListener("change",cargarFichas);
$("cf-buscar").addEventListener("input",cargarFichas);
$("cf-consultar").addEventListener("click",consultar);
cargarSectores();cargarDepartamentos();cargarFichas();
})().catch(e=>{
 const estado=document.getElementById("cf-estado");
 if(estado)estado.textContent="Error: "+e.message;
 console.error(e);
});