/**
 * Production Safety Guard
 * Ensures development-only flags (dev-session, default admin seeding, dev seed data)
 * cause a hard failure if enabled in a production build or runtime.
 */
import { fileURLToPath } from "node:url";

export function assertProductionSafety() {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  const violations = [];
  if (process.env.ENABLE_DEV_AUTH === "true") violations.push("ENABLE_DEV_AUTH=true");
  if (process.env.ALLOW_DEFAULT_ADMIN === "true") violations.push("ALLOW_DEFAULT_ADMIN=true");
  if (process.env.ALLOW_DEV_SEED === "true") violations.push("ALLOW_DEV_SEED=true");

  if (violations.length > 0) {
    throw new Error(
      `FATAL PRODUCTION SAFETY ERROR: Forbidden development/seed flags enabled with NODE_ENV=production: ${violations.join(", ")}`
    );
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1] === currentFile) {
  try {
    assertProductionSafety();
    console.log("[Build Check] Production safety check passed.");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
