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

  function migrateLoaded(parsed) {
    return {
      siteTitle: typeof parsed.siteTitle === "string" && parsed.siteTitle.trim() ? parsed.siteTitle : "Server Wiki",
      servers: parsed.servers.map(normalizeServer),
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

  var state = loadState();
  /** @type {{ type: 'server'|'app', serverId: string, appId?: string } | null} */
  var selection = null;
  var collapsed = {};
  var filterText = "";

  var els = {
    navTree: document.getElementById("nav-tree"),
    breadcrumb: document.getElementById("breadcrumb"),
    emptyMessage: document.getElementById("empty-message"),
    viewPanel: document.getElementById("view-panel"),
    guideIndex: document.getElementById("guide-index"),
    viewPageTitle: document.getElementById("view-page-title"),
    viewMeta: document.getElementById("view-meta"),
    viewSections: document.getElementById("view-sections"),
    articleRoot: document.getElementById("article-root"),
    sidebarFilter: document.getElementById("sidebar-filter"),
    viewSiteTitle: document.getElementById("view-site-title"),
    brandTitle: document.getElementById("view-brand-title"),
  };

  function applyDocumentTitle() {
    var t = (state.siteTitle && state.siteTitle.trim()) || "Server Wiki";
    document.title = t;
  }

  function syncBranding() {
    var t = (state.siteTitle && state.siteTitle.trim()) || "Server Wiki";
    els.viewSiteTitle.textContent = t;
    els.brandTitle.textContent = t;
  }

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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseMarkdown(md) {
    var raw = md && String(md).trim() ? md : "*No content.*";
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
      try {
        return marked.parse(raw, { breaks: true });
      } catch (e) {
        return "<p><em>Could not render this section.</em></p>";
      }
    }
    return "<pre>" + escapeHtml(raw) + "</pre>";
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

  function selectServer(serverId) {
    selection = { type: "server", serverId: serverId };
    renderTree();
    renderArticle();
  }

  function selectApp(serverId, appId) {
    selection = { type: "app", serverId: serverId, appId: appId };
    collapsed[serverId] = false;
    renderTree();
    renderArticle();
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

  function appendMetaRow(label, value, useMono) {
    var wrap = document.createElement("dl");
    wrap.className = "view-meta-row";
    var dt = document.createElement("dt");
    dt.textContent = label;
    var dd = document.createElement("dd");
    dd.className = "view-meta-value" + (useMono ? " mono" : "");
    var text = value != null && String(value).trim() ? String(value) : "—";
    dd.textContent = text;
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    els.viewMeta.appendChild(wrap);
  }

  function renderGuideIndex(sections) {
    els.guideIndex.innerHTML = "";
    if (!sections || !sections.length) {
      els.guideIndex.hidden = true;
      return;
    }
    sections.forEach(function (sec) {
      var s = normalizeSection(sec);
      var a = document.createElement("a");
      a.className = "guide-index-link";
      a.href = "#view-sec-" + s.id;
      a.textContent = s.title;
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var target = document.getElementById("view-sec-" + s.id);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      els.guideIndex.appendChild(a);
    });
    els.guideIndex.hidden = false;
  }

  function renderArticle() {
    state = loadState();
    syncBranding();
    applyDocumentTitle();

    if (!selection) {
      els.emptyMessage.hidden = false;
      els.viewPanel.hidden = true;
      els.breadcrumb.innerHTML = "";
      els.articleRoot.classList.add("empty-state");
      return;
    }

    var server = getServer(selection.serverId);
    if (!server) {
      selection = null;
      renderArticle();
      return;
    }

    els.articleRoot.classList.remove("empty-state");
    els.emptyMessage.hidden = true;
    els.viewPanel.hidden = false;

    var app = selection.type === "app" ? getApp(server, selection.appId) : null;
    if (selection.type === "app" && !app) {
      selection = { type: "server", serverId: server.id };
      renderArticle();
      return;
    }

    renderBreadcrumb(server, app);
    els.viewMeta.innerHTML = "";
    els.viewSections.innerHTML = "";

    var sections;
    if (app) {
      els.viewPageTitle.textContent = app.name;
      appendMetaRow("URL", app.url, true);
      appendMetaRow("Port", app.port, true);
      appendMetaRow("Runtime", app.runtime);
      sections = app.sections;
    } else {
      els.viewPageTitle.textContent = server.name;
      appendMetaRow("Hostname", server.hostname, true);
      appendMetaRow("IP / DNS", server.ip, true);
      appendMetaRow("OS", server.os);
      sections = server.sections;
    }

    renderGuideIndex(sections);

    (sections || []).map(normalizeSection).forEach(function (s) {
      var block = document.createElement("section");
      block.className = "view-section";
      block.id = "view-sec-" + s.id;
      var h = document.createElement("h2");
      h.className = "view-section-title";
      h.textContent = s.title;
      var body = document.createElement("div");
      body.className = "view-section-body prose";
      body.innerHTML = parseMarkdown(s.body);
      block.appendChild(h);
      block.appendChild(body);
      els.viewSections.appendChild(block);
    });
  }

  els.sidebarFilter.addEventListener("input", function () {
    filterText = els.sidebarFilter.value.trim();
    renderTree();
  });

  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY || e.key === "server-wiki-doc-v1") {
      state = loadState();
      syncBranding();
      applyDocumentTitle();
      renderTree();
      renderArticle();
    }
  });

  if (state.servers.length) {
    selection = { type: "server", serverId: state.servers[0].id };
  }

  syncBranding();
  applyDocumentTitle();
  renderTree();
  renderArticle();
})();
