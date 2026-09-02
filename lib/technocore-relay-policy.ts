export const TECHNOCORE_RELAY_FLAG = 'FOUNDRY_TECHNOCORE_RELAY_ENABLED' as const;
export const FOUNDRY_PUBLIC_ORIGIN = 'FOUNDRY_PUBLIC_ORIGIN' as const;

export type RelayConfiguration = {
  enabled: boolean;
  code: 'disabled' | 'missing_public_origin' | 'invalid_public_origin' | 'ready';
  publicOrigin: string | null;
  reason: string;
};

type RelayEnvironment = Partial<Record<typeof TECHNOCORE_RELAY_FLAG | typeof FOUNDRY_PUBLIC_ORIGIN, string>>;

function publicHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized.includes('.') &&
    normalized !== 'localhost' &&
    !normalized.endsWith('.localhost') &&
    !normalized.endsWith('.local') &&
    !normalized.endsWith('.internal') &&
    !normalized.includes(':') &&
    !/^\d+(?:\.\d+){3}$/.test(normalized) &&
    normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function normalizePublicFoundryOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('FOUNDRY_PUBLIC_ORIGIN must be an absolute public HTTPS origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !publicHostname(url.hostname)
  ) {
    throw new Error('FOUNDRY_PUBLIC_ORIGIN must be public HTTPS without credentials, a port, path, query, fragment, or literal/private host.');
  }
  return url.origin;
}

export function relayConfiguration(environment: RelayEnvironment): RelayConfiguration {
  if (environment[TECHNOCORE_RELAY_FLAG] !== '1') {
    return {
      enabled: false,
      code: 'disabled',
      publicOrigin: null,
      reason: `Relay is disabled. Set ${TECHNOCORE_RELAY_FLAG}=1 only after configuring a public Foundry origin.`,
    };
  }
  const configuredOrigin = environment[FOUNDRY_PUBLIC_ORIGIN];
  if (!configuredOrigin) {
    return {
      enabled: false,
      code: 'missing_public_origin',
      publicOrigin: null,
      reason: `${FOUNDRY_PUBLIC_ORIGIN} is required when the Technocore relay is enabled.`,
    };
  }
  try {
    const publicOrigin = normalizePublicFoundryOrigin(configuredOrigin);
    return { enabled: true, code: 'ready', publicOrigin, reason: 'Relay is explicitly enabled for this public Foundry origin.' };
  } catch (cause) {
    return {
      enabled: false,
      code: 'invalid_public_origin',
      publicOrigin: null,
      reason: cause instanceof Error ? cause.message : `${FOUNDRY_PUBLIC_ORIGIN} is invalid.`,
    };
  }
}

export function assertPublicReceiptAnnouncement(text: string, publicOrigin: string) {
  const match = /^\[FOUNDRY\] receipt (res_[a-f0-9]{24}) \| mission (M-[0-9]{3}|F-[A-F0-9]{8}) \| claimant ([^|\u0000-\u001f\u007f]{3,80}) \| artifact (sha256:[a-f0-9]{64}) \| key=valid artifact=match issuer=(accepted|rejected|not-present) \| (https:\/\/\S+)$/.exec(text);
  if (!match) throw new Error('Technocore announcement does not match the bounded Foundry receipt format.');
  const receiptId = match[1];
  const receiptUrl = new URL(match[6]);
  if (
    receiptUrl.origin !== publicOrigin ||
    receiptUrl.pathname !== `/receipt/${receiptId}` ||
    receiptUrl.username ||
    receiptUrl.password ||
    receiptUrl.search ||
    receiptUrl.hash
  ) {
    throw new Error('Technocore announcement must point to the matching receipt on FOUNDRY_PUBLIC_ORIGIN.');
  }
  return {
    receiptId,
    missionId: match[2],
    claimantLabel: match[3],
    artifactSha256: match[4],
    issuerState: match[5],
    receiptUrl: receiptUrl.toString(),
  };
}
