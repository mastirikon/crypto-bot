import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramService } from './services/telegram.service';
import { CryptoService } from './services/crypto.service';
import { RedisService } from './services/redis.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [TelegramService, CryptoService, RedisService],
})
export class AppModule {}
