# Assembly Notes

This ZIP was assembled from the supplied markdown transcript/specification that contains iterative implementations for Fase 1–8.

Consolidation performed:
- Combined incremental route mounts into one `backend/src/routes/index.js`.
- Combined Fase 2 and Fase 6 AI controller/routes.
- Combined all frontend route additions into one `App.jsx`.
- Combined all sidebar additions into one `Sidebar.jsx`.
- Combined package dependencies and environment examples.
- Migration runner now executes every SQL migration in filename order.

Before production deployment, run the QA checklist and verify environment-specific integrations (Google Workspace, Shared Drive, Calendar delegation, AI API keys, cPanel paths and MySQL credentials).
