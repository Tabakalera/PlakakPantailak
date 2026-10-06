"use strict";

// ES5 sin dependencias: tiene que funcionar en los navegadores antiguos de las
// pantallas Samsung (MagicInfo/Tizen). Nada de let/const, =>, `plantillas`,
// fetch, Promise, async, spread ni métodos modernos de Array/String.

var REFRESCO_MS = 60000;              // pedir datos cada minuto
var RECARGA_MS = 6 * 60 * 60000;      // recargar la página cada 6 h
var DATOS_VIEJOS_MS = 15 * 60000;     // aviso si los datos tienen más de 15 min
var NS = "http://www.w3.org/2000/svg";
var COLOR_SOLAR = "#d8fe5e";
var COLOR_CONSUMO = "#c4c4c4";

function $(id) { return document.getElementById(id); }

function claseSi(nodo, clase, si) {
  var cs = (" " + (nodo.getAttribute("class") || "") + " ").replace(" " + clase + " ", " ");
  if (si) cs += clase;
  nodo.setAttribute("class", cs.replace(/^\s+|\s+$/g, ""));
}

// ---------- formato ----------------------------------------------------------

function num(n, dec) {
  dec = dec || 0;
  if (n == null || isNaN(n)) return "–";
  var partes = Math.abs(n).toFixed(dec).split(".");
  var conPuntos = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? "−" : "") + conPuntos + (partes[1] ? "," + partes[1] : "");
}
function kw(v) { return num(v, v != null && Math.abs(v) < 10 ? 1 : 0) + " kW"; }

// CO₂ en kg → [valor, unidad]
function co2(kg) {
  if (kg == null) return ["–", "t CO₂"];
  if (kg < 1000) return [num(kg), "kg CO₂"];
  var ton = kg / 1000;
  return [num(ton, ton < 100 ? 1 : 0), "t CO₂"];
}

function dos(n) { return (n < 10 ? "0" : "") + n; }
function hora(d) { return dos(d.getHours()) + ":" + dos(d.getMinutes()); }

// Fecha ISO "2026-10-06T14:50:00", con o sin "Z"/"+02:00". Sin zona = hora local.
// No se usa new Date(texto) porque los navegadores antiguos lo interpretan distinto.
function fecha(txt) {
  var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?(?:\.\d+)?(Z|[+-]\d\d:?\d\d)?$/.exec(txt || "");
  if (!m) return null;
  var a = +m[1], mes = +m[2] - 1, d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0);
  if (!m[7]) return new Date(a, mes, d, h, mi, s);
  var ms = Date.UTC(a, mes, d, h, mi, s);
  if (m[7] !== "Z") {
    var signo = m[7].charAt(0) === "-" ? -1 : 1;
    var z = m[7].replace(":", "");
    ms -= signo * (+z.slice(1, 3) * 60 + +z.slice(3, 5)) * 60000;
  }
  return new Date(ms);
}

// ---------- escalado a la pantalla ------------------------------------------

function escalar() {
  var w = window.innerWidth, h = window.innerHeight;
  var esc = Math.min(w / 1920, h / 1080);
  var e = $("escenario").style;
  e.webkitTransform = e.transform = "scale(" + esc + ")";
  e.left = (w - 1920 * esc) / 2 + "px";
  e.top = (h - 1080 * esc) / 2 + "px";
}
window.addEventListener("resize", escalar);
escalar();

function ponerReloj() { $("reloj").textContent = hora(new Date()); }
setInterval(ponerReloj, 1000);
ponerReloj();

// ---------- utilidades SVG --------------------------------------------------

function el(tag, attrs, padre) {
  var n = document.createElementNS(NS, tag);
  for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
  if (padre) padre.appendChild(n);
  return n;
}

// flecha animada si hay flujo, apagada si no
function flecha(id, valor) {
  claseSi($(id), "parada", !(valor > 0.05));
}

// ---------- gráfica del día -------------------------------------------------

var C = { w: 1760, h: 284, izq: 52, der: 24, arr: 40, abj: 32 };

function pasoBonito(max) {
  var bruto = max / 4;
  var mag = Math.pow(10, Math.floor(Math.log(bruto) / Math.LN10));
  var n = bruto / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function pintarCurva(curva) {
  var svg = $("curva");
  svg.setAttribute("viewBox", "0 0 " + C.w + " " + C.h);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var t0 = hoy.getTime(), t1 = t0 + 24 * 3600000;
  // timeUtc es el final de cada intervalo de 5 min
  var pts = [], i, p, maxV = 10;
  for (i = 0; i < curva.length; i++) {
    var f = fecha(curva[i].t);
    if (!f || f.getTime() <= t0 || f.getTime() > t1) continue;
    p = { t: f.getTime(), fv: curva[i].fv, consumo: curva[i].consumo };
    pts.push(p);
    maxV = Math.max(maxV, p.fv || 0, p.consumo || 0);
  }
  var paso = pasoBonito(maxV);
  var tope = Math.ceil(maxV / paso) * paso;

  function x(t) { return C.izq + ((t - t0) / (t1 - t0)) * (C.w - C.izq - C.der); }
  function y(v) { return C.h - C.abj - (v / tope) * (C.h - C.arr - C.abj); }

  // ejes: solo etiquetas, sin líneas de guía; 00–24 h siempre
  var v, h, tx;
  for (v = 0; v <= tope + 1e-9; v += paso) {
    tx = el("text", { x: C.izq - 12, y: y(v) + 5, "text-anchor": "end", "class": "eje" }, svg);
    tx.textContent = num(v);
  }
  for (h = 0; h <= 24; h += 2) {
    tx = el("text", { x: x(t0 + h * 3600000), y: C.h - 8, "text-anchor": "middle", "class": "eje" }, svg);
    tx.textContent = dos(h) + ":00";
  }

  if (pts.length < 2) return;

  function serie(clave) {
    var linea = "";
    for (var j = 0; j < pts.length; j++) {
      linea += (j ? "L" : "M") + x(pts[j].t).toFixed(1) + "," + y(pts[j][clave] || 0).toFixed(1);
    }
    var area = linea + "L" + x(pts[pts.length - 1].t).toFixed(1) + "," + y(0) +
               "L" + x(pts[0].t).toFixed(1) + "," + y(0) + "Z";
    return { linea: linea, area: area };
  }
  var c = serie("consumo"), s = serie("fv");
  // consumo como contexto suave; la producción solar encima, protagonista
  el("path", { d: c.area, "class": "area-consumo" }, svg);
  el("path", { d: c.linea, "class": "linea-consumo" }, svg);
  el("path", { d: s.area, "class": "area-fv" }, svg);
  el("path", { d: s.linea, "class": "linea-fv" }, svg);

  // capa de interacción (cruz + tooltip), solo útil con ratón
  var guia = el("line", { "class": "guia", y1: C.arr - 10, y2: C.h - C.abj, visibility: "hidden" }, svg);
  var pC = el("circle", { r: 5, "class": "punto", fill: COLOR_CONSUMO, visibility: "hidden" }, svg);
  var pF = el("circle", { r: 5, "class": "punto", fill: COLOR_SOLAR, visibility: "hidden" }, svg);
  var zona = el("rect", { x: C.izq, y: 0, width: C.w - C.izq - C.der, height: C.h, fill: "transparent" }, svg);
  var tip = $("tooltip");
  var marcas = [guia, pC, pF];

  function visibles(si) {
    for (var j = 0; j < marcas.length; j++) marcas[j].setAttribute("visibility", si ? "visible" : "hidden");
  }

  zona.addEventListener("mousemove", function (ev) {
    var caja = svg.getBoundingClientRect();
    var px = ((ev.clientX - caja.left) / caja.width) * C.w;
    var mejor = pts[0];
    for (var j = 1; j < pts.length; j++) {
      if (Math.abs(x(pts[j].t) - px) < Math.abs(x(mejor.t) - px)) mejor = pts[j];
    }
    var X = x(mejor.t);
    visibles(true);
    guia.setAttribute("x1", X); guia.setAttribute("x2", X);
    pC.setAttribute("cx", X); pC.setAttribute("cy", y(mejor.consumo || 0));
    pF.setAttribute("cx", X); pF.setAttribute("cy", y(mejor.fv || 0));
    tip.style.display = "block";
    tip.innerHTML = hora(new Date(mejor.t)) + "<br>" + t("leyenda_fv") + " <b>" + kw(mejor.fv) + "</b><br>" +
                    t("leyenda_consumo") + " <b>" + kw(mejor.consumo) + "</b>";
    var izq = X + 16 + 260 > C.w ? X - 16 - tip.offsetWidth : X + 16;
    tip.style.left = izq + "px";
    tip.style.top = C.arr + "px";
  });
  zona.addEventListener("mouseout", function () {
    tip.style.display = "none";
    visibles(false);
  });
}

// ---------- datos -----------------------------------------------------------

function pintar(d) {
  var a = d.ahora;

  // KPI
  var total = (a.fv_consumida_kw || 0) + (a.red_kw || 0);
  $("k-pct").textContent = total > 0 ? Math.round((a.fv_consumida_kw / total) * 100) : "–";
  $("k-prod").textContent = num(d.acumulado.anio.produccion_kwh);
  var vCo2 = co2(d.co2_kg.anio);
  $("k-co2").textContent = vCo2[0];
  $("k-co2-unid").textContent = vCo2[1];
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
  var periodos = ["dia", "mes", "anio"];
  for (var i = 0; i < periodos.length; i++) {
    var p = periodos[i];
    $("a-" + p + "-p").textContent = num(d.acumulado[p].produccion_kwh);
    $("a-" + p + "-c").textContent = num(d.acumulado[p].consumo_kwh);
  }

  pintarCurva(d.curva || []);

  // "medida" es la hora local de la planta del último dato de 5 min
  var med = fecha(d.medida);
  var act = fecha(d.actualizado);
  var viejo = !act || new Date().getTime() - act.getTime() > DATOS_VIEJOS_MS;
  var aviso = $("aviso");
  claseSi(aviso, "error", viejo);
  var hMed = med ? hora(med) : act ? hora(act) : "";
  aviso.textContent = !act ? t("esperando") : viejo ? t("sin_portal") + " · " + hMed : t("actualizado") + " " + hMed;
}

var ultimo = null;

function sinServidor() {
  claseSi($("aviso"), "error", true);
  $("aviso").textContent = t("sin_servidor");
}

function cargar() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "api/datos?_=" + new Date().getTime(), true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status !== 200) return sinServidor();
    try {
      ultimo = JSON.parse(xhr.responseText);
      pintar(ultimo);
    } catch (e) {
      sinServidor();
    }
  };
  xhr.send();
}

pintarTextos();
vigilarIdioma(function () { if (ultimo) pintar(ultimo); });
cargar();
setInterval(cargar, REFRESCO_MS);
setTimeout(function () { location.reload(); }, RECARGA_MS);
