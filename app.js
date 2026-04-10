const apiBase = "";

const state = {
  activeView: "view-landing",
  activePanel: "panel-profile",
  userId: localStorage.getItem("user_id") || "",
  vendorId: localStorage.getItem("vendor_id") || "",
  user: null,
  vendor: null,
  medicalHistory: []
};

const ids = [
  "view-landing",
  "view-patient-auth",
  "view-vendor-auth",
  "view-vendor-dashboard",
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
  if (!status || !logout) return;

  if (state.userId && state.user) {
    status.textContent = `Patient: ${state.user.first_name || "Signed in"}`;
    status.classList.remove("muted");
    logout.classList.remove("hidden");
    return;
  }

  if (state.vendorId) {
    const displayName = state.vendor?.shop_name || state.vendor?.first_name || "Vendor";
    status.textContent = `Vendor: ${displayName}`;
    status.classList.remove("muted");
    logout.classList.remove("hidden");
    return;
  }

  status.textContent = "Not signed in";
  status.classList.add("muted");
  logout.classList.add("hidden");
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
  } else {
    safeText("vendor-login-msg", "");
    safeText("vendor-signup-msg", "");
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
  await loadMedicalHistory(userId);
  switchView("view-dashboard");
  switchDashboardPanel("panel-profile");
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
  const list = el("nearby-store-list");
  if (list) {
    list.innerHTML = "";
    if (stores && stores.length > 0) {
      stores.forEach((s) => {
        const trusted = s.trusted ? "<span class='pill'>Trusted</span>" : "";
        const note = s.note ? s.note : "No note available.";
        const phone = s.phone ? `<a href=\"tel:${s.phone}\" class=\"btn primary\">Call ${s.phone}</a>` : "<span>Phone not available</span>";
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${s.lat},${s.lng}`)}`;
        const card = document.createElement("article");
        card.className = "result-card";
        card.innerHTML = `
          <div class="section-head"><h4>${s.store_name}</h4>${trusted}</div>
          <p><strong>Distance:</strong> ${formatDistanceKm(s.distance_km)}</p>
          <p><strong>Note:</strong> ${note}</p>
          <div>${phone}</div>
          <div style="margin-top:8px"><a href="${mapsUrl}" rel="noopener">Open Store in Google Maps</a></div>
        `;
        list.appendChild(card);
      });
    }
  }
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
    state.userId = "";
    state.vendorId = "";
    state.user = null;
    state.vendor = null;
    setTopStatus();
    switchView("view-landing");
    toast("Session cleared");
  });

  el("patient-tab-login")?.addEventListener("click", () => switchAuthTab("patient", "login"));
  el("patient-tab-signup")?.addEventListener("click", () => switchAuthTab("patient", "signup"));
  el("vendor-tab-login")?.addEventListener("click", () => switchAuthTab("vendor", "login"));
  el("vendor-tab-signup")?.addEventListener("click", () => switchAuthTab("vendor", "signup"));

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

  el("patient-signup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      first_name: fd.get("first_name"),
      last_name: fd.get("last_name"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      password: fd.get("password")
    };

    try {
      await postJson("/patient/signup", payload);
      localStorage.setItem("patient_phone", String(payload.phone || ""));
      localStorage.setItem("patient_password", String(payload.password || ""));
      safeText("patient-signup-msg", "Account created. Please login now.");
      switchAuthTab("patient", "login");
      toast("Patient account created");
    } catch (err) {
      safeText("patient-signup-msg", `Signup failed: ${err.message}`);
    }
  });

  el("patient-login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const payload = {
      phone: String(fd.get("phone") || ""),
      password: String(fd.get("password") || "")
    };

    try {
      const res = await postJson("/patient/login", payload);
      state.userId = res.user_id;
      localStorage.setItem("user_id", state.userId);
      localStorage.setItem("patient_phone", payload.phone);
      localStorage.setItem("patient_password", payload.password);

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
      phone: String(fd.get("phone") || ""),
      password: String(fd.get("password") || "")
    };

    try {
      const res = await postJson("/vendor/login", payload);
      state.vendorId = res.vendor_id;
      localStorage.setItem("vendor_id", state.vendorId);
      localStorage.setItem("vendor_phone", payload.phone);
      localStorage.setItem("vendor_password", payload.password);

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

  el("btn-call")?.addEventListener("click", () => {
    window.location.href = "tel:7839010007";
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

  el("btn-nearby-stores")?.addEventListener("click", async () => {
    const nearbyBtn = el("btn-nearby-stores");
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const data = await getJson(`/medical-stores/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius_km=10`);
          switchDashboardPanel("panel-store-search");
          renderNearbyStores(data.stores || [], lat, lng);
          const mapsNearby = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`medical stores near ${lat},${lng}`)}`;
          if (nearbyBtn) nearbyBtn.href = mapsNearby;
        } catch (err) {
          toast(`Nearby search failed: ${err.message}`);
        }
      },
      () => {},
      { timeout: 10000 }
    );
  });
}

function restoreRememberedCreds() {
  const patientPhone = localStorage.getItem("patient_phone");
  const patientPw = localStorage.getItem("patient_password");
  const vendorPhone = localStorage.getItem("vendor_phone");
  const vendorPw = localStorage.getItem("vendor_password");

  if (patientPhone && el("patient-login-phone")) el("patient-login-phone").value = patientPhone;
  if (patientPw && el("patient-login-password")) el("patient-login-password").value = patientPw;
  if (vendorPhone && el("vendor-login-phone")) el("vendor-login-phone").value = vendorPhone;
  if (vendorPw && el("vendor-login-password")) el("vendor-login-password").value = vendorPw;
}

window.addEventListener("load", async () => {
  bindEvents();
  restoreRememberedCreds();
  setTopStatus();

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

  switchView("view-landing");
});
