"""
Sincronización de la base de datos SQLite con una base de datos Postgres gratuita (Neon).

En hostings gratuitos (Render free) el disco se borra en cada reinicio/actualización.
Para no perder datos:
  - Al arrancar: si existe una copia en la nube, se descarga y sustituye a la base local.
  - Tras cada cambio (POST/PUT/PATCH/DELETE): se sube una copia completa de la base a la nube.
  - Se guarda además un histórico de las últimas copias por seguridad.

Si la variable de entorno DATABASE_URL no está definida (uso local en el PC), no hace nada.
"""
import os
import sqlite3
import threading
import time

DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
HISTORY_KEEP = 30
DEBOUNCE_SECONDS = 1.5

_lock = threading.Lock()
_timer = None
_db_path = None


def enabled() -> bool:
    return bool(DATABASE_URL)


def _connect():
    import psycopg  # import perezoso: en local no hace falta instalarlo
    return psycopg.connect(DATABASE_URL, connect_timeout=20)


def _ensure_tables(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS thr_db_snapshot (
            id INTEGER PRIMARY KEY,
            data BYTEA NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS thr_db_history (
            id BIGSERIAL PRIMARY KEY,
            data BYTEA NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def restore_from_cloud(db_path: str) -> bool:
    """Descarga la copia de la nube a db_path.
    Devuelve True si se restauró, False si la nube aún está vacía.
    Lanza excepción si no se puede conectar (para no sobrescribir nunca la nube con datos viejos)."""
    global _db_path
    _db_path = db_path
    last_err = None
    for attempt in range(5):
        try:
            with _connect() as conn:
                with conn.cursor() as cur:
                    _ensure_tables(cur)
                    cur.execute("SELECT data FROM thr_db_snapshot WHERE id = 1")
                    row = cur.fetchone()
                conn.commit()
            if not row:
                print("[CloudSync] La nube está vacía: se usará la base local como punto de partida.")
                return False
            data = bytes(row[0])
            parent = os.path.dirname(os.path.abspath(db_path))
            os.makedirs(parent, exist_ok=True)
            tmp = db_path + ".cloud.tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, db_path)
            print(f"[CloudSync] Base de datos restaurada desde la nube ({len(data)} bytes).")
            return True
        except Exception as e:  # reintentos (Neon puede tardar en despertar)
            last_err = e
            print(f"[CloudSync] Intento {attempt + 1} de conexión fallido: {e}")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"[CloudSync] No se pudo conectar con la base de datos en la nube: {last_err}")


def _snapshot_bytes(db_path: str) -> bytes:
    src = sqlite3.connect(db_path)
    try:
        return src.serialize()
    finally:
        src.close()


def upload_now() -> bool:
    if not enabled() or not _db_path or not os.path.exists(_db_path):
        return False
    with _lock:
        try:
            data = _snapshot_bytes(_db_path)
            with _connect() as conn:
                with conn.cursor() as cur:
                    _ensure_tables(cur)
                    cur.execute(
                        """
                        INSERT INTO thr_db_snapshot (id, data, updated_at) VALUES (1, %s, now())
                        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
                        """,
                        (data,),
                    )
                    cur.execute("INSERT INTO thr_db_history (data) VALUES (%s)", (data,))
                    cur.execute(
                        """
                        DELETE FROM thr_db_history
                        WHERE id NOT IN (SELECT id FROM thr_db_history ORDER BY id DESC LIMIT %s)
                        """,
                        (HISTORY_KEEP,),
                    )
                conn.commit()
            print(f"[CloudSync] Copia subida a la nube ({len(data)} bytes).")
            return True
        except Exception as e:
            print("[CloudSync] Error subiendo copia a la nube:", e)
            return False


def _run_scheduled():
    global _timer
    _timer = None
    if not upload_now():
        # Reintento si falló
        time.sleep(10)
        upload_now()


def schedule_upload():
    """Programa una subida (agrupa varios cambios seguidos en una sola subida)."""
    global _timer
    if not enabled():
        return
    if _timer is not None:
        return
    _timer = threading.Timer(DEBOUNCE_SECONDS, _run_scheduled)
    _timer.daemon = True
    _timer.start()


def flush():
    """Sube inmediatamente cualquier cambio pendiente (al apagar el servidor)."""
    global _timer
    if not enabled():
        return
    if _timer is not None:
        _timer.cancel()
        _timer = None
        upload_now()
