import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { UserData } from '../interfaces/crypto.interface';

@Injectable()
export class RedisService {
  private readonly KEY_PREFIX = 'crypto_bot:';
  private readonly AVAILABLE_CRYPTOS_KEY =
    this.KEY_PREFIX + 'available_cryptos';
  private readonly DEFAULT_CRYPTOS = [
    'BTC',
    'ETH',
    'BNB',
    'XRP',
    'ADA',
    'DOGE',
    'SOL',
  ];
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('error', (error) => {
      console.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      console.log('Successfully connected to Redis');
      // Инициализируем список доступных криптовалют при успешном подключении
      this.initializeAvailableCryptos().catch((error) => {
        console.error('Failed to initialize available cryptos:', error);
      });
    });
  }

  private getUserKey(userId: number): string {
    return `${this.KEY_PREFIX}user:${userId}`;
  }

  private async initializeAvailableCryptos(): Promise<void> {
    const exists = await this.redis.exists(this.AVAILABLE_CRYPTOS_KEY);
    if (!exists) {
      await this.redis.set(
        this.AVAILABLE_CRYPTOS_KEY,
        JSON.stringify(this.DEFAULT_CRYPTOS),
      );
    }
  }

  async getAvailableCryptos(): Promise<string[]> {
    const cryptos = await this.redis.get(this.AVAILABLE_CRYPTOS_KEY);
    return cryptos ? JSON.parse(cryptos) : [];
  }

  async addAvailableCrypto(symbol: string): Promise<void> {
    const cryptos = await this.getAvailableCryptos();
    if (!cryptos.includes(symbol)) {
      cryptos.push(symbol);
      await this.redis.set(this.AVAILABLE_CRYPTOS_KEY, JSON.stringify(cryptos));
    }
  }

  async removeAvailableCrypto(symbol: string): Promise<void> {
    const cryptos = await this.getAvailableCryptos();
    const index = cryptos.indexOf(symbol);
    if (index !== -1) {
      cryptos.splice(index, 1);
      await this.redis.set(this.AVAILABLE_CRYPTOS_KEY, JSON.stringify(cryptos));
    }
  }

  async getUserData(userId: number): Promise<UserData | null> {
    const key = this.getUserKey(userId);
    const result = await this.redis.get(key);
    return result ? JSON.parse(result) : null;
  }

  async setUserData(userData: UserData): Promise<void> {
    const key = this.getUserKey(userData.userId);
    await this.redis.set(key, JSON.stringify(userData));
  }

  async updateUserData(
    userId: number,
    updates: Partial<UserData>,
  ): Promise<void> {
    const key = this.getUserKey(userId);
    const currentData = await this.getUserData(userId);
    if (currentData) {
      const updatedData = { ...currentData, ...updates };
      await this.setUserData(updatedData);
    } else {
      const newData: UserData = {
        userId,
        selectedCryptos: [],
        ...updates,
      };
      await this.setUserData(newData);
    }
  }

  async deleteUserData(userId: number): Promise<void> {
    const key = this.getUserKey(userId);
    await this.redis.del(key);
  }

  async getAllUsers(): Promise<UserData[]> {
    const keys = await this.redis.keys(`${this.KEY_PREFIX}user:*`);
    if (!keys.length) return [];

    const users: UserData[] = [];
    for (const key of keys) {
      const userData = await this.redis.get(key);
      if (userData) {
        users.push(JSON.parse(userData));
      }
    }
    return users;
  }
}
