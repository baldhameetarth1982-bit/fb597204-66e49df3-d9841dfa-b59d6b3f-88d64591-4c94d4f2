# Routing note

This template uses **TanStack Router** (file-based). The CTO spec referenced
`src/pages/` and `react-router-dom`; we map those to `src/routes/` and
`@tanstack/react-router` while preserving the screen hierarchy 1:1.

## Layout routes (RBAC boundaries)

- `_auth.tsx` — public auth screens (login, register, forgot/reset password)
- `_admin.tsx` — Super Admin only (`/admin/*`)
- `_society.tsx` — Society Admin only (`/society/*`)
- `_resident.tsx` — Resident only (`/app/*`) — mobile-first bottom nav

Each pathless layout uses `beforeLoad` to enforce role via `AuthContext`.
Place new screens as children, e.g. `_admin/dashboard.tsx` -> `/admin/dashboard`.
