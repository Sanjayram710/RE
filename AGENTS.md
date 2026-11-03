# Workspace Rules — GST Compliance Digital Assistant (frontend demo)

- Deadline is tight. Prefer working and beautiful over complete.
- Stack: Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui + React Router + Framer Motion + Recharts + lucide-react.
- Read `DESIGN.md` before writing any UI. Never hardcode colors, fonts or spacing outside its tokens.
- Read `PAGES_SPEC.md` for screens. Build exactly those routes.
- No backend. All data comes from `src/data/*.ts` mock modules and `data/api-status.json`.
- AI answers are canned/mock for the demo. Tax numbers are computed by plain deterministic functions in `src/lib/gst.ts`, never by an LLM. Show this in the UI as "Calculated by rules engine".
- Mobile-first (390px) then desktop. Every screen must work at both.
- Plain-language copy. No raw GSTR jargon in headings; jargon only in small secondary text.
- Accessibility: contrast AA, visible focus, 44px touch targets.
- After each phase run `npm run build` and fix errors before continuing.
- Do not add dependencies beyond the stack above without a reason.
- Never invent real GSTINs, PANs or phone numbers. Use obviously fake demo values.
