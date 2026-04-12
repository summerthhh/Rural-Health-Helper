// Theme Support
(function() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark-mode');
  }
})();

const apiBase = "";

// Enhanced state management with profile persistence
const state = {
  activeView: "view-landing",
  activePanel: "panel-profile",
  userId: localStorage.getItem("user_id") || "",
  vendorId: localStorage.getItem("vendor_id") || "",
  doctorId: localStorage.getItem("doctor_id") || "",
  userToken: localStorage.getItem("user_token") || "",
  vendorToken: localStorage.getItem("vendor_token") || "",
  doctorToken: localStorage.getItem("doctor_token") || "",
  user: null,
  vendor: null,
  doctor: null,
  doctorPublicList: [],
  doctorPatients: [],
  doctorConsultRequests: [],
  medicalHistory: [],
  incomingRequestId: "",
  doctorPollHandle: null
};

// User profile cache - stores user data locally for quick access
const profileCache = {
  get: (userId) => {
    try {
      const cached = localStorage.getItem(`profile_${userId}`);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  },
  set: (userId, profileData) => {
    try {
      localStorage.setItem(`profile_${userId}`, JSON.stringify(profileData));
    } catch (e) {
      console.warn("Profile cache storage failed:", e);
    }
  },
  clear: (userId) => {
    localStorage.removeItem(`profile_${userId}`);
  }
};

const ids = [
  "view-landing",
  "view-patient-auth",
  "view-vendor-auth",
  "view-doctor-auth",
  "view-vendor-dashboard",
  "view-doctor-dashboard",
  "view-dashboard"
];

function el(id) {
  return document.getElementById(id);
}

function hide(id) {
  const node = el(id);
  if (node) node.classList.add("hidden");
}

function show(id) {
  const node = el(id);
  if (node) node.classList.remove("hidden");
}

function toast(message) {
  const wrap = el("toast-wrap");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  wrap.appendChild(t);
  window.setTimeout(() => t.remove(), 3200);
}

function safeText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

function currentRole() {
  if (state.doctorId) return "doctor";
  if (state.vendorId) return "vendor";
  if (state.userId) return "patient";
  return "";
}

async function refreshAnnouncements() {
  const role = currentRole();
  const strip = el("announcement-strip");
  const track = el("announcement-track");
  if (!strip || !track || !role) {
    if (strip) strip.classList.add("hidden");
    return;
  }
  try {
    const data = await getJson(`/broadcast/${role}`);
    const items = data.announcements || [];
    if (!items.length) {
      strip.classList.add("hidden");
      track.textContent = "";
      return;
    }
    const text = items.map((a) => String(a.message || "").trim()).filter(Boolean).join("   |   ");
    if (!text) {
      strip.classList.add("hidden");
      track.textContent = "";
      return;
    }
    track.textContent = text;
    strip.classList.remove("hidden");
  } catch {
    strip.classList.add("hidden");
    track.textContent = "";
  }
}

function formatDistanceKm(raw) {
  if (raw == null || raw === undefined || Number.isNaN(Number(raw))) return "Unknown";
  // Keep demo UI distances in a realistic under-50km range.
  const value = Math.min(Number(raw), 49.9);
  return `${value.toFixed(2)} km`;
}

async function postJson(path, body) {
  const res = await fetch(apiBase + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

async function getJson(path) {
  const res = await fetch(apiBase + path);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

async function deleteJson(path) {
  const res = await fetch(apiBase + path, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
}

function setTopStatus() {
  const status = el("status-pill");
  const logout = el("btn-logout");
  const signin = el("btn-signin");
  if (!status || !logout) return;

  if (state.userId && state.user) {
    status.textContent = `Patient: ${state.user.first_name || "Signed in"}`;
    status.classList.remove("muted");
    logout.classList.remove("hidden");
    if (signin) signin.classList.add("hidden");
    return;
  }

  if (state.vendorId) {
    const displayName = state.vendor?.shop_name || state.vendor?.first_name || "Vendor";
    status.textContent = `Vendor: ${displayName}`;
    status.classList.remove("muted");
    logout.classList.remove("hidden");
    if (signin) signin.classList.add("hidden");
    return;
  }

  if (state.doctorId) {
    const displayName = state.doctor ? `Dr. ${state.doctor.first_name || ""} ${state.doctor.last_name || ""}`.trim() : "Doctor";
    status.textContent = displayName;
    status.classList.remove("muted");
    logout.classList.remove("hidden");
    if (signin) signin.classList.add("hidden");
    return;
  }

  status.textContent = "Not signed in";
  status.classList.add("muted");
  logout.classList.add("hidden");
  if (signin) signin.classList.remove("hidden");
}

function switchView(viewId) {
  ids.forEach((id) => hide(id));
  show(viewId);
  state.activeView = viewId;
}

function switchAuthTab(kind, tab) {
  const loginTab = el(`${kind}-tab-login`);
  const signupTab = el(`${kind}-tab-signup`);
  const loginPanel = el(`${kind}-login-panel`);
  const signupPanel = el(`${kind}-signup-panel`);

  if (!loginTab || !signupTab || !loginPanel || !signupPanel) return;

  const loginActive = tab === "login";
  loginTab.classList.toggle("active", loginActive);
  signupTab.classList.toggle("active", !loginActive);
  loginPanel.classList.toggle("hidden", !loginActive);
  signupPanel.classList.toggle("hidden", loginActive);

  if (kind === "patient") {
    safeText("patient-login-msg", "");
    safeText("patient-signup-msg", "");
  } else if (kind === "vendor") {
    safeText("vendor-login-msg", "");
    safeText("vendor-signup-msg", "");
  } else {
    safeText("doctor-login-msg", "");
    safeText("doctor-signup-msg", "");
  }
}

function switchDashboardPanel(panelId) {
  document.querySelectorAll(".panel-page").forEach((node) => node.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach((node) => node.classList.remove("active"));
  show(panelId);
  document.querySelector(`.nav-btn[data-panel='${panelId}']`)?.classList.add("active");
  state.activePanel = panelId;
}

function switchVendorPanel(panelId) {
  document.querySelectorAll(".vendor-panel-page").forEach((node) => node.classList.add("hidden"));
  document.querySelectorAll(".vendor-nav-btn").forEach((node) => node.classList.remove("active"));
  show(panelId);
  document.querySelector(`.vendor-nav-btn[data-vendor-panel='${panelId}']`)?.classList.add("active");
}

function switchDoctorPanel(panelId) {
  document.querySelectorAll(".doctor-panel-page").forEach((node) => node.classList.add("hidden"));
  document.querySelectorAll(".doctor-nav-btn").forEach((node) => node.classList.remove("active"));
  show(panelId);
  document.querySelector(`.doctor-nav-btn[data-doctor-panel='${panelId}']`)?.classList.add("active");
}

function updateVendorLocationUI(lat, lng) {
  const display = el("vendor-location-display");
  const openMaps = el("vendor-open-maps");
  const hasLocation = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  if (display) {
    display.textContent = hasLocation
      ? `Selected location: ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`
      : "Location not set.";
  }
  if (openMaps) {
    openMaps.disabled = !hasLocation;
  }
}

function renderProfile(user) {
  const out = el("profile-info");
  if (!out) return;

  out.innerHTML = "";
  const rows = [
    ["First name", user.first_name || "-"],
    ["Last name", user.last_name || "-"],
    ["Phone", user.phone || "-"],
    ["Email", user.email || "-"]
  ];

  rows.forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${k}</span><strong>${v}</strong>`;
    out.appendChild(row);
  });

  const perms = user.permissions || {};
  const lat = perms.location?.lat;
  const lng = perms.location?.lng;
  const locationState = perms.location?.granted
    ? `Allowed (${typeof lat === "number" ? lat.toFixed(4) : "?"}, ${typeof lng === "number" ? lng.toFixed(4) : "?"})`
    : "Not allowed";
  const callState = perms.call?.granted ? "Allowed" : "Not allowed";
  const galleryState = perms.gallery?.granted ? "Allowed" : "Not allowed";

  safeText("perm-location", locationState);
  safeText("perm-call", callState);
  safeText("perm-gallery", galleryState);
}

async function loadPatientDashboard(userId) {
  const data = await getJson(`/dashboard/${userId}`);
  state.user = data.user;
  setTopStatus();

  safeText("sidebar-user", `${data.user.first_name || "Patient"} (${data.user.phone || "no phone"})`);
  safeText("profile-id-pill", `ID: ${userId.slice(0, 8)}...`);
  renderProfile(data.user);
  await loadDoctorPublicList();
  await loadMedicalHistory(userId);
  switchView("view-dashboard");
  switchDashboardPanel("panel-profile");
  await refreshAnnouncements();
}

function formatHistoryDate(value) {
  if (!value) return "Unknown date";
  return String(value);
}

function renderHistoryDetails(entry) {
  const details = el("medical-history-detail");
  if (!details) return;
  details.innerHTML = "";
  if (!entry) return;

  const card = document.createElement("article");
  card.className = "result-card";

  const title = document.createElement("h3");
  title.textContent = entry.title || "Consultation";
  card.appendChild(title);

  const dateLine = document.createElement("p");
  dateLine.innerHTML = `<strong>Date:</strong> ${formatHistoryDate(entry.date)}`;
  card.appendChild(dateLine);

  const files = Array.isArray(entry.files) ? entry.files : [];
  const notes = Array.isArray(entry.doctor_notes) ? entry.doctor_notes : [];

  const filesHead = document.createElement("h4");
  filesHead.textContent = "Uploaded Images / Files";
  card.appendChild(filesHead);

  if (files.length === 0) {
    const noFiles = document.createElement("p");
    noFiles.textContent = "No uploaded files.";
    card.appendChild(noFiles);
  } else {
    const fileGrid = document.createElement("div");
    fileGrid.className = "history-file-grid";
    files.forEach((fileObj) => {
      const fileCard = document.createElement("div");
      fileCard.className = "history-file-card";

      const name = document.createElement("p");
      name.className = "history-file-name";
      name.textContent = fileObj.filename || "Uploaded file";
      fileCard.appendChild(name);

      if (fileObj.url) {
        const preview = document.createElement("img");
        preview.className = "history-preview";
        preview.src = fileObj.url;
        preview.alt = fileObj.filename || "Uploaded image";
        preview.loading = "lazy";
        preview.referrerPolicy = "no-referrer";
        preview.addEventListener("error", () => {
          preview.remove();
        });
        fileCard.appendChild(preview);

        const openLink = document.createElement("a");
        openLink.href = fileObj.url;
        openLink.target = "_blank";
        openLink.rel = "noopener";
        openLink.textContent = "Open file";
        fileCard.appendChild(openLink);
      }
      fileGrid.appendChild(fileCard);
    });
    card.appendChild(fileGrid);
  }

  const notesHead = document.createElement("h4");
  notesHead.textContent = "Doctor Notes";
  card.appendChild(notesHead);

  if (notes.length === 0) {
    const noNotes = document.createElement("p");
    noNotes.textContent = "No doctor notes yet.";
    card.appendChild(noNotes);
  } else {
    const notesWrap = document.createElement("div");
    notesWrap.className = "history-notes";
    notes.forEach((n) => {
      const noteCard = document.createElement("div");
      noteCard.className = "history-note-card";
      const doctorName = n.doctor_name || "Doctor";
      const noteDate = formatHistoryDate(n.date);
      const noteText = n.note || "";
      noteCard.innerHTML = `
        <p><strong>${doctorName}</strong> <span class="muted">(${noteDate})</span></p>
        <p>${noteText}</p>
      `;
      notesWrap.appendChild(noteCard);
    });
    card.appendChild(notesWrap);
  }

  details.appendChild(card);
}

function renderMedicalHistory(consultations) {
  const list = el("medical-history-list");
  const details = el("medical-history-detail");
  if (!list || !details) return;
  list.innerHTML = "";
  details.innerHTML = "";

  if (!consultations || consultations.length === 0) {
    list.innerHTML = "<article class='result-card'>No consultation history yet. Upload reports in Consult to create records.</article>";
    return;
  }

  consultations.forEach((entry, idx) => {
    const card = document.createElement("article");
    card.className = "result-card history-row";
    const title = entry.title || `Consultation ${idx + 1}`;
    const dateLine = formatHistoryDate(entry.date);
    card.innerHTML = `
      <div>
        <h4>${title}</h4>
        <p><strong>Date:</strong> ${dateLine}</p>
      </div>
      <button class="btn secondary history-details-btn" type="button">Show Details</button>
    `;
    card.querySelector(".history-details-btn")?.addEventListener("click", () => {
      renderHistoryDetails(entry);
    });
    list.appendChild(card);
  });

  renderHistoryDetails(consultations[0]);
}

async function loadMedicalHistory(userId) {
  try {
    const data = await getJson(`/medical_history/${userId}`);
    state.medicalHistory = data.consultations || [];
    renderMedicalHistory(state.medicalHistory);
  } catch (err) {
    state.medicalHistory = [];
    const list = el("medical-history-list");
    if (list) list.innerHTML = `<article class="result-card">Failed to load medical history: ${err.message}</article>`;
  }
}

function renderVendorMedicines(medicines) {
  const out = el("vendor-medicine-list");
  if (!out) return;
  out.innerHTML = "";
  if (!medicines || medicines.length === 0) {
    out.innerHTML = "<div class='result-card'>No medicines listed yet.</div>";
    return;
  }

  medicines.forEach((m) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const units = Number.isFinite(Number(m.units)) ? Number(m.units) : (Number.isFinite(Number(m.quantity)) ? Number(m.quantity) : 0);
    const medPerUnit = m.medicine_per_unit || m.unit || "Not set";
    const priceText = m.price == null || m.price === "" ? "Not set" : String(m.price);
    card.innerHTML = `
      <h4>${m.name}</h4>
      <p><strong>Units:</strong> ${units}</p>
      <p><strong>Medicine per unit:</strong> ${medPerUnit}</p>
      <p><strong>Price:</strong> ${priceText}</p>
      <button class="btn danger vendor-med-remove">Remove</button>
    `;
    card.querySelector(".vendor-med-remove")?.addEventListener("click", async () => {
      if (!state.vendorId) return;
      try {
        await deleteJson(`/vendor/${state.vendorId}/medicines/${encodeURIComponent(m.name)}`);
        toast(`Removed ${m.name}`);
        await loadVendorDashboard(state.vendorId);
      } catch (err) {
        toast(`Remove failed: ${err.message}`);
      }
    });
    out.appendChild(card);
  });
}

function renderVendorStore(details, vendor) {
  if (el("vendor-store-name")) el("vendor-store-name").value = details.shop_name || vendor.shop_name || "";
  if (el("vendor-store-address")) el("vendor-store-address").value = details.shop_address || vendor.shop_address || "";
  if (el("vendor-store-lat")) el("vendor-store-lat").value = details.lat ?? "";
  if (el("vendor-store-lng")) el("vendor-store-lng").value = details.lng ?? "";
  if (el("vendor-store-hours")) el("vendor-store-hours").value = details.open_hours || "";
  if (el("vendor-store-note")) el("vendor-store-note").value = details.contact_note || "";
  updateVendorLocationUI(details.lat, details.lng);
}

async function loadVendorDashboard(vendorId) {
  const data = await getJson(`/vendor/${vendorId}/dashboard`);
  state.vendor = data.vendor || null;
  setTopStatus();
  safeText("vendor-sidebar-user", `${data.vendor.shop_name || "Shop"} (${data.vendor.status || "pending"})`);
  safeText("vendor-status-pill", `ID: ${vendorId.slice(0, 8)}...`);
  renderVendorStore(data.store_details || {}, data.vendor || {});
  renderVendorMedicines(data.medicines || []);
  switchView("view-vendor-dashboard");
  switchVendorPanel("vendor-panel-store");
  await refreshAnnouncements();
}

function renderDoctorOverview(doctor, patients, consults) {
  const out = el("doctor-overview-card");
  if (!out) return;
  out.innerHTML = "";
  const card = document.createElement("article");
  card.className = "result-card";
  const spec = doctor.specialization || "General Physician";
  card.innerHTML = `
    <h3>Dr. ${doctor.first_name || ""} ${doctor.last_name || ""}</h3>
    <p><strong>Specialization:</strong> ${spec}</p>
    <p><strong>Phone:</strong> ${doctor.phone || "-"}</p>
    <p><strong>Total Patients:</strong> ${patients.length}</p>
    <p><strong>Consult Requests:</strong> ${consults.length}</p>
  `;
  out.appendChild(card);
}

function renderDoctorPatientDetails(item) {
  const out = el("doctor-patient-detail");
  if (!out) return;
  out.innerHTML = "";
  if (!item) return;

  const head = document.createElement("article");
  head.className = "result-card";
  const p = item.patient || {};
  head.innerHTML = `
    <h3>${p.first_name || ""} ${p.last_name || ""}</h3>
    <p><strong>Phone:</strong> ${p.phone || "-"}</p>
    <p><strong>Email:</strong> ${p.email || "-"}</p>
  `;
  out.appendChild(head);

  const consults = Array.isArray(item.consultations) ? item.consultations : [];
  const consultCard = document.createElement("article");
  consultCard.className = "result-card";
  consultCard.innerHTML = "<h4>Uploaded Files and Notes</h4>";
  if (!consults.length) {
    consultCard.innerHTML += "<p>No consultations yet.</p>";
  } else {
    const wrap = document.createElement("div");
    wrap.className = "history-notes";
    consults.forEach((c, idx) => {
      const files = c.files || [];
      const notes = (c.doctor_notes || []).map((n) => `${n.doctor_name || "Doctor"}: ${n.note || ""}`).join(" | ") || "No doctor notes";
      const row = document.createElement("div");
      row.className = "history-note-card";
      const fileHtml = files.length
        ? files.map((f) => {
            const fn = f.filename || "file";
            const url = f.url || "#";
            const img = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fn)
              ? `<div style="margin-top:8px"><img src="${url}" alt="${fn}" style="max-width:180px;border-radius:8px;border:1px solid #dbe4d9;"></div>`
              : "";
            return `<div><a href="${url}" target="_blank" rel="noopener">${fn}</a>${img}</div>`;
          }).join("")
        : "No files";
      row.innerHTML = `
        <p><strong>${c.title || `Consultation ${idx + 1}`}</strong> (${c.date || "-"})</p>
        <p><strong>Files:</strong></p>
        <div>${fileHtml}</div>
        <p><strong>Notes:</strong> ${notes}</p>
      `;
      wrap.appendChild(row);
    });
    consultCard.appendChild(wrap);
  }
  out.appendChild(consultCard);
}

function renderDoctorPatients(items) {
  const out = el("doctor-patient-list");
  if (!out) return;
  out.innerHTML = "";
  if (!items || !items.length) {
    out.innerHTML = "<article class='result-card'>No linked patients yet.</article>";
    return;
  }
  items.forEach((p) => {
    const card = document.createElement("article");
    card.className = "result-card history-row";
    card.innerHTML = `
      <div>
        <h4>${p.name || "Patient"}</h4>
        <p><strong>Phone:</strong> ${p.phone || "-"}</p>
        <p><strong>Consultations:</strong> ${p.consultation_count || 0}</p>
      </div>
      <button class="btn secondary" type="button">Show Details</button>
    `;
    card.querySelector("button")?.addEventListener("click", async () => {
      if (!state.doctorId) return;
      try {
        const detail = await getJson(`/doctor/${state.doctorId}/patient/${p.patient_id}`);
        renderDoctorPatientDetails(detail);
      } catch (err) {
        toast(`Failed to load patient details: ${err.message}`);
      }
    });
    out.appendChild(card);
  });
}

function renderDoctorConsultRequests(items) {
  const out = el("doctor-consult-list");
  if (!out) return;
  out.innerHTML = "";
  const pendingItems = (items || []).filter((r) => String(r.status || "").toLowerCase() === "pending");
  if (!pendingItems.length) {
    out.innerHTML = "<article class='result-card'>No consult requests right now.</article>";
    return;
  }
  pendingItems.forEach((r) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const reason = r.reason && String(r.reason).trim() ? r.reason : "No reason added.";
    card.innerHTML = `
      <h4>${r.patient_name || "Patient"}</h4>
      <p><strong>Status:</strong> pending</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p><strong>Created:</strong> ${r.created_at || "-"}</p>
      <div class="inline-actions">
        <button class="btn primary req-accept" type="button">Accept</button>
        <button class="btn danger req-reject" type="button">Reject</button>
      </div>
    `;
    card.querySelector(".req-accept")?.addEventListener("click", async () => {
      if (!state.doctorId) return;
      try {
        await postJson(`/doctor/${state.doctorId}/consult/${r.request_id}`, { action: "accepted" });
        await loadDoctorDashboard(state.doctorId);
        hideIncomingCallModal();
        toast("Consult accepted");
      } catch (err) {
        toast(`Accept failed: ${err.message}`);
      }
    });
    card.querySelector(".req-reject")?.addEventListener("click", async () => {
      if (!state.doctorId) return;
      try {
        await postJson(`/doctor/${state.doctorId}/consult/${r.request_id}`, { action: "rejected" });
        await loadDoctorDashboard(state.doctorId);
        hideIncomingCallModal();
        toast("Consult rejected");
      } catch (err) {
        toast(`Reject failed: ${err.message}`);
      }
    });
    out.appendChild(card);
  });
}

function hideIncomingCallModal() {
  const modal = el("incoming-call-modal");
  if (modal) modal.classList.add("hidden");
  state.incomingRequestId = "";
}

function showIncomingCallModal(req) {
  const modal = el("incoming-call-modal");
  const text = el("incoming-call-text");
  const accept = el("incoming-accept");
  const reject = el("incoming-reject");
  if (!modal || !text || !accept || !reject || !req) return;
  text.textContent = `${req.patient_name || "Patient"} (ID: ${req.patient_id || "-"}) has requested a consultation.`;
  modal.classList.remove("hidden");
  state.incomingRequestId = String(req.request_id || "");
  accept.onclick = async () => {
    if (!state.doctorId || !req.request_id) return;
    try {
      await postJson(`/doctor/${state.doctorId}/consult/${req.request_id}`, { action: "accepted" });
      hideIncomingCallModal();
      await loadDoctorDashboard(state.doctorId);
      toast("Consult accepted");
    } catch (err) {
      toast(`Accept failed: ${err.message}`);
    }
  };
  reject.onclick = async () => {
    if (!state.doctorId || !req.request_id) return;
    try {
      await postJson(`/doctor/${state.doctorId}/consult/${req.request_id}`, { action: "rejected" });
      hideIncomingCallModal();
      await loadDoctorDashboard(state.doctorId);
      toast("Call rejected");
    } catch (err) {
      toast(`Reject failed: ${err.message}`);
    }
  };
}

function evaluateIncomingCalls() {
  const pending = (state.doctorConsultRequests || []).filter((r) => String(r.status || "").toLowerCase() === "pending");
  if (!pending.length) {
    hideIncomingCallModal();
    return;
  }
  const first = pending[0];
  const rid = String(first.request_id || "");
  if (!rid) return;
  if (state.incomingRequestId === rid) return;
  showIncomingCallModal(first);
}

async function loadDoctorPublicList() {
  try {
    const data = await getJson("/doctors/public");
    state.doctorPublicList = data.doctors || [];
  } catch {
    state.doctorPublicList = [];
  }
  const select = el("consult-doctor-select");
  if (!select) return;
  select.innerHTML = "";
  if (!state.doctorPublicList.length) {
    select.innerHTML = "<option value=''>No doctors available</option>";
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a doctor";
  select.appendChild(placeholder);
  state.doctorPublicList.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.doctor_id;
    opt.textContent = `${d.name} (${d.specialization || "General Physician"})`;
    select.appendChild(opt);
  });
  const selectedId = String(select.value || "");
  const selectedDoc = state.doctorPublicList.find((d) => String(d.doctor_id) === selectedId) || null;
  const phoneNode = el("consult-doctor-phone");
  if (selectedDoc) {
    if (phoneNode) phoneNode.textContent = `Doctor phone: ${selectedDoc.phone || "-"}`;
  } else {
    if (phoneNode) phoneNode.textContent = "Doctor phone: -";
  }
}

async function loadDoctorDashboard(doctorId) {
  const data = await getJson(`/doctor/${doctorId}/dashboard`);
  state.doctor = data.doctor || null;
  state.doctorPatients = data.patients || [];
  state.doctorConsultRequests = data.consult_requests || [];
  setTopStatus();

  const name = state.doctor ? `Dr. ${state.doctor.first_name || ""} ${state.doctor.last_name || ""}`.trim() : "Doctor";
  safeText("doctor-sidebar-user", `${name} (${state.doctor?.specialization || "General Physician"})`);
  safeText("doctor-status-pill", `ID: ${doctorId.slice(0, 8)}...`);
  const patientSelect = el("doctor-presc-patient-select");
  if (patientSelect) {
    patientSelect.innerHTML = "<option value=''>Select linked patient</option>";
    state.doctorPatients.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.patient_id;
      opt.textContent = `${p.name || "Patient"} (${p.patient_id.slice(0, 8)}...)`;
      patientSelect.appendChild(opt);
    });
  }
  renderDoctorOverview(state.doctor || {}, state.doctorPatients, state.doctorConsultRequests);
  renderDoctorPatients(state.doctorPatients);
  renderDoctorConsultRequests(state.doctorConsultRequests);
  evaluateIncomingCalls();
  switchView("view-doctor-dashboard");
  switchDoctorPanel("doctor-panel-overview");
  await refreshAnnouncements();
  if (!state.doctorPollHandle) {
    state.doctorPollHandle = window.setInterval(async () => {
      if (!state.doctorId) return;
      try {
        const data = await getJson(`/doctor/${state.doctorId}/dashboard`);
        state.doctorConsultRequests = data.consult_requests || [];
        renderDoctorConsultRequests(state.doctorConsultRequests);
        evaluateIncomingCalls();
        await refreshAnnouncements();
      } catch {
        // ignore transient polling errors
      }
    }, 12000);
  }
}

async function setLocationPermission(userId) {
  if (!navigator.geolocation) {
    await postJson(`/permissions/${userId}`, { location: false, lat: null, lng: null });
    toast("Geolocation not available in this browser");
    return;
  }

  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await postJson(`/permissions/${userId}`, {
            location: true,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
          toast("Location permission saved");
        } catch (err) {
          toast("Failed to save location permission");
          console.error(err);
        }
        resolve();
      },
      async () => {
        try {
          await postJson(`/permissions/${userId}`, {
            location: false,
            lat: null,
            lng: null
          });
        } catch (err) {
          console.error(err);
        }
        toast("Location permission denied");
        resolve();
      },
      { timeout: 9000 }
    );
  });
}

async function setBinaryPermission(userId, type) {
  const allowed = window.confirm(`Allow ${type} permission?`);
  if (type === "call") {
    await postJson(`/permissions/${userId}/call`, { call: allowed });
  } else {
    await postJson(`/permissions/${userId}/gallery`, { gallery: allowed });
  }
  toast(`${type[0].toUpperCase() + type.slice(1)} permission ${allowed ? "allowed" : "denied"}`);
}

function renderSearchResults(result) {
  const out = el("search-results");
  if (!out) return;
  out.innerHTML = "";

  const card = document.createElement("article");
  card.className = "result-card";

  const symptoms = (result.symptoms || []).map((s) => `<li>${s}</li>`).join("");
  const meds = (result.recommended_medicines || []).map((m) => `<li>${m}</li>`).join("");

  card.innerHTML = `
    <h3>Disease: ${result.disease || "Unknown"}</h3>
    <p><strong>Symptoms</strong></p>
    <ul>${symptoms || "<li>No symptoms listed</li>"}</ul>
    <p><strong>Recommended medicines</strong></p>
    <ul>${meds || "<li>No medicines listed</li>"}</ul>
    <h4>Nearby shops</h4>
  `;

  const shopsWrap = document.createElement("div");
  shopsWrap.className = "shop-list";

  if (!result.shops || result.shops.length === 0) {
    const noShop = document.createElement("div");
    noShop.className = "shop-item";
    noShop.textContent = "No shops found.";
    shopsWrap.appendChild(noShop);
  } else {
    result.shops.forEach((shop) => {
      const item = document.createElement("article");
      item.className = "shop-item";

      const medLine = shop.available_medicines?.length
        ? shop.available_medicines.join(", ")
        : "Not listed";
      const dist = formatDistanceKm(shop.distance_km);
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${shop.lat},${shop.lng}`;

      item.innerHTML = `
        <h4>${shop.name}</h4>
        <p><strong>Distance:</strong> ${dist}</p>
        <p><strong>Available:</strong> ${medLine}</p>
        <a href="${mapUrl}" target="_blank" rel="noopener">Open in Google Maps</a>
      `;
      shopsWrap.appendChild(item);
    });
  }

  card.appendChild(shopsWrap);
  out.appendChild(card);
}

function renderStoreSuggestions(items) {
  const out = el("store-suggestions");
  if (!out) return;
  out.innerHTML = "";
  if (!items || items.length === 0) return;
  const card = document.createElement("article");
  card.className = "result-card";
  card.innerHTML = "<h4>Suggestions</h4>";
  const list = document.createElement("div");
  list.className = "shop-list";
  items.forEach((name) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn ghost";
    btn.textContent = name;
    btn.addEventListener("click", () => {
      if (el("store-search-query")) el("store-search-query").value = name;
      runMedicalStoreSearch(name);
    });
    list.appendChild(btn);
  });
  card.appendChild(list);
  out.appendChild(card);
}

function renderMedicalStoreResult(result) {
  const out = el("store-search-result");
  if (!out) return;
  out.innerHTML = "";
  const card = document.createElement("article");
  card.className = "result-card";

  if (!result || !result.found) {
    card.innerHTML = "<h4>Store not found in database</h4>";
    out.appendChild(card);
    return;
  }

  const note = result.note && String(result.note).trim() ? result.note : "No note available.";
  const phone = result.phone && String(result.phone).trim() ? String(result.phone) : "";
  const callLink = phone ? `<a href="tel:${phone}" class="btn primary">Call ${phone}</a>` : "<p>Phone not available.</p>";
  card.innerHTML = `
    <h3>${result.store_name}</h3>
    <p><strong>Note:</strong> ${note}</p>
    <div>${callLink}</div>
  `;
  out.appendChild(card);
}

async function runMedicalStoreSearch(name) {
  const q = String(name || "").trim();
  if (!q) return;
  try {
    const result = await getJson(`/medical-stores/search?q=${encodeURIComponent(q)}`);
    renderMedicalStoreResult(result);
  } catch (err) {
    const out = el("store-search-result");
    if (out) out.innerHTML = `<div class="result-card">Search failed: ${err.message}</div>`;
  }
}

function renderNearbyStores(stores, userLat, userLng) {
  // Nearby stores now only use Google Maps link - no list rendering
  const list = el("nearby-store-list");
  if (list) list.innerHTML = "";
}

function bindEvents() {
  el("start-patient")?.addEventListener("click", () => {
    switchView("view-patient-auth");
    switchAuthTab("patient", "login");
  });

  el("start-vendor")?.addEventListener("click", () => {
    switchView("view-vendor-auth");
    switchAuthTab("vendor", "login");
  });

  el("start-doctor")?.addEventListener("click", () => {
    switchView("view-doctor-auth");
    switchAuthTab("doctor", "login");
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.getAttribute("data-back")));
  });

  el("btn-home")?.addEventListener("click", async () => {
    if (state.userId) {
      try {
        await loadPatientDashboard(state.userId);
      } catch {
        switchView("view-landing");
      }
      return;
    }
    if (state.vendorId) {
      try {
        await loadVendorDashboard(state.vendorId);
      } catch {
        switchView("view-landing");
      }
      return;
    }
    if (state.doctorId) {
      try {
        await loadDoctorDashboard(state.doctorId);
      } catch {
        switchView("view-landing");
      }
      return;
    }
    switchView("view-landing");
  });

  el("btn-signin")?.addEventListener("click", () => {
    switchView("view-patient-auth");
    switchAuthTab("patient", "login");
  });

  el("btn-logout")?.addEventListener("click", async () => {
    if (state.userId) {
      try {
        await postJson(`/logout/${state.userId}`, {});
      } catch (e) {
        console.error(e);
      }
    }
    localStorage.removeItem("user_id");
    localStorage.removeItem("vendor_id");
    localStorage.removeItem("doctor_id");
    state.userId = "";
    state.vendorId = "";
    state.doctorId = "";
    state.user = null;
    state.vendor = null;
    state.doctor = null;
    if (state.doctorPollHandle) {
      window.clearInterval(state.doctorPollHandle);
      state.doctorPollHandle = null;
    }
    hideIncomingCallModal();
    setTopStatus();
    switchView("view-landing");
    await refreshAnnouncements();
    toast("Session cleared");
  });

  el("patient-tab-login")?.addEventListener("click", () => switchAuthTab("patient", "login"));
  el("patient-tab-signup")?.addEventListener("click", () => switchAuthTab("patient", "signup"));
  el("vendor-tab-login")?.addEventListener("click", () => switchAuthTab("vendor", "login"));
  el("vendor-tab-signup")?.addEventListener("click", () => switchAuthTab("vendor", "signup"));
  el("doctor-tab-login")?.addEventListener("click", () => switchAuthTab("doctor", "login"));
  el("doctor-tab-signup")?.addEventListener("click", () => switchAuthTab("doctor", "signup"));

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.getAttribute("data-panel");
      if (panel) switchDashboardPanel(panel);
    });
  });

  document.querySelectorAll(".vendor-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.getAttribute("data-vendor-panel");
      if (panel) switchVendorPanel(panel);
    });
  });

  document.querySelectorAll(".doctor-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.getAttribute("data-doctor-panel");
      if (panel) switchDoctorPanel(panel);
    });
  });

  el("patient-signup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      first_name: String(fd.get("first_name") || "").trim(),
      last_name: String(fd.get("last_name") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      password: String(fd.get("password") || "").trim()
    };

    try {
      const res = await postJson("/patient/signup", payload);
      state.userId = res.user_id;
      state.user = res.user || null;
      state.vendorId = "";
      state.vendor = null;
      state.doctorId = "";
      state.doctor = null;
      localStorage.setItem("user_id", state.userId);
      localStorage.removeItem("vendor_id");
      localStorage.removeItem("vendor_token");
      localStorage.removeItem("doctor_id");
      localStorage.removeItem("doctor_token");
      localStorage.setItem("patient_phone", payload.phone);
      localStorage.setItem("patient_password", payload.password);
      localStorage.setItem("user_type", "patient");
      localStorage.setItem("last_login", new Date().toISOString());
      if (res.user) profileCache.set(state.userId, res.user);

      safeText("patient-signup-msg", "Account created and signed in.");
      toast("Patient account created and logged in");
      await loadPatientDashboard(state.userId);
    } catch (err) {
      safeText("patient-signup-msg", `Signup failed: ${err.message}`);
    }
  });

  el("patient-login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      phone: String(fd.get("phone") || "").trim(),
      password: String(fd.get("password") || "").trim()
    };

    try {
      const res = await postJson("/patient/login", payload);
      state.userId = res.user_id;
      state.user = res.user || null;
      state.vendorId = "";
      state.vendor = null;
      state.doctorId = "";
      state.doctor = null;
      localStorage.setItem("user_id", state.userId);
      localStorage.removeItem("vendor_id");
      localStorage.removeItem("vendor_token");
      localStorage.removeItem("doctor_id");
      localStorage.removeItem("doctor_token");
      localStorage.setItem("patient_phone", payload.phone);
      localStorage.setItem("patient_password", payload.password);
      localStorage.setItem("user_type", "patient");
      localStorage.setItem("last_login", new Date().toISOString());
      if (res.user) profileCache.set(state.userId, res.user);

      safeText("patient-login-msg", "Login successful.");
      await loadPatientDashboard(state.userId);
      toast("Welcome back");
    } catch (err) {
      safeText("patient-login-msg", `Login failed: ${err.message}`);
    }
  });

  el("vendor-signup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      first_name: fd.get("first_name"),
      last_name: fd.get("last_name"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      shop_name: fd.get("shop_name"),
      shop_address: fd.get("shop_address"),
      license_no: fd.get("license_no"),
      password: fd.get("password")
    };

    try {
      await postJson("/vendor/signup", payload);
      localStorage.setItem("vendor_phone", String(payload.phone || ""));
      localStorage.setItem("vendor_password", String(payload.password || ""));
      safeText("vendor-signup-msg", "Vendor account created. Waiting for admin approval.");
      switchAuthTab("vendor", "login");
      toast("Vendor signup successful");
    } catch (err) {
      safeText("vendor-signup-msg", `Signup failed: ${err.message}`);
    }
  });

  el("vendor-login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      phone: String(fd.get("phone") || "").trim(),
      password: String(fd.get("password") || "").trim()
    };

    try {
      const res = await postJson("/vendor/login", payload);
      state.vendorId = res.vendor_id;
      state.vendorToken = res.token || "";
      state.userId = "";
      state.user = null;
      state.doctorId = "";
      state.doctor = null;
      localStorage.setItem("vendor_id", state.vendorId);
      localStorage.removeItem("user_id");
      localStorage.removeItem("user_token");
      localStorage.removeItem("doctor_id");
      localStorage.removeItem("doctor_token");
      localStorage.setItem("vendor_phone", payload.phone);
      localStorage.setItem("vendor_password", payload.password);
      localStorage.setItem("user_type", "vendor");
      localStorage.setItem("last_login", new Date().toISOString());

      if (res.vendor) {
        profileCache.set(state.vendorId, res.vendor);
      }

      safeText("vendor-login-msg", "Vendor login successful.");
      try {
        await loadVendorDashboard(state.vendorId);
        toast("Vendor dashboard ready");
      } catch (dashErr) {
        console.error("Vendor dashboard load failed:", dashErr);
        setTopStatus();
        switchView("view-landing");
        toast("Logged in. Refresh server/page once if vendor dashboard does not open.");
      }
    } catch (err) {
      safeText("vendor-login-msg", `Login failed: ${err.message}`);
    }
  });

  el("doctor-signup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      first_name: String(fd.get("first_name") || "").trim(),
      last_name: String(fd.get("last_name") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      specialization: String(fd.get("specialization") || "").trim(),
      license_no: String(fd.get("license_no") || "").trim(),
      password: String(fd.get("password") || "")
    };
    try {
      await postJson("/doctor/signup", payload);
      localStorage.setItem("doctor_phone", payload.phone);
      localStorage.setItem("doctor_password", payload.password);
      safeText("doctor-signup-msg", "Doctor account created. Waiting for admin approval.");
      switchAuthTab("doctor", "login");
      toast("Doctor signup submitted");
    } catch (err) {
      safeText("doctor-signup-msg", `Signup failed: ${err.message}`);
    }
  });

  el("doctor-login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      phone: String(fd.get("phone") || "").trim(),
      password: String(fd.get("password") || "").trim()
    };
    try {
      const res = await postJson("/doctor/login", payload);
      state.doctorId = res.doctor_id;
      state.userId = "";
      state.user = null;
      state.vendorId = "";
      state.vendor = null;
      localStorage.setItem("doctor_id", state.doctorId);
      localStorage.removeItem("user_id");
      localStorage.removeItem("user_token");
      localStorage.removeItem("vendor_id");
      localStorage.removeItem("vendor_token");
      localStorage.setItem("doctor_phone", payload.phone);
      localStorage.setItem("doctor_password", payload.password);
      safeText("doctor-login-msg", "Doctor login successful.");
      await loadDoctorDashboard(state.doctorId);
      toast("Doctor dashboard ready");
    } catch (err) {
      safeText("doctor-login-msg", `Login failed: ${err.message}`);
    }
  });

  el("vendor-store-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.vendorId) return;
    const fd = new FormData(event.target);
    const payload = {
      shop_name: String(fd.get("shop_name") || ""),
      shop_address: String(fd.get("shop_address") || ""),
      lat: fd.get("lat") === "" ? null : Number(fd.get("lat")),
      lng: fd.get("lng") === "" ? null : Number(fd.get("lng")),
      open_hours: String(fd.get("open_hours") || ""),
      contact_note: String(fd.get("contact_note") || "")
    };
    try {
      await postJson(`/vendor/${state.vendorId}/store`, payload);
      safeText("vendor-store-msg", "Store details saved.");
      await loadVendorDashboard(state.vendorId);
      toast("Store updated");
    } catch (err) {
      safeText("vendor-store-msg", `Save failed: ${err.message}`);
    }
  });

  el("vendor-use-current-location")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      safeText("vendor-store-msg", "Geolocation is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (el("vendor-store-lat")) el("vendor-store-lat").value = String(lat);
        if (el("vendor-store-lng")) el("vendor-store-lng").value = String(lng);
        updateVendorLocationUI(lat, lng);
        safeText("vendor-store-msg", "Current location captured. Save store details to persist.");
        toast("Location captured");
      },
      () => {
        safeText("vendor-store-msg", "Location permission denied. Please allow location access.");
      },
      { timeout: 10000 }
    );
  });

  el("vendor-open-maps")?.addEventListener("click", () => {
    const lat = el("vendor-store-lat")?.value;
    const lng = el("vendor-store-lng")?.value;
    if (!lat || !lng) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    window.open(url, "_blank", "noopener");
  });

  el("vendor-medicine-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.vendorId) return;
    const fd = new FormData(event.target);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      units: Number(fd.get("units")),
      medicine_per_unit: String(fd.get("medicine_per_unit") || "").trim(),
      price: fd.get("price") === "" ? null : Number(fd.get("price"))
    };
    if (!payload.name) {
      safeText("vendor-medicine-msg", "Medicine name is required.");
      return;
    }
    if (!Number.isFinite(payload.units) || payload.units < 0) {
      safeText("vendor-medicine-msg", "Units must be 0 or more.");
      return;
    }
    if (!payload.medicine_per_unit) {
      safeText("vendor-medicine-msg", "Medicine per unit is required.");
      return;
    }
    try {
      await postJson(`/vendor/${state.vendorId}/medicines`, payload);
      safeText("vendor-medicine-msg", "Medicine inventory updated.");
      event.target.reset();
      await loadVendorDashboard(state.vendorId);
      switchVendorPanel("vendor-panel-medicines");
      toast("Medicine saved");
    } catch (err) {
      safeText("vendor-medicine-msg", `Update failed: ${err.message}`);
    }
  });

  el("btn-refresh-location")?.addEventListener("click", async () => {
    if (!state.userId) return;
    await setLocationPermission(state.userId);
    await loadPatientDashboard(state.userId);
  });

  el("btn-set-call")?.addEventListener("click", async () => {
    if (!state.userId) return;
    await setBinaryPermission(state.userId, "call");
    await loadPatientDashboard(state.userId);
  });

  el("btn-set-gallery")?.addEventListener("click", async () => {
    if (!state.userId) return;
    await setBinaryPermission(state.userId, "gallery");
    await loadPatientDashboard(state.userId);
  });

  el("btn-request-consult")?.addEventListener("click", async () => {
    if (!state.userId) {
      toast("Please login first");
      return;
    }
    const doctorId = String(el("consult-doctor-select")?.value || "").trim();
    if (!doctorId) {
      safeText("consult-request-msg", "Please select a doctor.");
      return;
    }
    const reason = String(el("consult-reason")?.value || "").trim();
    try {
      await postJson("/consult/request", {
        user_id: state.userId,
        doctor_id: doctorId,
        reason
      });
      safeText("consult-request-msg", "Consult request sent. The doctor will review it shortly.");
      toast("Consult request sent");
    } catch (err) {
      safeText("consult-request-msg", `Request failed: ${err.message}`);
    }
  });

  el("consult-doctor-select")?.addEventListener("change", () => {
    const selectedId = String(el("consult-doctor-select")?.value || "");
    const doc = state.doctorPublicList.find((d) => String(d.doctor_id) === selectedId) || null;
    const phoneNode = el("consult-doctor-phone");
    if (!doc) {
      if (phoneNode) phoneNode.textContent = "Doctor phone: -";
      return;
    }
    if (phoneNode) phoneNode.textContent = `Doctor phone: ${doc.phone || "-"}`;
  });

  el("btn-upload")?.addEventListener("click", async () => {
    if (!state.userId) {
      toast("Please login first");
      return;
    }

    const input = el("file-input");
    if (!input || !input.files || input.files.length === 0) {
      safeText("upload-msg", "Please pick a file first.");
      return;
    }

    const form = new FormData();
    form.append("file", input.files[0]);

    try {
      const res = await fetch(`/upload/${state.userId}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      safeText("upload-msg", `Uploaded: ${out.filename}`);
      await loadMedicalHistory(state.userId);
      toast("File uploaded");
    } catch (err) {
      safeText("upload-msg", `Upload failed: ${err.message}`);
    }
  });

  el("search-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.userId) {
      toast("Please login first");
      return;
    }

    const fd = new FormData(event.target);
    const disease = String(fd.get("disease") || "").trim();
    if (!disease) return;

    try {
      await setLocationPermission(state.userId);
    } catch (err) {
      console.error(err);
    }

    try {
      const result = await postJson("/search", {
        user_id: state.userId,
        disease
      });
      renderSearchResults(result);
      toast("Search complete");
      switchDashboardPanel("panel-search");
    } catch (err) {
      safeText("search-results", `Search failed: ${err.message}`);
    }
  });

  el("store-search-query")?.addEventListener("input", async (event) => {
    const q = String(event.target.value || "").trim();
    if (q.length < 1) {
      renderStoreSuggestions([]);
      return;
    }
    try {
      const data = await getJson(`/medical-stores/suggest?q=${encodeURIComponent(q)}`);
      renderStoreSuggestions(data.suggestions || []);
    } catch {
      renderStoreSuggestions([]);
    }
  });

  el("store-search-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = String(el("store-search-query")?.value || "").trim();
    await runMedicalStoreSearch(q);
    switchDashboardPanel("panel-store-search");
  });

  // Near-store button just uses the href link to Google Maps
  // No additional action needed beyond clicking the link

  el("doctor-prescription-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.doctorId) return;
    const fd = new FormData(event.target);
    const patientId = String(fd.get("patient_id") || "").trim();
    const consultationId = String(fd.get("consultation_id") || "").trim();
    const note = String(fd.get("note") || "").trim();
    const medicines = String(fd.get("medicines") || "").trim();
    const followUp = String(fd.get("follow_up") || "").trim();
    const photoInput = el("doctor-presc-photos");
    if (!patientId || !note) {
      safeText("doctor-prescription-msg", "Patient ID and note are required.");
      return;
    }
    try {
      const form = new FormData();
      form.append("patient_id", patientId);
      if (consultationId) form.append("consultation_id", consultationId);
      form.append("note", note);
      form.append("medicines", medicines);
      form.append("follow_up", followUp);
      if (photoInput?.files?.length) {
        Array.from(photoInput.files).forEach((f) => form.append("files", f));
      }
      const res = await fetch(`/doctor/${state.doctorId}/prescription_with_files`, {
        method: "POST",
        body: form
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      const prescId = out?.prescription?.prescription_id || "saved";
      const count = Array.isArray(out?.uploaded_files) ? out.uploaded_files.length : 0;
      safeText("doctor-prescription-msg", `Prescription sent (${prescId}). Uploaded photos: ${count}.`);
      event.target.reset();
      await loadDoctorDashboard(state.doctorId);
      switchDoctorPanel("doctor-panel-prescribe");
      toast("Prescription shared");
    } catch (err) {
      safeText("doctor-prescription-msg", `Failed: ${err.message}`);
    }
  });

  el("doctor-presc-patient-select")?.addEventListener("change", () => {
    const patientId = String(el("doctor-presc-patient-select")?.value || "");
    if (patientId && el("doctor-presc-patient-id")) {
      el("doctor-presc-patient-id").value = patientId;
    }
  });

  el("doctor-presc-photos")?.addEventListener("change", () => {
    const preview = el("doctor-presc-photo-preview");
    if (!preview) return;
    preview.innerHTML = "";
    const files = el("doctor-presc-photos")?.files;
    if (!files || !files.length) return;

    Array.from(files).forEach((file) => {
      const thumb = document.createElement("div");
      thumb.className = "photo-preview-thumb";
      const fileName = document.createElement("span");
      fileName.textContent = file.name;
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        img.onload = () => URL.revokeObjectURL(img.src);
        thumb.appendChild(img);
      }
      thumb.appendChild(fileName);
      preview.appendChild(thumb);
    });
  });
}

function restoreRememberedCreds() {
  const patientPhone = localStorage.getItem("patient_phone");
  const patientPw = localStorage.getItem("patient_password");
  const vendorPhone = localStorage.getItem("vendor_phone");
  const vendorPw = localStorage.getItem("vendor_password");
  const doctorPhone = localStorage.getItem("doctor_phone");
  const doctorPw = localStorage.getItem("doctor_password");

  if (patientPhone && el("patient-login-phone")) el("patient-login-phone").value = patientPhone;
  if (patientPw && el("patient-login-password")) el("patient-login-password").value = patientPw;
  if (vendorPhone && el("vendor-login-phone")) el("vendor-login-phone").value = vendorPhone;
  if (vendorPw && el("vendor-login-password")) el("vendor-login-password").value = vendorPw;
  if (doctorPhone && el("doctor-login-phone")) el("doctor-login-phone").value = doctorPhone;
  if (doctorPw && el("doctor-login-password")) el("doctor-login-password").value = doctorPw;
}

window.addEventListener("load", async () => {
  bindEvents();
  restoreRememberedCreds();
  setTopStatus();
  await loadDoctorPublicList();
  await refreshAnnouncements();
  window.setInterval(() => { refreshAnnouncements(); }, 20000);

  if (state.userId) {
    try {
      await loadPatientDashboard(state.userId);
      toast("Restored previous patient session");
      return;
    } catch (err) {
      console.error(err);
      localStorage.removeItem("user_id");
      state.userId = "";
      state.user = null;
      setTopStatus();
    }
  }

  if (state.vendorId) {
    try {
      await loadVendorDashboard(state.vendorId);
      toast("Restored previous vendor session");
      return;
    } catch (err) {
      console.error(err);
      localStorage.removeItem("vendor_id");
      state.vendorId = "";
      state.vendor = null;
      setTopStatus();
    }
  }

  if (state.doctorId) {
    try {
      await loadDoctorDashboard(state.doctorId);
      toast("Restored previous doctor session");
      return;
    } catch (err) {
      console.error(err);
      localStorage.removeItem("doctor_id");
      state.doctorId = "";
      state.doctor = null;
      setTopStatus();
    }
  }

  switchView("view-landing");

  // Theme Toggle Handler
  el("btn-theme-toggle")?.addEventListener("click", () => {
    const html = document.documentElement;
    html.classList.toggle("dark-mode");
    const isDark = html.classList.contains("dark-mode");
    const btn = el("btn-theme-toggle");
    const icon = el("btn-theme-toggle")?.querySelector(".theme-icon");
    
    if (isDark) {
      btn?.classList.add("dark-mode-active");
      if (icon) icon.textContent = "🌙";
    } else {
      btn?.classList.remove("dark-mode-active");
      if (icon) icon.textContent = "☀️";
    }
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });

  // Set initial theme based on saved preference
  const savedTheme = localStorage.getItem("theme") || "light";
  if (savedTheme === "dark") {
    document.documentElement.classList.add("dark-mode");
    const btn = el("btn-theme-toggle");
    const icon = el("btn-theme-toggle")?.querySelector(".theme-icon");
    btn?.classList.add("dark-mode-active");
    if (icon) icon.textContent = "🌙";
  }
});
