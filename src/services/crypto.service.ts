import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { CryptoPrice } from '../interfaces/crypto.interface';

@Injectable()
export class CryptoService {
  private readonly baseUrl = 'https://api.binance.com/api/v3';
  private readonly tickerUrl = `${this.baseUrl}/ticker/price`;
  private readonly ticker24hUrl = `${this.baseUrl}/ticker/24hr`;

  async getCryptoPrices(symbols: string[]): Promise<CryptoPrice[]> {
    try {
      const promises = symbols.map(async (symbol) => {
        const [priceResponse, statsResponse] = await Promise.all([
          axios.get(`${this.tickerUrl}?symbol=${symbol}USDT`),
          axios.get(`${this.ticker24hUrl}?symbol=${symbol}USDT`),
        ]);

        const price = parseFloat(priceResponse.data.price);
        const priceChangePercent24h = parseFloat(
          statsResponse.data.priceChangePercent,
        );

        // Получаем данные за 30 дней
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const klinesResponse = await axios.get(`${this.baseUrl}/klines`, {
          params: {
            symbol: `${symbol}USDT`,
            interval: '1d',
            startTime: thirtyDaysAgo.getTime(),
          },
        });

        const firstPrice = parseFloat(klinesResponse.data[0][4]); // Цена закрытия первого дня
        const priceChangePercent30d = ((price - firstPrice) / firstPrice) * 100;

        // Получаем данные за год
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        const yearKlinesResponse = await axios.get(`${this.baseUrl}/klines`, {
          params: {
            symbol: `${symbol}USDT`,
            interval: '1d',
            startTime: yearAgo.getTime(),
          },
        });

        const yearFirstPrice = parseFloat(yearKlinesResponse.data[0][4]);
        const priceChangePercentYear =
          ((price - yearFirstPrice) / yearFirstPrice) * 100;

        // Получаем данные за все время (используем максимально доступный период)
        const allTimeKlinesResponse = await axios.get(
          `${this.baseUrl}/klines`,
          {
            params: {
              symbol: `${symbol}USDT`,
              interval: '1d',
              limit: 1000, // Максимальное количество свечей
            },
          },
        );

        const allTimeFirstPrice = parseFloat(allTimeKlinesResponse.data[0][4]);
        const priceChangePercentAllTime =
          ((price - allTimeFirstPrice) / allTimeFirstPrice) * 100;

        return {
          symbol: symbol,
          price,
          priceChangePercent24h,
          priceChangePercent30d,
          priceChangePercentYear,
          priceChangePercentAllTime,
        };
      });

      return await Promise.all(promises);
    } catch (error) {
      console.error('Error fetching crypto prices:', error?.message);
      return [];
    }
  }
}
