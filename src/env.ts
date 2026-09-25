import dotenv from "dotenv"

// Configuration is evaluated during imports, including under tsx in development.
// Tests must never accidentally load a developer's real service credentials.
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" })
  dotenv.config()
}
