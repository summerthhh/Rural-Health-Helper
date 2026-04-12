from datetime import datetime
import hashlib
import json
import math
import os
import time
from typing import Dict, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Rural Health Helper backend (FastAPI + static frontend mount)
APP_DIR = os.path.dirname(__file__)
IS_VERCEL = bool(os.getenv("VERCEL")) or bool(os.getenv("VERCEL_URL"))
DATA_DIR = os.path.join("/tmp", "rural_health_helper_data") if IS_VERCEL else os.path.join(APP_DIR, "data")


def _safe_mkdir(path: str):
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass


_safe_mkdir(DATA_DIR)
USERS_FILE = os.path.join(DATA_DIR, "users.json")
VENDORS_FILE = os.path.join(DATA_DIR, "vendors.json")
DOCTORS_FILE = os.path.join(DATA_DIR, "doctors.json")
NOTICES_FILE = os.path.join(DATA_DIR, "notices.json")
ANNOUNCEMENTS_FILE = os.path.join(DATA_DIR, "announcements.json")
BUGS_FILE = os.path.join(DATA_DIR, "bugs.json")
_safe_mkdir(os.path.join(DATA_DIR, "uploads"))


def _load_json(path, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default


def _save_json(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


users: Dict[str, dict] = _load_json(USERS_FILE, {})
vendors: Dict[str, dict] = _load_json(VENDORS_FILE, {})
doctors: Dict[str, dict] = _load_json(DOCTORS_FILE, {})
notices = _load_json(NOTICES_FILE, [])
announcements = _load_json(ANNOUNCEMENTS_FILE, [])
bugs = _load_json(BUGS_FILE, [])
admin_sessions = set()

ADMIN_PHONE = "1234567890"
ADMIN_PASSWORD = "0987654321"

# Sample disease and shop data for search demo
DISEASES = {
    'malaria': {
        'symptoms': [
            'Fever and chills',
            'Headache',
            'Nausea and vomiting',
            'Muscle pain'
        ],
        'medicines': ['Artemisinin-based combination therapy', 'Chloroquine']
    },
    'dengue': {
        'symptoms': [
            'High fever',
            'Severe headache',
            'Pain behind the eyes',
            'Joint and muscle pain'
        ],
        'medicines': ['Paracetamol', 'Fluid replacement therapy']
    },
    'common cold': {
        'symptoms': [
            'Runny or stuffy nose',
            'Sore throat',
            'Cough',
            'Mild body aches'
        ],
        'medicines': ['Decongestant', 'Antihistamines']
    }
}

# Example shops with locations (lat, lng) and inventory
SHOPS = [
    {
        'id': 'shop-1', 'name': 'Village Pharmacy', 'lat': 12.9710, 'lng': 77.5937,
        'inventory': {'Paracetamol': 50, 'Artemisinin-based combination therapy': 10}
    },
    {
        'id': 'shop-2', 'name': 'Health Plus', 'lat': 12.9750, 'lng': 77.5900,
        'inventory': {'Chloroquine': 20, 'Decongestant': 30}
    },
    {
        'id': 'shop-3', 'name': 'Rural Meds', 'lat': 12.9650, 'lng': 77.6000,
        'inventory': {'Paracetamol': 100, 'Antihistamines': 40}
    }
]


def _haversine_km(lat1, lon1, lat2, lon2):
    # return distance in kilometers between two lat/lng
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def _dummy_distance_km(seed: str) -> float:
    # Demo-only distance generator: keeps values close (0.8-4.5 km) for cleaner UI.
    h = int(hashlib.sha256(seed.encode('utf-8')).hexdigest()[:8], 16)
    return round(0.8 + ((h % 371) / 100), 2)

app = FastAPI(title="Rural Health Helper - Minimal",
              description="Patient signup/login + location permission demo",
              version="0.1")

# Allow cross-origin for local testing
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

# Serve frontend static files from /static
frontend_dir = os.path.join(APP_DIR, "frontend")
if not os.path.exists(os.path.join(frontend_dir, "index.html")):
    frontend_dir = APP_DIR
# In serverless bundles, frontend assets may be omitted if not included explicitly.
# check_dir=False prevents cold-start crashes when directory is absent.
app.mount("/static", StaticFiles(directory=frontend_dir, check_dir=False), name="static")
app.mount("/uploads", StaticFiles(directory=os.path.join(DATA_DIR, "uploads"), check_dir=False), name="uploads")


def _hash_password(pw: str) -> str:
    return hashlib.sha256(pw.encode('utf-8')).hexdigest()


def normalize_phone(p):
    """Return digits-only phone string for comparisons; empty string if None."""
    if p is None:
        return ''
    return ''.join(ch for ch in str(p) if ch.isdigit())


class PatientSignup(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: Optional[str]
    password: str


class PatientLogin(BaseModel):
    phone: str
    password: str


class PermissionModel(BaseModel):
    location: bool
    lat: Optional[float]
    lng: Optional[float]


class CallPermissionModel(BaseModel):
    call: bool


class GalleryPermissionModel(BaseModel):
    gallery: bool


class VendorCreate(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: Optional[str]
    shop_name: str
    shop_address: str
    license_no: str
    password: Optional[str]


class VendorStoreUpdate(BaseModel):
    shop_name: Optional[str] = None
    shop_address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    open_hours: Optional[str] = None
    contact_note: Optional[str] = None


class VendorMedicineUpsert(BaseModel):
    name: str
    units: Optional[int] = None
    medicine_per_unit: Optional[str] = None
    quantity: Optional[int] = None
    unit: Optional[str] = None
    price: Optional[float] = None


class AdminAction(BaseModel):
    reason: Optional[str]


class AdminLogin(BaseModel):
    phone: str
    password: str


class DoctorNoteInput(BaseModel):
    consultation_id: str
    note: str
    doctor_name: Optional[str] = "Doctor"


class DoctorSignup(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: Optional[str] = None
    specialization: Optional[str] = None
    license_no: str
    password: str


class DoctorLogin(BaseModel):
    phone: str
    password: str


class ConsultRequestInput(BaseModel):
    user_id: str
    doctor_id: str
    reason: Optional[str] = None


class DoctorPrescriptionInput(BaseModel):
    patient_id: str
    consultation_id: Optional[str] = None
    note: str
    medicines: Optional[str] = None
    follow_up: Optional[str] = None


class DoctorConsultAction(BaseModel):
    action: str = "accepted"
    video_link: Optional[str] = None


class AdminBroadcastInput(BaseModel):
    message: str
    target: str = "all"  # all | patients | vendors | doctors
    duration_seconds: int = 30


def require_admin(x_admin_token: Optional[str] = Header(default=None, alias="X-Admin-Token")):
    if not x_admin_token or x_admin_token not in admin_sessions:
        raise HTTPException(status_code=401, detail="Admin authentication required")


@app.post('/admin/login')
def admin_login(data: AdminLogin):
    if normalize_phone(data.phone) != normalize_phone(ADMIN_PHONE) or str(data.password) != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail='Invalid admin phone or password')
    token = str(uuid4())
    admin_sessions.add(token)
    return {'token': token, 'admin_phone': ADMIN_PHONE}


@app.get("/")
def root():
    index_path = os.path.join(APP_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    raise HTTPException(status_code=404, detail="index.html not found")


@app.get("/admin.html")
def admin_page():
    admin_path = os.path.join(frontend_dir, "admin.html")
    if os.path.exists(admin_path):
        return FileResponse(admin_path)
    root_admin = os.path.join(APP_DIR, "admin.html")
    if os.path.exists(root_admin):
        return FileResponse(root_admin)
    raise HTTPException(status_code=404, detail="Admin page not found")


@app.get("/styles.css")
def styles_css():
    styles_path = os.path.join(APP_DIR, "styles.css")
    if os.path.exists(styles_path):
        return FileResponse(styles_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="Styles not found")


@app.get("/app.js")
def app_js():
    app_js_path = os.path.join(APP_DIR, "app.js")
    if os.path.exists(app_js_path):
        return FileResponse(app_js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="App JS not found")


@app.post('/patient/signup')
def patient_signup(p: PatientSignup):
    # ensure phone uniqueness
    for uid, u in users.items():
        if u.get('phone') == p.phone:
            raise HTTPException(status_code=400, detail='Phone already registered')
    uid = str(uuid4())
    users[uid] = {
        'id': uid,
        'first_name': p.first_name,
        'last_name': p.last_name,
        'phone': p.phone,
        'email': p.email,
        'password_hash': _hash_password(p.password),
        'permissions': {},
        'consultations': [],
        'assigned_doctor_id': None,
        'consult_requests': [],
        'prescriptions': []
    }
    _save_json(USERS_FILE, users)
    return {'user_id': uid}


@app.post('/patient/login')
def patient_login(l: PatientLogin):
    # allow login by phone or by user id
    login_phone = normalize_phone(l.phone)
    for uid, u in users.items():
        user_phone = normalize_phone(u.get('phone'))
        if (user_phone and user_phone == login_phone) or (str(uid) == str(l.phone)):
            if u.get('password_hash') == _hash_password(l.password):
                return {'user_id': uid}
    raise HTTPException(status_code=401, detail='Invalid phone or password')


@app.post('/permissions/{user_id}')
def set_permissions(user_id: str, perm: PermissionModel):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    u['permissions']['location'] = {'granted': perm.location, 'lat': perm.lat, 'lng': perm.lng}
    _save_json(USERS_FILE, users)
    return {'user_id': user_id, 'permissions': u['permissions']}


@app.get('/home/{user_id}')
def home(user_id: str):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    return {'user': {k: v for k, v in u.items() if k != 'password_hash'}, 'message': 'Welcome!'}


@app.get('/dashboard/{user_id}')
def dashboard(user_id: str):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    # return basic profile and empty records/consults for now
    return {
        'user': {k: v for k, v in u.items() if k != 'password_hash'},
        'records': [],
        'consults': u.get('consultations', [])
    }


class SearchRequest(BaseModel):
    user_id: str
    disease: str


@app.post('/search')
def search(req: SearchRequest):
    # find disease by simple case-insensitive match
    dq = req.disease.strip().lower()
    match = None
    for name, info in DISEASES.items():
        if dq == name or dq in name or name in dq:
            match = {'name': name, 'info': info}
            break
    if not match:
        raise HTTPException(status_code=404, detail='Disease not found in database')

    # get user's last known location if available
    u = users.get(req.user_id)
    user_lat = user_lng = None
    if u:
        loc = u.get('permissions', {}).get('location')
        if loc and loc.get('granted') and loc.get('lat') is not None and loc.get('lng') is not None:
            user_lat = loc.get('lat')
            user_lng = loc.get('lng')

    shops = []
    for s in SHOPS:
        # Demo mode: always keep close dummy distances for clean UI.
        distance_km = _dummy_distance_km(f"{req.user_id}:{match['name']}:{s['id']}")
        # list which of the disease medicines the shop has
        meds = [m for m in match['info']['medicines'] if any(m.startswith(k) or k.startswith(m) for k in s['inventory'].keys()) or m in s['inventory']]
        # fallback: check inventory keys case-insensitive substring match
        if not meds:
            for key in s['inventory'].keys():
                for dm in match['info']['medicines']:
                    if dm.lower() in key.lower() or key.lower() in dm.lower():
                        meds.append(key)
        shops.append({
            'id': s['id'], 'name': s['name'], 'lat': s['lat'], 'lng': s['lng'],
            'distance_km': distance_km, 'available_medicines': meds, 'inventory': s['inventory']
        })

    # sort shops by distance if available
    if user_lat is not None:
        shops = sorted(shops, key=lambda s: s['distance_km'] if s['distance_km'] is not None else 99999)

    return {
        'disease': match['name'],
        'symptoms': match['info']['symptoms'],
        'recommended_medicines': match['info']['medicines'],
        'shops': shops
    }


@app.get('/medical-stores/suggest')
def medical_store_suggest(q: str = ''):
    query = (q or '').strip().lower()
    names = []
    for v in vendors.values():
        if v.get('status') == 'blocked':
            continue
        name = (v.get('shop_name') or '').strip()
        if not name:
            continue
        if query and query not in name.lower():
            continue
        names.append(name)
    # de-duplicate while preserving order
    seen = set()
    unique = []
    for n in names:
        key = n.lower()
        if key not in seen:
            seen.add(key)
            unique.append(n)
    return {'suggestions': unique[:10]}


@app.get('/medical-stores/search')
def medical_store_search(q: str):
    query = (q or '').strip().lower()
    if not query:
        raise HTTPException(status_code=400, detail='Store name is required')
    for v in vendors.values():
        if v.get('status') == 'blocked':
            continue
        shop_name = (v.get('shop_name') or '').strip()
        if not shop_name:
            continue
        if shop_name.lower() == query or query in shop_name.lower():
            details = v.get('store_details', {}) or {}
            note = details.get('contact_note', '') or ''
            phone = (v.get('phone') or '').strip()
            return {
                'found': True,
                'store_name': shop_name,
                'note': note,
                'phone': phone
            }
    return {'found': False}


@app.get('/medical-stores/nearby')
def medical_stores_nearby(lat: float, lng: float, radius_km: float = 10):
    if radius_km <= 0:
        raise HTTPException(status_code=400, detail='radius_km must be positive')
    stores = []
    for vid, v in vendors.items():
        if v.get('status') == 'blocked':
            continue
        details = v.get('store_details', {}) or {}
        s_lat = details.get('lat')
        s_lng = details.get('lng')
        if s_lat is None or s_lng is None:
            continue
        try:
            d_km = round(_haversine_km(lat, lng, float(s_lat), float(s_lng)), 2)
        except Exception:
            continue
        if d_km > radius_km:
            continue
        stores.append({
            'vendor_id': vid,
            'store_name': (v.get('shop_name') or details.get('shop_name') or 'Medical Store'),
            'phone': (v.get('phone') or '').strip(),
            'note': (details.get('contact_note') or '').strip(),
            'lat': float(s_lat),
            'lng': float(s_lng),
            'distance_km': d_km,
            'trusted': True
        })
    stores = sorted(stores, key=lambda s: s.get('distance_km', 99999))
    return {'stores': stores, 'radius_km': radius_km}


# --- Consult / Call / Upload endpoints ---
@app.get('/consult/{user_id}')
def consult_info(user_id: str):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    # phone number for consult (as requested)
    phone_no = '7839010007'
    perms = u.get('permissions', {})
    return {'consult_phone': phone_no, 'permissions': perms}


@app.post('/permissions/{user_id}/call')
def set_call_permission(user_id: str, p: CallPermissionModel):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    u.setdefault('permissions', {})['call'] = {'granted': p.call}
    _save_json(USERS_FILE, users)
    return {'user_id': user_id, 'call_permission': p.call}


@app.post('/permissions/{user_id}/gallery')
def set_gallery_permission(user_id: str, p: GalleryPermissionModel):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    u.setdefault('permissions', {})['gallery'] = {'granted': p.gallery}
    _save_json(USERS_FILE, users)
    return {'user_id': user_id, 'gallery_permission': p.gallery}


@app.post('/upload/{user_id}')
def upload_file(user_id: str, file: UploadFile = File(...)):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    user_upload_dir = os.path.join(DATA_DIR, 'uploads', user_id)
    _safe_mkdir(user_upload_dir)
    safe_name = os.path.basename(file.filename)
    save_path = os.path.join(user_upload_dir, safe_name)
    try:
        with open(save_path, 'wb') as f:
            f.write(file.file.read())
    finally:
        file.file.close()
    uploaded_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    consultation = {
        'consultation_id': str(uuid4()),
        'title': f"Consultation {len(u.get('consultations', [])) + 1}",
        'date': uploaded_at,
        'doctor_id': u.get('assigned_doctor_id'),
        'files': [{
            'filename': safe_name,
            'url': f"/uploads/{user_id}/{safe_name}",
            'uploaded_at': uploaded_at
        }],
        'doctor_notes': []
    }
    u.setdefault('consultations', []).append(consultation)
    _save_json(USERS_FILE, users)
    return {
        'user_id': user_id,
        'filename': safe_name,
        'path': save_path,
        'consultation_id': consultation['consultation_id']
    }


@app.get('/medical_history/{user_id}')
def medical_history(user_id: str):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    return {'user_id': user_id, 'consultations': u.get('consultations', [])}


def _patient_display_name(u: dict) -> str:
    first = (u.get('first_name') or '').strip()
    last = (u.get('last_name') or '').strip()
    name = f"{first} {last}".strip()
    return name or "Patient"


def _doctor_display_name(d: dict) -> str:
    first = (d.get('first_name') or '').strip()
    last = (d.get('last_name') or '').strip()
    name = f"Dr. {first} {last}".strip()
    return name if name != "Dr." else "Doctor"


def _ensure_patient_link(doctor_id: str, patient_id: str):
    d = doctors.get(doctor_id)
    if not d:
        return
    patient_ids = d.setdefault('patient_ids', [])
    if patient_id not in patient_ids:
        patient_ids.append(patient_id)


@app.post('/doctor/signup')
def doctor_signup(data: DoctorSignup):
    phone_norm = normalize_phone(data.phone)
    for d in doctors.values():
        if normalize_phone(d.get('phone')) == phone_norm:
            raise HTTPException(status_code=400, detail='Doctor phone already registered')
    did = str(uuid4())
    doctors[did] = {
        'id': did,
        'first_name': data.first_name,
        'last_name': data.last_name,
        'phone': data.phone,
        'email': data.email,
        'specialization': (data.specialization or '').strip(),
        'license_no': data.license_no,
        'status': 'approval_pending',
        'password_hash': _hash_password(data.password),
        'patient_ids': [],
        'consult_requests': []
    }
    _save_json(DOCTORS_FILE, doctors)
    return {'doctor_id': did, 'status': 'approval_pending'}


@app.post('/doctor/login')
def doctor_login(data: DoctorLogin):
    login_phone = normalize_phone(data.phone)
    for did, d in doctors.items():
        d_phone = normalize_phone(d.get('phone'))
        if (d_phone and d_phone == login_phone) or str(did) == str(data.phone):
            if d.get('password_hash') != _hash_password(data.password):
                raise HTTPException(status_code=401, detail='Invalid phone or password')
            status = d.get('status', 'approval_pending')
            if status == 'blocked':
                raise HTTPException(status_code=403, detail='Doctor account is blocked by admin')
            if status != 'approved':
                raise HTTPException(status_code=403, detail='Doctor signup pending admin approval')
            return {'doctor_id': did, 'status': status}
    raise HTTPException(status_code=401, detail='Invalid phone or password')


@app.get('/doctors/public')
def doctors_public():
    items = []
    for did, d in doctors.items():
        if d.get('status') != 'approved':
            continue
        items.append({
            'doctor_id': did,
            'name': _doctor_display_name(d),
            'specialization': d.get('specialization') or 'General Physician',
            'phone': d.get('phone') or ''
        })
    return {'doctors': items}


@app.post('/consult/request')
def consult_request(data: ConsultRequestInput):
    u = users.get(data.user_id)
    if not u:
        raise HTTPException(status_code=404, detail='Patient not found')
    d = doctors.get(data.doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    request_id = str(uuid4())
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    room_name = f"rural-health-{request_id[:8]}"
    video_link = f"https://talky.io/{room_name}"
    req = {
        'request_id': request_id,
        'patient_id': data.user_id,
        'patient_name': _patient_display_name(u),
        'doctor_id': data.doctor_id,
        'doctor_name': _doctor_display_name(d),
        'reason': (data.reason or '').strip(),
        'status': 'pending',
        'created_at': now,
        'video_link': video_link
    }
    u.setdefault('consult_requests', []).append(req)
    u['assigned_doctor_id'] = data.doctor_id
    _ensure_patient_link(data.doctor_id, data.user_id)
    d.setdefault('consult_requests', []).append(req.copy())
    _save_json(USERS_FILE, users)
    _save_json(DOCTORS_FILE, doctors)
    return req


@app.get('/doctor/{doctor_id}/dashboard')
def doctor_dashboard(doctor_id: str):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    patient_cards = []
    for pid in d.get('patient_ids', []):
        u = users.get(pid)
        if not u:
            continue
        patient_cards.append({
            'patient_id': pid,
            'name': _patient_display_name(u),
            'phone': u.get('phone') or '',
            'consultation_count': len(u.get('consultations', []))
        })
    return {
        'doctor': {k: v for k, v in d.items() if k != 'password_hash'},
        'patients': patient_cards,
        'consult_requests': d.get('consult_requests', [])
    }


@app.get('/doctor/{doctor_id}/patients')
def doctor_patients(doctor_id: str):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    items = []
    for pid in d.get('patient_ids', []):
        u = users.get(pid)
        if not u:
            continue
        items.append({
            'patient_id': pid,
            'name': _patient_display_name(u),
            'phone': u.get('phone') or '',
            'email': u.get('email') or '',
            'consultation_count': len(u.get('consultations', []))
        })
    return {'patients': items}


@app.get('/doctor/{doctor_id}/patient/{patient_id}')
def doctor_patient_details(doctor_id: str, patient_id: str):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    if patient_id not in d.get('patient_ids', []):
        raise HTTPException(status_code=403, detail='Patient is not linked to this doctor')
    u = users.get(patient_id)
    if not u:
        raise HTTPException(status_code=404, detail='Patient not found')
    return {
        'patient': {k: v for k, v in u.items() if k != 'password_hash'},
        'consultations': u.get('consultations', []),
        'prescriptions': u.get('prescriptions', [])
    }


@app.post('/doctor/{doctor_id}/consult/{request_id}')
def doctor_consult_action(doctor_id: str, request_id: str, data: DoctorConsultAction):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    req = None
    for r in d.get('consult_requests', []):
        if str(r.get('request_id')) == str(request_id):
            req = r
            break
    if req is None:
        raise HTTPException(status_code=404, detail='Consult request not found')
    action = (data.action or 'accepted').strip().lower()
    if action not in ['accepted', 'rejected', 'completed']:
        raise HTTPException(status_code=400, detail='Invalid action')
    req['status'] = action
    if data.video_link:
        req['video_link'] = data.video_link.strip()
    pid = req.get('patient_id')
    u = users.get(pid) if pid else None
    if u:
        for r in u.get('consult_requests', []):
            if str(r.get('request_id')) == str(request_id):
                r['status'] = action
                if req.get('video_link'):
                    r['video_link'] = req.get('video_link')
                break
        _save_json(USERS_FILE, users)
    # remove resolved requests from doctor's active queue so accepted/rejected disappears
    if action in ['accepted', 'rejected', 'completed']:
        d['consult_requests'] = [r for r in d.get('consult_requests', []) if str(r.get('request_id')) != str(request_id)]
    _save_json(DOCTORS_FILE, doctors)
    return {'request_id': request_id, 'status': action, 'video_link': req.get('video_link')}


@app.post('/doctor/{doctor_id}/prescription')
def doctor_prescription(doctor_id: str, data: DoctorPrescriptionInput):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    if data.patient_id not in d.get('patient_ids', []):
        raise HTTPException(status_code=403, detail='Patient is not linked to this doctor')
    u = users.get(data.patient_id)
    if not u:
        raise HTTPException(status_code=404, detail='Patient not found')
    note_text = (data.note or '').strip()
    if not note_text:
        raise HTTPException(status_code=400, detail='Prescription note is required')
    doctor_name = _doctor_display_name(d)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    consultations = u.setdefault('consultations', [])
    target = None
    if data.consultation_id:
        for c in consultations:
            if str(c.get('consultation_id')) == str(data.consultation_id):
                target = c
                break
    if target is None:
        target = {
            'consultation_id': str(uuid4()),
            'title': f"Consultation {len(consultations) + 1}",
            'date': now,
            'files': [],
            'doctor_notes': []
        }
        consultations.append(target)
    target.setdefault('doctor_notes', []).append({
        'doctor_name': doctor_name,
        'note': note_text,
        'date': now
    })
    prescription = {
        'prescription_id': str(uuid4()),
        'doctor_id': doctor_id,
        'doctor_name': doctor_name,
        'patient_id': data.patient_id,
        'consultation_id': target.get('consultation_id'),
        'note': note_text,
        'medicines': (data.medicines or '').strip(),
        'follow_up': (data.follow_up or '').strip(),
        'date': now
    }
    u.setdefault('prescriptions', []).append(prescription)
    _save_json(USERS_FILE, users)
    return prescription


@app.post('/doctor/{doctor_id}/prescription_with_files')
def doctor_prescription_with_files(
    doctor_id: str,
    patient_id: str = Form(...),
    note: str = Form(...),
    consultation_id: Optional[str] = Form(default=None),
    medicines: Optional[str] = Form(default=''),
    follow_up: Optional[str] = Form(default=''),
    files: list[UploadFile] = File(default=[])
):
    # First save prescription text payload using existing flow.
    payload = DoctorPrescriptionInput(
        patient_id=patient_id,
        consultation_id=consultation_id,
        note=note,
        medicines=medicines,
        follow_up=follow_up
    )
    prescription = doctor_prescription(doctor_id, payload)
    u = users.get(patient_id)
    if not u:
        raise HTTPException(status_code=404, detail='Patient not found')
    target_consultation_id = prescription.get('consultation_id')
    consultations = u.setdefault('consultations', [])
    target = None
    for c in consultations:
        if str(c.get('consultation_id')) == str(target_consultation_id):
            target = c
            break
    if target is None:
        raise HTTPException(status_code=404, detail='Consultation not found')

    uploaded_files = []
    if files:
        user_upload_dir = os.path.join(DATA_DIR, 'uploads', patient_id)
        _safe_mkdir(user_upload_dir)
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        for f in files:
            safe_name = os.path.basename(f.filename or '')
            if not safe_name:
                continue
            stored_name = f"doctor_{doctor_id[:8]}_{uuid4().hex[:8]}_{safe_name}"
            save_path = os.path.join(user_upload_dir, stored_name)
            try:
                with open(save_path, 'wb') as out:
                    out.write(f.file.read())
            finally:
                f.file.close()
            rec = {
                'filename': stored_name,
                'url': f"/uploads/{patient_id}/{stored_name}",
                'uploaded_at': now,
                'source': 'doctor',
                'doctor_id': doctor_id
            }
            target.setdefault('files', []).append(rec)
            uploaded_files.append(rec)
        _save_json(USERS_FILE, users)

    return {
        'prescription': prescription,
        'uploaded_files': uploaded_files,
        'consultation_id': target_consultation_id
    }


@app.post('/doctor/notes/{user_id}')
def add_doctor_note(user_id: str, data: DoctorNoteInput):
    u = users.get(user_id)
    if not u:
        raise HTTPException(status_code=404, detail='User not found')
    consultations = u.setdefault('consultations', [])
    target = None
    for c in consultations:
        if str(c.get('consultation_id')) == str(data.consultation_id):
            target = c
            break
    if target is None:
        raise HTTPException(status_code=404, detail='Consultation not found')
    note_text = (data.note or '').strip()
    if not note_text:
        raise HTTPException(status_code=400, detail='Note cannot be empty')
    target.setdefault('doctor_notes', []).append({
        'doctor_name': (data.doctor_name or 'Doctor').strip() or 'Doctor',
        'note': note_text,
        'date': datetime.now().strftime("%Y-%m-%d %H:%M")
    })
    _save_json(USERS_FILE, users)
    return {'user_id': user_id, 'consultation_id': target.get('consultation_id'), 'saved': True}


# Simple logout/return-to-login endpoint (clients can call this to clear session client-side)
@app.post('/logout/{user_id}')
def logout(user_id: str):
    if user_id not in users:
        raise HTTPException(status_code=404, detail='User not found')
    # No server-side session management here; client should clear tokens/cookies.
    return {'message': 'Logged out', 'user_id': user_id}


# --- Vendor endpoints and Admin/Super-admin controls ---
@app.post('/vendor/create')
def vendor_create(v: VendorCreate):
    vid = str(uuid4())
    vendors[vid] = {
        'id': vid,
        'first_name': v.first_name,
        'last_name': v.last_name,
        'phone': v.phone,
        'email': v.email,
        'shop_name': v.shop_name,
        'shop_address': v.shop_address,
        'license_no': v.license_no,
        'status': 'approval_pending',
        'store_details': {
            'shop_name': v.shop_name,
            'shop_address': v.shop_address,
            'lat': None,
            'lng': None,
            'open_hours': '',
            'contact_note': ''
        },
        'medicines': []
    }
    # store password hash only if provided (backwards compatible)
    if getattr(v, 'password', None):
        vendors[vid]['password_hash'] = _hash_password(v.password)
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vid, 'status': 'approval_pending'}


@app.post('/vendor/signup')
def vendor_signup(v: VendorCreate):
    # alias for vendor_create (signup)
    return vendor_create(v)


class VendorLogin(BaseModel):
    phone: str
    password: str


@app.post('/vendor/login')
def vendor_login(l: VendorLogin):
    login_phone = normalize_phone(l.phone)
    # allow login by phone or by vendor id
    for vid, v in vendors.items():
        v_phone = normalize_phone(v.get('phone'))
        if (v_phone and v_phone == login_phone) or (str(vid) == str(l.phone)):
            # ensure vendor has password set
            if not v.get('password_hash'):
                raise HTTPException(status_code=403, detail='Vendor has no password set; admin must set password')
            if v.get('password_hash') != _hash_password(l.password):
                raise HTTPException(status_code=401, detail='Invalid phone or password')
            # allow login for pending/approved vendors; only blocked vendors are denied.
            if v.get('status') == 'blocked':
                raise HTTPException(status_code=403, detail='Vendor is blocked')
            return {'vendor_id': vid, 'status': v.get('status', 'approval_pending')}
    raise HTTPException(status_code=401, detail='Invalid phone or password')


@app.get('/vendor/{vendor_id}')
def vendor_get(vendor_id: str):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    return v


@app.get('/vendor/{vendor_id}/dashboard')
def vendor_dashboard(vendor_id: str):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    return {
        'vendor': {k: vv for k, vv in v.items() if k != 'password_hash'},
        'store_details': v.get('store_details', {}),
        'medicines': v.get('medicines', [])
    }


@app.post('/vendor/{vendor_id}/store')
def vendor_update_store(vendor_id: str, data: VendorStoreUpdate):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    details = v.setdefault('store_details', {})
    if data.shop_name is not None:
        details['shop_name'] = data.shop_name
        v['shop_name'] = data.shop_name
    if data.shop_address is not None:
        details['shop_address'] = data.shop_address
        v['shop_address'] = data.shop_address
    if data.lat is not None:
        details['lat'] = data.lat
    if data.lng is not None:
        details['lng'] = data.lng
    if data.open_hours is not None:
        details['open_hours'] = data.open_hours
    if data.contact_note is not None:
        details['contact_note'] = data.contact_note
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'store_details': details}


@app.get('/vendor/{vendor_id}/medicines')
def vendor_list_medicines(vendor_id: str):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    return {'vendor_id': vendor_id, 'medicines': v.get('medicines', [])}


@app.post('/vendor/{vendor_id}/medicines')
def vendor_upsert_medicine(vendor_id: str, data: VendorMedicineUpsert):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    meds = v.setdefault('medicines', [])
    name_norm = data.name.strip().lower()
    if not name_norm:
        raise HTTPException(status_code=400, detail='Medicine name is required')
    units = data.units if data.units is not None else data.quantity
    if units is None:
        raise HTTPException(status_code=400, detail='Units is required')
    if units < 0:
        raise HTTPException(status_code=400, detail='Units cannot be negative')
    medicine_per_unit = (data.medicine_per_unit or data.unit or '').strip()
    if not medicine_per_unit:
        raise HTTPException(status_code=400, detail='Medicine per unit is required')
    updated = False
    for m in meds:
        if str(m.get('name', '')).strip().lower() == name_norm:
            m['name'] = data.name.strip()
            m['units'] = units
            m['medicine_per_unit'] = medicine_per_unit
            m['price'] = data.price
            updated = True
            break
    if not updated:
        meds.append({
            'name': data.name.strip(),
            'units': units,
            'medicine_per_unit': medicine_per_unit,
            'price': data.price
        })
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'medicines': meds}


@app.delete('/vendor/{vendor_id}/medicines/{medicine_name}')
def vendor_delete_medicine(vendor_id: str, medicine_name: str):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    meds = v.setdefault('medicines', [])
    target = medicine_name.strip().lower()
    before = len(meds)
    meds[:] = [m for m in meds if str(m.get('name', '')).strip().lower() != target]
    if len(meds) == before:
        raise HTTPException(status_code=404, detail='Medicine not found')
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'removed': medicine_name}


@app.get('/vendors')
def vendor_list(_: None = Depends(require_admin)):
    return {'vendors': list(vendors.values())}


@app.get('/admin/doctors')
def admin_list_doctors(_: None = Depends(require_admin)):
    return {'doctors': [{k: v for k, v in d.items() if k != 'password_hash'} for d in doctors.values()]}


@app.post('/admin/doctor/{doctor_id}/approve')
def admin_approve_doctor(doctor_id: str, action: AdminAction, _: None = Depends(require_admin)):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    d['status'] = 'approved'
    d['admin_review'] = {'action': 'approved', 'reason': action.reason}
    _save_json(DOCTORS_FILE, doctors)
    return {'doctor_id': doctor_id, 'status': 'approved'}


@app.post('/admin/doctor/{doctor_id}/block')
def admin_block_doctor(doctor_id: str, action: AdminAction, _: None = Depends(require_admin)):
    d = doctors.get(doctor_id)
    if not d:
        raise HTTPException(status_code=404, detail='Doctor not found')
    d['status'] = 'blocked'
    d['admin_review'] = {'action': 'blocked', 'reason': action.reason}
    _save_json(DOCTORS_FILE, doctors)
    return {'doctor_id': doctor_id, 'status': 'blocked'}


@app.delete('/admin/doctor/{doctor_id}')
def admin_remove_doctor(doctor_id: str, _: None = Depends(require_admin)):
    if doctor_id not in doctors:
        raise HTTPException(status_code=404, detail='Doctor not found')
    doctors.pop(doctor_id)
    # unlink doctor assignment for patients
    for u in users.values():
        if str(u.get('assigned_doctor_id')) == str(doctor_id):
            u['assigned_doctor_id'] = None
    _save_json(DOCTORS_FILE, doctors)
    _save_json(USERS_FILE, users)
    return {'doctor_id': doctor_id, 'removed': True}


@app.post('/admin/doctors/clear')
def admin_clear_doctors(_: None = Depends(require_admin)):
    doctors.clear()
    for u in users.values():
        u['assigned_doctor_id'] = None
    _save_json(DOCTORS_FILE, doctors)
    _save_json(USERS_FILE, users)
    return {'cleared': 'doctors', 'count': 0}


@app.delete('/admin/vendor/{vendor_id}')
def admin_remove_vendor(vendor_id: str, _: None = Depends(require_admin)):
    if vendor_id not in vendors:
        raise HTTPException(status_code=404, detail='Vendor not found')
    vendors.pop(vendor_id)
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'removed': True}


@app.post('/admin/vendor/{vendor_id}/approve')
def admin_approve_vendor(vendor_id: str, action: AdminAction, _: None = Depends(require_admin)):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    v['status'] = 'approved'
    v['admin_review'] = {'action': 'approved', 'reason': action.reason}
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'status': 'approved'}


class PasswordSet(BaseModel):
    password: str


@app.post('/admin/vendor/{vendor_id}/set_password')
def admin_set_vendor_password(vendor_id: str, data: PasswordSet, _: None = Depends(require_admin)):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    v['password_hash'] = _hash_password(data.password)
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'password_set': True}


@app.post('/admin/vendor/{vendor_id}/block')
def admin_block_vendor(vendor_id: str, action: AdminAction, _: None = Depends(require_admin)):
    v = vendors.get(vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail='Vendor not found')
    v['status'] = 'blocked'
    v['admin_review'] = {'action': 'blocked', 'reason': action.reason}
    _save_json(VENDORS_FILE, vendors)
    return {'vendor_id': vendor_id, 'status': 'blocked'}


@app.get('/admin/patients')
def admin_list_patients(_: None = Depends(require_admin)):
    # return sanitized patient list
    return {'patients': [{k: v for k, v in u.items() if k != 'password_hash'} for u in users.values()]}


@app.post('/admin/patient/{patient_id}/modify')
def admin_modify_patient(patient_id: str, data: dict, _: None = Depends(require_admin)):
    u = users.get(patient_id)
    if not u:
        raise HTTPException(status_code=404, detail='Patient not found')
    # allow certain fields to be modified
    for key in ['first_name', 'last_name', 'phone', 'email']:
        if key in data:
            u[key] = data[key]
    _save_json(USERS_FILE, users)
    return {'patient_id': patient_id, 'updated': True}


@app.delete('/admin/patient/{patient_id}')
def admin_remove_patient(patient_id: str, _: None = Depends(require_admin)):
    if patient_id not in users:
        raise HTTPException(status_code=404, detail='Patient not found')
    users.pop(patient_id)
    _save_json(USERS_FILE, users)
    # unlink removed patient from doctors
    changed = False
    for d in doctors.values():
        ids = d.setdefault('patient_ids', [])
        before = len(ids)
        d['patient_ids'] = [pid for pid in ids if str(pid) != str(patient_id)]
        if len(d['patient_ids']) != before:
            changed = True
    if changed:
        _save_json(DOCTORS_FILE, doctors)
    return {'patient_id': patient_id, 'removed': True}


@app.post('/admin/patients/clear')
def admin_clear_patients(_: None = Depends(require_admin)):
    users.clear()
    _save_json(USERS_FILE, users)
    # clear linked patient lists for doctors
    for d in doctors.values():
        d['patient_ids'] = []
    _save_json(DOCTORS_FILE, doctors)
    return {'cleared': 'patients', 'count': 0}


@app.post('/admin/vendors/clear')
def admin_clear_vendors(_: None = Depends(require_admin)):
    vendors.clear()
    _save_json(VENDORS_FILE, vendors)
    return {'cleared': 'vendors', 'count': 0}


@app.post('/admin/send_message')
def admin_send_message(target_id: str, message: str, _: None = Depends(require_admin)):
    # minimal send-message simulation: record message in user's data
    if target_id in users:
        u = users[target_id]
        u.setdefault('messages', []).append({'from': 'admin', 'message': message, 'target_id': target_id})
        _save_json(USERS_FILE, users)
        return {'target': target_id, 'sent': True}
    if target_id in vendors:
        v = vendors[target_id]
        v.setdefault('messages', []).append({'from': 'admin', 'message': message, 'target_id': target_id})
        _save_json(VENDORS_FILE, vendors)
        return {'target': target_id, 'sent': True}
    raise HTTPException(status_code=404, detail='Target not found')


@app.post('/admin/merge_duplicates')
def admin_merge_duplicates(_: None = Depends(require_admin)):
    return _admin_merge_duplicates_impl()


def _admin_merge_duplicates_impl():
    # Merge users with duplicate phone numbers.
    phones = {}
    to_delete = []
    merged_count = 0
    for uid, u in list(users.items()):
        ph = u.get('phone')
        if not ph:
            continue
        if ph in phones:
            keep_id = phones[ph]
            keep = users.get(keep_id)
            if not keep:
                phones[ph] = uid
                continue
            # merge basic fields if missing
            for key, val in u.items():
                if key in ('id', 'password_hash', 'phone'):
                    continue
                if key == 'permissions':
                    keep.setdefault('permissions', {})
                    for pk, pv in val.items():
                        if pk not in keep['permissions']:
                            keep['permissions'][pk] = pv
                elif key == 'messages':
                    keep.setdefault('messages', [])
                    keep['messages'].extend(val)
                else:
                    if not keep.get(key):
                        keep[key] = val
            to_delete.append(uid)
            merged_count += 1
        else:
            phones[ph] = uid
    for d in to_delete:
        users.pop(d, None)
    _save_json(USERS_FILE, users)
    return {'merged': merged_count}


@app.post('/admin/bug_analysis')
def admin_bug_analysis(payload: dict = None, _: None = Depends(require_admin)):
    # Run simple site checks (HTTP checks of root and key static files).
    auto_merge = False
    if payload and isinstance(payload, dict):
        auto_merge = bool(payload.get('auto_merge', False))
    import urllib.request
    urls = [
        'http://127.0.0.1:8001/',
        'http://127.0.0.1:8001/static/app.js',
        'http://127.0.0.1:8001/static/admin.html',
        'http://127.0.0.1:8001/static/index.html'
    ]
    report = {}
    for u in urls:
        try:
            with urllib.request.urlopen(u, timeout=5) as r:
                status = r.getcode()
                snippet = r.read(2000).decode('utf-8', errors='replace')
                report[u] = {'status': status, 'snippet': snippet[:400]}
        except Exception as e:
            report[u] = {'error': str(e)}
    if auto_merge:
        report['auto_merge'] = _admin_merge_duplicates_impl()
    return report


@app.post('/admin/notices')
def admin_add_notice(title: str, body: str, _: None = Depends(require_admin)):
    notice = {'id': str(uuid4()), 'title': title, 'body': body}
    notices.append(notice)
    _save_json(NOTICES_FILE, notices)
    return {'notice_id': notice['id']}


@app.get('/admin/notices')
def admin_list_notices(_: None = Depends(require_admin)):
    return {'notices': notices}


@app.post('/admin/broadcast')
def admin_broadcast(data: AdminBroadcastInput, _: None = Depends(require_admin)):
    msg = (data.message or '').strip()
    if not msg:
        raise HTTPException(status_code=400, detail='Message is required')
    target = (data.target or 'all').strip().lower()
    if target not in ['all', 'patients', 'vendors', 'doctors']:
        raise HTTPException(status_code=400, detail='Invalid target')
    duration = int(data.duration_seconds or 30)
    if duration < 5:
        duration = 5
    if duration > 3600:
        duration = 3600
    now = int(time.time())
    announcement = {
        'id': str(uuid4()),
        'message': msg,
        'target': target,
        'start_ts': now,
        'end_ts': now + duration,
        'duration_seconds': duration
    }
    announcements.append(announcement)
    _save_json(ANNOUNCEMENTS_FILE, announcements)
    return announcement


@app.get('/broadcast/{role}')
def get_broadcast(role: str):
    r = (role or '').strip().lower()
    if r not in ['patient', 'vendor', 'doctor']:
        raise HTTPException(status_code=400, detail='Invalid role')
    target_map = {
        'patient': 'patients',
        'vendor': 'vendors',
        'doctor': 'doctors'
    }
    now = int(time.time())
    active = []
    for a in announcements:
        if int(a.get('end_ts', 0)) < now:
            continue
        t = str(a.get('target', 'all')).lower()
        if t in ['all', target_map[r]]:
            active.append(a)
    return {'announcements': active}


@app.post('/admin/bugs')
def admin_report_bug(title: str, details: Optional[str] = None, _: None = Depends(require_admin)):
    b = {'id': str(uuid4()), 'title': title, 'details': details}
    bugs.append(b)
    _save_json(BUGS_FILE, bugs)
    return {'bug_id': b['id']}


@app.get('/admin/bugs')
def admin_list_bugs(_: None = Depends(require_admin)):
    return {'bugs': bugs}


@app.post('/admin/reload_data')
def admin_reload_data(_: None = Depends(require_admin)):
    return _admin_reload_data_impl()


def _admin_reload_data_impl():
    # reload users/vendors/notices/bugs from disk into memory
    global users, vendors, doctors, notices, announcements, bugs
    users = _load_json(USERS_FILE, {})
    vendors = _load_json(VENDORS_FILE, {})
    doctors = _load_json(DOCTORS_FILE, {})
    notices = _load_json(NOTICES_FILE, [])
    announcements = _load_json(ANNOUNCEMENTS_FILE, [])
    bugs = _load_json(BUGS_FILE, [])
    return {
        'users': len(users),
        'vendors': len(vendors),
        'doctors': len(doctors),
        'notices': len(notices),
        'announcements': len(announcements),
        'bugs': len(bugs)
    }


@app.get('/admin/reload_data')
def admin_reload_data_get(_: None = Depends(require_admin)):
    return _admin_reload_data_impl()


if __name__ == "__main__":
    # Start server on a predictable default port to avoid UI/API port mismatch.
    import os
    try:
        import uvicorn  # ensure dependency is available
    except Exception:
        print("uvicorn is not installed. Install it with: pip install uvicorn[standard]")
        raise SystemExit(1)

    host = "0.0.0.0"
    port = int(os.getenv("PORT", "8000"))
    print(f"Starting server at http://127.0.0.1:{port}/ (host={host})")
    uvicorn.run("main:app", host=host, port=port)
