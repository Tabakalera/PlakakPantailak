# Despliegue: pantalla de la instalación fotovoltaica

Pantalla web (1920×1080) que muestra en tiempo casi real la producción solar y el consumo de Tabakalera. Los datos se leen de **SMA Sunny Portal powered by ennexOS**. Se monta igual que **DashboardEnergetikoa**: imagen Docker + `docker-compose.yml` en la red `proxynet_network`.

## Qué es

- Un único contenedor Python (librería estándar + `requests`), sin base de datos. Imagen de unos 100 MB.
- Escucha en el **puerto 8000** y sirve:
  - `/`: la pantalla (HTML/CSS/JS estáticos, sin dependencias externas; la tipografía va incluida).
  - `/api/datos`: JSON con los datos que usa la pantalla.
- Consulta Sunny Portal en segundo plano: datos actuales cada minuto, curva del día cada 5 minutos, mes y año cada 15 minutos. Guarda los últimos datos buenos en memoria y en `/app/datos/cache_datos.json`. Las visitas a la pantalla **no** generan peticiones a SMA, así que el número de pantallas o visitas no afecta.
- Si Sunny Portal falla, la pantalla sigue mostrando los últimos datos con un aviso en rojo, y el contenedor reintenta solo.
- Tiene `HEALTHCHECK` sobre `/api/datos`.

## Variables de entorno (`.env`, no se sube a Git)

```
SMA_USER=usuario@tabakalera.eus
SMA_PASSWORD=********
```

Es una cuenta de Sunny Portal con acceso a la planta TABAKALERA DONOSTIA. Plantilla: `.env.example`.

## Construir y publicar la imagen

```sh
docker build -t tbksys/plakapantailak:release .
docker push tbksys/plakapantailak:release
```

## Arrancar en el servidor

```sh
# en la carpeta con docker-compose.yml y .env
docker compose pull
docker compose up -d
docker compose logs -f     # debe aparecer: "Primeros datos cargados de la planta TABAKALERA DONOSTIA"
```

Después hay que dar de alta en el proxy un host que apunte a `web:8000`, igual que en DashboardEnergetikoa.

## Prueba en local sin proxy

```sh
docker run --rm --env-file .env -p 8090:8000 tbksys/plakapantailak:release
# abrir http://localhost:8090
```

## Uso en la pantalla o el loop

- URL: la raíz, a pantalla completa. Está diseñada a 1920×1080 y se escala a cualquier resolución.
- El texto rota euskera → castellano → inglés cada 10 s.
- `?idioma=eu`, `?idioma=es` o `?idioma=en` fija un idioma.
- La página pide datos nuevos cada minuto y se recarga sola cada 6 h. No necesita interacción.
- Funciona en las pantallas Samsung con MagicInfo, que llevan un navegador antiguo (Tizen 2.4, "Browser 1.1", WebKit de 2014). Por eso `web/` está escrito en JavaScript ES5 y CSS sin variables, flex ni grid. Hay que mantenerlo así.
- `?diag` en la URL muestra abajo, en negro, el navegador, la resolución y cualquier error de JavaScript. Sirve para diagnosticar una pantalla sin conectar un ordenador.

## Notas

- Los datos de SMA se actualizan cada 5 minutos. "Ahora" significa el último intervalo de 5 minutos.
- La conexión con SMA es el login web normal de Sunny Portal (OAuth2 en `login.sma.energy`) y la API interna `uiapi.sunnyportal.com`. No es la API oficial de SMA para terceros, así que si SMA cambia su web podría dejar de funcionar. En ese caso, el log del contenedor mostrará `Fallo al consultar Sunny Portal`.
