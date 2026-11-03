# DESIGN.md — "GST Made Simple"

## Brand feel
Calm, trustworthy, friendly fintech. A small shop owner should feel "this is easy", not "this is a government portal". Think Stripe clarity + Indian warmth. Not purple gradients, not generic SaaS.

## Color tokens (CSS variables)
- --bg: #F7F8F5 (warm off-white)
- --surface: #FFFFFF
- --ink: #0F1B14 (near-black green)
- --muted: #5B6B62
- --line: #E3E7E1
- --brand: #0B6B4F (deep green, primary buttons, active states)
- --brand-soft: #E3F2EC
- --accent: #F2A33A (saffron, highlights, referral, CTA on dark)
- --ok: #1E9E5A  --warn: #E8A317  --risk: #D64545  (Green / Amber / Red compliance)
- Dark panel (hero, score card): #0C2A20 with --accent highlights

## Typography
- Headings: "Plus Jakarta Sans" 700/800 (Google Fonts)
- Body: "Inter" 400/500/600
- Numbers (₹ amounts, scores): "JetBrains Mono" or Inter with tabular-nums
- Scale: 12 / 14 / 16 / 20 / 28 / 40 / 56. Headings tight tracking (-0.02em).
- Indian number format everywhere: ₹1,42,361 (use `toLocaleString('en-IN')`).

## Shape and space
- Radius: cards 20px, buttons 14px, chips 999px
- Spacing grid 4px; page padding 16 mobile / 32 desktop; max content width 1200px
- Shadows soft only: 0 1px 2px rgba(15,27,20,.06), 0 8px 24px rgba(15,27,20,.06)

## Components to build once and reuse
StatusDot (green/amber/red), ComplianceScoreRing, StepperCard (Copilot steps), MoneyStat, DeadlineChip, InvoiceTable, ChannelBadge (Mobile/Web/Kiosk/WhatsApp/CA), ApiHealthRow, EmptyState, BottomTabBar (mobile), Sidebar (desktop), ChatBubble, ReferralBanner.

## Motion (keep it purposeful)
- Page transition: 200ms fade + 8px rise
- Score ring animates 0 → value in 900ms ease-out on mount
- Copilot step completes: checkmark draw + card collapses
- Filing success: confetti burst (CSS/canvas, under 1.5s), respect prefers-reduced-motion
- No looping decorative animation

## Copy tone
Short. Second person. "Your GST for October is ready." Never "GSTR-3B Table 4A(5)" in a headline.

## Do not
Gradient-purple hero, stock 3D blobs, emoji as icons (use lucide), lorem ipsum, centered-everything layouts, more than 2 font families.

## Reference override (optional)
<!-- Paste tokens from a DESIGN.md in VoltAgent/awesome-design-md here to override the above -->
