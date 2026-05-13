(function () {
  "use strict";

  var STORAGE_KEY = "server-wiki-doc-v2";

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function normalizeSection(s) {
    return {
      id: s.id || uuid(),
      title: (s.title && String(s.title).trim()) || "Section",
      body: typeof s.body === "string" ? s.body : "",
    };
  }

  function sectionsFromLegacy(entity) {
    if (Array.isArray(entity.sections) && entity.sections.length) {
      return entity.sections.map(normalizeSection);
    }
    var b = typeof entity.body === "string" ? entity.body : "";
    return [{ id: uuid(), title: "Overview", body: b }];
  }

  function defaultState() {
    return {
      siteTitle: "Server Wiki",
      servers: [
        {
          id: uuid(),
          name: "Example homelab",
          hostname: "homelab.local",
          ip: "192.168.1.10",
          os: "Debian 12",
          sections: [
            {
              id: uuid(),
              title: "Overview",
              body:
                "Short description of this machine.\n\n- **Role:** app host\n- **Access:** SSH via LAN",
            },
            {
              id: uuid(),
              title: "Maintenance",
              body: "Document backups and upgrade notes here.",
            },
          ],
          apps: [
            {
              id: uuid(),
              name: "Example web app",
              url: "https://app.homelab.local",
              port: "443",
              runtime: "Docker",
              sections: [
                {
                  id: uuid(),
                  title: "Deploy",
                  body: "How this service is deployed.\n\n```bash\ndocker compose up -d\n```",
                },
              ],
            },
          ],
        },
      ],
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.servers)) return migrateLoaded(parsed);
      }
      raw = localStorage.getItem("server-wiki-doc-v1");
      if (raw) {
        var legacy = JSON.parse(raw);
        if (legacy && Array.isArray(legacy.servers)) return migrateLoaded(legacy);
      }
    } catch (e) {}
    return defaultState();
  }

  function migrateLoaded(parsed) {
    return {
      siteTitle: typeof parsed.siteTitle === "string" && parsed.siteTitle.trim() ? parsed.siteTitle : "Server Wiki",
      servers: parsed.servers.map(normalizeServer),
    };
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  var state = loadState();
  /** @type {{ type: 'server'|'app', serverId: string, appId?: string } | null} */
  var selection = null;
  var dirty = false;
  var collapsed = {};
  var filterText = "";
  var syncingWikiTitle = false;
  /** @type {null | (() => void)} */
  var pendingAction = null;

  var els = {
    navTree: document.getElementById("nav-tree"),
    breadcrumb: document.getElementById("breadcrumb"),
    emptyMessage: document.getElementById("empty-message"),
    editorPanel: document.getElementById("editor-panel"),
    metaFields: document.getElementById("meta-fields"),
    bodyPreview: document.getElementById("body-preview"),
    sectionsRoot: document.getElementById("sections-root"),
    guideIndex: document.getElementById("guide-index"),
    saveStatus: document.getElementById("save-status"),
    btnSave: document.getElementById("btn-save"),
    btnDelete: document.getElementById("btn-delete"),
    btnNewServer: document.getElementById("btn-new-server"),
    btnNewAppToolbar: document.getElementById("btn-new-app-toolbar"),
    btnAddSection: document.getElementById("btn-add-section"),
    btnExport: document.getElementById("btn-export"),
    importFile: document.getElementById("import-file"),
    articleRoot: document.getElementById("article-root"),
    secondaryActions: document.getElementById("secondary-actions"),
    sidebarFilter: document.getElementById("sidebar-filter"),
    modalConfirm: document.getElementById("modal-confirm"),
    modalTitle: document.getElementById("modal-title"),
    modalBody: document.getElementById("modal-body"),
    modalOk: document.getElementById("modal-ok"),
    modalUnsaved: document.getElementById("modal-unsaved"),
    wikiSiteTitleInput: document.getElementById("wiki-site-title-input"),
    wikiSiteTitleBlock: document.getElementById("wiki-site-title-block"),
    sectionsToolbar: document.getElementById("sections-toolbar"),
  };

  var tabs = document.querySelectorAll(".tab");

  function applyDocumentTitle() {
    var t = (state.siteTitle && state.siteTitle.trim()) || "Server Wiki";
    document.title = t;
  }

  function markSaved() {
    dirty = false;
    els.saveStatus.textContent = "Saved";
    els.saveStatus.classList.remove("dirty");
    els.btnSave.hidden = true;
  }

  function markDirty() {
    dirty = true;
    els.saveStatus.textContent = "Unsaved changes";
    els.saveStatus.classList.add("dirty");
    els.btnSave.hidden = false;
  }

  function tryNavigate(applyFn) {
    if (!dirty) {
      applyFn();
      return;
    }
    pendingAction = applyFn;
    els.modalUnsaved.returnValue = "";
    els.modalUnsaved.showModal();
  }

  function resolvePendingUnsaved() {
    var v = els.modalUnsaved.returnValue;
    if (v === "save") {
      persistFromForm();
      markSaved();
    } else if (v === "discard") {
      markSaved();
    } else {
      pendingAction = null;
      return;
    }
    var fn = pendingAction;
    pendingAction = null;
    if (fn) fn();
  }

  els.modalUnsaved.addEventListener("close", resolvePendingUnsaved);

  function getServer(id) {
    return state.servers.find(function (s) {
      return s.id === id;
    });
  }

  function getApp(server, appId) {
    return server.apps.find(function (a) {
      return a.id === appId;
    });
  }

  function normalizeServer(s) {
    return {
      id: s.id || uuid(),
      name: s.name || "Untitled server",
      hostname: s.hostname || "",
      ip: s.ip || "",
      os: s.os || "",
      sections: sectionsFromLegacy(s),
      apps: Array.isArray(s.apps) ? s.apps.map(normalizeApp) : [],
    };
  }

  function normalizeApp(a) {
    return {
      id: a.id || uuid(),
      name: a.name || "Untitled app",
      url: a.url || "",
      port: a.port || "",
      runtime: a.runtime || "",
      sections: sectionsFromLegacy(a),
    };
  }

  function syncWikiTitleInput() {
    syncingWikiTitle = true;
    els.wikiSiteTitleInput.value = state.siteTitle || "";
    syncingWikiTitle = false;
  }

  function persistFromForm() {
    state.siteTitle = els.wikiSiteTitleInput.value.trim() || "Server Wiki";
    applyDocumentTitle();

    if (!selection) {
      saveState(state);
      return;
    }

    var server = getServer(selection.serverId);
    if (!server) return;

    var titleEl = document.getElementById("title-input");

    if (selection.type === "server") {
      server.name = titleEl ? titleEl.value.trim() || "Untitled server" : server.name;
      server.hostname = val("meta-hostname");
      server.ip = val("meta-ip");
      server.os = val("meta-os");
      server.sections = collectSectionsFromDom();
    } else if (selection.type === "app" && selection.appId) {
      var app = getApp(server, selection.appId);
      if (!app) return;
      app.name = titleEl ? titleEl.value.trim() || "Untitled app" : app.name;
      app.url = val("meta-url");
      app.port = val("meta-port");
      app.runtime = val("meta-runtime");
      app.sections = collectSectionsFromDom();
    }

    saveState(state);
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function collectSectionsFromDom() {
    var list = [];
    els.sectionsRoot.querySelectorAll(".wiki-section").forEach(function (el) {
      var sid = el.getAttribute("data-section-id");
      var titleInp = el.querySelector("[data-sec-title]");
      var bodyTa = el.querySelector("[data-sec-body]");
      list.push({
        id: sid || uuid(),
        title: titleInp ? titleInp.value.trim() || "Section" : "Section",
        body: bodyTa ? bodyTa.value : "",
      });
    });
    if (!list.length) list.push({ id: uuid(), title: "Overview", body: "" });
    return list;
  }

  function buildMarkdownFromSectionsForPreview() {
    var parts = [];
    els.sectionsRoot.querySelectorAll(".wiki-section").forEach(function (el) {
      var titleInp = el.querySelector("[data-sec-title]");
      var bodyTa = el.querySelector("[data-sec-body]");
      var title = titleInp ? titleInp.value.trim() || "Section" : "Section";
      var body = bodyTa ? bodyTa.value.trim() : "";
      parts.push("## " + title + "\n\n" + (body || "*No content yet.*"));
    });
    return parts.join("\n\n");
  }

  function matchesFilter(text) {
    if (!filterText) return true;
    var q = filterText.toLowerCase();
    return text.toLowerCase().indexOf(q) !== -1;
  }

  function renderTree() {
    els.navTree.innerHTML = "";
    state.servers.forEach(function (server) {
      var serverMatch = matchesFilter(server.name + " " + server.hostname + " " + server.ip);
      var appsShown = server.apps.filter(function (app) {
        return matchesFilter(app.name + " " + app.url + " " + app.port);
      });
      if (!serverMatch && appsShown.length === 0) return;

      var section = document.createElement("div");
      section.className = "tree-section";
      if (collapsed[server.id]) section.classList.add("collapsed");

      var btnSrv = document.createElement("button");
      btnSrv.type = "button";
      btnSrv.className = "tree-server";
      if (
        selection &&
        selection.type === "server" &&
        selection.serverId === server.id
      ) {
        btnSrv.classList.add("active");
      }
      btnSrv.innerHTML =
        '<span class="tree-chevron" aria-hidden="true">▼</span>' +
        '<span class="tree-server-text">' +
        '<div class="tree-server-name"></div>' +
        '<div class="tree-server-meta"></div>' +
        "</span>";
      btnSrv.querySelector(".tree-server-name").textContent = server.name;
      var metaBits = [server.hostname, server.ip].filter(Boolean).join(" · ");
      btnSrv.querySelector(".tree-server-meta").textContent = metaBits || "Server";

      btnSrv.addEventListener("click", function () {
        selectServer(server.id);
      });

      var chevron = btnSrv.querySelector(".tree-chevron");
      chevron.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        section.classList.toggle("collapsed");
        collapsed[server.id] = section.classList.contains("collapsed");
      });

      var appsWrap = document.createElement("div");
      appsWrap.className = "tree-apps";

      var appsSource = serverMatch ? server.apps : appsShown;
      appsSource.forEach(function (app) {
        if (!serverMatch && !matchesFilter(app.name + " " + app.url + " " + app.port)) return;
        var btnApp = document.createElement("button");
        btnApp.type = "button";
        btnApp.className = "tree-app";
        btnApp.textContent = app.name;
        if (
          selection &&
          selection.type === "app" &&
          selection.serverId === server.id &&
          selection.appId === app.id
        ) {
          btnApp.classList.add("active");
        }
        btnApp.addEventListener("click", function () {
          selectApp(server.id, app.id);
        });
        appsWrap.appendChild(btnApp);
      });

      section.appendChild(btnSrv);
      section.appendChild(appsWrap);
      els.navTree.appendChild(section);
    });

    if (!els.navTree.children.length) {
      var empty = document.createElement("p");
      empty.style.padding = "0.5rem 0.65rem";
      empty.style.color = "var(--ink-soft)";
      empty.style.fontSize = "0.9rem";
      empty.style.fontStyle = "italic";
      empty.textContent = "No servers match your filter.";
      els.navTree.appendChild(empty);
    }
  }

  function renderGuideIndex() {
    els.guideIndex.innerHTML = "";
    var sectionEls = els.sectionsRoot.querySelectorAll(".wiki-section");
    if (!sectionEls.length) {
      els.guideIndex.hidden = true;
      return;
    }
    sectionEls.forEach(function (sec) {
      var sid = sec.getAttribute("data-section-id");
      var titleInp = sec.querySelector("[data-sec-title]");
      var title = titleInp ? titleInp.value.trim() || "Section" : "Section";
      var a = document.createElement("a");
      a.className = "guide-index-link";
      a.href = "#wiki-sec-" + sid;
      a.textContent = title;
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.getElementById("wiki-sec-" + sid);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      els.guideIndex.appendChild(a);
    });
    els.guideIndex.hidden = false;
  }

  function setTab(mode) {
    tabs.forEach(function (t) {
      var active = t.getAttribute("data-tab") === mode;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    var isPreview = mode === "preview";
    els.sectionsRoot.hidden = isPreview;
    els.btnAddSection.hidden = isPreview;
    if (els.sectionsToolbar) els.sectionsToolbar.hidden = isPreview;
    if (isPreview) els.guideIndex.hidden = true;
    else els.guideIndex.hidden = els.guideIndex.querySelector("a") === null;
    els.bodyPreview.hidden = !isPreview;
    if (isPreview) {
      var raw = buildMarkdownFromSectionsForPreview();
      if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        try {
          els.bodyPreview.innerHTML = marked.parse(raw, { breaks: true });
        } catch (e) {
          els.bodyPreview.innerHTML = "<p><em>Preview unavailable.</em></p>";
        }
      } else {
        els.bodyPreview.innerHTML = "<pre>" + escapeHtml(raw) + "</pre>";
      }
    }
  }

  function selectServer(serverId) {
    tryNavigate(function () {
      selection = { type: "server", serverId: serverId };
      renderEditor();
      renderTree();
    });
  }

  function selectApp(serverId, appId) {
    tryNavigate(function () {
      selection = { type: "app", serverId: serverId, appId: appId };
      collapsed[serverId] = false;
      renderEditor();
      renderTree();
    });
  }

  function renderBreadcrumb(server, app) {
    if (!server) {
      els.breadcrumb.innerHTML = "";
      return;
    }
    if (!app) {
      els.breadcrumb.innerHTML = "Server · <strong>" + escapeHtml(server.name) + "</strong>";
      return;
    }
    els.breadcrumb.innerHTML =
      '<span style="cursor:pointer;text-decoration:underline" data-bc="srv">' +
      escapeHtml(server.name) +
      "</span>" +
      " · " +
      "<strong>" +
      escapeHtml(app.name) +
      "</strong>";
    els.breadcrumb.querySelector("[data-bc=srv]").addEventListener("click", function () {
      selectServer(server.id);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function appendMetaTextarea(label, id, value, extraClass) {
    var wrap = document.createElement("dl");
    wrap.className = "meta-row";
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    var ta = document.createElement("textarea");
    ta.className = "meta-textarea" + (extraClass ? " " + extraClass : "");
    ta.id = id;
    ta.rows = 3;
    ta.spellcheck = true;
    ta.value = value || "";
    dd.appendChild(ta);
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    els.metaFields.appendChild(wrap);
  }

  function renderSectionBlocks(sections) {
    els.sectionsRoot.innerHTML = "";
    sections.forEach(function (sec) {
      var s = normalizeSection(sec);
      var block = document.createElement("section");
      block.className = "wiki-section";
      block.id = "wiki-sec-" + s.id;
      block.setAttribute("data-section-id", s.id);

      var head = document.createElement("div");
      head.className = "wiki-section-head";

      var titleInp = document.createElement("input");
      titleInp.type = "text";
      titleInp.className = "wiki-section-title-input";
      titleInp.setAttribute("data-sec-title", "");
      titleInp.value = s.title;
      titleInp.setAttribute("aria-label", "Section title");

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-ghost btn-small wiki-section-delete";
      delBtn.textContent = "Delete section…";
      delBtn.setAttribute("data-sec-delete", s.id);

      head.appendChild(titleInp);
      head.appendChild(delBtn);

      var bodyLabel = document.createElement("label");
      bodyLabel.className = "field-label wiki-section-body-label";
      bodyLabel.setAttribute("for", "sec-body-" + s.id);
      bodyLabel.textContent =
        "Markdown (headings, lists, code; images: ![alt](https://…))";

      var bodyTa = document.createElement("textarea");
      bodyTa.id = "sec-body-" + s.id;
      bodyTa.className = "body-input wiki-section-body";
      bodyTa.rows = 10;
      bodyTa.spellcheck = true;
      bodyTa.setAttribute("data-sec-body", "");
      bodyTa.value = s.body;

      block.appendChild(head);
      block.appendChild(bodyLabel);
      block.appendChild(bodyTa);
      els.sectionsRoot.appendChild(block);
    });
  }

  function onSectionDeleteClick(btn) {
    var sid = btn.getAttribute("data-sec-delete");
    var count = els.sectionsRoot.querySelectorAll(".wiki-section").length;
    if (count <= 1) {
      window.alert("Each page needs at least one section.");
      return;
    }
    confirmDelete("Delete this section and its content?", function () {
      var el = document.getElementById("wiki-sec-" + sid);
      if (el) el.remove();
      renderGuideIndex();
      markDirty();
    });
  }

  function confirmDelete(message, onOk) {
    els.modalTitle.textContent = "Confirm";
    els.modalBody.textContent = message;
    els.modalOk.textContent = "Delete";
    els.modalOk.classList.add("btn-danger");
    els.modalOk.classList.remove("btn-primary");
    els.modalConfirm.returnValue = "";
    els.modalConfirm.addEventListener(
      "close",
      function onClose() {
        if (els.modalConfirm.returnValue === "ok") onOk();
      },
      { once: true }
    );
    els.modalConfirm.showModal();
  }

  function renderEditor() {
    syncWikiTitleInput();
    applyDocumentTitle();

    if (!selection) {
      els.emptyMessage.hidden = false;
      els.editorPanel.hidden = true;
      els.btnDelete.hidden = true;
      els.btnNewAppToolbar.hidden = true;
      els.breadcrumb.textContent = "";
      els.articleRoot.classList.add("empty-state");
      return;
    }

    var server = getServer(selection.serverId);
    if (!server) {
      selection = null;
      renderEditor();
      return;
    }

    els.articleRoot.classList.remove("empty-state");
    els.emptyMessage.hidden = true;
    els.editorPanel.hidden = false;
    els.btnDelete.hidden = false;

    var app = selection.type === "app" ? getApp(server, selection.appId) : null;
    if (selection.type === "app" && !app) {
      selection = { type: "server", serverId: server.id };
      return renderEditor();
    }

    els.btnNewAppToolbar.hidden = selection.type !== "server";

    renderBreadcrumb(server, app);

    els.metaFields.innerHTML = "";

    var titleWrap = document.createElement("div");
    titleWrap.innerHTML =
      '<label class="field-label" for="title-input">Page title</label>' +
      '<input id="title-input" class="title-input" type="text" autocomplete="off" />';
    els.metaFields.appendChild(titleWrap);
    var titleInput = document.getElementById("title-input");

    if (selection.type === "server") {
      titleInput.value = server.name;
      appendMetaTextarea("Hostname", "meta-hostname", server.hostname, "mono");
      appendMetaTextarea("IP / DNS", "meta-ip", server.ip, "mono");
      appendMetaTextarea("OS", "meta-os", server.os, "");
      renderSectionBlocks(server.sections);
    } else {
      titleInput.value = app.name;
      appendMetaTextarea("URL", "meta-url", app.url, "mono");
      appendMetaTextarea("Port", "meta-port", app.port, "mono");
      appendMetaTextarea("Runtime", "meta-runtime", app.runtime, "");
      renderSectionBlocks(app.sections);
    }

    titleInput.addEventListener("input", markDirty);

    els.metaFields.querySelectorAll("textarea").forEach(function (ta) {
      ta.addEventListener("input", markDirty);
    });

    renderGuideIndex();

    if (els.sectionsToolbar) els.sectionsToolbar.hidden = false;
    els.btnAddSection.hidden = false;

    var activeTab = document.querySelector(".tab.active");
    setTab(activeTab ? activeTab.getAttribute("data-tab") : "edit");
    markSaved();
  }

  els.btnAddSection.addEventListener("click", function () {
    if (!selection) return;
    var server = getServer(selection.serverId);
    if (!server) return;
    var na = normalizeSection({
      id: uuid(),
      title: "New section",
      body: "",
    });
    var block = document.createElement("section");
    block.className = "wiki-section";
    block.id = "wiki-sec-" + na.id;
    block.setAttribute("data-section-id", na.id);
    block.innerHTML =
      '<div class="wiki-section-head">' +
      '<input type="text" class="wiki-section-title-input" data-sec-title="" aria-label="Section title" value="' +
      escapeHtml(na.title) +
      '" />' +
      '<button type="button" class="btn btn-ghost btn-small wiki-section-delete" data-sec-delete="' +
      na.id +
      '">Delete section…</button>' +
      "</div>" +
      '<label class="field-label wiki-section-body-label" for="sec-body-' +
      na.id +
      '">Markdown (headings, lists, code; images: ![alt](https://…))</label>' +
      '<textarea id="sec-body-' +
      na.id +
      '" class="body-input wiki-section-body" rows="10" spellcheck="true" data-sec-body=""></textarea>';
    els.sectionsRoot.appendChild(block);
    renderGuideIndex();
    markDirty();
    block.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  function createNewAppOnServer(server) {
    var na = normalizeApp({
      id: uuid(),
      name: "New application",
      sections: [{ id: uuid(), title: "About", body: "What this service does.\n" }],
    });
    server.apps.push(na);
    saveState(state);
    collapsed[server.id] = false;
    selection = { type: "app", serverId: server.id, appId: na.id };
    renderEditor();
    renderTree();
  }

  els.btnNewAppToolbar.addEventListener("click", function () {
    if (!selection || selection.type !== "server") return;
    var server = getServer(selection.serverId);
    if (!server) return;
    tryNavigate(function () {
      createNewAppOnServer(server);
    });
  });

  els.btnSave.addEventListener("click", function () {
    persistFromForm();
    markSaved();
    renderTree();
  });

  els.btnNewServer.addEventListener("click", function () {
    tryNavigate(function () {
      var s = normalizeServer({
        id: uuid(),
        name: "New server",
        hostname: "",
        ip: "",
        os: "",
        sections: [{ id: uuid(), title: "Overview", body: "## Overview\n\nDescribe this host.\n" }],
        apps: [],
      });
      state.servers.push(s);
      saveState(state);
      collapsed[s.id] = false;
      selection = { type: "server", serverId: s.id };
      renderTree();
      renderEditor();
    });
  });

  els.btnDelete.addEventListener("click", function () {
    if (!selection) return;
    var server = getServer(selection.serverId);
    if (!server) return;

    if (selection.type === "server") {
      confirmDelete(
        'Delete server "' + server.name + '" and all applications listed under it?',
        function () {
          state.servers = state.servers.filter(function (s) {
            return s.id !== server.id;
          });
          saveState(state);
          selection = state.servers[0]
            ? { type: "server", serverId: state.servers[0].id }
            : null;
          renderTree();
          renderEditor();
        }
      );
    } else {
      var app = getApp(server, selection.appId);
      if (!app) return;
      confirmDelete('Delete application "' + app.name + '"?', function () {
        server.apps = server.apps.filter(function (a) {
          return a.id !== app.id;
        });
        saveState(state);
        selection = { type: "server", serverId: server.id };
        renderTree();
        renderEditor();
      });
    }
  });

  els.btnExport.addEventListener("click", function () {
    tryNavigate(function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "server-wiki-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  els.importFile.addEventListener("change", function () {
    var file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = "";
    if (!file) return;

    function runImport() {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.servers)) throw new Error("Invalid file");
          state = migrateLoaded(data);
          saveState(state);
          selection = state.servers[0] ? { type: "server", serverId: state.servers[0].id } : null;
          renderTree();
          renderEditor();
        } catch (e) {
          alert("Could not import: file must be JSON with a top-level `servers` array.");
        }
      };
      reader.readAsText(file);
    }

    tryNavigate(runImport);
  });

  els.sidebarFilter.addEventListener("input", function () {
    filterText = els.sidebarFilter.value.trim();
    renderTree();
  });

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      setTab(tab.getAttribute("data-tab"));
    });
  });

  els.wikiSiteTitleInput.addEventListener("input", function () {
    if (syncingWikiTitle) return;
    markDirty();
  });

  els.sectionsRoot.addEventListener("click", function (e) {
    var btn = e.target.closest(".wiki-section-delete");
    if (!btn || !els.sectionsRoot.contains(btn)) return;
    e.preventDefault();
    onSectionDeleteClick(btn);
  });

  els.sectionsRoot.addEventListener("input", function (e) {
    var t = e.target;
    if (t.matches("[data-sec-title]")) renderGuideIndex();
    markDirty();
    var active = document.querySelector(".tab.active");
    if (active && active.getAttribute("data-tab") === "preview") setTab("preview");
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  if (state.servers.length) {
    selection = { type: "server", serverId: state.servers[0].id };
  }

  applyDocumentTitle();
  renderTree();
  renderEditor();
})();
