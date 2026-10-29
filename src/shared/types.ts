export type ProviderName = "claude" | "codex";

export type UsageDisplayMode = "remaining" | "used";
export type CollectionMode = "hybrid" | "local-only" | "remote-only";
export type UsageSource = "claude-statusline" | "claude-desktop" | "codex-rollout" | "claude-sdk" | "codex-rpc";
export type IdentityConfidence = "confirmed" | "profile";

export interface AccountConfig {
  readonly id: string;
  readonly label: string;
  readonly provider: ProviderName;
  readonly displayMode?: UsageDisplayMode;
  readonly enabled?: boolean;
  readonly binaryPath?: string;
  readonly configDir?: string;
  readonly homeDir?: string;
  readonly statusLinePath?: string;
  readonly collectionMode?: CollectionMode;
  readonly remotePollIntervalSeconds?: number;
  readonly externalUsagePath?: string;
}

export interface AppConfig {
  readonly pollIntervalSeconds?: number;
  readonly probeTimeoutSeconds: number;
  readonly claudeStatusLineMaxAgeSeconds: number;
  readonly claudeDesktopMaxAgeSeconds: number;
  readonly claudeOAuthMinIntervalSeconds: number;
  readonly accounts: readonly AccountConfig[];
}

export type UsageWindowKind = "session" | "weekly" | "monthly" | "other";

export interface UsageWindow {
  readonly id: string;
  readonly kind: UsageWindowKind;
  readonly label: string;
  readonly usedPercent: number;
  readonly remainingPercent: number;
  readonly resetsAt?: string;
  readonly resetSource?: "statusLine" | "oauth";
  readonly resetCheckedAt?: string;
  readonly windowDurationMins?: number;
  readonly source?: UsageSource;
  readonly observedAt?: string;
  readonly sourceEventAt?: string;
  readonly fetchedAt?: string;
  readonly identityConfidence?: IdentityConfidence;
  readonly bindingGeneration?: string;
}

export type UsageStatus = "ok" | "unsupported" | "error";

export interface AccountUsage {
  readonly identityId?: string;
  readonly id: string;
  readonly label: string;
  readonly provider: ProviderName;
  readonly status: UsageStatus;
  readonly displayMode?: UsageDisplayMode;
  readonly plan?: string;
  readonly email?: string;
  readonly windows: readonly UsageWindow[];
  readonly checkedAt: string;
  readonly profileKey?: string;
  readonly source?: "statusLine" | "desktop" | "oauth" | "codex";
  readonly stale?: boolean;
  readonly error?: string;
  readonly collection?: {
    readonly lastAttemptAt?: string;
    readonly lastSuccessAt?: string;
    readonly nextRetryAt?: string;
    readonly failure?: RemoteProbeResult["failure"];
    readonly revision: number;
    readonly identityConfidence?: IdentityConfidence;
  };
}

export interface UsageSnapshot {
  readonly version: 1;
  readonly createdAt: string;
  readonly configPath?: string;
  readonly accounts: readonly AccountUsage[];
  readonly refreshResult?: RefreshResult;
}

export interface ProfileBinding {
  accountId: string;
  profilePath: string;
  generation: string;
  identityId?: string;
  boundAt: string;
}
export interface QuotaObservation {
  binding: ProfileBinding;
  sessionId?: string;
  identityConfidence: IdentityConfidence;
  source: UsageSource;
  observedAt: string;
  sourceEventAt?: string;
  fetchedAt?: string;
  windows: readonly UsageWindow[];
}
export interface RemoteProbeResult {
  usage: AccountUsage;
  failure?: "rate-limited" | "transient" | "unsupported";
  retryAt?: string;
  fetchedAt?: string;
}
export interface AccountCollectionState {
  binding: ProfileBinding;
  windows: readonly UsageWindow[];
  lastLocalEventAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  nextRetryAt?: string;
  rateLimitLevel: number;
  error?: string;
  failure?: RemoteProbeResult["failure"];
  revision: number;
  plan?: string;
  email?: string;
}
export interface RefreshRequest { version: 1; id: string; createdAt: string; accountIds?: readonly string[] }
export interface RefreshResult {
  id: string;
  completedAt: string;
  accounts: readonly {
    accountId: string;
    outcome: "observed" | "queried" | "unchanged" | "blocked" | "error";
    nextRetryAt?: string;
    error?: string;
  }[];
}
