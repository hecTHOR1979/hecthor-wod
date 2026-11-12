import random
from typing import List, Dict, Any

MOVEMENT_DATABASE = [
    # Barbell movements
    {"name": "Thrusters", "equipment": ["Barra olímpica", "Discos"], "category": "weightlifting", "rx_m": "43 kg", "rx_f": "30 kg", "reps_amrap": 10, "reps_emom": 8, "reps_ft": 21},
    {"name": "Power Cleans", "equipment": ["Barra olímpica", "Discos"], "category": "weightlifting", "rx_m": "60 kg", "rx_f": "40 kg", "reps_amrap": 8, "reps_emom": 6, "reps_ft": 15},
    {"name": "Power Snatches", "equipment": ["Barra olímpica", "Discos"], "category": "weightlifting", "rx_m": "50 kg", "rx_f": "35 kg", "reps_amrap": 8, "reps_emom": 5, "reps_ft": 12},
    {"name": "Push Jerks", "equipment": ["Barra olímpica", "Discos"], "category": "weightlifting", "rx_m": "50 kg", "rx_f": "35 kg", "reps_amrap": 10, "reps_emom": 7, "reps_ft": 15},
    {"name": "Deadlifts", "equipment": ["Barra olímpica", "Discos"], "category": "weightlifting", "rx_m": "100 kg", "rx_f": "70 kg", "reps_amrap": 12, "reps_emom": 8, "reps_ft": 21},
    {"name": "Overhead Squats", "equipment": ["Barra olímpica", "Discos"], "category": "weightlifting", "rx_m": "50 kg", "rx_f": "35 kg", "reps_amrap": 8, "reps_emom": 6, "reps_ft": 12},

    # Dumbbell / Kettlebell movements
    {"name": "Dumbbell Snatches alternos", "equipment": ["Mancuernas"], "category": "weightlifting", "rx_m": "22.5 kg", "rx_f": "15 kg", "reps_amrap": 14, "reps_emom": 12, "reps_ft": 20},
    {"name": "Dumbbell Thrusters", "equipment": ["Mancuernas"], "category": "weightlifting", "rx_m": "2x 17.5 kg", "rx_f": "2x 12.5 kg", "reps_amrap": 10, "reps_emom": 8, "reps_ft": 15},
    {"name": "Dumbbell Box Step-overs", "equipment": ["Mancuernas", "Cajón"], "category": "metcon", "rx_m": "2x 15 kg", "rx_f": "2x 10 kg", "reps_amrap": 10, "reps_emom": 8, "reps_ft": 12},
    {"name": "Kettlebell Swings Americanos", "equipment": ["Kettlebells"], "category": "weightlifting", "rx_m": "24 kg", "rx_f": "16 kg", "reps_amrap": 16, "reps_emom": 14, "reps_ft": 25},
    {"name": "Goblet Squats", "equipment": ["Kettlebells"], "category": "weightlifting", "rx_m": "24 kg", "rx_f": "16 kg", "reps_amrap": 15, "reps_emom": 12, "reps_ft": 20},

    # Gymnastic movements
    {"name": "Pull-ups (Dominadas)", "equipment": ["Barra de dominadas"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 12, "reps_emom": 10, "reps_ft": 15},
    {"name": "Chest-to-Bar Pull-ups", "equipment": ["Barra de dominadas"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 9, "reps_emom": 7, "reps_ft": 12},
    {"name": "Toes-to-Bar (T2B)", "equipment": ["Barra de dominadas"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 12, "reps_emom": 10, "reps_ft": 15},
    {"name": "Bar Muscle-ups", "equipment": ["Barra de dominadas"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 4, "reps_emom": 3, "reps_ft": 6},
    {"name": "Handstand Push-ups (HSPU)", "equipment": ["Sin material"], "category": "gymnastics", "rx_m": "Pared", "rx_f": "Pared", "reps_amrap": 10, "reps_emom": 8, "reps_ft": 12},
    {"name": "Push-ups (Flexiones)", "equipment": ["Sin material"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 15, "reps_emom": 12, "reps_ft": 20},
    {"name": "Pistols (Sentadilla a una pierna)", "equipment": ["Sin material"], "category": "gymnastics", "rx_m": "Alterno", "rx_f": "Alterno", "reps_amrap": 12, "reps_emom": 10, "reps_ft": 16},
    {"name": "Ring Dips (Fondos en anillas)", "equipment": ["Anillas"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 8, "reps_emom": 7, "reps_ft": 12},

    # Monostructural & Bodyweight
    {"name": "Double Unders (Saltos Dobles)", "equipment": ["Comba / Cuerda"], "category": "monostructural", "rx_m": "Comba", "rx_f": "Comba", "reps_amrap": 40, "reps_emom": 35, "reps_ft": 50},
    {"name": "Burpees sobre la barra / suelo", "equipment": ["Sin material"], "category": "metcon", "rx_m": "Pecho al suelo", "rx_f": "Pecho al suelo", "reps_amrap": 12, "reps_emom": 10, "reps_ft": 15},
    {"name": "Box Jumps / Box Jump Overs", "equipment": ["Cajón"], "category": "metcon", "rx_m": "24\"", "rx_f": "20\"", "reps_amrap": 12, "reps_emom": 10, "reps_ft": 15},
    {"name": "Wall Ball Shots", "equipment": ["Wall Ball"], "category": "metcon", "rx_m": "9 kg (3m)", "rx_f": "6 kg (2.7m)", "reps_amrap": 15, "reps_emom": 14, "reps_ft": 20},
    {"name": "Wall Ball Shots (Balón medicinal)", "equipment": ["Balón medicinal"], "category": "metcon", "rx_m": "9 kg (3m)", "rx_f": "6 kg (2.7m)", "reps_amrap": 15, "reps_emom": 14, "reps_ft": 20},
    {"name": "Remo Concept2 (Calorías)", "equipment": ["Remo"], "category": "monostructural", "rx_m": "15 Cal", "rx_f": "12 Cal", "reps_amrap": 15, "reps_emom": 12, "reps_ft": 20},
    {"name": "EcoBike (Calorías)", "equipment": ["EcoBike"], "category": "monostructural", "rx_m": "14 Cal", "rx_f": "10 Cal", "reps_amrap": 12, "reps_emom": 10, "reps_ft": 15},
    {"name": "Ski Erg (Calorías)", "equipment": ["Ski Erg"], "category": "monostructural", "rx_m": "15 Cal", "rx_f": "12 Cal", "reps_amrap": 15, "reps_emom": 12, "reps_ft": 20},
    {"name": "Bike Erg (Calorías)", "equipment": ["Bike Erg"], "category": "monostructural", "rx_m": "20 Cal", "rx_f": "15 Cal", "reps_amrap": 18, "reps_emom": 15, "reps_ft": 25},
    {"name": "Rope Climbs (Subidas a cuerda)", "equipment": ["Rope"], "category": "gymnastics", "rx_m": "4.5 m", "rx_f": "4.5 m", "reps_amrap": 2, "reps_emom": 2, "reps_ft": 3},
    {"name": "Sled Push / Pull (Empuje/Arrastre Trineo)", "equipment": ["Sled"], "category": "monostructural", "rx_m": "75 kg (20m)", "rx_f": "50 kg (20m)", "reps_amrap": 20, "reps_emom": 15, "reps_ft": 25},
    {"name": "Yoke Carry (Paseo de Yugo)", "equipment": ["Yoke"], "category": "weightlifting", "rx_m": "140 kg (20m)", "rx_f": "100 kg (20m)", "reps_amrap": 20, "reps_emom": 15, "reps_ft": 25},
    {"name": "Farmers Carry (Paseo del Granjero)", "equipment": ["Farmers"], "category": "weightlifting", "rx_m": "2x 32 kg (25m)", "rx_f": "2x 24 kg (25m)", "reps_amrap": 25, "reps_emom": 20, "reps_ft": 50},
    {"name": "Air Squats (Sentadillas al aire)", "equipment": ["Sin material"], "category": "metcon", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 20, "reps_emom": 18, "reps_ft": 30},
    {"name": "V-Ups / Abdominales", "equipment": ["Sin material"], "category": "gymnastics", "rx_m": "Sin peso", "rx_f": "Sin peso", "reps_amrap": 15, "reps_emom": 12, "reps_ft": 20}
]

def generate_custom_wod(
    equipment_available: List[str],
    time_minutes: int,
    wod_type: str,
    goal: str = "Híbrido"
) -> Dict[str, Any]:
    """
    Intelligently composes a balanced CrossFit WOD based on available equipment,
    selected time domain, and workout style.
    """
    # Normalize equipment
    has_all_bodyweight = "Sin material" in equipment_available or len(equipment_available) == 0

    available_moves = []
    for m in MOVEMENT_DATABASE:
        needed = m["equipment"]
        # Can be done if every required item is in equipment_available or needed is "Sin material"
        if all(item in equipment_available for item in needed) or ("Sin material" in needed and has_all_bodyweight):
            available_moves.append(m)

    if len(available_moves) < 2:
        # Fallback to bodyweight movements
        available_moves = [m for m in MOVEMENT_DATABASE if "Sin material" in m["equipment"]]

    # Pick 2 to 4 distinct movements with varied modalities (weightlifting, gymnastics, mono)
    categories = list(set(m["category"] for m in available_moves))
    selected_moves = []

    # Try to pick 1 from each category for a classic triplet or couplet
    shuffled_moves = list(available_moves)
    random.shuffle(shuffled_moves)

    used_cats = set()
    for m in shuffled_moves:
        if m["category"] not in used_cats:
            selected_moves.append(m)
            used_cats.add(m["category"])
        if len(selected_moves) >= (3 if time_minutes >= 12 else 2):
            break

    # If still not enough, add more
    for m in shuffled_moves:
        if m not in selected_moves:
            selected_moves.append(m)
        if len(selected_moves) >= (4 if time_minutes >= 18 else 3):
            break

    wt = wod_type.strip().upper()
    if wt == "AMRAP":
        return build_amrap(selected_moves, time_minutes, goal)
    elif wt == "EMOM":
        return build_emom(selected_moves, time_minutes, goal)
    elif wt == "TABATA":
        return build_tabata(selected_moves)
    elif wt == "CHIPPER":
        return build_chipper(selected_moves, time_minutes)
    elif wt == "ENDURANCE":
        return build_endurance(selected_moves, time_minutes, goal)
    elif wt in ("FOR TIME", "FORTIME", "FT"):
        return build_for_time(selected_moves, time_minutes, goal)
    else:
        return build_custom_wod_style(wod_type, selected_moves, time_minutes, goal)

def build_amrap(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []

    for m in moves:
        reps = m["reps_amrap"]
        lines.append(f"- {reps} {m['name']}")
        if m["rx_m"] != "Sin peso" and m["rx_m"] != "Comba":
            rx_notes.append(f"{m['name']}: {m['rx_m']} chicos / {m['rx_f']} chicas")
            scaled_notes.append(f"{m['name']}: reducción del 30-40% de carga o variante con mancuerna/goma")

    description = f"AMRAP {minutes} Minutos:\n" + "\n".join(lines)
    title = f"AMRAP {minutes}' - '{random.choice(['Iron Will', 'Velocity', 'Apex Predator', 'Engine Lab', 'Tormenta'])}'"

    est_rounds = max(3, int(minutes / (len(moves) * 0.85)))

    return {
        "title": title,
        "type": "AMRAP",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Peso corporal Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Ajustar repeticiones al 75% o usar apoyos/gomas",
        "target_score": f"{est_rounds} a {est_rounds + 2} rondas completas",
        "strategy": f"Pacing sostenible desde el minuto 1. Tratar de mantener transiciones de menos de 5 segundos entre estaciones. Dividir repeticiones antes del fallo muscular."
    }

def build_emom(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    stations = len(moves)
    # If stations divide minutes neatly, good, otherwise include a rest minute
    include_rest = (minutes % (stations + 1) == 0 and stations >= 3)
    cycle_len = stations + (1 if include_rest else 0)

    lines = []
    rx_notes = []
    scaled_notes = []

    for i, m in enumerate(moves, 1):
        reps = m["reps_emom"]
        lines.append(f"- Minuto {i}: {reps} {m['name']}")
        if m["rx_m"] != "Sin peso":
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: reducir 2-3 reps o usar peso moderado")

    if include_rest:
        lines.append(f"- Minuto {cycle_len}: Descanso activo")

    description = f"EMOM {minutes} Minutos (Rotando cada minuto):\n" + "\n".join(lines)
    title = f"EMOM {minutes}' - '{random.choice(['On The Clock', 'Minute Crunch', 'Pacing Test', 'Precision'])}'"

    return {
        "title": title,
        "type": "EMOM",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Adaptar repeticiones para tener al menos 15 segundos de descanso por minuto",
        "target_score": "Completar todos los intervalos dentro del minuto asignado (trabajo de 40s / descanso de 20s).",
        "strategy": "No acelerar en los primeros 15 segundos del minuto; buscar un ritmo uniforme que te permita terminar la tarea entre los segundos 38 y 44."
    }

def build_for_time(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    # Decide scheme: Couplet 21-15-9 or 3-5 Rounds for time
    lines = []
    rx_notes = []
    scaled_notes = []

    if len(moves) == 2 and minutes <= 14:
        # Classic 21-15-9
        for m in moves:
            if m["rx_m"] != "Sin peso":
                rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
                scaled_notes.append(f"{m['name']}: 15-12-9 o carga adaptada")
        description = f"21 - 15 - 9 Repeticiones por tiempo:\n- {moves[0]['name']}\n- {moves[1]['name']}"
        title = f"For Time: 'Fast & Furious 21-15-9'"
    else:
        num_rounds = 4 if minutes <= 16 else 5
        for m in moves:
            reps = m["reps_ft"]
            lines.append(f"- {reps} {m['name']}")
            if m["rx_m"] != "Sin peso":
                rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
                scaled_notes.append(f"{m['name']}: carga moderada escalada")
        description = f"{num_rounds} Rondas por tiempo:\n" + "\n".join(lines)
        title = f"For Time: {num_rounds} Rondas - '{random.choice(['Metcon Rush', 'Vanguard', 'Titan Track', 'The Crucible'])}'"

    return {
        "title": title,
        "type": "For Time",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Escalar repeticiones o rango de movimiento",
        "target_score": f"Tiempo objetivo: Sub {int(minutes * 0.75)} minutos",
        "strategy": "La primera ronda nunca se hace al 100%. Salir al 85% y acelerar en la última ronda o serie."
    }

def build_tabata(moves: List[Dict[str, Any]]) -> Dict[str, Any]:
    selected = moves[:4] if len(moves) >= 4 else moves
    names = " + ".join(m["name"] for m in selected)
    description = f"TABATA (20 segundos de trabajo / 10 segundos de descanso x 8 intervalos por ejercicio):\n"
    for i, m in enumerate(selected, 1):
        description += f"Bloque {i} (4 min): {m['name']}\n"

    total_min = len(selected) * 4
    return {
        "title": f"Tabata Madness ({total_min} Minutos)",
        "type": "Tabata",
        "time_cap": f"{total_min} Minutos",
        "description": description,
        "rx_weights": "Máxima intensidad en los 20s",
        "scaled_weights": "Ritmo moderado en trabajo, respiración constante",
        "target_score": "Contar la ronda de menor puntuación en cada bloque",
        "strategy": "Mantener la intensidad constante sin caer en picado en las rondas 5 a 8 de cada estación."
    }

def build_chipper(moves: List[Dict[str, Any]], minutes: int) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []

    for m in moves:
        reps = m["reps_ft"] * 2
        lines.append(f"- {reps} {m['name']}")
        if m["rx_m"] != "Sin peso":
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: reducir a la mitad las repeticiones")

    description = f"Chipper por tiempo (Completar en orden una sola vez):\n" + "\n".join(lines)
    return {
        "title": f"Chipper: 'The Grinder Odyssey'",
        "type": "Chipper",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Escalar a 60% del volumen prescrito",
        "target_score": f"Terminar antes del Time Cap de {minutes} minutos",
        "strategy": "Disecciona cada movimiento en pequeños bloques (ej: 10 en 10) con pausas cronometradas de 3 a 5 respiraciones profundas."
    }

def build_endurance(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []

    # Aerobic pacing scheme: rotations or continuous steady-state blocks
    stations = len(moves)
    rounds = max(3, int(minutes / max(3, stations)))

    for m in moves:
        reps = int(m.get("reps_amrap", 12) * 1.2)
        lines.append(f"- {reps} {m['name']}")
        if m.get("rx_m") and m["rx_m"] != "Sin peso":
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: peso ligero o variante continua")

    description = f"ENDURANCE ({rounds} Rondas a ritmo constante / Zone 2-3):\n" + "\n".join(lines) + f"\n- Descanso: 60-90 seg al finalizar cada ronda"
    title = f"ENDURANCE Engine ({minutes}') - '{random.choice(['Steady Diesel', 'Aero Lab', 'Oxygen Flow', 'Iron Lung'])}'"

    return {
        "title": title,
        "type": "ENDURANCE",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Carga moderada / controlada",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Ajustar carga para mantener respiración nasal o conversacional",
        "target_score": f"Completar las {rounds} rondas con variación de tiempo menor a 15s entre series",
        "strategy": "Pacing aeróbico constante (RPE 7/10). No busques fatiga neuromuscular, sino cadencia ininterrumpida y transiciones fluidas."
    }

def build_custom_wod_style(style_name: str, moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []

    for m in moves:
        reps = m.get("reps_amrap", 10)
        lines.append(f"- {reps} {m['name']}")
        if m.get("rx_m") and m["rx_m"] != "Sin peso":
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: carga adaptada al nivel")

    clean_style = style_name.strip()
    description = f"{clean_style} ({minutes} Minutos):\n" + "\n".join(lines)
    title = f"{clean_style}: 'WOD {random.choice(['Vanguard', 'Apex', 'Thunder', 'Titan'])}'"

    return {
        "title": title,
        "type": clean_style,
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Escalar repeticiones o peso para mantener el estímulo",
        "target_score": f"Objetivo acorde al estilo {clean_style} en {minutes} minutos",
        "strategy": "Mantén la técnica y ritmo estable a lo largo de todo el bloque."
    }
