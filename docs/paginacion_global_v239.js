"use strict";
(()=>{
 const PAGE_SIZE=50;

 const configs=[
  {
   container:"ranking",
   tag:"TR",
   root:"mercado",
   note:"Proveedores adjudicados"
  },
  {
   container:"ficha-results",
   tag:"TR",
   root:"mercado",
   note:"Fichas técnicas"
  },
  {
   container:"cf-resultados",
   tag:"TR",
   root:"mercado",
   note:"Adjudicaciones por ficha"
  },
  {
   container:"ranking",
   tag:".rank-row",
   root:"index",
   note:"Ranking general"
  }
 ];

 const isMarket=
  location.pathname.endsWith("/mercado.html");

 const list=configs.filter(c=>
  c.root===(isMarket?"mercado":"index")
 );

 for(const config of list){

  const host=document.getElementById(
   config.container
  );

  if(!host)continue;

  let page=0;
  let updating=false;

  const nav=document.createElement("div");

  nav.className="radar-pagination";

  nav.style.cssText=
   "display:flex;flex-wrap:wrap;gap:10px;"+
   "align-items:center;margin:14px 0 24px";

  const previous=document.createElement("button");
  previous.type="button";
  previous.textContent="← Anterior";

  const next=document.createElement("button");
  next.type="button";
  next.textContent="Siguiente →";

  const info=document.createElement("span");

  info.style.cssText=
   "font-size:14px;color:#b8d5f4";

  nav.append(previous,info,next);

  const table=host.closest("table");

  const anchor=
   table?.closest(".tablewrap")||
   table||
   host;

  anchor.insertAdjacentElement("afterend",nav);

  function children(){
   return config.tag==="TR"
    ?Array.from(host.children).filter(
      x=>x.tagName==="TR"
     )
    :Array.from(
      host.querySelectorAll(config.tag)
     );
  }

  function paint(reset){

   const all=children();

   const pages=Math.max(
    1,Math.ceil(all.length/PAGE_SIZE)
   );

   if(reset)page=0;

   page=Math.min(page,pages-1);

   updating=true;

   for(let i=0;i<all.length;i++){

    const visible=
     i>=page*PAGE_SIZE&&
     i<(page+1)*PAGE_SIZE;

    if(all[i].hidden===visible){
     all[i].hidden=!visible;
    }
   }

   updating=false;

   previous.disabled=page===0;
   next.disabled=page>=pages-1;

   nav.style.display=
    all.length?"flex":"none";

   const first=all.length
    ?page*PAGE_SIZE+1
    :0;

   const last=Math.min(
    (page+1)*PAGE_SIZE,
    all.length
   );

   info.textContent=
    config.note+": "+
    first+"–"+last+
    " de "+all.length+
    " · Página "+(page+1)+"/"+pages;
  }

  let scheduled=false;

  const observer=new MutationObserver(
   mutations=>{

    if(updating||scheduled)return;

    if(!mutations.some(
      m=>m.type==="childList"
    ))return;

    scheduled=true;

    requestAnimationFrame(()=>{
     scheduled=false;
     paint(true);
    });
   }
  );

  observer.observe(host,{
   childList:true,
   subtree:config.tag!=="TR"
  });

  previous.onclick=()=>{
   if(page>0){
    page--;
    paint(false);
    nav.scrollIntoView({
     block:"nearest"
    });
   }
  };

  next.onclick=()=>{
   page++;
   paint(false);
   nav.scrollIntoView({
    block:"nearest"
   });
  };

  paint(true);
 }
})();
