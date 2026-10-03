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
};

export type GameInput = Omit<Game, 'id' | 'updatedAt'>;
