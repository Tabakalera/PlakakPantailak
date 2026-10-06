"use strict";

const REFRESCO_MS = 60000;             // pedir datos cada minuto
const RECARGA_MS = 6 * 60 * 60000;     // recargar la página cada 6 h
const DATOS_VIEJOS_MS = 15 * 60000;    // aviso si los datos tienen más de 15 min
const NS = "http://www.w3.org/2000/svg";

const $ = (id) => document.getElementById(id);

// ---------- formato ----------------------------------------------------------

function num(n, dec = 0) {
  if (n == null || isNaN(n)) return "–";
  const [ent, frac] = Math.abs(n).toFixed(dec).split(".");
  const conPuntos = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "−" : "") + conPuntos + (frac ? "," + frac : "");
}
const kw = (v) => `${num(v, v != null && Math.abs(v) < 10 ? 1 : 0)} kW`;

// CO₂ en kg → [valor, unidad]
function co2(kg) {
  if (kg == null) return ["–", "t CO₂"];
  if (kg < 1000) return [num(kg), "kg CO₂"];
  const ton = kg / 1000;
  return [num(ton, ton < 100 ? 1 : 0), "t CO₂"];
}
const hora = (d) => d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

// ---------- escalado a la pantalla ------------------------------------------

function escalar() {
  const esc = Math.min(innerWidth / 1920, innerHeight / 1080);
  const e = $("escenario");
  e.style.transform = `scale(${esc})`;
  e.style.left = `${(innerWidth - 1920 * esc) / 2}px`;
  e.style.top = `${(innerHeight - 1080 * esc) / 2}px`;
}
addEventListener("resize", escalar);
escalar();

setInterval(() => ($("reloj").textContent = hora(new Date())), 1000);
$("reloj").textContent = hora(new Date());

// ---------- utilidades SVG --------------------------------------------------

function el(tag, attrs = {}, padre) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (padre) padre.appendChild(n);
  return n;
}

// flecha animada si hay flujo, apagada si no
function flecha(id, valor) {
  $(id).classList.toggle("parada", !(valor > 0.05));
}

// ---------- gráfica del día -------------------------------------------------

const C = { w: 1760, h: 284, izq: 52, der: 24, arr: 40, abj: 32 };

function pasoBonito(max) {
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function pintarCurva(curva) {
  const svg = $("curva");
  svg.setAttribute("viewBox", `0 0 ${C.w} ${C.h}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const t0 = hoy.getTime(), t1 = t0 + 24 * 3600000;
  // timeUtc es el final de cada intervalo de 5 min
  const pts = curva.map((p) => ({ t: new Date(p.t).getTime(), fv: p.fv, consumo: p.consumo }))
                   .filter((p) => p.t > t0 && p.t <= t1);

  const maxV = Math.max(10, ...pts.map((p) => Math.max(p.fv || 0, p.consumo || 0)));
  const paso = pasoBonito(maxV);
  const tope = Math.ceil(maxV / paso) * paso;

  const x = (t) => C.izq + ((t - t0) / (t1 - t0)) * (C.w - C.izq - C.der);
  const y = (v) => C.h - C.abj - (v / tope) * (C.h - C.arr - C.abj);

  // ejes: solo etiquetas, sin líneas de guía; 00–24 h siempre
  for (let v = 0; v <= tope + 1e-9; v += paso) {
    const tx = el("text", { x: C.izq - 12, y: y(v) + 5, "text-anchor": "end", class: "eje" }, svg);
    tx.textContent = num(v);
  }
  for (let h = 0; h <= 24; h += 2) {
    const tx = el("text", { x: x(t0 + h * 3600000), y: C.h - 8, "text-anchor": "middle", class: "eje" }, svg);
    tx.textContent = `${("0" + h).slice(-2)}:00`;
  }

  if (pts.length < 2) return;

  const serie = (clave) => {
    const linea = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[clave] || 0).toFixed(1)}`).join("");
    const area = `${linea}L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)}L${x(pts[0].t).toFixed(1)},${y(0)}Z`;
    return { linea, area };
  };
  const c = serie("consumo"), f = serie("fv");
  // consumo como contexto suave; la producción solar encima, protagonista
  el("path", { d: c.area, class: "area-consumo" }, svg);
  el("path", { d: c.linea, class: "linea-consumo" }, svg);
  el("path", { d: f.area, class: "area-fv" }, svg);
  el("path", { d: f.linea, class: "linea-fv" }, svg);

  // capa de interacción (cruz + tooltip)
  const guia = el("line", { class: "guia", y1: C.arr - 10, y2: C.h - C.abj, visibility: "hidden" }, svg);
  const pC = el("circle", { r: 5, class: "punto", fill: "var(--consumo-linea)", visibility: "hidden" }, svg);
  const pF = el("circle", { r: 5, class: "punto", fill: "var(--solar)", visibility: "hidden" }, svg);
  const zona = el("rect", { x: C.izq, y: 0, width: C.w - C.izq - C.der, height: C.h, fill: "transparent" }, svg);
  const tip = $("tooltip");

  zona.addEventListener("pointermove", (ev) => {
    const caja = svg.getBoundingClientRect();
    const px = ((ev.clientX - caja.left) / caja.width) * C.w;
    let mejor = pts[0];
    for (const p of pts) if (Math.abs(x(p.t) - px) < Math.abs(x(mejor.t) - px)) mejor = p;
    const X = x(mejor.t);
    for (const n of [guia, pC, pF]) n.setAttribute("visibility", "visible");
    guia.setAttribute("x1", X); guia.setAttribute("x2", X);
    pC.setAttribute("cx", X); pC.setAttribute("cy", y(mejor.consumo || 0));
    pF.setAttribute("cx", X); pF.setAttribute("cy", y(mejor.fv || 0));
    tip.hidden = false;
    tip.innerHTML = `${hora(new Date(mejor.t))}<br>${t("leyenda_fv")} <b>${kw(mejor.fv)}</b><br>${t("leyenda_consumo")} <b>${kw(mejor.consumo)}</b>`;
    const izq = X + 16 + 260 > C.w ? X - 16 - tip.offsetWidth : X + 16;
    tip.style.left = `${izq}px`;
    tip.style.top = `${C.arr}px`;
  });
  zona.addEventListener("pointerleave", () => {
    tip.hidden = true;
    for (const n of [guia, pC, pF]) n.setAttribute("visibility", "hidden");
  });
}

// ---------- datos -----------------------------------------------------------

function pintar(d) {
  const a = d.ahora;

  // KPI
  const total = (a.fv_consumida_kw || 0) + (a.red_kw || 0);
  $("k-pct").textContent = total > 0 ? Math.round((a.fv_consumida_kw / total) * 100) : "–";
  $("k-prod").textContent = num(d.acumulado.anio.produccion_kwh);
  const [vCo2, uCo2] = co2(d.co2_kg.anio);
  $("k-co2").textContent = vCo2;
  $("k-co2-unid").textContent = uCo2;
  $("eq-hogares").textContent = num(d.equivalencias.hogares);
  $("eq-arboles").textContent = num(d.equivalencias.arboles);

  // balance energético ahora
  $("v-fv").textContent = kw(a.fv_consumida_kw);
  $("v-red").textContent = kw(a.red_kw);
  $("v-total").textContent = kw(a.consumo_kw);
  $("v-vertido").textContent = kw(a.vertido_kw);
  flecha("f-fv", a.fv_consumida_kw);
  flecha("f-red", a.red_kw);

  // detalle
  for (const p of ["dia", "mes", "anio"]) {
    $(`a-${p}-p`).textContent = num(d.acumulado[p].produccion_kwh);
    $(`a-${p}-c`).textContent = num(d.acumulado[p].consumo_kwh);
  }

  pintarCurva(d.curva || []);

  // "medida" es la hora local de la planta del último dato de 5 min
  const med = d.medida ? new Date(d.medida) : null;
  const act = d.actualizado ? new Date(d.actualizado) : null;
  const viejo = !act || Date.now() - act.getTime() > DATOS_VIEJOS_MS;
  const aviso = $("aviso");
  aviso.classList.toggle("error", viejo);
  const hMed = med ? hora(med) : act ? hora(act) : "";
  aviso.textContent = !act ? t("esperando") : viejo ? `${t("sin_portal")} · ${hMed}` : `${t("actualizado")} ${hMed}`;
}

let ultimo = null;

async function cargar() {
  try {
    const r = await fetch("api/datos", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    ultimo = await r.json();
    pintar(ultimo);
  } catch (e) {
    $("aviso").classList.add("error");
    $("aviso").textContent = t("sin_servidor");
  }
}

pintarTextos();
vigilarIdioma(() => ultimo && pintar(ultimo));
cargar();
setInterval(cargar, REFRESCO_MS);
setTimeout(() => location.reload(), RECARGA_MS);
