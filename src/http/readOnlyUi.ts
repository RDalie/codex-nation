import type { FastifyInstance, FastifyReply } from "fastify";

export function registerReadOnlyUi(app: FastifyInstance): void {
  app.get("/", async (_request, reply) => {
    sendReadOnlyUi(reply);
  });

  app.get("/ui", async (_request, reply) => {
    sendReadOnlyUi(reply);
  });
}

function sendReadOnlyUi(reply: FastifyReply): void {
  reply
    .header("Cache-Control", "no-store")
    .header("Content-Security-Policy", "default-src 'none'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
    .header("X-Content-Type-Options", "nosniff")
    .type("text/html; charset=utf-8")
    .send(readOnlyUiHtml);
}

const readOnlyUiHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentHub State</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8f5;
      --surface: #ffffff;
      --surface-muted: #f0f3ee;
      --surface-soft: #fafbf8;
      --text: #20231f;
      --muted: #687065;
      --faint: #8b9387;
      --border: #dfe5db;
      --border-strong: #cbd4c5;
      --accent: #265f73;
      --accent-soft: #dcecef;
      --ok: #2f7a4c;
      --ok-soft: #e1f2e7;
      --warn: #9a681b;
      --warn-soft: #f6ead2;
      --bad: #b94a48;
      --bad-soft: #f7dfdc;
      --info: #4967a8;
      --info-soft: #e3e9f7;
      --shadow: 0 18px 45px rgba(38, 54, 43, 0.08);
      --radius: 8px;
      --radius-sm: 6px;
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html {
      min-width: 320px;
      background: var(--bg);
      color: var(--text);
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0) 280px),
        var(--bg);
      font-size: 14px;
      line-height: 1.45;
    }

    button,
    input {
      font: inherit;
    }

    button {
      min-height: 36px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 12px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 650;
      transition:
        background 160ms ease,
        border-color 160ms ease,
        color 160ms ease,
        transform 160ms ease;
      white-space: nowrap;
    }

    button:hover {
      border-color: #aebcab;
      background: #f8faf5;
    }

    button:active {
      transform: translateY(1px);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.58;
      transform: none;
    }

    input {
      width: 100%;
      min-height: 36px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text);
      padding: 0 11px;
      font-size: 13px;
      outline: none;
      transition:
        border-color 160ms ease,
        box-shadow 160ms ease;
    }

    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(38, 95, 115, 0.14);
    }

    .page {
      width: min(1480px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 22px 0 34px;
    }

    .topbar {
      min-height: 62px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 18px;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 17px;
    }

    .brand {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .mark {
      width: 42px;
      height: 42px;
      border-radius: var(--radius);
      background:
        linear-gradient(135deg, rgba(38, 95, 115, 0.14), rgba(47, 122, 76, 0.1)),
        var(--surface);
      border: 1px solid var(--border-strong);
      display: grid;
      place-items: center;
      color: var(--accent);
      flex: 0 0 auto;
    }

    .brand h1 {
      margin: 0;
      color: var(--text);
      font-size: clamp(22px, 4.8vw, 31px);
      line-height: 1.04;
      font-weight: 760;
    }

    .brand p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: end;
    }

    .health {
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.72);
      color: var(--muted);
      padding: 0 12px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--faint);
      box-shadow: 0 0 0 3px rgba(139, 147, 135, 0.14);
      flex: 0 0 auto;
    }

    .dot.ok {
      background: var(--ok);
      box-shadow: 0 0 0 3px rgba(47, 122, 76, 0.14);
    }

    .dot.bad {
      background: var(--bad);
      box-shadow: 0 0 0 3px rgba(185, 74, 72, 0.14);
    }

    .shell {
      display: grid;
      grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
      padding-top: 18px;
    }

    .sidebar,
    .main {
      min-width: 0;
    }

    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: rgba(255, 255, 255, 0.84);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .panel + .panel {
      margin-top: 16px;
    }

    .panel-head {
      min-height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(250, 251, 248, 0.92);
    }

    .panel-title {
      min-width: 0;
    }

    .panel-title h2,
    .panel-title h3 {
      margin: 0;
      font-size: 14px;
      line-height: 1.25;
      font-weight: 760;
    }

    .panel-title p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }

    .panel-body {
      padding: 16px;
    }

    .finder {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }

    .project-list {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }

    .project-row {
      width: 100%;
      min-height: 76px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      padding: 11px 12px;
      display: grid;
      gap: 7px;
      text-align: left;
      color: var(--text);
      cursor: pointer;
      transition:
        border-color 160ms ease,
        background 160ms ease,
        box-shadow 160ms ease;
    }

    .project-row:hover {
      border-color: #b8c6b3;
      background: #fbfcf9;
    }

    .project-row.active {
      border-color: rgba(38, 95, 115, 0.46);
      background: linear-gradient(180deg, #ffffff, #f3f8f7);
      box-shadow: 0 0 0 3px rgba(38, 95, 115, 0.1);
    }

    .project-name {
      min-width: 0;
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 8px;
      font-size: 13px;
      font-weight: 740;
    }

    .project-name span:first-child {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .project-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .pill {
      min-height: 24px;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface-soft);
      color: var(--muted);
      padding: 0 8px;
      font-size: 11px;
      font-weight: 740;
      white-space: nowrap;
    }

    .pill.status-working {
      color: #596157;
      background: #f2f4ef;
      border-color: #d7dfd2;
    }

    .pill.status-submitted,
    .pill.status-queued {
      color: var(--warn);
      background: var(--warn-soft);
      border-color: #ebd1a9;
    }

    .pill.status-evaluating,
    .pill.status-running {
      color: var(--info);
      background: var(--info-soft);
      border-color: #c9d4ed;
    }

    .pill.status-passed {
      color: var(--ok);
      background: var(--ok-soft);
      border-color: #b8dbc4;
    }

    .pill.status-failed {
      color: var(--bad);
      background: var(--bad-soft);
      border-color: #edc3bf;
    }

    .project-summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: start;
    }

    .project-kicker {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      font-weight: 700;
    }

    .project-summary h2 {
      margin: 0;
      color: var(--text);
      font-size: clamp(20px, 4vw, 28px);
      line-height: 1.12;
      font-weight: 780;
      overflow-wrap: anywhere;
    }

    .project-summary p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(92px, 1fr));
      gap: 10px;
      margin-top: 16px;
    }

    .stat {
      min-height: 78px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface-soft);
      padding: 12px;
    }

    .stat b {
      display: block;
      color: var(--text);
      font-size: 25px;
      line-height: 1;
      font-weight: 780;
    }

    .stat span {
      display: block;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.25;
      font-weight: 700;
    }

    .lineage {
      display: grid;
      gap: 9px;
    }

    .fork-row {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(110px, 0.55fr) minmax(170px, 0.85fr) minmax(120px, 0.45fr);
      gap: 12px;
      align-items: center;
      min-height: 72px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      padding: 10px 12px;
    }

    .fork-main {
      min-width: 0;
      display: grid;
      gap: 5px;
    }

    .fork-title {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .fork-indent {
      width: calc(var(--depth, 0) * 16px);
      max-width: 96px;
      height: 1px;
      flex: 0 0 auto;
    }

    .branch-mark {
      width: 14px;
      height: 14px;
      border-left: 2px solid #b8c3b2;
      border-bottom: 2px solid #b8c3b2;
      border-radius: 0 0 0 5px;
      flex: 0 0 auto;
      margin-top: -5px;
    }

    .fork-title b {
      min-width: 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.25;
      font-weight: 760;
      overflow-wrap: anywhere;
    }

    .fork-subtext,
    .cell-label {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .cell {
      min-width: 0;
      display: grid;
      gap: 5px;
    }

    .cell strong {
      color: var(--text);
      font-size: 13px;
      line-height: 1.25;
      font-weight: 720;
      overflow-wrap: anywhere;
    }

    .status-stack {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }

    .events {
      display: grid;
      gap: 8px;
    }

    .event-row {
      display: grid;
      grid-template-columns: minmax(150px, 0.35fr) minmax(0, 1fr) auto;
      gap: 12px;
      align-items: start;
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
    }

    .event-row:first-child {
      padding-top: 0;
    }

    .event-row:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }

    .event-type {
      color: var(--text);
      font-size: 13px;
      line-height: 1.25;
      font-weight: 730;
      overflow-wrap: anywhere;
    }

    .event-payload {
      min-width: 0;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      line-height: 1.45;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .event-time {
      color: var(--faint);
      font-size: 12px;
      white-space: nowrap;
    }

    .empty,
    .error,
    .loading {
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-sm);
      background: var(--surface-soft);
      color: var(--muted);
      padding: 18px;
      font-size: 13px;
      line-height: 1.45;
    }

    .error {
      border-style: solid;
      border-color: #e6beb8;
      background: #fff7f5;
      color: #8f3d38;
    }

    .loading {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid var(--border-strong);
      border-top-color: var(--accent);
      animation: spin 800ms linear infinite;
      flex: 0 0 auto;
    }

    .footnote {
      margin-top: 14px;
      color: var(--faint);
      font-size: 12px;
      line-height: 1.35;
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation-duration: 1ms !important;
        scroll-behavior: auto !important;
        transition-duration: 1ms !important;
      }
    }

    @media (max-width: 980px) {
      .page {
        width: min(100% - 24px, 760px);
      }

      .topbar,
      .shell,
      .project-summary {
        grid-template-columns: 1fr;
      }

      .top-actions {
        justify-content: start;
        flex-wrap: wrap;
      }

      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .fork-row {
        grid-template-columns: 1fr;
        gap: 9px;
      }

      .status-stack {
        justify-content: flex-start;
      }
    }

    @media (max-width: 620px) {
      .page {
        width: min(100% - 18px, 540px);
        padding-top: 14px;
      }

      .brand {
        align-items: flex-start;
      }

      .mark {
        width: 38px;
        height: 38px;
      }

      .finder,
      .stats,
      .event-row {
        grid-template-columns: 1fr;
      }

      .panel-head {
        align-items: flex-start;
        flex-direction: column;
      }

      .event-time {
        white-space: normal;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M6 7.5h7.5A4.5 4.5 0 0 1 18 12v0a4.5 4.5 0 0 1-4.5 4.5H6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M9 4.5 5.5 7.5 9 10.5M15 13.5l3.5 3-3.5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div>
          <h1>AgentHub State</h1>
          <p>Projects, fork lineage, submissions, and eval status.</p>
        </div>
      </div>
      <div class="top-actions">
        <div class="health" id="health"><span class="dot"></span><span>Checking</span></div>
        <button type="button" id="refreshButton" title="Refresh state">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M20 4v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>
    </header>

    <div class="shell">
      <aside class="sidebar">
        <section class="panel" aria-labelledby="projectsTitle">
          <div class="panel-head">
            <div class="panel-title">
              <h2 id="projectsTitle">Projects</h2>
              <p id="projectCount">Loading</p>
            </div>
          </div>
          <div class="panel-body">
            <form class="finder" id="projectLookup">
              <label class="visually-hidden" for="projectIdInput">Project id</label>
              <input id="projectIdInput" name="projectId" autocomplete="off" placeholder="Project id">
              <button type="submit">Load</button>
            </form>
            <div class="project-list" id="projectList"></div>
            <div class="footnote" id="lastUpdated">No refresh yet.</div>
          </div>
        </section>
      </aside>

      <main class="main" id="main" tabindex="-1">
        <section class="panel">
          <div class="panel-body">
            <div class="loading"><span class="spinner" aria-hidden="true"></span><span>Loading AgentHub state</span></div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const endpoints = {
      health: "/health",
      projects: "/projects",
      lineage: (id) => "/projects/" + encodeURIComponent(id) + "/lineage",
      forkStatus: (id) => "/forks/" + encodeURIComponent(id) + "/status"
    };

    const state = {
      health: "checking",
      healthMessage: "Checking",
      projects: [],
      projectsError: "",
      selectedProjectId: "",
      lineage: null,
      lineageError: "",
      forkStatuses: new Map(),
      loadingProjects: false,
      loadingLineage: false,
      updatedAt: null
    };

    const nodes = {
      health: document.getElementById("health"),
      refreshButton: document.getElementById("refreshButton"),
      projectCount: document.getElementById("projectCount"),
      projectList: document.getElementById("projectList"),
      projectLookup: document.getElementById("projectLookup"),
      projectIdInput: document.getElementById("projectIdInput"),
      lastUpdated: document.getElementById("lastUpdated"),
      main: document.getElementById("main")
    };

    nodes.refreshButton.addEventListener("click", () => {
      refreshAll();
    });

    nodes.projectLookup.addEventListener("submit", (event) => {
      event.preventDefault();
      const projectId = nodes.projectIdInput.value.trim();
      if (!projectId) {
        return;
      }
      selectProject(projectId, true);
    });

    bootstrap();

    async function bootstrap() {
      render();
      await refreshAll();
    }

    async function refreshAll() {
      nodes.refreshButton.disabled = true;
      state.loadingProjects = true;
      state.projectsError = "";
      state.lineageError = "";
      render();

      await Promise.all([loadHealth(), loadProjects()]);

      if (!state.selectedProjectId && state.projects.length > 0) {
        state.selectedProjectId = state.projects[0].id;
      }

      if (state.selectedProjectId) {
        await loadLineage(state.selectedProjectId);
      } else {
        state.lineage = null;
        state.forkStatuses = new Map();
      }

      state.updatedAt = new Date();
      state.loadingProjects = false;
      nodes.refreshButton.disabled = false;
      render();
    }

    async function loadHealth() {
      try {
        const body = await apiGet(endpoints.health);
        state.health = body && body.ok === true ? "ok" : "bad";
        state.healthMessage = body && body.ok === true ? "Healthy" : "Unhealthy";
      } catch (error) {
        state.health = "bad";
        state.healthMessage = error.message || "Unavailable";
      }
      renderHealth();
    }

    async function loadProjects() {
      try {
        const body = await apiGet(endpoints.projects);
        state.projects = normalizeProjects(body);
        state.projectsError = "";
      } catch (error) {
        state.projects = [];
        state.projectsError = error.message || "Could not load projects";
      } finally {
        state.loadingProjects = false;
        renderProjects();
      }
    }

    async function selectProject(projectId, focusMain) {
      state.selectedProjectId = projectId;
      state.lineage = null;
      state.lineageError = "";
      state.forkStatuses = new Map();
      nodes.projectIdInput.value = projectId;
      render();
      await loadLineage(projectId);
      state.updatedAt = new Date();
      render();
      if (focusMain) {
        nodes.main.focus({ preventScroll: false });
      }
    }

    async function loadLineage(projectId) {
      state.loadingLineage = true;
      state.lineageError = "";
      renderMain();

      try {
        const body = await apiGet(endpoints.lineage(projectId));
        state.lineage = normalizeLineage(body);
        await loadForkStatuses(state.lineage.forks);
      } catch (error) {
        state.lineage = null;
        state.forkStatuses = new Map();
        state.lineageError = error.message || "Could not load project lineage";
      } finally {
        state.loadingLineage = false;
      }
      renderMain();
    }

    async function loadForkStatuses(forks) {
      state.forkStatuses = new Map();
      const settled = await Promise.allSettled(
        forks.map(async (fork) => {
          const status = await apiGet(endpoints.forkStatus(fork.id));
          return [fork.id, normalizeForkStatus(status)];
        })
      );

      for (const item of settled) {
        if (item.status === "fulfilled") {
          state.forkStatuses.set(item.value[0], item.value[1]);
        }
      }
    }

    async function apiGet(path) {
      const response = await fetch(path, {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });

      const text = await response.text();
      let body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (_error) {
          body = { message: text };
        }
      }

      if (!response.ok) {
        const message = body && body.error && body.error.message
          ? body.error.message
          : body && body.message
            ? body.message
            : response.status + " " + response.statusText;
        throw new Error(message);
      }

      return body;
    }

    function normalizeProjects(body) {
      const source = Array.isArray(body)
        ? body
        : body && Array.isArray(body.projects)
          ? body.projects
          : body && Array.isArray(body.items)
            ? body.items
            : [];

      return source
        .map((item) => item && item.project ? item.project : item)
        .filter((item) => item && typeof item.id === "string")
        .map((project) => ({
          id: project.id,
          name: stringOr(project.name, project.id),
          slug: stringOr(project.slug, ""),
          rootOwner: stringOr(project.rootOwner, ""),
          rootRepo: stringOr(project.rootRepo, ""),
          createdAt: stringOr(project.createdAt, "")
        }));
    }

    function normalizeLineage(body) {
      const project = body && body.project ? body.project : {};
      return {
        project: {
          id: stringOr(project.id, state.selectedProjectId),
          name: stringOr(project.name, state.selectedProjectId),
          slug: stringOr(project.slug, ""),
          rootOwner: stringOr(project.rootOwner, ""),
          rootRepo: stringOr(project.rootRepo, ""),
          createdAt: stringOr(project.createdAt, "")
        },
        rootFork: body && body.rootFork ? body.rootFork : null,
        forks: Array.isArray(body && body.forks) ? body.forks.filter((fork) => fork && fork.id) : [],
        events: Array.isArray(body && body.events) ? body.events.filter((event) => event && event.id) : []
      };
    }

    function normalizeForkStatus(body) {
      return {
        fork: body && body.fork ? body.fork : null,
        submission: body && body.submission ? body.submission : null,
        eval: body && body.eval ? body.eval : null
      };
    }

    function render() {
      renderHealth();
      renderProjects();
      renderMain();
      nodes.lastUpdated.textContent = state.updatedAt
        ? "Last refreshed " + formatTime(state.updatedAt)
        : "No refresh yet.";
    }

    function renderHealth() {
      const dotClass = state.health === "ok" ? "ok" : state.health === "bad" ? "bad" : "";
      nodes.health.innerHTML = '<span class="dot ' + dotClass + '"></span><span>' + h(state.healthMessage) + '</span>';
    }

    function renderProjects() {
      nodes.projectCount.textContent = state.loadingProjects
        ? "Loading"
        : state.projects.length === 1
          ? "1 project"
          : state.projects.length + " projects";

      if (state.projectsError) {
        nodes.projectList.innerHTML = '<div class="error">' + h(state.projectsError) + '</div>';
        return;
      }

      if (state.loadingProjects) {
        nodes.projectList.innerHTML = '<div class="loading"><span class="spinner" aria-hidden="true"></span><span>Loading projects</span></div>';
        return;
      }

      if (state.projects.length === 0) {
        nodes.projectList.innerHTML = '<div class="empty">No projects found.</div>';
        return;
      }

      nodes.projectList.innerHTML = state.projects.map((project) => {
        const active = project.id === state.selectedProjectId ? " active" : "";
        const repo = project.rootOwner && project.rootRepo ? project.rootOwner + "/" + project.rootRepo : project.slug || project.id;
        return '<button type="button" class="project-row' + active + '" data-project-id="' + h(project.id) + '">' +
          '<span class="project-name"><span>' + h(project.name) + '</span><span class="pill">' + h(project.slug || "project") + '</span></span>' +
          '<span class="project-meta"><span>' + h(repo) + '</span><span>' + h(formatDate(project.createdAt)) + '</span></span>' +
        '</button>';
      }).join("");

      for (const row of nodes.projectList.querySelectorAll(".project-row")) {
        row.addEventListener("click", () => {
          const projectId = row.getAttribute("data-project-id");
          if (projectId) {
            selectProject(projectId, false);
          }
        });
      }
    }

    function renderMain() {
      if (state.loadingLineage) {
        nodes.main.innerHTML = '<section class="panel"><div class="panel-body"><div class="loading"><span class="spinner" aria-hidden="true"></span><span>Loading lineage</span></div></div></section>';
        return;
      }

      if (state.lineageError) {
        nodes.main.innerHTML = '<section class="panel"><div class="panel-body"><div class="error">' + h(state.lineageError) + '</div></div></section>';
        return;
      }

      if (!state.lineage) {
        nodes.main.innerHTML = '<section class="panel"><div class="panel-body"><div class="empty">No project selected.</div></div></section>';
        return;
      }

      const lineage = state.lineage;
      const project = lineage.project;
      const stats = summarizeForks(lineage.forks, state.forkStatuses);
      const repo = project.rootOwner && project.rootRepo ? project.rootOwner + "/" + project.rootRepo : project.slug || project.id;

      nodes.main.innerHTML =
        '<section class="panel">' +
          '<div class="panel-body">' +
            '<div class="project-summary">' +
              '<div>' +
                '<p class="project-kicker">' + h(repo) + '</p>' +
                '<h2>' + h(project.name) + '</h2>' +
                '<p>' + h(project.id) + (project.createdAt ? " · Created " + h(formatDate(project.createdAt)) : "") + '</p>' +
              '</div>' +
              '<div class="status-stack">' +
                '<span class="pill">' + h(project.slug || "project") + '</span>' +
                '<span class="pill">' + h(lineage.events.length + " events") + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="stats">' +
              renderStat(stats.total, "Forks") +
              renderStat(stats.submitted, "Submitted") +
              renderStat(stats.passed, "Passed") +
              renderStat(stats.failed, "Failed") +
            '</div>' +
          '</div>' +
        '</section>' +
        '<section class="panel">' +
          '<div class="panel-head">' +
            '<div class="panel-title"><h3>Fork Lineage</h3><p>' + h(lineage.forks.length + " forks") + '</p></div>' +
          '</div>' +
          '<div class="panel-body">' + renderForks(lineage.forks) + '</div>' +
        '</section>' +
        '<section class="panel">' +
          '<div class="panel-head">' +
            '<div class="panel-title"><h3>Activity</h3><p>' + h(lineage.events.length + " events") + '</p></div>' +
          '</div>' +
          '<div class="panel-body">' + renderEvents(lineage.events) + '</div>' +
        '</section>';
    }

    function renderStat(value, label) {
      return '<div class="stat"><b>' + h(String(value)) + '</b><span>' + h(label) + '</span></div>';
    }

    function renderForks(forks) {
      if (forks.length === 0) {
        return '<div class="empty">No forks found.</div>';
      }

      const depths = computeDepths(forks);
      return '<div class="lineage">' + forks.map((fork) => {
        const depth = depths.get(fork.id) || 0;
        const statusDetails = state.forkStatuses.get(fork.id);
        const forkStatus = statusDetails && statusDetails.fork && statusDetails.fork.status ? statusDetails.fork.status : fork.status;
        const submission = statusDetails ? statusDetails.submission : null;
        const evalRecord = statusDetails ? statusDetails.eval : null;
        const repo = stringOr(fork.owner, "") && stringOr(fork.repo, "") ? fork.owner + "/" + fork.repo : fork.id;
        const source = fork.sourceOwner && fork.sourceRepo ? fork.sourceOwner + "/" + fork.sourceRepo : "root";
        const evalStatus = evalRecord && evalRecord.status ? evalRecord.status : "not queued";
        const submitted = submission ? formatDate(submission.createdAt) : "No submission";

        return '<article class="fork-row">' +
          '<div class="fork-main">' +
            '<div class="fork-title">' +
              '<span class="fork-indent" style="--depth:' + h(String(depth)) + '"></span>' +
              (depth > 0 ? '<span class="branch-mark" aria-hidden="true"></span>' : '') +
              '<b>' + h(repo) + '</b>' +
            '</div>' +
            '<div class="fork-subtext">' + h(fork.goal || "No goal recorded") + '</div>' +
          '</div>' +
          '<div class="cell"><span class="cell-label">Parent</span><strong>' + h(fork.parentForkId || source) + '</strong></div>' +
          '<div class="cell"><span class="cell-label">Submission</span><strong>' + h(submitted) + '</strong></div>' +
          '<div class="status-stack">' +
            statusPill(forkStatus) +
            statusPill(evalStatus) +
          '</div>' +
        '</article>';
      }).join("") + '</div>';
    }

    function renderEvents(events) {
      if (events.length === 0) {
        return '<div class="empty">No activity found.</div>';
      }

      return '<div class="events">' + events.slice().reverse().map((event) => {
        return '<article class="event-row">' +
          '<div class="event-type">' + h(event.type || event.id) + '</div>' +
          '<pre class="event-payload">' + h(prettyPayload(event.payload)) + '</pre>' +
          '<time class="event-time">' + h(formatDate(event.createdAt)) + '</time>' +
        '</article>';
      }).join("") + '</div>';
    }

    function statusPill(status) {
      const normalized = stringOr(status, "unknown").toLowerCase();
      const className = normalized.replace(/[^a-z0-9_-]/g, "-");
      return '<span class="pill status-' + h(className) + '">' + h(normalized) + '</span>';
    }

    function summarizeForks(forks, statuses) {
      const summary = { total: forks.length, submitted: 0, passed: 0, failed: 0 };
      for (const fork of forks) {
        const details = statuses.get(fork.id);
        const forkStatus = details && details.fork && details.fork.status ? details.fork.status : fork.status;
        const evalStatus = details && details.eval && details.eval.status ? details.eval.status : "";

        if (forkStatus === "submitted" || forkStatus === "evaluating" || Boolean(details && details.submission)) {
          summary.submitted += 1;
        }
        if (forkStatus === "passed" || evalStatus === "passed") {
          summary.passed += 1;
        }
        if (forkStatus === "failed" || evalStatus === "failed") {
          summary.failed += 1;
        }
      }
      return summary;
    }

    function computeDepths(forks) {
      const byId = new Map(forks.map((fork) => [fork.id, fork]));
      const cache = new Map();

      function depthFor(fork) {
        if (!fork || !fork.parentForkId || !byId.has(fork.parentForkId)) {
          return 0;
        }
        if (cache.has(fork.id)) {
          return cache.get(fork.id);
        }
        const depth = Math.min(6, depthFor(byId.get(fork.parentForkId)) + 1);
        cache.set(fork.id, depth);
        return depth;
      }

      for (const fork of forks) {
        cache.set(fork.id, depthFor(fork));
      }
      return cache;
    }

    function prettyPayload(payload) {
      if (!payload || typeof payload !== "object") {
        return "";
      }
      try {
        return JSON.stringify(payload, null, 2);
      } catch (_error) {
        return String(payload);
      }
    }

    function stringOr(value, fallback) {
      return typeof value === "string" && value ? value : fallback;
    }

    function formatDate(value) {
      if (!value) {
        return "Unknown";
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
    }

    function formatTime(value) {
      return new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(value);
    }

    function h(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }
  </script>
</body>
</html>`;
