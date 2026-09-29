FROM python:3.12-alpine

WORKDIR /app

# hora de Madrid también en los logs
RUN apk add --no-cache tzdata
ENV TZ=Europe/Madrid

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sunnyportal.py probar_sunnyportal.py servidor.py ./
COPY web/ ./web/

# usuario sin privilegios y carpeta para la caché de datos
RUN adduser -D -H app && mkdir -p /app/datos && chown app /app/datos
USER app

ENV PUERTO=8000 \
    CACHE=/app/datos/cache_datos.json \
    PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/datos', timeout=4)"

CMD ["python", "servidor.py"]
