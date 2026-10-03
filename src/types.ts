export type SteamNewsCounts = {
  last365Days: number;
  last90Days: number;
  last30Days: number;
  last7Days: number;
};

export type SteamNewsItem = {
  id: string;
  title: string;
  url: string;
  author: string;
  publishedAt: string;
  feed: string;
  tags: string[];
  excerpt: string;
};

export type Game = {
  id: string;
  channel: '端游' | 'App' | '小游戏';
  name: string;
  englishName: string;
  genre: string;
  platforms: string[];
  releaseDate: string;
  developer: string;
  publisher: string;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  peakPlayers: number | null;
  tags: string[];
  description: string;
  steamAppId: number | null;
  sourceUrl: string;
  metricsSourceUrl?: string;
  dataAsOf?: string;
  metricScope?: string;
  sourceExtras?: {
    appStoreId?: number | null;
    usPriceUsd?: number | null;
    usRatingOutOf5?: number | null;
    usRatingCount?: number | null;
  } | null;
  isDemo: boolean;
  updatedAt?: string;
  currentPlayers?: number | null;
  steamNewsCounts?: SteamNewsCounts;
  latestSteamNews?: SteamNewsItem[];
  steamCapturedAt?: string;
  peakSourceUrl?: string;
  peakCapturedAt?: string;
  hasLiveData?: boolean;
};

export type GameInput = Omit<Game, 'id' | 'updatedAt' | 'currentPlayers' | 'steamNewsCounts' | 'latestSteamNews' | 'steamCapturedAt' | 'peakSourceUrl' | 'peakCapturedAt' | 'hasLiveData'>;

export type ProjectRisk = {
  id: string;
  category: 'license' | 'ip' | 'team' | 'competition' | 'technical';
  description: string;
  status: 'unverified' | 'confirmed' | 'cleared';
  severity: 'low' | 'medium' | 'high' | 'catastrophic';
  evidenceUrl: string;
};

export type InvestmentInputs = {
  market: { tam: number | null; growth12mPct: number | null; concentrationPct: number | null; survival6mPct: number | null; benchmarkIrrPct: number | null; benchmarkPaybackMonths: number | null; currency: string; region: string; asOf: string; basis: string };
  users: { d1Pct: number | null; d7Pct: number | null; d30Pct: number | null; d90Pct: number | null; payingD180Pct: number | null; avgSessionMinutes: number | null; monthlyCashDecayPct: number | null; newUserGrowthPct: number | null; region: string; asOf: string; basis: string };
  commercial: { arpu: number | null; arppu: number | null; payerPenetrationPct: number | null; ltv30: number | null; ltv90: number | null; cac: number | null; currency: string; region: string; asOf: string; basis: string };
  operations: { versionCycleMonths: number | null; versionRevenueLiftPct: number | null; contentConsumptionMonths: number | null; economyStabilityScore: number | null; sentimentScore: number | null; negativeEventCashShockPct: number | null; region: string; asOf: string; basis: string };
  finance: { currency: string; upfrontCost: number | null; annualDiscountRatePct: number | null; basis: string; scenarios: Record<'optimistic' | 'base' | 'pessimistic', { month1Revenue: number | null; monthlyRevenueDecayPct: number | null; monthlyOperatingCost: number | null }> };
};

export type ScoreConfig = {
  weights: { market: number; returns: number; sustainability: number; riskReserve: number };
  thresholds: { growthTargetPct: number; survivalTargetPct: number; irrTargetPct: number; paybackTargetMonths: number; ltvCacTarget: number; payingD180TargetPct: number; cashDecayTargetPct: number; cautionScore: number; recommendScore: number };
  riskPenalties: { low: number; medium: number; high: number };
};

export type Project = {
  id: string;
  name: string;
  genre: string;
  studio: string;
  stage: 'concept' | 'prototype' | 'production' | 'live';
  description: string;
  risks: ProjectRisk[];
  investmentInputs: InvestmentInputs;
  riskReviewComplete: boolean;
  createdAt: string;
  updatedAt: string;
  assessment: {
    status: 'vetoed' | 'pending' | 'rated';
    score: number | null;
    conclusion: string;
    vetoRiskIds: string[];
    missing?: string[];
    breakdown?: { market: number; returns: number; sustainability: number; riskReserve: number; riskPenalty: number } | null;
    financialGate?: { triggered: boolean; reasons: string[]; uncappedScore: number } | null;
  };
  forecast?: { currency: string; scenarios: Record<'optimistic' | 'base' | 'pessimistic', { status: 'incomplete'; missingFields: string[] } | { status: 'complete'; horizonMonths: number; months: { month: number; revenue: number; cashFlow: number; cumulativeCashFlow: number }[]; npv: number; annualIrrPct: number | null; paybackMonth: number | null; maximumCumulativeLoss: number }> } | null;
};

export type ProjectInput = Pick<Project, 'name' | 'genre' | 'studio' | 'stage' | 'description' | 'risks' | 'investmentInputs' | 'riskReviewComplete'>;
