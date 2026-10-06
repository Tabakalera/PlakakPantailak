"use strict";

// Idiomas que rotan en la pantalla, en este orden. Para dejar solo euskera: ["eu"]
var IDIOMAS = ["eu", "es", "en"];
var CAMBIO_IDIOMA_SEG = 10; // segundos que se muestra cada idioma

// Textos de la pantalla: [euskera, castellano, inglés]
var TEXTOS = {
  subtitulo:        ["AUTOKONTSUMORAKO INSTALAZIO FOTOBOLTAIKOA", "INSTALACIÓN FOTOVOLTAICA DE AUTOCONSUMO", "SELF-CONSUMPTION SOLAR PV INSTALLATION"],

  // KPI
  frase_solar:      ["uneko kontsumoa eguzki-energiatik", "del consumo actual es energía solar", "of current consumption is solar energy"],
  prod_anio:        ["Aurtengo eguzki-ekoizpena", "Producción solar este año", "Solar production this year"],
  co2_anio:         ["Aurten saihestutako CO₂ isurpenak", "Emisiones de CO₂ evitadas este año", "CO₂ emissions avoided this year"],
  hogares:          ["etxebizitzen kontsumoa", "hogares", "homes"],
  arboles:          ["zuhaitz", "árboles", "trees"],

  // Balance energético ahora
  solar:            ["Eguzkia", "Solar", "Solar"],
  red:              ["Sarea", "Red", "Grid"],
  edificio:         ["Eraikina", "Edificio", "Building"],
  consumo_edificio: ["Eraikinaren kontsumoa", "Consumo del edificio", "Building consumption"],
  vertido:          ["Sarera isuritakoa", "Vertido a la red", "Exported to the grid"],

  // Franja hoy / mes / año
  produccion:       ["kWh ekoizpena", "kWh producción", "kWh production"],
  consumo:          ["kWh kontsumoa", "kWh consumo", "kWh consumption"],
  hoy:              ["Gaur", "Hoy", "Today"],
  mes:              ["Hilabete honetan", "Este mes", "This month"],
  anio:             ["Aurten", "Este año", "This year"],

  // Gráfica
  leyenda_fv:       ["Eguzki-ekoizpena (kW)", "Producción solar (kW)", "Solar production (kW)"],
  leyenda_consumo:  ["Eraikinaren kontsumoa (kW)", "Consumo del edificio (kW)", "Building consumption (kW)"],

  // Estado
  actualizado:      ["Azken eguneraketa", "Última actualización", "Last update"],
  sin_portal:       ["Sunny Portalekin konexiorik gabe", "Sin conexión con Sunny Portal", "No connection to Sunny Portal"],
  sin_servidor:     ["Zerbitzariarekin konexiorik gabe", "Sin conexión con el servidor", "No connection to the server"],
  esperando:        ["Datuen zain…", "Esperando datos…", "Waiting for data…"],
};

var POSICION = { eu: 0, es: 1, en: 2 };

// ?idioma=eu|es|en en la URL fija un idioma y desactiva la rotación
var IDIOMA_FIJO = (/[?&]idioma=([a-z]+)/.exec(location.search) || [])[1];

// Idioma que toca ahora según el reloj (igual en todas las pantallas)
function idiomaActual() {
  if (IDIOMA_FIJO in POSICION) return IDIOMA_FIJO;
  var bloque = Math.floor(Date.now() / (CAMBIO_IDIOMA_SEG * 1000));
  return IDIOMAS[bloque % IDIOMAS.length];
}

var idioma = idiomaActual();

// Texto en el idioma actual
function t(clave) {
  return TEXTOS[clave][POSICION[idioma]];
}

function pintarTextos() {
  document.documentElement.lang = idioma;
  var nodos = document.querySelectorAll("[data-t]");
  for (var i = 0; i < nodos.length; i++) {
    nodos[i].textContent = t(nodos[i].getAttribute("data-t"));
  }
}

// Comprueba cada pocos segundos si toca cambiar; al cambiar hace un fundido corto
function vigilarIdioma(alCambiar) {
  setInterval(function () {
    var nuevo = idiomaActual();
    if (nuevo === idioma) return;
    var esc = document.getElementById("escenario");
    esc.className = "cambiando-idioma";
    setTimeout(function () {
      idioma = nuevo;
      pintarTextos();
      alCambiar();
      esc.className = "";
    }, 400);
  }, 250);
}
