/* עוֹר וָחוּט — site interactions: catalog rendering, 3D tilt, parallax hero,
   drag-to-spin 360 viewer, product overlay. Vanilla JS, no build step. */

(() => {
  "use strict";

  // ---- TODO: replace the placeholder email with the real business address ----
  const CONTACT = {
    whatsappNumber: "972524742260", // international format, no + or leading 0
    whatsappMessage: "היי! מתעניין/ת בתיק מהאתר",
    email: "hello@example.com",
  };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    $("#year").textContent = new Date().getFullYear();
    setupContactLinks();
    setupNav();
    setupReveal();
    renderCategories();
    renderFilterChips();
    renderCatalog("all");
    if (!reduceMotion) {
      setupCursorGlow();
      setupHeroParallax();
      setupLeaves();
    }
    setupHeroSpin();
    setupOverlay();
    requestAnimationFrame(() => document.body.classList.remove("is-loading"));
  }

  // ---------------- contact ----------------
  function setupContactLinks() {
    const wa = $("#contactWhatsapp");
    if (wa) {
      wa.href = `https://wa.me/${CONTACT.whatsappNumber}?text=${encodeURIComponent(CONTACT.whatsappMessage)}`;
    }
    const email = $("#contactEmail");
    if (email) email.href = `mailto:${CONTACT.email}`;
  }

  function waLinkForProduct(product) {
    const msg = `היי! אשמח לשמוע פרטים על ${product.name} (${money(product.price)})`;
    return `https://wa.me/${CONTACT.whatsappNumber}?text=${encodeURIComponent(msg)}`;
  }

  // ---------------- nav ----------------
  function setupNav() {
    const burger = $("#navBurger");
    const links = $(".nav-links");
    burger.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      burger.setAttribute("aria-expanded", String(open));
    });
    $$(".nav-links a").forEach((a) => a.addEventListener("click", () => {
      links.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
    }));

    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      const nav = $("#siteNav");
      nav.style.boxShadow = window.scrollY > 8 ? "0 12px 30px -20px rgba(0,0,0,0.6)" : "none";
      lastY = window.scrollY;
    }, { passive: true });
  }

  // ---------------- categories ----------------
  let activeFilter = "all";

  function renderCategories() {
    const rail = $("#categoryRail");
    rail.innerHTML = CATEGORIES.map((c) => `
      <div class="cat-card" data-cat="${c.id}" role="button" tabindex="0">
        <span class="cat-icon">${c.icon}</span>
        <h3>${c.name}</h3>
        <p>${c.tagline}</p>
      </div>
    `).join("");

    $$(".cat-card", rail).forEach((card) => {
      card.addEventListener("click", () => {
        setFilter(card.dataset.cat);
        $("#catalog").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); }
      });
      if (!isCoarsePointer) attachTilt(card, { max: 10 });
    });
  }

  function renderFilterChips() {
    const wrap = $("#filterChips");
    const all = [{ id: "all", name: "הכל" }, ...CATEGORIES];
    wrap.innerHTML = all.map((c) => `<button class="chip${c.id === "all" ? " active" : ""}" data-cat="${c.id}">${c.name}</button>`).join("");
    $$(".chip", wrap).forEach((chip) => chip.addEventListener("click", () => setFilter(chip.dataset.cat)));
  }

  function setFilter(cat) {
    activeFilter = cat;
    $$(".chip").forEach((c) => c.classList.toggle("active", c.dataset.cat === cat));
    $$(".cat-card").forEach((c) => c.classList.toggle("active", c.dataset.cat === cat));
    renderCatalog(cat);
  }

  // ---------------- catalog ----------------
  function money(n) {
    return `₪${n.toLocaleString("he-IL")}`;
  }

  function anglesLabel(n) {
    if (n >= 8) return "360°";
    if (n >= 2) return `${n} זוויות`;
    return "";
  }

  function renderCatalog(filter) {
    const grid = $("#catalogGrid");
    const items = PRODUCTS.filter((p) => filter === "all" || p.category === filter || (p.extraCategories || []).includes(filter));
    grid.innerHTML = items.map((p) => `
      <article class="product-card" data-slug="${p.slug}" role="button" tabindex="0">
        <div class="card-tilt">
          <div class="card-media">
            <span class="card-badge">${p.badge}</span>
            ${anglesLabel(p.frames.length) ? `<span class="card-360">${anglesLabel(p.frames.length)}</span>` : ""}
            <img src="${p.cover}" alt="${p.name}" loading="lazy" />
          </div>
          <div class="card-body">
            <h3>${p.name}</h3>
            <p class="card-material">${p.material}</p>
            <p class="card-price">${money(p.price)}</p>
          </div>
        </div>
      </article>
    `).join("");

    $$(".product-card", grid).forEach((card) => {
      card.addEventListener("click", () => openProduct(card.dataset.slug));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); }
      });
      observeReveal(card);
      if (!isCoarsePointer) attachTilt($(".card-tilt", card), { max: 8, sourceEl: card });
    });
  }

  // ---------------- scroll reveal ----------------
  let revealObserver;
  function setupReveal() {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  }
  function observeReveal(el) { revealObserver.observe(el); }

  // ---------------- 3D tilt ----------------
  function attachTilt(el, { max = 10, sourceEl } = {}) {
    const target = sourceEl || el;
    target.addEventListener("mousemove", (e) => {
      const r = target.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg)`;
    });
    target.addEventListener("mouseleave", () => { el.style.transform = ""; });
  }

  // ---------------- cursor glow ----------------
  function setupCursorGlow() {
    const glow = $("#cursorGlow");
    window.addEventListener("mousemove", (e) => {
      glow.style.setProperty("--mx", `${e.clientX}px`);
      glow.style.setProperty("--my", `${e.clientY}px`);
      document.documentElement.style.setProperty("--mx", `${e.clientX}px`);
      document.documentElement.style.setProperty("--my", `${e.clientY}px`);
    }, { passive: true });
  }

  // ---------------- hero parallax ----------------
  function setupHeroParallax() {
    const hero = $("#top");
    const layers = $$("[data-depth]", hero);
    let raf = null;
    hero.addEventListener("mousemove", (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        layers.forEach((layer) => {
          const depth = parseFloat(layer.dataset.depth) || 0.2;
          layer.style.transform = `translate3d(${(-px * 40 * depth).toFixed(1)}px, ${(-py * 40 * depth).toFixed(1)}px, 0)`;
        });
        raf = null;
      });
    });
    hero.addEventListener("mouseleave", () => {
      layers.forEach((layer) => { layer.style.transform = ""; });
    });
  }

  // ---------------- falling autumn leaves ----------------
  // Mottled two-tone palettes echoing a real fall leaf pile: reds, oranges,
  // golds and olive-to-yellow blends, each with a darker vein tone.
  const LEAF_PALETTES = [
    { from: "#b23a2f", to: "#7a2318", vein: "#4a140d" }, // deep red
    { from: "#d4772e", to: "#a1532f", vein: "#74371e" }, // burnt orange
    { from: "#d9a441", to: "#a1532f", vein: "#74371e" }, // golden orange
    { from: "#c98a3a", to: "#8f5c22", vein: "#5c3a15" }, // amber
    { from: "#9aa23f", to: "#c9a83a", vein: "#5c5a1e" }, // olive-to-gold
    { from: "#c1703f", to: "#7a3220", vein: "#4a1f13" }, // terracotta
    { from: "#e0b64a", to: "#c1502f", vein: "#7a2318" }, // yellow-to-red
  ];

  let leafIdCounter = 0;

  function leafSvgUrl(shape, palette) {
    const gradId = `lg${leafIdCounter++}`;
    const gradient = `<linearGradient id='${gradId}' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0%' stop-color='${palette.from}'/><stop offset='100%' stop-color='${palette.to}'/></linearGradient>`;
    const body = shape === "maple"
      ? `<path d='M50 8 L60 20 L76 18 L66 36 L90 38 L64 52 L74 66 L54 60 L50 96 L46 60 L26 66 L36 52 L10 38 L34 36 L24 18 L40 20 Z' fill='url(#${gradId})'/>` +
        `<path d='M50 90 L50 12 M50 50 L66 36 M50 50 L34 36 M50 30 L60 20 M50 30 L40 20' stroke='${palette.vein}' stroke-width='1.6' fill='none' opacity='0.5' stroke-linecap='round'/>`
      : `<path d='M50 6 C82 22 90 56 50 96 C10 56 18 22 50 6 Z' fill='url(#${gradId})'/>` +
        `<path d='M50 14 C46 40 46 62 50 88' stroke='${palette.vein}' stroke-width='3' fill='none' opacity='0.55' stroke-linecap='round'/>`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs>${gradient}</defs>${body}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }

  function setupLeaves() {
    const field = document.createElement("div");
    field.className = "leaf-field";
    field.setAttribute("aria-hidden", "true");
    document.body.appendChild(field);

    const shapes = ["almond", "maple"];
    const count = window.innerWidth < 720 ? 8 : 15;
    for (let i = 0; i < count; i++) {
      const palette = LEAF_PALETTES[Math.floor(Math.random() * LEAF_PALETTES.length)];
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const leaf = document.createElement("span");
      leaf.className = "leaf";
      const size = 14 + Math.random() * 26;
      leaf.style.backgroundImage = leafSvgUrl(shape, palette);
      leaf.style.width = `${size}px`;
      leaf.style.height = `${size}px`;
      leaf.style.left = `${Math.random() * 100}%`;
      leaf.style.opacity = (0.35 + Math.random() * 0.4).toFixed(2);
      leaf.style.animationDuration = `${14 + Math.random() * 16}s`;
      leaf.style.animationDelay = `-${Math.random() * 20}s`;
      leaf.style.setProperty("--sway", `${18 + Math.random() * 30}px`);
      field.appendChild(leaf);
    }
  }

  // ---------------- hero decorative showcase ----------------
  function setupHeroSpin() {
    const showcase = PRODUCTS[0];
    if (!showcase) return;
    $("#heroSpinImg").src = showcase.cover;
  }

  // ---------------- product overlay ----------------
  let viewer = null;

  function setupOverlay() {
    $("#overlayClose").addEventListener("click", closeProduct);
    $("#overlayBackdrop").addEventListener("click", closeProduct);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeProduct();
    });
    $("#spinAutoplay").addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const pressed = btn.getAttribute("aria-pressed") === "true";
      if (pressed) { viewer.stopAutoplay(); btn.setAttribute("aria-pressed", "false"); }
      else { viewer.startAutoplay(); btn.setAttribute("aria-pressed", "true"); }
    });
  }

  function openProduct(slug) {
    const product = PRODUCTS.find((p) => p.slug === slug);
    if (!product) return;

    const category = CATEGORIES.find((c) => c.id === product.category);
    const pane = $("#detailsPane");
    pane.innerHTML = `
      <p class="d-category">${category ? category.name : ""}</p>
      <h2>${product.name}</h2>
      <p class="d-price">${money(product.price)}</p>
      <p class="d-material">${product.material}</p>
      <p class="d-desc">${product.description}</p>
      <span class="d-badge">${product.badge}</span>
      <div class="d-actions">
        <a class="btn btn-primary btn-lg" href="${waLinkForProduct(product)}" target="_blank" rel="noopener">💬 להזמין דרך וואטסאפ</a>
        <a class="btn btn-ghost btn-lg" href="mailto:${CONTACT.email}?subject=${encodeURIComponent("התעניינות ב" + product.name)}">✉️ לשלוח מייל</a>
      </div>
    `;

    const spinEl = $("#spinViewer");
    const multiAngle = product.frames.length > 1;
    spinEl.classList.remove("spun", "dragging");
    spinEl.classList.toggle("single-frame", !multiAngle);
    $("#spinHint").querySelector("span").textContent =
      product.frames.length >= 8 ? "🖐️ גררו לסובב" : "🖐️ גררו לזווית נוספת";
    $("#spinAutoplay").hidden = !multiAngle;
    $("#spinAutoplay").setAttribute("aria-pressed", "false");

    if (!viewer) {
      viewer = new SpinViewer({
        el: spinEl,
        imgEl: $("#spinImg"),
        frames: product.frames,
        progressEl: $("#spinProgress"),
        hintEl: $("#spinHint"),
      });
    } else {
      viewer.stopAutoplay();
      viewer.setFrames(product.frames);
    }

    const overlay = $("#productOverlay");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeProduct() {
    const overlay = $("#productOverlay");
    if (!overlay.classList.contains("open")) return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (viewer) viewer.stopAutoplay();
  }
})();
