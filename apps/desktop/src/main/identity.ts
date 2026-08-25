/**
 * Public project identity, resolved from build-time environment values.
 *
 * These reach the build through `define` in electron.vite.config.ts, which
 * substitutes the literal `process.env.NAME` expressions below. A stale `.env`
 * copied from the template used to reach users verbatim: Roon showed
 * "PROJECT_PUBLISHER" as the extension publisher, and MusicBrainz received a
 * contact URL naming no real project. Placeholder-shaped values are therefore
 * rejected in favour of the frozen defaults.
 */

export interface ProjectIdentity {
  /** Frozen. Changing it makes Roon treat the app as a new extension. */
  roonExtensionId: string;
  publisher: string;
  supportEmail: string;
  /** Sent to MusicBrainz in the User-Agent, whose policy requires a real contact. */
  contactUrl: string;
}

export const PROJECT_IDENTITY_DEFAULTS: Readonly<ProjectIdentity> = Object.freeze({
  roonExtensionId: 'io.github.suvir0.roon-rich-presence',
  publisher: 'Suvir Potdar',
  supportEmail: 'hello@suvir.net',
  contactUrl: 'https://github.com/Suvir0/roon-rich-presence'
});

const PLACEHOLDER_PATTERN =
  /PROJECT_OWNER|PROJECT_PUBLISHER|PROJECT_CONTACT_URL|PROJECT_SUPPORT_EMAIL|YOUR_|CHANGEME|example\.com|example\.org|[<>]/i;

/** Returns the configured value, or the frozen default when it is absent or a template placeholder. */
export function configuredIdentityValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || PLACEHOLDER_PATTERN.test(trimmed)) return fallback;
  return trimmed;
}

export function projectIdentity(): ProjectIdentity {
  return {
    roonExtensionId: configuredIdentityValue(
      process.env.ROON_EXTENSION_ID,
      PROJECT_IDENTITY_DEFAULTS.roonExtensionId
    ),
    publisher: configuredIdentityValue(
      process.env.PROJECT_PUBLISHER,
      PROJECT_IDENTITY_DEFAULTS.publisher
    ),
    supportEmail: configuredIdentityValue(
      process.env.PROJECT_SUPPORT_EMAIL,
      PROJECT_IDENTITY_DEFAULTS.supportEmail
    ),
    contactUrl: configuredIdentityValue(
      process.env.PROJECT_CONTACT_URL,
      PROJECT_IDENTITY_DEFAULTS.contactUrl
    )
  };
}
