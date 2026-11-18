import sqlite3
import json
import os
from typing import List, Dict, Any, Optional

DB_PATH = os.environ.get(
    "CROSSFIT_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "crossfit.db")
)

AUTO_BACKUP_PATH = os.environ.get(
    "CROSSFIT_BACKUP_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "crossfit_auto_backup.json")
)

def get_db():
    parent = os.path.dirname(os.path.abspath(DB_PATH))
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def save_server_auto_backup():
    """Genera una instantánea JSON automática e indestructible de la base de datos completa."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM microcycles ORDER BY id ASC")
        microcycles = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM days ORDER BY microcycle_id ASC, week_number ASC, day_number ASC")
        days = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM exercises ORDER BY id ASC")
        exercises = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM warmup_types ORDER BY id ASC")
        warmup_types = [dict(r) for r in cursor.fetchall()]
        conn.close()

        data = {
            "version": 1,
            "saved_at": os.path.getmtime(DB_PATH) if os.path.exists(DB_PATH) else None,
            "microcycles": microcycles,
            "days": days,
            "exercises": exercises,
            "warmup_types": warmup_types,
        }
        temp_path = AUTO_BACKUP_PATH + ".tmp"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        if os.path.exists(AUTO_BACKUP_PATH):
            try:
                os.remove(AUTO_BACKUP_PATH)
            except Exception:
                pass
        os.replace(temp_path, AUTO_BACKUP_PATH)
    except Exception as e:
        print("[AutoBackup] Warning saving auto backup:", e)

def try_restore_server_auto_backup():
    """Restaura automáticamente si la base de datos se reinició o tiene menos microciclos/días que el archivo de respaldo."""
    if not os.path.exists(AUTO_BACKUP_PATH):
        return False
    try:
        with open(AUTO_BACKUP_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        backup_mcs = data.get("microcycles") or []
        backup_days = data.get("days") or []
        if not backup_mcs:
            return False

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM microcycles")
        db_mc_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM days")
        db_day_count = cursor.fetchone()[0]

        # Si la base de datos está vacía o tiene menos microciclos/días que el respaldo
        if db_mc_count == 0 or db_day_count < len(backup_days):
            print(f"[AutoBackup] Restaurando automáticamente {len(backup_mcs)} mesociclos y {len(backup_days)} días desde {AUTO_BACKUP_PATH}...")
            for m in backup_mcs:
                cursor.execute("""
                    INSERT OR REPLACE INTO microcycles (id, name, weeks_count, days_per_week, primary_goal, description, access_code, start_date, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    m.get("id"),
                    m.get("name", "Mesociclo"),
                    m.get("weeks_count", 4),
                    m.get("days_per_week", 5),
                    m.get("primary_goal", "Fuerza"),
                    m.get("description", ""),
                    (m.get("access_code") or f"CF{m.get('id', 1)}").upper().strip(),
                    m.get("start_date", ""),
                    1 if m.get("is_active", 1) else 0
                ))

            for d in backup_days:
                cursor.execute("""
                    INSERT OR REPLACE INTO days (id, microcycle_id, week_number, day_number, title, warmup_type, warmup_notes, warmup_exercises, warmup_timer, parts, wod, coaching_tips)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    d.get("id"),
                    d.get("microcycle_id"),
                    d.get("week_number", 1),
                    d.get("day_number", 1),
                    d.get("title", f"Día {d.get('day_number', 1)}"),
                    d.get("warmup_type", "Movilidad GROUND"),
                    d.get("warmup_notes", ""),
                    d.get("warmup_exercises") if isinstance(d.get("warmup_exercises"), str) else json.dumps(d.get("warmup_exercises") or []),
                    d.get("warmup_timer") if isinstance(d.get("warmup_timer"), str) else json.dumps(d.get("warmup_timer") or {"type": "AMRAP", "minutes": 8}),
                    d.get("parts") if isinstance(d.get("parts"), str) else json.dumps(d.get("parts") or []),
                    d.get("wod") if isinstance(d.get("wod"), str) else json.dumps(d.get("wod") or {}),
                    d.get("coaching_tips", "")
                ))
            conn.commit()
            conn.close()
            return True
        conn.close()
    except Exception as e:
        print("[AutoBackup] Error restoring auto backup:", e)
    return False

def init_db():
    # En la nube (Render + Neon): recuperar primero la última copia guardada
    from . import cloud_sync
    cloud_restored = False
    if cloud_sync.enabled():
        cloud_restored = cloud_sync.restore_from_cloud(DB_PATH)

    conn = get_db()
    cursor = conn.cursor()

    # Table: exercises
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        equipment TEXT DEFAULT '[]',
        description TEXT,
        coaching_cues TEXT,
        video_url TEXT,
        is_ground INTEGER DEFAULT 0,
        ground_flow_level TEXT DEFAULT 'Todos',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Table: microcycles
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS microcycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        weeks_count INTEGER NOT NULL,
        days_per_week INTEGER NOT NULL,
        primary_goal TEXT NOT NULL,
        description TEXT,
        access_code TEXT NOT NULL UNIQUE,
        start_date TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    cursor.execute("PRAGMA table_info(microcycles)")
    mc_cols = [r[1] for r in cursor.fetchall()]
    if "start_date" not in mc_cols:
        cursor.execute("ALTER TABLE microcycles ADD COLUMN start_date TEXT DEFAULT ''")

    # Table: days
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        microcycle_id INTEGER NOT NULL,
        week_number INTEGER NOT NULL,
        day_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        warmup_type TEXT DEFAULT 'Movilidad GROUND',
        warmup_notes TEXT,
        warmup_exercises TEXT DEFAULT '[]',
        warmup_timer TEXT DEFAULT '{"type":"AMRAP","minutes":8}',
        parts TEXT DEFAULT '[]',
        wod TEXT DEFAULT '{}',
        coaching_tips TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (microcycle_id) REFERENCES microcycles(id) ON DELETE CASCADE,
        UNIQUE(microcycle_id, week_number, day_number)
    )
    """)

    # Migrate existing days table if warmup_type or warmup_timer column is missing
    cursor.execute("PRAGMA table_info(days)")
    day_cols = [r[1] for r in cursor.fetchall()]
    if "warmup_type" not in day_cols:
        cursor.execute("ALTER TABLE days ADD COLUMN warmup_type TEXT DEFAULT 'Movilidad GROUND'")
    if "warmup_timer" not in day_cols:
        cursor.execute("""ALTER TABLE days ADD COLUMN warmup_timer TEXT DEFAULT '{"type":"AMRAP","minutes":8}'""")

    # Table: warmup_types
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS warmup_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    )
    """)
    for wt in [
        "Movilidad GROUND",
        "Calentamiento General",
        "Activación Core & Escápula",
        "Cardio / Ergómetro",
        "Técnica con Barra",
    ]:
        cursor.execute("INSERT OR IGNORE INTO warmup_types (name) VALUES (?)", (wt,))

    # Table: student_logs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS student_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        microcycle_id INTEGER NOT NULL,
        day_id INTEGER NOT NULL,
        student_name TEXT NOT NULL,
        score TEXT,
        rx_status TEXT DEFAULT 'Rx',
        weights_used TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (microcycle_id) REFERENCES microcycles(id) ON DELETE CASCADE
    )
    """)

    # Table: app_settings (secret key, coach password hash, etc.)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """)

    # Table: students (registration + coach approval workflow)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT DEFAULT '',
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_microcycle_id INTEGER DEFAULT NULL,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        approved_at TIMESTAMP DEFAULT NULL
    )
    """)

    conn.commit()

    # Seed default exercises if empty
    cursor.execute("SELECT COUNT(*) FROM exercises")
    if cursor.fetchone()[0] == 0:
        seed_exercises(conn)

    # Si los datos vienen de la nube, son la fuente de verdad: no restaurar ni sembrar nada encima
    if not cloud_restored:
        # Try auto-restore from latest auto-backup before seeding sample
        restored = try_restore_server_auto_backup()

        # Seed default microcycle only if still empty
        cursor.execute("SELECT COUNT(*) FROM microcycles")
        if cursor.fetchone()[0] == 0:
            seed_sample_microcycle(conn)

    conn.close()

    # Always ensure a valid auto-backup snapshot exists on disk
    save_server_auto_backup()

    # Primera vez en la nube: subir la base local como punto de partida
    if cloud_sync.enabled() and not cloud_restored:
        cloud_sync.upload_now()

def seed_exercises(conn):
    cursor = conn.cursor()

    default_exercises = [
        # --- GROUND (Especialidad Movilidad & Suelo) ---
        {
            "name": "Shin Box Flow & Rotaciones de Cadera (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Trabajo de movilidad articular en suelo propio del método GROUND. Transición suave entre rotación interna y externa de cadera en posición 90/90 (Shin Box) con elevación de pelvis y extensión de glúteos.",
            "coaching_cues": "Mantener torso erguido. Intentar no apoyar las manos al cambiar de lado si la movilidad lo permite. Sentir el apoyo activo de rodillas y espinillas. Respiración controlada y fluida.",
            "video_url": "https://www.youtube.com/watch?v=R9K_p1E0Gcw",
            "is_ground": 1,
            "ground_flow_level": "Fundamental"
        },
        {
            "name": "Beast to Crab Reach (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Flujo de suelo que conecta la postura de cuadrupedia activa baja (Beast) con apertura torácica unilateral en postura de cangrejo (Crab). Excelente para descompresión de hombro y activación del core.",
            "coaching_cues": "Desde Beast, despega rodillas 2 cm del suelo. Rota sobre un pie y mano mientras empujas la pelvis al techo y extiendes el brazo libre con la mirada en la mano de apoyo.",
            "video_url": "https://www.youtube.com/watch?v=FqPz0Jk-43Y",
            "is_ground": 1,
            "ground_flow_level": "Intermedio"
        },
        {
            "name": "Scorpion Reach & Rotación Espinal (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Movimiento de rotación torácica y apertura de flexores de cadera en suelo. Desde decúbito prono o plancha invertida hacia torsión controlada de columna.",
            "coaching_cues": "Llevar el talón hacia la mano contraria buscando longitud, no solo flexión. Mantener hombro base en contacto activo.",
            "video_url": "https://www.youtube.com/watch?v=Hcx08eW0K6M",
            "is_ground": 1,
            "ground_flow_level": "Intermedio"
        },
        {
            "name": "Side Kickthrough & Transición Lateral (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Movimiento dinámico de ground flow. Rotación del torso con paso lateral rasante por debajo del cuerpo manteniendo apoyo firme en trípode (1 mano y 1 pie).",
            "coaching_cues": "La cadera roza el suelo sin llegar a colapsar. La mano libre se repliega protegiendo la cara o el pecho. Estabilidad escapular activa.",
            "video_url": "https://www.youtube.com/watch?v=B7bZ9cI3lY0",
            "is_ground": 1,
            "ground_flow_level": "Avanzado"
        },
        {
            "name": "Deep Squat to Spine Twist & Flujo Escapular (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Apertura profunda de sentadilla en suelo con rotación del eje torácico e implicación de la cintura pélvica y escapular para preparación de haltero y squat.",
            "coaching_cues": "Talones pegados al suelo, codo anclado contra la rodilla interna, apertura del pecho hacia la diagonal superior.",
            "video_url": "https://www.youtube.com/watch?v=kY7o0q8Wl4Y",
            "is_ground": 1,
            "ground_flow_level": "Fundamental"
        },
        {
            "name": "Wrist Mobility & Palm Press Ground Prep (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Preparación articular y de fascia palmar en cuatro apoyos para acondicionar muñecas para soporte de barra en front rack, handstands y flexiones.",
            "coaching_cues": "Cargar peso progresivamente en dedos y base de la palma. Rotaciones en sentido horario y antihorario, dorsos de manos y estiramiento de flexores/extensores.",
            "video_url": "https://www.youtube.com/watch?v=eE7yG0Xz2-Y",
            "is_ground": 1,
            "ground_flow_level": "Fundamental"
        },
        {
            "name": "Thoracic Bridge & Ola Espinal (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Secuencia de extensión de columna y movilidad torácica. Permite desbloquear la espalda alta antes de movimientos overhead como Snatch o Jerk.",
            "coaching_cues": "Empuje fuerte de glúteos hacia el techo, brazo arqueando por encima de la cabeza sin bloquear la respiración.",
            "video_url": "https://www.youtube.com/watch?v=FqPz0Jk-43Y",
            "is_ground": 1,
            "ground_flow_level": "Intermedio"
        },
        {
            "name": "Ape & Frogger Ground Locomotion (GROUND)",
            "category": "ground",
            "equipment": json.dumps(["Sin material"]),
            "description": "Patrones de desplazamiento bajo en sentadilla profunda con apoyo de manos. Trabajo integral de cadera, tobillos y estabilidad escapular.",
            "coaching_cues": "Manos primero, salto elástico suave amortiguando con pies. Sin impacto seco.",
            "video_url": "https://www.youtube.com/watch?v=B7bZ9cI3lY0",
            "is_ground": 1,
            "ground_flow_level": "Intermedio"
        },

        # --- HALTEROFILIA (Weightlifting) ---
        {
            "name": "Snatch (Arrancada)",
            "category": "halterofilia",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "Movimiento olímpico completo que lleva la barra desde el suelo hasta por encima de la cabeza en un solo movimiento fluido recibiendo en sentadilla profunda.",
            "coaching_cues": "Barra pegada a las espinillas, primer tirón controlado, extensión triple violenta en cadera/rodilla/tobillo y bloqueo sólido con hombros activos en el rececho.",
            "video_url": "https://www.youtube.com/watch?v=9xQp2sldyts",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Power Snatch (Arrancada de Potencia)",
            "category": "halterofilia",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "Arrancada recibida por encima de la paralela (cadera superior a las rodillas). Enfocado en potencia y velocidad de cadera.",
            "coaching_cues": "Máxima aceleración en el segundo tirón, recepción firme con pies estables y bloqueo overhead inmediato.",
            "video_url": "https://www.youtube.com/watch?v=TL8p1Gg1W2E",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Clean & Jerk (Dos Tiempos)",
            "category": "halterofilia",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "El levantamiento olímpico de máxima carga: cargada al pecho (Clean) seguido de expulsión por encima de la cabeza (Jerk en split o push).",
            "coaching_cues": "Codos altos y rápidos en el rack del clean. En el jerk, dip vertical y recuperación pie delantero primero.",
            "video_url": "https://www.youtube.com/watch?v=8miqQQJXZ0M",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Power Clean (Cargada de Potencia)",
            "category": "halterofilia",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "Llevar la barra desde el suelo a los hombros en posición front rack sin descender por debajo de la paralela.",
            "coaching_cues": "Mantener la espalda neutra, contacto potente en muslos y rotación rápida de codos hacia adelante.",
            "video_url": "https://www.youtube.com/watch?v=EKRiW9qK9mY",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Overhead Squat (Sentadilla de Arrancada)",
            "category": "halterofilia",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "Sentadilla completa manteniendo la barra bloqueada sobre la cabeza con agarre amplio.",
            "coaching_cues": "Empujar activamente la barra hacia el techo (hombros a las orejas), torso lo más vertical posible, rodillas hacia afuera.",
            "video_url": "https://www.youtube.com/watch?v=pn8mqlGZK1A",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },

        # --- FUERZA (Strength) ---
        {
            "name": "Back Squat (Sentadilla Trasera)",
            "category": "fuerza",
            "equipment": json.dumps(["Barra olímpica", "Discos", "Rack"]),
            "description": "Ejercicio fundamental de fuerza de tren inferior con barra apoyada sobre trapecios.",
            "coaching_cues": "Core compacto (maniobra de Valsalva), descenso controlado rompiendo paralela, ascenso liderado con el pecho sin colapsar rodillas.",
            "video_url": "https://www.youtube.com/watch?v=ultWZbUMPL8",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Front Squat (Sentadilla Frontal)",
            "category": "fuerza",
            "equipment": json.dumps(["Barra olímpica", "Discos", "Rack"]),
            "description": "Sentadilla con la barra cargada en la cintura escapular anterior (front rack). Gran demanda de core y cuádriceps.",
            "coaching_cues": "Codos bien arriba en todo momento, torso completamente vertical, empuje desde el mediopié.",
            "video_url": "https://www.youtube.com/watch?v=uYumuL_G_V0",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Deadlift (Peso Muerto)",
            "category": "fuerza",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "Levantamiento de carga máxima desde el suelo hasta cadera extendida. Implica toda la cadena posterior.",
            "coaching_cues": "Espalda plana, dorsales activados empacando los hombros, barra en contacto con piernas durante todo el trayecto.",
            "video_url": "https://www.youtube.com/watch?v=op9kVnSso6Q",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Strict Shoulder Press (Press Militar Estricto)",
            "category": "fuerza",
            "equipment": json.dumps(["Barra olímpica", "Discos"]),
            "description": "Empuje vertical estricto de hombros sin impulso de piernas. Glúteos y abdomen en máxima tensión.",
            "coaching_cues": "Mentón hacia atrás para dejar pasar la barra, trayectoria recta hacia arriba y meter la cabeza al finalizar el bloqueo.",
            "video_url": "https://www.youtube.com/watch?v=xe19t2_6y38",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },

        # --- GIMNÁSTICOS (Gymnastics) ---
        {
            "name": "Bar Muscle-Up (BMU)",
            "category": "gimnasticos",
            "equipment": json.dumps(["Barra de dominadas"]),
            "description": "Transición gimnástica fluida desde colgado en barra hasta soporte completo de brazos sobre la barra.",
            "coaching_cues": "Kip potente buscando hollow y arch, tracción rápida al ombligo y transición agresiva del torso sobre la barra.",
            "video_url": "https://www.youtube.com/watch?v=OCg7T_YyQ7Y",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Toes-to-Bar (T2B)",
            "category": "gimnasticos",
            "equipment": json.dumps(["Barra de dominadas"]),
            "description": "Tocar con ambos pies simultáneamente la barra de dominadas mediante balanceo gimnástico (kipping) y flexión de core.",
            "coaching_cues": "Empujar la barra hacia abajo con los dorsales, elevar rodillas al pecho y dar el latigazo final con los pies a la barra.",
            "video_url": "https://www.youtube.com/watch?v=_03pCU667WY",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Handstand Push-Up (HSPU)",
            "category": "gimnasticos",
            "equipment": json.dumps(["Pared", "AbMat"]),
            "description": "Flexiones de brazos verticales haciendo el pino contra la pared (estrictas o con kip de piernas).",
            "coaching_cues": "Formar un trípode estable entre cabeza y manos. En kipping, flexionar rodillas controladas y patear verticalmente.",
            "video_url": "https://www.youtube.com/watch?v=0wDEO6shVjc",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Pull-ups (Dominadas Kipping / Butterfly)",
            "category": "gimnasticos",
            "equipment": json.dumps(["Barra de dominadas"]),
            "description": "Dominadas dinámicas con ritmo gimnástico para acumulación eficiente de repeticiones en WOD.",
            "coaching_cues": "Barbilla supera claramente la barra. Mantener la tensión corporal sin quebrar la cadera en exceso.",
            "video_url": "https://www.youtube.com/watch?v=J3b4zY4Y0z4",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },

        # --- METCON & CARDIO ---
        {
            "name": "Thruster",
            "category": "metcon",
            "equipment": json.dumps(["Barra olímpica", "Discos", "Mancuernas"]),
            "description": "Combinación continua de Front Squat profundo con Push Press overhead en un único movimiento explosivo.",
            "coaching_cues": "Aprovechar la energía elástica de la sentadilla para proyectar la barra hacia arriba. Extensión total en la cima.",
            "video_url": "https://www.youtube.com/watch?v=L219ltL15zk",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Double Unders (Saltos Dobles de Comba)",
            "category": "metcon",
            "equipment": json.dumps(["Comba / Cuerda"]),
            "description": "Dos pasos de la comba por debajo de los pies en un solo salto vertical.",
            "coaching_cues": "Codos pegados al cuerpo, rotación rápida generada en las muñecas, salto con rebote reactivo de tobillos.",
            "video_url": "https://www.youtube.com/watch?v=82jNxWU24vg",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Wall Ball Shots",
            "category": "metcon",
            "equipment": json.dumps(["Balón medicinal", "Diana de pared"]),
            "description": "Sentadilla profunda sujetando balón medicinal al pecho y lanzamiento explosivo a diana reglamentaria (3m / 2.7m).",
            "coaching_cues": "Recibir el balón amortiguando inmediatamente en sentadilla, lanzamiento con triple extensión.",
            "video_url": "https://www.youtube.com/watch?v=Eqj_txsmE38",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Burpees over the Bar",
            "category": "metcon",
            "equipment": json.dumps(["Barra olímpica", "Sin material"]),
            "description": "Pecho al suelo al lado de la barra y salto lateral o frontal con ambos pies despegando a la vez sobre la barra.",
            "coaching_cues": "Ritmo constante, pies cerca de las manos al levantarse, saltar con cadera baja para ganar segundos.",
            "video_url": "https://www.youtube.com/watch?v=cZpM3Xk7syg",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Remo Concept2 (Row Erg)",
            "category": "metcon",
            "equipment": json.dumps(["Remo"]),
            "description": "Monostructural aeróbico de tracción de cuerpo completo. 60% piernas, 20% core, 20% brazos.",
            "coaching_cues": "Secuencia en empuje: piernas -> cadera -> brazos. En retorno: brazos -> cadera -> piernas.",
            "video_url": "https://www.youtube.com/watch?v=zQ82RYIFLN8",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Echo Bike / AirBike",
            "category": "metcon",
            "equipment": json.dumps(["EcoBike"]),
            "description": "Bicicleta de resistencia por aire con brazos móviles para estímulo cardiovascular de máxima potencia láctica.",
            "coaching_cues": "Empuje y tracción constante de brazos sincronizado con el pedaleo, torso estable.",
            "video_url": "https://www.youtube.com/watch?v=zQ82RYIFLN8",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Dumbbell Snatch (Arrancada con Mancuerna)",
            "category": "metcon",
            "equipment": json.dumps(["Mancuernas"]),
            "description": "Arrancada de mancuerna desde el suelo a overhead alternando brazos. Movimiento clásico en competiciones de CrossFit.",
            "coaching_cues": "Espalda firme, ambos cabezales tocan el suelo, extensión de cadera y cambio de mano a la altura de la cara.",
            "video_url": "https://www.youtube.com/watch?v=78HhH_jG4xY",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        },
        {
            "name": "Box Jump Over",
            "category": "metcon",
            "equipment": json.dumps(["Cajón"]),
            "description": "Salto al cajón aterrizando en la parte superior y pasando al otro lado (step down o salto de bajada).",
            "coaching_cues": "Aterrizar suave con rodillas flexionadas, pivotar sobre el cajón para encarar el siguiente salto con fluidez.",
            "video_url": "https://www.youtube.com/watch?v=uCmsM0b0G4s",
            "is_ground": 0,
            "ground_flow_level": "N/A"
        }
    ]

    for ex in default_exercises:
        cursor.execute("""
        INSERT INTO exercises (name, category, equipment, description, coaching_cues, video_url, is_ground, ground_flow_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            ex["name"], ex["category"], ex["equipment"], ex["description"],
            ex["coaching_cues"], ex["video_url"], ex["is_ground"], ex["ground_flow_level"]
        ))

    conn.commit()

def seed_sample_microcycle(conn):
    cursor = conn.cursor()

    # Create Microcycle
    cursor.execute("""
    INSERT INTO microcycles (name, weeks_count, days_per_week, primary_goal, description, access_code)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (
        "Microciclo 1: Fuerza Máxima, Halterofilia & Engine",
        4,
        5,
        "Fuerza & Halterofilia",
        "Microciclo enfocado en ganancia de fuerza básica (Back Squat & Deadlift), técnica y velocidad en Snatch, con preparación específica de movilidad articular basada en GROUND antes de cada sesión.",
        "CF2026"
    ))
    microcycle_id = cursor.lastrowid

    empty_manual_wod = json.dumps({
        "title": "",
        "type": "WOD",
        "time_cap": "",
        "has_time_cap": False,
        "exercises": [],
        "rx_weights": "",
        "scaled_weights": "",
        "strategy": "",
        "is_manual": True
    })

    # Seed Days for Week 1 (5 days)
    sample_days_week1 = [
        {
            "week": 1,
            "day": 1,
            "title": "Día 1: Sentadilla Trasera Pesada & Sprint Engine",
            "warmup_notes": "10 minutos de calentamiento enfocado en pelvis, tobillos y cadera con la metodología GROUND.",
            "warmup_exercises": json.dumps([
                {
                    "name": "Shin Box Flow & Rotaciones de Cadera (GROUND)",
                    "sets": "3 rondas",
                    "reps": "8 transiciones por lado",
                    "notes": "Pausar 2 segundos en la máxima rotación y proyectar la cadera hacia arriba activando glúteo.",
                    "video_url": "https://www.youtube.com/watch?v=R9K_p1E0Gcw"
                },
                {
                    "name": "Deep Squat to Spine Twist & Flujo Escapular (GROUND)",
                    "sets": "2 rondas",
                    "reps": "6 rotaciones por brazo",
                    "notes": "Mantener talones pegados y pecho abierto hacia el techo.",
                    "video_url": "https://www.youtube.com/watch?v=kY7o0q8Wl4Y"
                },
                {
                    "name": "Double Unders (Saltos Dobles de Comba)",
                    "sets": "3 rondas",
                    "reps": "30 saltos",
                    "notes": "Activación reactiva de gemelos y coordinación.",
                    "video_url": "https://www.youtube.com/watch?v=82jNxWU24vg"
                }
            ]),
            "parts": json.dumps([
                {
                    "part_label": "Bloque A",
                    "title": "Fuerza Principal: Back Squat",
                    "type": "Fuerza",
                    "description": "5 series x 5 repeticiones @ 75% del 1RM. Descanso 2:30 entre series. Mantener tempo 30X1 (3 seg de bajada controlada, sin pausa abajo y subida explosiva).",
                    "exercises": [
                        {
                            "name": "Back Squat (Sentadilla Trasera)",
                            "sets": "5",
                            "reps": "5",
                            "load": "75% 1RM",
                            "rest": "150 seg",
                            "video_url": "https://www.youtube.com/watch?v=ultWZbUMPL8"
                        }
                    ]
                },
                {
                    "part_label": "Bloque B",
                    "title": "Accesorio Hipertrofia & Core",
                    "type": "Accesorio",
                    "description": "3 Rondas por calidad: 10 Bulgarian Split Squats con mancuernas por pierna + 15 Toes to Bar controlados.",
                    "exercises": [
                        {
                            "name": "Toes-to-Bar (T2B)",
                            "sets": "3",
                            "reps": "15",
                            "load": "Peso corporal",
                            "rest": "60 seg",
                            "video_url": "https://www.youtube.com/watch?v=_03pCU667WY"
                        }
                    ]
                }
            ]),
            "wod": empty_manual_wod,
            "coaching_tips": "El foco del día es la consistencia en el Back Squat. En el WOD, vigilar que los atletas rompan el paralelo en todos los thrusters."
        },
        {
            "week": 1,
            "day": 2,
            "title": "Día 2: Técnica de Snatch & Gymnastic Density",
            "warmup_notes": "Movilidad de suelo específica para el hombro y escápula con GROUND antes del Snatch.",
            "warmup_exercises": json.dumps([
                {
                    "name": "Wrist Mobility & Palm Press Ground Prep (GROUND)",
                    "sets": "2 rondas",
                    "reps": "1 min continuo",
                    "notes": "Acondicionamiento de flexores y extensores de muñeca contra el suelo.",
                    "video_url": "https://www.youtube.com/watch?v=eE7yG0Xz2-Y"
                },
                {
                    "name": "Beast to Crab Reach (GROUND)",
                    "sets": "3 rondas",
                    "reps": "6 repeticiones alternas",
                    "notes": "Empuje vertical de cadera y rotación torácica amplia.",
                    "video_url": "https://www.youtube.com/watch?v=FqPz0Jk-43Y"
                },
                {
                    "name": "Side Kickthrough & Transición Lateral (GROUND)",
                    "sets": "2 rondas",
                    "reps": "8 repeticiones fluidas",
                    "notes": "Enfoque en fluidez y estabilidad sobre una sola mano.",
                    "video_url": "https://www.youtube.com/watch?v=B7bZ9cI3lY0"
                }
            ]),
            "parts": json.dumps([
                {
                    "part_label": "Bloque A",
                    "title": "Complejo de Halterofilia: Snatch",
                    "type": "Halterofilia",
                    "description": "Cada 2:00 x 6 series:\n1 Hang Power Snatch + 1 Overhead Squat + 1 Squat Snatch.\nEmpezar con el 65% y subir hasta el 75-80% si la técnica es impecable.",
                    "exercises": [
                        {
                            "name": "Snatch (Arrancada)",
                            "sets": "6",
                            "reps": "1 complex",
                            "load": "65% -> 80%",
                            "rest": "90 seg",
                            "video_url": "https://www.youtube.com/watch?v=9xQp2sldyts"
                        },
                        {
                            "name": "Overhead Squat (Sentadilla de Arrancada)",
                            "sets": "6",
                            "reps": "1 pausa 2 seg abajo",
                            "load": "Misma carga",
                            "rest": "Dentro del complex",
                            "video_url": "https://www.youtube.com/watch?v=pn8mqlGZK1A"
                        }
                    ]
                }
            ]),
            "wod": empty_manual_wod,
            "coaching_tips": "En el complejo de arrancada, corregir que la barra no se separe del cuerpo tras el salto."
        },
        {
            "week": 1,
            "day": 3,
            "title": "Día 3: Peso Muerto Pesado & Capacidad Anaeróbica",
            "warmup_notes": "Preparación de la cadena posterior con GROUND.",
            "warmup_exercises": json.dumps([
                {
                    "name": "Scorpion Reach & Rotación Espinal (GROUND)",
                    "sets": "3 rondas",
                    "reps": "6 por lado",
                    "notes": "Apertura pélvica y descompresión lumbar activa.",
                    "video_url": "https://www.youtube.com/watch?v=Hcx08eW0K6M"
                },
                {
                    "name": "Thoracic Bridge & Ola Espinal (GROUND)",
                    "sets": "3 rondas",
                    "reps": "5 puentes con extensión",
                    "notes": "Activación glútea y extensión dorsal.",
                    "video_url": "https://www.youtube.com/watch?v=FqPz0Jk-43Y"
                }
            ]),
            "parts": json.dumps([
                {
                    "part_label": "Bloque A",
                    "title": "Fuerza: Deadlift",
                    "type": "Fuerza",
                    "description": "Construir una serie pesada de 5 repeticiones sólidas (Touch and Go controlado sin rebotar la barra). Luego 2 series de bajada con el 85% de la marca del día.",
                    "exercises": [
                        {
                            "name": "Deadlift (Peso Muerto)",
                            "sets": "5",
                            "reps": "5",
                            "load": "Progresivo hasta RPE 8.5",
                            "rest": "180 seg",
                            "video_url": "https://www.youtube.com/watch?v=op9kVnSso6Q"
                        }
                    ]
                }
            ]),
            "wod": empty_manual_wod,
            "coaching_tips": "El peso muerto no debe convertirse en un levantamiento con la espalda redonda. Bloquear dorsales."
        },
        {
            "week": 1,
            "day": 4,
            "title": "Día 4: Clean & Jerk de Potencia & Gimnasia Pura",
            "warmup_notes": "Flujo continuo de suelo de 8 minutos integrando Shin Box y Beast to Crab.",
            "warmup_exercises": json.dumps([
                {
                    "name": "Shin Box Flow & Rotaciones de Cadera (GROUND)",
                    "sets": "2 rondas",
                    "reps": "10 cambios de lado",
                    "notes": "Fluidez continua al ritmo de la respiración.",
                    "video_url": "https://www.youtube.com/watch?v=R9K_p1E0Gcw"
                },
                {
                    "name": "Ape & Frogger Ground Locomotion (GROUND)",
                    "sets": "3 pasadas",
                    "reps": "10 metros",
                    "notes": "Apertura pélvica dinámica en sentadilla profunda.",
                    "video_url": "https://www.youtube.com/watch?v=B7bZ9cI3lY0"
                }
            ]),
            "parts": json.dumps([
                {
                    "part_label": "Bloque A",
                    "title": "Halterofilia: Power Clean + Push Jerk",
                    "type": "Halterofilia",
                    "description": "5 series x (2 Power Cleans + 1 Push Jerk) @ 75-80% 1RM. Pausa de 1 segundo en el dip del jerk para controlar el tronco.",
                    "exercises": [
                        {
                            "name": "Clean & Jerk (Dos Tiempos)",
                            "sets": "5",
                            "reps": "2+1",
                            "load": "78%",
                            "rest": "120 seg",
                            "video_url": "https://www.youtube.com/watch?v=8miqQQJXZ0M"
                        }
                    ]
                },
                {
                    "part_label": "Bloque B",
                    "title": "Gimnástico: Handstand Skill",
                    "type": "Gimnásticos",
                    "description": "4 series de 8 a 10 Handstand Push-ups estrictos o kipping + 20 segundos de Hollow Hold.",
                    "exercises": [
                        {
                            "name": "Handstand Push-Up (HSPU)",
                            "sets": "4",
                            "reps": "8-10",
                            "load": "Peso corporal",
                            "rest": "90 seg",
                            "video_url": "https://www.youtube.com/watch?v=0wDEO6shVjc"
                        }
                    ]
                }
            ]),
            "wod": empty_manual_wod,
            "coaching_tips": "En el push jerk, insistir en el bloqueo de rodillas al recibir la barra."
        },
        {
            "week": 1,
            "day": 5,
            "title": "Día 5: Aerobic Capacity & Grinder Friday",
            "warmup_notes": "Calentamiento articular completo combinando GROUND con movilidad de muñecas.",
            "warmup_exercises": json.dumps([
                {
                    "name": "Wrist Mobility & Palm Press Ground Prep (GROUND)",
                    "sets": "2 rondas",
                    "reps": "1 min",
                    "notes": "Preparar apoyo palmar y flexibilidad de dedos.",
                    "video_url": "https://www.youtube.com/watch?v=eE7yG0Xz2-Y"
                },
                {
                    "name": "Beast to Crab Reach (GROUND)",
                    "sets": "3 rondas",
                    "reps": "8 alternas",
                    "notes": "Apertura completa de pecho y hombro.",
                    "video_url": "https://www.youtube.com/watch?v=FqPz0Jk-43Y"
                }
            ]),
            "parts": json.dumps([
                {
                    "part_label": "Bloque A",
                    "title": "Fuerza Frontal: Front Squat",
                    "type": "Fuerza",
                    "description": "4 series x 3 repeticiones @ 82% 1RM. Pausa de 2 segundos en la primera repetición de cada serie.",
                    "exercises": [
                        {
                            "name": "Front Squat (Sentadilla Frontal)",
                            "sets": "4",
                            "reps": "3",
                            "load": "82%",
                            "rest": "150 seg",
                            "video_url": "https://www.youtube.com/watch?v=uYumuL_G_V0"
                        }
                    ]
                }
            ]),
            "wod": empty_manual_wod,
            "coaching_tips": "Cuidar la posición del rack en la sentadilla frontal: codos paralelos al suelo."
        }
    ]

    for d in sample_days_week1:
        cursor.execute("""
        INSERT INTO days (microcycle_id, week_number, day_number, title, warmup_notes, warmup_exercises, parts, wod, coaching_tips)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            microcycle_id, d["week"], d["day"], d["title"],
            d["warmup_notes"], d["warmup_exercises"], d["parts"], d["wod"], d["coaching_tips"]
        ))

    # Also generate template empty/baseline days for Weeks 2, 3, 4 so all 4 weeks are initialized
    for w in range(2, 5):
        for d in range(1, 6):
            title = f"Semana {w} - Día {d}: Programación de Progresión"
            warmup_notes = "Calentamiento articular y activación específica GROUND."
            warmup_exercises = json.dumps([
                {
                    "name": "Shin Box Flow & Rotaciones de Cadera (GROUND)",
                    "sets": "3 rondas",
                    "reps": "8 por lado",
                    "notes": "Fluidez en suelo.",
                    "video_url": "https://www.youtube.com/watch?v=R9K_p1E0Gcw"
                },
                {
                    "name": "Beast to Crab Reach (GROUND)",
                    "sets": "2 rondas",
                    "reps": "6 repeticiones",
                    "notes": "Extensión torácica.",
                    "video_url": "https://www.youtube.com/watch?v=FqPz0Jk-43Y"
                }
            ])
            parts = json.dumps([
                {
                    "part_label": "Bloque A",
                    "title": f"Semana {w}: Progresión de Fuerza/Haltero (+2.5% a 5%)",
                    "type": "Fuerza",
                    "description": f"Progresión planificada para semana {w}. Aumentar carga o volumen de trabajo.",
                    "exercises": []
                }
            ])
            wod = empty_manual_wod
            cursor.execute("""
            INSERT INTO days (microcycle_id, week_number, day_number, title, warmup_notes, warmup_exercises, parts, wod, coaching_tips)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                microcycle_id, w, d, title, warmup_notes, warmup_exercises, parts, wod, "Enfoque técnico semana " + str(w)
            ))

    conn.commit()
