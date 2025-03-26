export interface CryptoPrice {
  symbol: string;
  price: number;
  priceChangePercent24h: number;
  priceChangePercent30d: number;
  priceChangePercentYear: number;
  priceChangePercentAllTime: number;
}

export interface UserPreferences {
  userId: number;
  selectedCryptos: string[];
}

export interface UserData {
  userId: number;
  username?: string;
  firstName?: string;
  selectedCryptos: string[];
  messageId?: number;
  date?: number;
}
