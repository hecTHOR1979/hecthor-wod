import os
import io
import json
import socket
import sqlite3
from typing import List, Optional
import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response

from .database import get_db, init_db, save_server_auto_backup
from .models import (
    MicrocycleCreate, MicrocycleUpdate,
    DayUpdate, ExerciseCreate, ExerciseUpdate,
    StudentAccessRequest, StudentLogCreate,
    WodGeneratorRequest, WarmupTypeCreate,
    CoachAuthRequest, CoachChangePasswordRequest,
    StudentRegisterRequest, StudentLoginRequest,
    CoachStudentCreate, CoachStudentUpdate,
)
from .auth import (
    hash_password, verify_password,
    is_coach_configured, get_coach_username,
    verify_coach_credentials, verify_coach_password, set_coach_credentials, get_coach_token_version,
    create_token, get_current_actor, require_coach, require_student_or_coach,
)
from .wod_generator import generate_custom_wod

# Initialize DB on startup
init_db()

from contextlib import asynccontextmanager
from . import cloud_sync


@asynccontextmanager
async def _lifespan(_app):
    yield
    # Al apagar el servidor: subir cualquier cambio pendiente a la nube
    cloud_sync.flush()


app = FastAPI(title="THR Plan API", version="1.0.0", lifespan=_lifespan)


@app.middleware("http")
async def cloud_sync_after_writes(request: Request, call_next):
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and response.status_code < 400:
        cloud_sync.schedule_upload()
    return response

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")

# Helper to serialize sqlite rows with json fields parsed
def normalize_ex_name(name: str) -> str:
    if not name:
        return ""
    import unicodedata, re
    n = unicodedata.normalize('NFD', name)
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn')
    n = n.lower()
    n = re.sub(r'[^a-z0-9]', ' ', n)
    return re.sub(r'\s+', ' ', n).strip()

def build_exercise_library_lookup(cursor=None):
    close_conn = False
    if cursor is None:
        conn = get_db()
        cursor = conn.cursor()
        close_conn = True
    cursor.execute("SELECT id, name, video_url, coaching_cues, description FROM exercises")
    rows = cursor.fetchall()
    lookup = {}
    import re
    for r in rows:
        vid = (r["video_url"] if isinstance(r, dict) or hasattr(r, "keys") and "video_url" in r.keys() else r[2]) or ""
        if not vid or not vid.strip():
            continue
        raw_name = (r["name"] if isinstance(r, dict) or hasattr(r, "keys") and "name" in r.keys() else r[1]) or ""
        cues = (r["coaching_cues"] if isinstance(r, dict) or hasattr(r, "keys") and "coaching_cues" in r.keys() else r[3]) or ""
        desc = (r["description"] if isinstance(r, dict) or hasattr(r, "keys") and "description" in r.keys() else r[4]) or ""
        notes = cues or desc or ""
        meta = {"video_url": vid.strip(), "notes": notes.strip(), "canonical_name": raw_name}
        
        norm_full = normalize_ex_name(raw_name)
        if norm_full:
            lookup[norm_full] = meta
        
        # Split aliases in parentheses, e.g. Back Squat (Sentadilla Trasera)
        parts = re.split(r'[\(\)\/]', raw_name)
        for p in parts:
            norm_p = normalize_ex_name(p)
            if norm_p and len(norm_p) >= 3 and norm_p not in lookup:
                lookup[norm_p] = meta

    if close_conn:
        conn.close()
    return lookup

def enrich_day_videos(d: dict, lookup: Optional[dict] = None):
    try:
        if lookup is None:
            lookup = build_exercise_library_lookup()
        if not lookup:
            return d

        import re
        def attach_video(item: dict):
            if not isinstance(item, dict):
                return
            if not item.get("is_timed_section") and not item.get("is_sub_block"):
                name = item.get("name") or ""
                cur_vid = (item.get("video_url") or "").strip()
                if not cur_vid and name:
                    norm = normalize_ex_name(name)
                    match = lookup.get(norm)
                    if not match:
                        for part in re.split(r'[\(\)\/]', name):
                            norm_p = normalize_ex_name(part)
                            if norm_p in lookup:
                                match = lookup[norm_p]
                                break
                    if not match and len(norm) >= 4:
                        for k, v in lookup.items():
                            if k.startswith(norm) or norm.startswith(k):
                                match = v
                                break
                    if match:
                        item["video_url"] = match["video_url"]
            
            # Check sub_exercises
            for sub in (item.get("sub_exercises") or []):
                attach_video(sub)

        for ex in (d.get("warmup_exercises") or []):
            attach_video(ex)
        for part in (d.get("parts") or []):
            for ex in (part.get("exercises") or []):
                attach_video(ex)
        wod = d.get("wod")
        if isinstance(wod, dict):
            for m in (wod.get("exercises") or wod.get("movements") or []):
                attach_video(m)
    except Exception as err:
        print("enrich_day_videos error:", err)
    return d

def auto_sync_exercises_to_db(warmup_exercises, parts, wod, cursor):
    try:
        items_to_sync = []
        def collect(item, default_cat="Fuerza"):
            if not isinstance(item, dict):
                return
            if not item.get("is_timed_section") and not item.get("is_sub_block"):
                name = (item.get("name") or "").strip()
                vid = (item.get("video_url") or "").strip()
                notes = (item.get("notes") or "").strip()
                if name and vid:
                    items_to_sync.append({"name": name, "video_url": vid, "notes": notes, "category": default_cat})
            for sub in (item.get("sub_exercises") or []):
                collect(sub, default_cat)

        for ex in (warmup_exercises or []):
            collect(ex, "Calentamiento")
        for part in (parts or []):
            p_cat = (part.get("type") or "Fuerza").strip()
            for ex in (part.get("exercises") or []):
                collect(ex, p_cat)
        if isinstance(wod, dict):
            for m in (wod.get("exercises") or wod.get("movements") or []):
                collect(m, "WOD")

        seen_norms = set()
        for item in items_to_sync:
            norm = normalize_ex_name(item["name"])
            if not norm or norm in seen_norms:
                continue
            seen_norms.add(norm)
            cursor.execute("SELECT id, video_url FROM exercises WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))", (item["name"],))
            existing = cursor.fetchone()
            if existing:
                ex_id = existing[0]
                cur_vid = (existing[1] or "").strip()
                if not cur_vid:
                    cursor.execute("UPDATE exercises SET video_url = ?, coaching_cues = ? WHERE id = ?", (item["video_url"], item["notes"], ex_id))
            else:
                is_ground = 1 if "ground" in norm else 0
                cursor.execute("""
                    INSERT INTO exercises (name, category, equipment, description, coaching_cues, video_url, is_ground, ground_flow_level)
                    VALUES (?, ?, '[]', '', ?, ?, ?, 'N/A')
                """, (item["name"], item["category"], item["notes"], item["video_url"], is_ground))
    except Exception as err:
        print("auto_sync_exercises_to_db error:", err)

def row_to_day(row: sqlite3.Row):
    d = dict(row)
    d["warmup_type"] = d.get("warmup_type") or "Movilidad GROUND"
    try:
        d["warmup_exercises"] = json.loads(d.get("warmup_exercises") or "[]")
    except Exception:
        d["warmup_exercises"] = []
    try:
        wt = json.loads(d.get("warmup_timer") or "{}")
        d["warmup_timer"] = wt if wt else {"type": "AMRAP", "minutes": 8}
    except Exception:
        d["warmup_timer"] = {"type": "AMRAP", "minutes": 8}
    try:
        d["parts"] = json.loads(d.get("parts") or "[]")
    except Exception:
        d["parts"] = []
    try:
        d["wod"] = json.loads(d.get("wod") or "{}")
    except Exception:
        d["wod"] = {}
    return enrich_day_videos(d)

def row_to_exercise(row: sqlite3.Row):
    d = dict(row)
    try:
        d["equipment"] = json.loads(d.get("equipment") or "[]")
    except Exception:
        d["equipment"] = []
    return d

# ================= AUTH & ACCESS CONTROL API =================

def _student_public_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d.pop("password_hash", None)
    return d


def _get_student_microcycles(assigned_microcycle_id: Optional[int]) -> list:
    conn = get_db()
    cursor = conn.cursor()
    if assigned_microcycle_id:
        cursor.execute(
            "SELECT * FROM microcycles WHERE id = ? AND is_active = 1",
            (assigned_microcycle_id,),
        )
    else:
        cursor.execute("SELECT * FROM microcycles WHERE is_active = 1 ORDER BY id DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    for mc in rows:
        cursor.execute(
            "SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC",
            (mc["id"],),
        )
        mc["days"] = [row_to_day(d) for d in cursor.fetchall()]
    conn.close()
    return rows


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status(request: Request):
    return {
        "coach_configured": is_coach_configured(),
        "coach_username": get_coach_username(),
        "actor": get_current_actor(request),
    }


@app.post("/api/auth/coach/setup")
def coach_first_setup(req: CoachAuthRequest):
    if is_coach_configured():
        raise HTTPException(status_code=403, detail="El acceso de entrenador ya está configurado.")
    pw = (req.password or "").strip()
    if len(pw) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")
    set_coach_credentials(req.username or "coach", pw)
    token = create_token({"role": "coach", "ver": get_coach_token_version()})
    return {"token": token, "username": get_coach_username(), "message": "Contraseña de entrenador guardada."}


@app.post("/api/auth/coach/login")
def coach_login(req: CoachAuthRequest):
    if not is_coach_configured():
        raise HTTPException(status_code=400, detail="Configura primero tu contraseña de entrenador.")
    if not verify_coach_credentials(req.username or "", req.password or ""):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
    token = create_token({"role": "coach", "ver": get_coach_token_version()})
    return {"token": token, "username": get_coach_username()}


@app.post("/api/auth/coach/change-password")
def coach_change_password(req: CoachChangePasswordRequest, _coach=Depends(require_coach)):
    if os.environ.get("COACH_PASSWORD"):
        raise HTTPException(status_code=400, detail="La contraseña viene fijada por la variable de entorno COACH_PASSWORD del servidor.")
    if not verify_coach_credentials(get_coach_username(), req.current_password):
        raise HTTPException(status_code=401, detail="La contraseña actual no es correcta.")
    new_pw = (req.new_password or "").strip()
    if len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 4 caracteres.")
    set_coach_credentials(get_coach_username(), new_pw)
    token = create_token({"role": "coach", "ver": get_coach_token_version()})
    return {"token": token, "message": "Contraseña actualizada correctamente."}


# ================= COACH STUDENT APPROVALS API =================

@app.get("/api/coach/students")
def list_students(_coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.*, m.name AS assigned_microcycle_name, m.access_code AS assigned_access_code
        FROM students s
        LEFT JOIN microcycles m ON s.assigned_microcycle_id = m.id
        ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.id DESC
    """)
    rows = [_student_public_dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


@app.post("/api/coach/students")
def create_student_by_coach(req: CoachStudentCreate, _coach=Depends(require_coach)):
    name = req.full_name.strip()
    email = req.email.strip().lower()
    pw = req.password.strip()
    if not name or "@" not in email or len(pw) < 4:
        raise HTTPException(status_code=400, detail="Nombre, email válido y contraseña (mín. 4 caracteres) son obligatorios.")
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO students (full_name, email, phone, password_hash, status, assigned_microcycle_id, notes, approved_at)
            VALUES (?, ?, ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP)
        """, (name, email, (req.phone or "").strip(), hash_password(pw), req.assigned_microcycle_id, req.notes or ""))
        conn.commit()
        sid = cursor.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Ya existe un alumno con ese email.")
    conn.close()
    return {"id": sid, "message": "Alumno dado de alta y aprobado."}


@app.put("/api/coach/students/{student_id}")
def update_student_by_coach(student_id: int, req: CoachStudentUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    fields = []
    values = []
    if req.status is not None:
        st = req.status.strip().lower()
        if st not in ("pending", "approved", "rejected"):
            conn.close()
            raise HTTPException(status_code=400, detail="Estado no válido.")
        fields.append("status = ?")
        values.append(st)
        if st == "approved":
            fields.append("approved_at = CURRENT_TIMESTAMP")
    if req.clear_microcycle_assignment:
        fields.append("assigned_microcycle_id = NULL")
    elif req.assigned_microcycle_id is not None:
        fields.append("assigned_microcycle_id = ?")
        values.append(req.assigned_microcycle_id)
    if req.notes is not None:
        fields.append("notes = ?")
        values.append(req.notes)

    if not fields:
        conn.close()
        return {"message": "Sin cambios"}

    values.append(student_id)
    cursor.execute(f"UPDATE students SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")
    conn.close()
    return {"message": "Alumno actualizado correctamente."}


@app.delete("/api/coach/students/{student_id}")
def delete_student_by_coach(student_id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM students WHERE id = ?", (student_id,))
    conn.commit()
    conn.close()
    return {"message": "Alumno eliminado."}


# ================= MICROCYCLES API =================

@app.get("/api/microcycles")
def list_microcycles(_coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT m.*, COUNT(d.id) as total_programmed_days 
        FROM microcycles m
        LEFT JOIN days d ON m.id = d.microcycle_id
        GROUP BY m.id
        ORDER BY m.id DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/microcycles")
def create_microcycle(m: MicrocycleCreate, _coach=Depends(require_coach)):
    import datetime as _dt
    today = _dt.date.today()
    default_monday = (today - _dt.timedelta(days=today.weekday())).isoformat()
    start_date = (m.start_date or "").strip() or default_monday

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO microcycles (name, weeks_count, days_per_week, primary_goal, description, access_code, start_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (m.name, m.weeks_count, m.days_per_week, m.primary_goal, m.description or "", m.access_code.upper().strip(), start_date))
        microcycle_id = cursor.lastrowid

        # Generate template blank days for this microcycle
        for w in range(1, m.weeks_count + 1):
            for d in range(1, m.days_per_week + 1):
                cursor.execute("""
                    INSERT INTO days (microcycle_id, week_number, day_number, title, warmup_notes, warmup_exercises, parts, wod, coaching_tips)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    microcycle_id, w, d, f"Microciclo {w} - Día {d}",
                    "Calentamiento general y movilidad articular GROUND",
                    json.dumps([]), json.dumps([]), json.dumps({
                        "title": f"WOD Día {d}",
                        "type": "AMRAP",
                        "time_cap": "15 Minutos",
                        "description": "Configura el WOD para este día",
                        "rx_weights": "",
                        "scaled_weights": "",
                        "target_score": "",
                        "strategy": ""
                    }),
                    ""
                ))
        conn.commit()
        save_server_auto_backup()
        return {"id": microcycle_id, "message": "Microciclo creado correctamente con todas sus sesiones"}
    except sqlite3.IntegrityError as e:
        conn.close()
        raise HTTPException(status_code=400, detail="El código de acceso ya existe. Elige otro código único.")
    finally:
        conn.close()

@app.get("/api/microcycles/{id}")
def get_microcycle(id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM microcycles WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Microciclo no encontrado")

    microcycle = dict(row)

    # Fetch days
    cursor.execute("SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC", (id,))
    day_rows = cursor.fetchall()
    microcycle["days"] = [row_to_day(d) for d in day_rows]
    conn.close()
    return microcycle

@app.put("/api/microcycles/{id}")
def update_microcycle(id: int, u: MicrocycleUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    fields = []
    values = []
    if u.name is not None:
        fields.append("name = ?")
        values.append(u.name)
    if u.weeks_count is not None:
        fields.append("weeks_count = ?")
        values.append(u.weeks_count)
    if u.days_per_week is not None:
        fields.append("days_per_week = ?")
        values.append(u.days_per_week)
    if u.primary_goal is not None:
        fields.append("primary_goal = ?")
        values.append(u.primary_goal)
    if u.description is not None:
        fields.append("description = ?")
        values.append(u.description)
    if u.access_code is not None:
        fields.append("access_code = ?")
        values.append(u.access_code.upper().strip())
    if u.start_date is not None:
        fields.append("start_date = ?")
        values.append(u.start_date.strip())
    if u.is_active is not None:
        fields.append("is_active = ?")
        values.append(u.is_active)

    if not fields:
        conn.close()
        return {"message": "Sin cambios"}

    values.append(id)
    query = f"UPDATE microcycles SET {', '.join(fields)} WHERE id = ?"
    try:
        cursor.execute(query, values)
        conn.commit()
        save_server_auto_backup()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="El código de acceso ya está en uso por otro microciclo")
    finally:
        conn.close()

    return {"message": "Microciclo actualizado con éxito"}

@app.delete("/api/microcycles/{id}")
def delete_microcycle(id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM microcycles WHERE id = ?", (id,))
    cursor.execute("DELETE FROM days WHERE microcycle_id = ?", (id,))
    cursor.execute("DELETE FROM student_logs WHERE microcycle_id = ?", (id,))
    conn.commit()
    conn.close()
    save_server_auto_backup()
    return {"message": "Microciclo y sus sesiones eliminados"}

# ================= DAYS API =================

@app.get("/api/days/{day_id}")
def get_day(day_id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM days WHERE id = ?", (day_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Día no encontrado")
    return row_to_day(row)

@app.put("/api/days/{day_id}")
def update_day(day_id: int, d: DayUpdate, sync_lib: bool = Query(default=False), _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE days 
        SET title = ?, warmup_type = ?, warmup_notes = ?, warmup_exercises = ?, warmup_timer = ?, parts = ?, wod = ?, coaching_tips = ?
        WHERE id = ?
    """, (
        d.title,
        (d.warmup_type or "Movilidad GROUND").strip(),
        d.warmup_notes or "",
        json.dumps(d.warmup_exercises or []),
        json.dumps(d.warmup_timer or {"type": "AMRAP", "minutes": 8}),
        json.dumps(d.parts or []),
        json.dumps(d.wod or {}),
        d.coaching_tips or "",
        day_id
    ))
    if sync_lib:
        auto_sync_exercises_to_db(d.warmup_exercises, d.parts, d.wod, cursor)
    conn.commit()
    conn.close()
    save_server_auto_backup()
    return {"message": "Día guardado correctamente"}

@app.get("/api/warmup-types")
def list_warmup_types(_actor=Depends(require_student_or_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM warmup_types ORDER BY id ASC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.post("/api/warmup-types")
def create_warmup_type(wt: WarmupTypeCreate, _coach=Depends(require_coach)):
    name = wt.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El tipo de Warm Up no puede estar vacío")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO warmup_types (name) VALUES (?)", (name,))
    conn.commit()
    cursor.execute("SELECT id, name FROM warmup_types WHERE name = ?", (name,))
    row = dict(cursor.fetchone())
    conn.close()
    return row

@app.post("/api/days/copy")
def copy_day(source_day_id: int, target_day_id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT warmup_type, warmup_notes, warmup_exercises, warmup_timer, parts, wod, coaching_tips FROM days WHERE id = ?", (source_day_id,))
    source = cursor.fetchone()
    if not source:
        conn.close()
        raise HTTPException(status_code=404, detail="Día de origen no encontrado")

    cursor.execute("""
        UPDATE days
        SET warmup_type = ?, warmup_notes = ?, warmup_exercises = ?, warmup_timer = ?, parts = ?, wod = ?, coaching_tips = ?
        WHERE id = ?
    """, (source[0], source[1], source[2], source[3], source[4], source[5], source[6], target_day_id))
    conn.commit()
    conn.close()
    save_server_auto_backup()
    return {"message": "Sesión duplicada en el día destino"}

# ================= EXERCISES & VIDEOS API =================

@app.get("/api/exercises")
def list_exercises(category: Optional[str] = None, ground_only: Optional[int] = None, _actor=Depends(require_student_or_coach)):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM exercises WHERE 1=1"
    params = []

    if ground_only:
        query += " AND is_ground = 1"
    elif category:
        query += " AND category = ?"
        params.append(category)

    query += " ORDER BY is_ground DESC, name ASC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [row_to_exercise(r) for r in rows]

@app.post("/api/exercises")
def create_exercise(ex: ExerciseCreate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO exercises (name, category, equipment, description, coaching_cues, video_url, is_ground, ground_flow_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        ex.name, ex.category, json.dumps(ex.equipment or []),
        ex.description or "", ex.coaching_cues or "",
        ex.video_url or "", ex.is_ground or 0, ex.ground_flow_level or "Todos"
    ))
    conn.commit()
    ex_id = cursor.lastrowid
    conn.close()
    return {"id": ex_id, "message": "Ejercicio añadido a la biblioteca"}

@app.put("/api/exercises/{id}")
def update_exercise(id: int, ex: ExerciseUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    fields = []
    values = []
    if ex.name is not None:
        fields.append("name = ?")
        values.append(ex.name.strip())
    if ex.category is not None:
        fields.append("category = ?")
        values.append(ex.category.strip())
    if ex.equipment is not None:
        fields.append("equipment = ?")
        values.append(json.dumps(ex.equipment))
    if ex.description is not None:
        fields.append("description = ?")
        values.append(ex.description)
    if ex.coaching_cues is not None:
        fields.append("coaching_cues = ?")
        values.append(ex.coaching_cues)
    if ex.video_url is not None:
        fields.append("video_url = ?")
        values.append(ex.video_url.strip())
    if ex.is_ground is not None:
        fields.append("is_ground = ?")
        values.append(1 if ex.is_ground else 0)
    if ex.ground_flow_level is not None:
        fields.append("ground_flow_level = ?")
        values.append(ex.ground_flow_level)

    if not fields:
        conn.close()
        return {"message": "Sin cambios"}

    values.append(id)
    cursor.execute(f"UPDATE exercises SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Ejercicio no encontrado")
    conn.close()
    return {"message": "Ejercicio actualizado correctamente"}

@app.delete("/api/exercises/{id}")
def delete_exercise(id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM exercises WHERE id = ?", (id,))
    conn.commit()
    conn.close()
    return {"message": "Ejercicio eliminado"}

# ================= WOD GENERATOR API =================

@app.post("/api/generate-wod")
def generate_wod_endpoint(req: WodGeneratorRequest, _coach=Depends(require_coach)):
    wod = generate_custom_wod(
        equipment_available=req.equipment,
        time_minutes=req.time_minutes,
        wod_type=req.wod_type,
        goal=req.goal or "Híbrido",
        skills=req.skills or []
    )
    return wod

# ================= STUDENT / ALUMNOS PORTAL API =================

@app.post("/api/student/register")
def student_register(req: StudentRegisterRequest):
    name = (req.full_name or "").strip()
    email = (req.email or "").strip().lower()
    pw = (req.password or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Introduce tu nombre completo.")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Introduce un correo electrónico válido.")
    if len(pw) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO students (full_name, email, phone, password_hash, status)
            VALUES (?, ?, ?, ?, 'pending')
        """, (name, email, (req.phone or "").strip(), hash_password(pw)))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Ya existe una solicitud o cuenta registrada con ese correo.")
    conn.close()
    return {"message": "Solicitud enviada correctamente. Tu entrenador revisará tu alta para darte acceso."}


@app.post("/api/student/login")
def student_login(req: StudentLoginRequest):
    email = (req.email or "").strip().lower()
    pw = req.password or ""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()

    if not row or not verify_password(pw, row["password_hash"]):
        # Check if the coach is logging in from the student view
        raw_user = (req.email or "").strip()
        is_coach = False
        if is_coach_configured():
            if verify_coach_password(pw):
                is_coach = True
            elif verify_coach_credentials(raw_user, pw) or verify_coach_credentials(email, pw):
                is_coach = True
        if is_coach:
            token = create_token({"role": "coach", "ver": get_coach_token_version()})
            microcycles = _get_student_microcycles(None)
            return {
                "token": token,
                "student": {
                    "id": 0,
                    "full_name": f"Coach ({get_coach_username()})",
                    "email": email or get_coach_username(),
                    "role": "coach",
                },
                "microcycles": microcycles,
            }
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    if row["status"] == "pending":
        raise HTTPException(status_code=403, detail="Tu alta está pendiente de aprobación por tu entrenador.")
    if row["status"] != "approved":
        raise HTTPException(status_code=403, detail="Tu acceso no está habilitado. Contacta con tu entrenador.")

    token = create_token({"role": "student", "student_id": row["id"]})
    microcycles = _get_student_microcycles(row["assigned_microcycle_id"])
    return {
        "token": token,
        "student": _student_public_dict(row),
        "microcycles": microcycles,
    }


@app.get("/api/student/me")
def student_me(actor=Depends(require_student_or_coach)):
    assigned_id = actor.get("assigned_microcycle_id") if actor["role"] == "student" else None
    microcycles = _get_student_microcycles(assigned_id)
    return {
        "actor": actor,
        "microcycles": microcycles,
    }


@app.post("/api/student/verify")
def student_verify(req: StudentAccessRequest, actor=Depends(require_student_or_coach)):
    code = req.access_code.upper().strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM microcycles WHERE access_code = ? AND is_active = 1", (code,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=403, detail="Código de acceso no válido o microciclo inactivo. Consulta a tu entrenador.")
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and row["id"] != actor["assigned_microcycle_id"]:
        conn.close()
        raise HTTPException(status_code=403, detail="No tienes acceso asignado a este microciclo.")

    microcycle = dict(row)
    cursor.execute("SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC", (microcycle["id"],))
    day_rows = cursor.fetchall()
    microcycle["days"] = [row_to_day(d) for d in day_rows]
    conn.close()
    return microcycle

@app.post("/api/student/log")
def submit_student_log(log: StudentLogCreate, actor=Depends(require_student_or_coach)):
    student_name = actor["full_name"] if actor["role"] == "student" else log.student_name.strip()
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and log.microcycle_id != actor["assigned_microcycle_id"]:
        raise HTTPException(status_code=403, detail="No puedes registrar marcas en este microciclo.")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO student_logs (microcycle_id, day_id, student_name, score, rx_status, weights_used, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        log.microcycle_id, log.day_id, student_name,
        log.score.strip(), log.rx_status or "Rx",
        log.weights_used or "", log.notes or ""
    ))
    conn.commit()
    log_id = cursor.lastrowid
    conn.close()
    return {"id": log_id, "message": "¡Resultado registrado con éxito!"}

@app.get("/api/student/logs/{microcycle_id}")
def get_student_logs(microcycle_id: int, day_id: Optional[int] = None, actor=Depends(require_student_or_coach)):
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and microcycle_id != actor["assigned_microcycle_id"]:
        raise HTTPException(status_code=403, detail="Sin acceso a los registros de este microciclo.")
    conn = get_db()
    cursor = conn.cursor()
    if day_id:
        cursor.execute("""
            SELECT l.*, d.title as day_title, d.week_number, d.day_number
            FROM student_logs l
            JOIN days d ON l.day_id = d.id
            WHERE l.microcycle_id = ? AND l.day_id = ?
            ORDER BY l.id DESC
        """, (microcycle_id, day_id))
    else:
        cursor.execute("""
            SELECT l.*, d.title as day_title, d.week_number, d.day_number
            FROM student_logs l
            JOIN days d ON l.day_id = d.id
            WHERE l.microcycle_id = ?
            ORDER BY l.id DESC
        """, (microcycle_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ================= SERVER INFO (IP LAN PARA MÓVIL) =================

def _get_lan_ips() -> List[str]:
    ips: List[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("8.8.8.8", 80))
        primary = s.getsockname()[0]
        s.close()
        if primary and not primary.startswith(("127.", "169.254.")):
            ips.append(primary)
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith(("127.", "169.254.")) and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips

@app.get("/api/server-info")
def get_server_info(request: Request, _coach=Depends(require_coach)):
    ips = _get_lan_ips()
    port = request.url.port or 8000
    primary_ip = ips[0] if ips else "127.0.0.1"
    host = (request.url.hostname or "").lower()
    is_public = host not in ("127.0.0.1", "localhost", "") and not host.startswith(("192.168.", "10.", "172."))
    if is_public:
        base = str(request.base_url).rstrip("/")
        coach_url = f"{base}/"
        student_url = f"{base}/alumnos"
    else:
        coach_url = f"http://{primary_ip}:{port}/"
        student_url = f"http://{primary_ip}:{port}/alumnos"
    return {
        "primary_ip": primary_ip,
        "all_ips": ips,
        "port": port,
        "coach_url": coach_url,
        "student_url": student_url,
    }

@app.get("/api/qr")
def generate_qr_svg(text: str = Query(..., min_length=1, max_length=500), _coach=Depends(require_coach)):
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")

# ================= BACKUP & RESTORE (PERSISTENCIA Y SEGURIDAD) =================
@app.get("/api/backup/export")
def export_database_backup(_coach=Depends(require_coach)):
    """Exporta una copia completa de toda la base de datos (microciclos, días, ejercicios, calentamientos y registros)
    en formato JSON estructurado para que el entrenador pueda guardarla localmente.
    """
    from datetime import datetime as _dt
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
    
    cursor.execute("SELECT * FROM student_logs ORDER BY id ASC")
    student_logs = [dict(r) for r in cursor.fetchall()]
    
    conn.close()
    
    return {
        "version": 1,
        "exported_at": _dt.now().isoformat(),
        "app": "THR Plan",
        "microcycles": microcycles,
        "days": days,
        "exercises": exercises,
        "warmup_types": warmup_types,
        "student_logs": student_logs,
    }

@app.post("/api/backup/import")
async def import_database_backup(req: Request, _coach=Depends(require_coach)):
    """Restaura una copia de seguridad en formato JSON, asegurando que todos los microciclos,
    días y ejercicios queden permanentemente guardados en SQLite.
    """
    body = await req.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Formato de copia de seguridad no válido (debe ser un objeto JSON).")
    
    microcycles = body.get("microcycles") or []
    days = body.get("days") or []
    exercises = body.get("exercises") or []
    warmup_types = body.get("warmup_types") or []
    
    conn = get_db()
    cursor = conn.cursor()
    
    imported_mc = 0
    imported_days = 0
    imported_ex = 0
    
    try:
        # Microcycles
        for m in microcycles:
            m_id = m.get("id")
            name = m.get("name") or "Mesociclo Restaurado"
            weeks_count = m.get("weeks_count") or 4
            days_per_week = m.get("days_per_week") or 5
            primary_goal = m.get("primary_goal") or "Fuerza"
            desc = m.get("description") or ""
            access_code = (m.get("access_code") or f"CF{m_id or 100}").upper().strip()
            start_date = m.get("start_date") or ""
            is_active = 1 if m.get("is_active", 1) else 0
            
            cursor.execute("SELECT id FROM microcycles WHERE id = ? OR access_code = ?", (m_id, access_code))
            existing = cursor.fetchone()
            if existing:
                cursor.execute("""
                    UPDATE microcycles
                    SET name = ?, weeks_count = ?, days_per_week = ?, primary_goal = ?, description = ?, access_code = ?, start_date = ?, is_active = ?
                    WHERE id = ?
                """, (name, weeks_count, days_per_week, primary_goal, desc, access_code, start_date, is_active, existing["id"]))
            else:
                if m_id:
                    cursor.execute("""
                        INSERT INTO microcycles (id, name, weeks_count, days_per_week, primary_goal, description, access_code, start_date, is_active)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (m_id, name, weeks_count, days_per_week, primary_goal, desc, access_code, start_date, is_active))
                else:
                    cursor.execute("""
                        INSERT INTO microcycles (name, weeks_count, days_per_week, primary_goal, description, access_code, start_date, is_active)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (name, weeks_count, days_per_week, primary_goal, desc, access_code, start_date, is_active))
            imported_mc += 1

        # Days
        for d in days:
            d_id = d.get("id")
            mc_id = d.get("microcycle_id")
            w_num = d.get("week_number", 1)
            d_num = d.get("day_number", 1)
            title = d.get("title") or f"Día {d_num}"
            warmup_type = d.get("warmup_type") or "Movilidad GROUND"
            warmup_notes = d.get("warmup_notes") or ""
            wu_ex = d.get("warmup_exercises")
            if not isinstance(wu_ex, str):
                wu_ex = json.dumps(wu_ex or [])
            wu_tm = d.get("warmup_timer")
            if not isinstance(wu_tm, str):
                wu_tm = json.dumps(wu_tm or {"type": "AMRAP", "minutes": 8})
            parts = d.get("parts")
            if not isinstance(parts, str):
                parts = json.dumps(parts or [])
            wod = d.get("wod")
            if not isinstance(wod, str):
                wod = json.dumps(wod or {})
            tips = d.get("coaching_tips") or ""

            cursor.execute("SELECT id FROM days WHERE id = ? OR (microcycle_id = ? AND week_number = ? AND day_number = ?)",
                           (d_id, mc_id, w_num, d_num))
            existing_d = cursor.fetchone()
            if existing_d:
                cursor.execute("""
                    UPDATE days
                    SET title = ?, warmup_type = ?, warmup_notes = ?, warmup_exercises = ?, warmup_timer = ?, parts = ?, wod = ?, coaching_tips = ?
                    WHERE id = ?
                """, (title, warmup_type, warmup_notes, wu_ex, wu_tm, parts, wod, tips, existing_d["id"]))
            else:
                if d_id:
                    cursor.execute("""
                        INSERT INTO days (id, microcycle_id, week_number, day_number, title, warmup_type, warmup_notes, warmup_exercises, warmup_timer, parts, wod, coaching_tips)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (d_id, mc_id, w_num, d_num, title, warmup_type, warmup_notes, wu_ex, wu_tm, parts, wod, tips))
                else:
                    cursor.execute("""
                        INSERT INTO days (microcycle_id, week_number, day_number, title, warmup_type, warmup_notes, warmup_exercises, warmup_timer, parts, wod, coaching_tips)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (mc_id, w_num, d_num, title, warmup_type, warmup_notes, wu_ex, wu_tm, parts, wod, tips))
            imported_days += 1

        # Exercises
        for ex in exercises:
            name = (ex.get("name") or "").strip()
            if not name:
                continue
            cat = ex.get("category") or "General"
            equip = ex.get("equipment")
            if not isinstance(equip, str):
                equip = json.dumps(equip or [])
            desc = ex.get("description") or ""
            cues = ex.get("coaching_cues") or ""
            vid = ex.get("video_url") or ""
            is_g = 1 if ex.get("is_ground") else 0
            lvl = ex.get("ground_flow_level") or "Todos"

            cursor.execute("SELECT id FROM exercises WHERE LOWER(name) = LOWER(?)", (name,))
            ex_row = cursor.fetchone()
            if ex_row:
                cursor.execute("""
                    UPDATE exercises
                    SET category = ?, equipment = ?, description = ?, coaching_cues = ?, video_url = ?, is_ground = ?, ground_flow_level = ?
                    WHERE id = ?
                """, (cat, equip, desc, cues, vid, is_g, lvl, ex_row["id"]))
            else:
                cursor.execute("""
                    INSERT INTO exercises (name, category, equipment, description, coaching_cues, video_url, is_ground, ground_flow_level)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (name, cat, equip, desc, cues, vid, is_g, lvl))
            imported_ex += 1

        # Warmup types
        for wt in warmup_types:
            wt_name = (wt.get("name") if isinstance(wt, dict) else str(wt)).strip()
            if wt_name:
                cursor.execute("INSERT OR IGNORE INTO warmup_types (name) VALUES (?)", (wt_name,))

        conn.commit()
        conn.close()
        save_server_auto_backup()
        return {
            "status": "ok",
            "imported_microcycles": imported_mc,
            "imported_days": imported_days,
            "imported_exercises": imported_ex,
        }
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=500, detail=f"Error al importar copia de seguridad: {str(e)}")

@app.post("/api/backup/auto-restore")
def auto_restore_backup(_coach=Depends(require_coach)):
    """Restaura forzosamente la copia automática del servidor en SQLite."""
    from .database import AUTO_BACKUP_PATH
    if not os.path.exists(AUTO_BACKUP_PATH):
        raise HTTPException(status_code=404, detail="No se encontró archivo de copia automática en el servidor.")
    try:
        with open(AUTO_BACKUP_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        backup_mcs = data.get("microcycles") or []
        backup_days = data.get("days") or []
        backup_ex = data.get("exercises") or []
        
        conn = get_db()
        cursor = conn.cursor()
        
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
        save_server_auto_backup()
        return {
            "status": "ok",
            "restored_microcycles": len(backup_mcs),
            "restored_days": len(backup_days),
            "restored_exercises": len(backup_ex),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al restaurar copia automática: {str(e)}")

# ================= STATIC FILE SERVING =================

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(
        os.path.join(STATIC_DIR, "manifest.json"),
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/sw.js")
def serve_sw():
    return FileResponse(
        os.path.join(STATIC_DIR, "sw.js"),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/icon.svg")
def serve_icon():
    return FileResponse(os.path.join(STATIC_DIR, "icon.svg"), media_type="image/svg+xml")

@app.get("/icon-192.png")
def serve_icon_192():
    return FileResponse(os.path.join(STATIC_DIR, "img", "icon-192.png"), media_type="image/png")

@app.get("/icon-512.png")
def serve_icon_512():
    return FileResponse(os.path.join(STATIC_DIR, "img", "icon-512.png"), media_type="image/png")

@app.get("/app-icon.jpg")
def serve_app_icon():
    return FileResponse(os.path.join(STATIC_DIR, "img", "app-icon.jpg"), media_type="image/jpeg")

@app.get("/")
@app.get("/ui")
@app.get("/ui/")
def serve_coach_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/alumnos")
@app.get("/alumnos.html")
@app.get("/alumno")
@app.get("/ui/alumnos")
def serve_student_index():
    return FileResponse(os.path.join(STATIC_DIR, "alumnos.html"))

CRONO_DIR = os.path.join(STATIC_DIR, "crono")

@app.get("/crono")
@app.get("/crono/")
def serve_crono_index():
    return FileResponse(os.path.join(CRONO_DIR, "index.html"))

if os.path.exists(CRONO_DIR):
    app.mount("/crono", StaticFiles(directory=CRONO_DIR, html=True), name="crono")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ================= MICROCYCLER POR CÓDIGO =================
@app.get("/api/microcycles/code/{access_code}")
def get_microcycle_by_code(access_code: str, actor=Depends(require_student_or_coach)):
    """Devuelve el microciclo completo (con días) usando el código de acceso.
    Solo accesible para alumnos aprobados o entrenador.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM microcycles WHERE access_code = ? AND is_active = 1",
        (access_code.upper().strip(),)
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Código de acceso no válido o microciclo inactivo.")
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and row["id"] != actor["assigned_microcycle_id"]:
        conn.close()
        raise HTTPException(status_code=403, detail="No tienes acceso asignado a este microciclo.")
    microcycle = dict(row)
    cursor.execute(
        "SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC",
        (microcycle["id"],)
    )
    day_rows = cursor.fetchall()
    microcycle["days"] = [row_to_day(d) for d in day_rows]
    conn.close()
    return microcycle
