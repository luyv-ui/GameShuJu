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
  name: string;
  englishName: string;
  genre: string;
  platforms: string[];
  releaseDate: string;
  developer: string;
  publisher: string;
  price: number;
  rating: number;
  reviewCount: number;
  peakPlayers: number;
  tags: string[];
  description: string;
  steamAppId: number | null;
  sourceUrl: string;
  isDemo: boolean;
  updatedAt?: string;
  currentPlayers?: number | null;
  steamNewsCounts?: SteamNewsCounts;
  latestSteamNews?: SteamNewsItem[];
  steamCapturedAt?: string;
  hasLiveData?: boolean;
};

export type GameInput = Omit<Game, 'id' | 'updatedAt' | 'currentPlayers' | 'steamNewsCounts' | 'latestSteamNews' | 'steamCapturedAt' | 'hasLiveData'>;
