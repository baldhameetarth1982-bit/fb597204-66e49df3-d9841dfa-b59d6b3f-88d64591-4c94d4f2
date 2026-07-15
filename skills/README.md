# Project-local Lovable Agent Skills

These skills were imported from four upstream repositories and namespaced per source:

- `emil-*` — Emil Kowalski (https://github.com/emilkowalski/skills)
- `matt-*` — Matt Pocock (https://github.com/mattpocock/skills)
- `david-*` — David Ondrej (https://github.com/davidondrej/skills)
- `uxpm-*` — UI UX Pro Max (https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)

## Rules for use inside SociyoHub

1. These are **project-local** Lovable Agent Skills. They provide specialist
   guidance to the Lovable agent working on SociyoHub.
2. Skill names are namespaced with the repository prefix so identically-named
   skills from different authors do not collide.
3. No specialist skill may independently override SociyoHub product decisions
   (branding, payment architecture, RLS, Firebase→Supabase auth, no-online-
   gateway policy, etc.). Product rules always win.
4. A future `sociyohub-ceo-orchestrator` skill will coordinate these
   specialists and enforce SociyoHub product rules.
5. The application runtime MUST NOT import anything from `skills/`.
   This directory is not part of `tsconfig.json` `include`, is not shipped in
   the client bundle by Vite, and is excluded from browser-facing scans.
