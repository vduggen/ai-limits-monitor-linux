export type ProviderName = "claude" | "codex";

export type UsageDisplayMode = "remaining" | "used";

export interface AccountConfig {
  readonly id: string;
  readonly label: string;
  readonly provider: ProviderName;
  readonly displayMode?: UsageDisplayMode;
  readonly enabled?: boolean;
  readonly binaryPath?: string;
  readonly configDir?: string;
  readonly homeDir?: string;
}

export interface AppConfig {
  readonly pollIntervalSeconds: number;
  readonly probeTimeoutSeconds: number;
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
  readonly windowDurationMins?: number;
}

export type UsageStatus = "ok" | "unsupported" | "error";

export interface AccountUsage {
  readonly id: string;
  readonly label: string;
  readonly provider: ProviderName;
  readonly status: UsageStatus;
  readonly displayMode?: UsageDisplayMode;
  readonly plan?: string;
  readonly email?: string;
  readonly windows: readonly UsageWindow[];
  readonly checkedAt: string;
  readonly error?: string;
}

export interface UsageSnapshot {
  readonly version: 1;
  readonly createdAt: string;
  readonly configPath?: string;
  readonly accounts: readonly AccountUsage[];
}
