"use strict";
(() => {
  const SIZE = 50;

  const configs = [
    { id: "ranking", type: "cards", page: "index",
      label: "Ranking general" },
    { id: "ranking", type: "rows", page: "mercado",
      label: "Proveedores adjudicados" },
    { id: "ficha-results", type: "rows", page: "mercado",
      label: "Fichas tecnicas" },
    { id: "cf-resultados", type: "rows", page: "mercado",
      label: "Adjudicaciones por ficha" }
  ];

  const currentPage =
    location.pathname.endsWith("mercado.html")
      ? "mercado" : "index";

  const active = new Set();

  function initialize(config) {
    const host = document.getElementById(config.id);

    if (!host || active.has(config.id)) return;

    active.add(config.id);

    let page = 0;
    let previousCount = -1;
    let previousSignature = "";

    const nav = document.createElement("nav");
    nav.setAttribute("aria-label",
      "Paginacion de " + config.label);

    nav.style.cssText =
      "display:flex;gap:12px;align-items:center;" +
      "flex-wrap:wrap;margin:18px 0 25px;";

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "← Anterior";

    const info = document.createElement("span");
    info.style.cssText =
      "font-size:14px;color:#b9cbe3;";

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Siguiente →";

    nav.append(previous, info, next);

    const table = host.closest("table");
    const wrapper = table?.closest(".tablewrap");
    const anchor = wrapper || table || host;

    anchor.insertAdjacentElement("afterend", nav);

    function getItems() {
      if (config.type === "cards") {
        return Array.from(host.children)
          .filter(e => e.classList.contains("rank-row"));
      }

      return Array.from(host.children)
        .filter(e => e.tagName === "TR");
    }

    function paint(reset = false) {
      const items = getItems();
      const total = items.length;
      const pages = Math.max(1, Math.ceil(total / SIZE));

      if (reset) page = 0;
      page = Math.min(Math.max(page, 0), pages - 1);

      const start = page * SIZE;
      const end = Math.min(start + SIZE, total);

      items.forEach((item, i) => {
        if (i >= start && i < end) {
          item.style.removeProperty("display");
        } else {
          item.style.setProperty(
            "display", "none", "important"
          );
        }
      });

      previous.disabled = page === 0;
      next.disabled = page >= pages - 1;

      nav.style.display = total ? "flex" : "none";

      info.textContent =
        config.label + ": " +
        (total ? start + 1 : 0) +
        "–" + end + " de " + total +
        " | Pagina " + (page + 1) +
        " de " + pages;

      previousCount = total;
      previousSignature = items.length
        ? (items[0].textContent || "").slice(0, 100)
        : "";
    }

    previous.addEventListener("click", () => {
      if (page > 0) {
        page--;
        paint();
      }
    });

    next.addEventListener("click", () => {
      if ((page + 1) * SIZE < getItems().length) {
        page++;
        paint();
      }
    });

    let scheduled = false;

    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;

      requestAnimationFrame(() => {
        scheduled = false;

        const items = getItems();
        const signature = items.length
          ? (items[0].textContent || "").slice(0, 100)
          : "";

        const changed =
          items.length !== previousCount ||
          signature !== previousSignature;

        paint(changed);
      });
    });

    observer.observe(host, {
      childList: true,
      subtree: false
    });

    paint(true);
    console.info("PAGINACION_V240_ACTIVA", config.id);
  }

  function scan() {
    for (const config of configs) {
      if (config.page === currentPage) {
        initialize(config);
      }
    }
  }

  scan();

  // La consulta comercial aparece despues de cargar JSON.
  // Este observador permite encontrarla cuando se inserte.
  const bodyObserver = new MutationObserver(() => {
    scan();

    const expected = currentPage === "mercado" ? 3 : 1;
    if (active.size >= expected) {
      bodyObserver.disconnect();
    }
  });

  if (active.size < (currentPage === "mercado" ? 3 : 1)) {
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();