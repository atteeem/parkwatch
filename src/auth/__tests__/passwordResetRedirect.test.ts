import { readFileSync } from "fs";
import { join } from "path";
import { PASSWORD_RESET_REDIRECT, passwordResetRedirect } from "../passwordResetRedirect";

const root = join(__dirname, "../../..");

describe("password reset redirect (explicit, never the Site URL fallback)", () => {
  it("development build -> parkwatch-dev://auth/reset-password", () => {
    expect(passwordResetRedirect({ platform: "android", appVariant: "development" })).toBe("parkwatch-dev://auth/reset-password");
    expect(passwordResetRedirect({ platform: "ios", appVariant: "development" })).toBe("parkwatch-dev://auth/reset-password");
  });

  it("preview/production (and unknown variant) -> parkwatch://auth/reset-password", () => {
    for (const appVariant of ["production", undefined, null, "", "preview", 42]) {
      expect(passwordResetRedirect({ platform: "android", appVariant })).toBe("parkwatch://auth/reset-password");
      expect(passwordResetRedirect({ platform: "ios", appVariant })).toBe("parkwatch://auth/reset-password");
    }
  });

  it("native recovery never uses localhost, http(s) or Expo Go exp:// URLs", () => {
    for (const platform of ["android", "ios"]) {
      for (const appVariant of ["development", "production", undefined]) {
        const url = passwordResetRedirect({ platform, appVariant, webOrigin: "http://localhost:3000" });
        expect(url).not.toMatch(/localhost|127\.0\.0\.1|^https?:|^exp:/);
        expect(Object.values(PASSWORD_RESET_REDIRECT)).toContain(url);
      }
    }
  });

  it("web (local mock testing) uses the page origin", () => {
    expect(passwordResetRedirect({ platform: "web", appVariant: "production", webOrigin: "http://localhost:8082" })).toBe("http://localhost:8082/auth/reset-password");
  });

  it("each variant's redirect scheme matches the app scheme in app.config.ts", () => {
    const config = readFileSync(join(root, "app.config.ts"), "utf8");
    expect(config).toMatch(/scheme: APP_VARIANT === "development" \? "parkwatch-dev" : "parkwatch"/);
    expect(config).toMatch(/extra: \{ \.\.\.config\.extra, appVariant: APP_VARIANT \}/);
    expect(PASSWORD_RESET_REDIRECT.development.startsWith("parkwatch-dev://")).toBe(true);
    expect(PASSWORD_RESET_REDIRECT.production.startsWith("parkwatch://")).toBe(true);
  });

  it("the forgot-password screen passes the explicit redirect (no Linking.createURL, no localhost)", () => {
    const screen = readFileSync(join(root, "app/auth/forgot-password.tsx"), "utf8");
    expect(screen).toMatch(/requestPasswordReset\(\s*email,\s*passwordResetRedirect\(/);
    expect(screen).toMatch(/appVariant: \(Constants\.expoConfig\?\.extra/);
    expect(screen).not.toMatch(/createURL|localhost|3000/);
  });

  it("the auth service always forwards redirectTo to resetPasswordForEmail", () => {
    const service = readFileSync(join(root, "src/auth/authService.ts"), "utf8");
    expect(service).toMatch(/resetPasswordForEmail\(email\.trim\(\), \{ redirectTo \}\)/);
  });
});
