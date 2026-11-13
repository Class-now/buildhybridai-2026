import { ensureInitialized, fetchAndActivate, getRemoteConfig, getValue, type RemoteConfig } from 'firebase/remote-config';
import { firebaseApp } from './firebase';

/**
 * The routing policy lives in Firebase Remote Config, so it can be tuned for everyone
 * without shipping a new build: which tasks prefer the cloud, which cloud model to use,
 * how long a document Gemini Nano is trusted with, and an emergency switch that keeps
 * every request on the device (for example when the free cloud quota runs out).
 *
 * The defaults below are the policy the app ships with. If Remote Config cannot be
 * reached (offline, blocked, no template published), these are used unchanged.
 * None of these values can weaken the privacy invariant: raw text is only ever given
 * to an ONLY_ON_DEVICE model, and the router enforces that regardless of config.
 */
export const DEFAULTS = {
  /** Gemini model used for the cloud side of hybrid requests. */
  cloud_model: 'gemini-3.5-flash-lite',
  cloud_temperature: 0.3,
  /** Documents longer than this (characters, after masking) skip Nano and prefer the cloud. */
  device_char_budget: 20000,
  /** Comma-separated task ids that prefer the cloud in Auto mode. The rest prefer the device. */
  cloud_preferred_tasks: 'explain,reply,connect',
  /** false = cloud switched off: Auto keeps everything on the device, Cloud mode is unavailable. */
  cloud_enabled: true,
  /** Short note shown next to the routing card when set (e.g. "Cloud paused for maintenance"). */
  routing_notice: '',
};

export interface RoutingConfig {
  cloudModel: string;
  cloudTemperature: number;
  deviceCharBudget: number;
  cloudPreferred: Set<string>;
  cloudEnabled: boolean;
  notice: string;
  /** 'remote' when at least one value came from a published template. */
  source: 'remote' | 'default';
  status: 'loading' | 'fetched' | 'cached' | 'offline' | 'error';
  fetchedAt?: number;
}

const KNOWN_TASKS = new Set(['summary', 'actions', 'explain', 'reply', 'ask', 'connect']);

function fromDefaults(): RoutingConfig {
  return {
    cloudModel: DEFAULTS.cloud_model,
    cloudTemperature: DEFAULTS.cloud_temperature,
    deviceCharBudget: DEFAULTS.device_char_budget,
    cloudPreferred: new Set(DEFAULTS.cloud_preferred_tasks.split(',')),
    cloudEnabled: DEFAULTS.cloud_enabled,
    notice: DEFAULTS.routing_notice,
    source: 'default',
    status: 'loading',
  };
}

export let routing: RoutingConfig = fromDefaults();

const clamp = (n: number, lo: number, hi: number, fallback: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

function read(rc: RemoteConfig, status: RoutingConfig['status']): RoutingConfig {
  const keys = Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[];
  const remote = keys.some((k) => getValue(rc, k).getSource() === 'remote');
  const model = getValue(rc, 'cloud_model').asString().trim();
  const tasks = getValue(rc, 'cloud_preferred_tasks')
    .asString()
    .split(',')
    .map((s) => s.trim())
    .filter((s) => KNOWN_TASKS.has(s));
  return {
    // Only Gemini models are accepted; anything else falls back to the shipped model.
    cloudModel: /^gemini-[\w.-]+$/.test(model) ? model : DEFAULTS.cloud_model,
    cloudTemperature: clamp(getValue(rc, 'cloud_temperature').asNumber(), 0, 1, DEFAULTS.cloud_temperature),
    deviceCharBudget: clamp(getValue(rc, 'device_char_budget').asNumber(), 2000, 30000, DEFAULTS.device_char_budget),
    cloudPreferred: new Set(tasks),
    cloudEnabled: getValue(rc, 'cloud_enabled').asBoolean(),
    notice: getValue(rc, 'routing_notice').asString().slice(0, 200),
    source: remote ? 'remote' : 'default',
    status,
    fetchedAt: rc.fetchTimeMillis > 0 ? rc.fetchTimeMillis : undefined,
  };
}

/** Fetch and activate the routing policy. Never throws; calls onChange with whatever is in effect. */
export async function loadRouting(onChange: (c: RoutingConfig) => void): Promise<void> {
  let rc: RemoteConfig;
  try {
    rc = getRemoteConfig(firebaseApp);
    rc.settings.minimumFetchIntervalMillis = import.meta.env.DEV ? 60_000 : 30 * 60_000;
    rc.settings.fetchTimeoutMillis = 8000;
    rc.defaultConfig = { ...DEFAULTS };
  } catch {
    routing = { ...routing, status: 'error' };
    onChange(routing);
    return;
  }
  // A previously activated template (IndexedDB) is usable at once, even offline.
  try {
    await ensureInitialized(rc);
  } catch {
    /* storage unavailable: defaults */
  }
  routing = read(rc, rc.lastFetchStatus === 'success' ? 'cached' : 'loading');
  onChange(routing);
  if (!navigator.onLine) {
    routing = { ...routing, status: 'offline' };
    onChange(routing);
    return;
  }
  try {
    await fetchAndActivate(rc);
    routing = read(rc, 'fetched');
  } catch {
    routing = { ...read(rc, 'error') };
  }
  onChange(routing);
}
