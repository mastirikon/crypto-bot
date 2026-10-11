import { Injectable, OnModuleInit } from '@nestjs/common';
import * as TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';
import { RedisService } from './redis.service';
import { SEND_TIMER } from '../constants';

interface LastMessage {
  messageId: number;
  date: number;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: TelegramBot;
  private priceUpdateInterval: NodeJS.Timeout;
  private lastMessages: Map<number, LastMessage> = new Map();

  constructor(
    private configService: ConfigService,
    private cryptoService: CryptoService,
    private redisService: RedisService,
  ) {}

  async onModuleInit() {
    const proxy = this.configService.get<string>('TELEGRAM_PROXY');
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.bot = new TelegramBot(token, {
      polling: true,
      ...(proxy ? { request: { proxy } as any } : {}),
    });

    // Восстанавливаем предпочтения пользователей при запуске
    const allUsers = await this.redisService.getAllUsers();

    // Для существующих пользователей отправляем первые данные
    if (allUsers && allUsers.length > 0) {
      for (const userData of allUsers) {
        if (
          userData &&
          userData.selectedCryptos &&
          userData.selectedCryptos.length > 0
        ) {
          try {
            // Пытаемся удалить предыдущее сообщение, если оно есть
            if (userData.messageId) {
              try {
                await this.bot.deleteMessage(
                  userData.userId,
                  userData.messageId,
                );
              } catch (error) {
                console.error(
                  `Failed to delete last message for user ${userData.userId}:`,
                  error.message,
                );
              }
            }

            // Отправляем первые данные
            const message = await this.createMessage(userData.selectedCryptos);

            // Отправляем и сохраняем первое сообщение с данными
            const sentMessage = await this.bot.sendMessage(
              userData.userId,
              message,
              {
                parse_mode: 'Markdown',
              },
            );

            // Обновляем информацию о сообщении
            await this.redisService.updateUserData(userData.userId, {
              messageId: sentMessage.message_id,
              date: sentMessage.date,
            });
          } catch (error) {
            console.error(
              `Error sending initial data for user ${userData.userId}: ${error.message}`,
            );
          }
        }
      }
    }

    // Сначала настраиваем обновления цен
    await this.initializePriceUpdates();

    // Затем настраиваем команды
    this.setupCommands();
  }

  private async deletePreviousMessage(userId: number) {
    const lastMessage = this.lastMessages.get(userId);
    if (!lastMessage) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const messageDate = new Date(lastMessage.date * 1000);
    messageDate.setHours(0, 0, 0, 0);

    // Если сообщение не из сегодняшнего дня, удаляем его
    if (messageDate.getTime() !== today.getTime()) {
      try {
        await this.bot.deleteMessage(userId, lastMessage.messageId);
      } catch (error) {
        console.error(`Failed to delete message: ${error.message}`);
      }
    }
  }

  private async initializePriceUpdates() {
    // Останавливаем предыдущий интервал, если он существует
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }

    // Запускаем обновление цен для всех пользователей
    this.priceUpdateInterval = setInterval(async () => {
      const allUsers = await this.redisService.getAllUsers();

      if (allUsers && allUsers.length > 0) {
        for (const userData of allUsers) {
          if (
            !userData ||
            !userData.selectedCryptos ||
            userData.selectedCryptos.length === 0
          )
            continue;

          try {
            // Отправляем первые данные
            const message = await this.createMessage(userData.selectedCryptos);

            // Удаляем предыдущее сообщение, если оно есть
            if (userData.messageId) {
              try {
                await this.bot.deleteMessage(
                  userData.userId,
                  userData.messageId,
                );
              } catch (error) {
                console.error(
                  `Failed to delete message for user ${userData.userId}:`,
                  error.message,
                );
              }
            }

            // Отправляем новое сообщение
            const sentMessage = await this.bot.sendMessage(
              userData.userId,
              message,
              {
                parse_mode: 'Markdown',
              },
            );

            // Обновляем информацию о сообщении
            await this.redisService.updateUserData(userData.userId, {
              messageId: sentMessage.message_id,
              date: sentMessage.date,
            });
          } catch (error) {
            console.error(
              `Error updating prices for user ${userData.userId}: ${error.message}`,
            );
          }
        }
      }
    }, SEND_TIMER);
  }

  private setupCommands() {
    this.bot.onText(/\/start/, this.handleStart.bind(this));
    this.bot.onText(/\/list/, this.handleList.bind(this));
    this.bot.onText(/\/add (.+)/, this.handleAdd.bind(this));
    this.bot.onText(/\/remove (.+)/, this.handleRemove.bind(this));
  }

  private async handleStart(msg: TelegramBot.Message) {
    const userId = msg.from.id;
    const userData = await this.redisService.getUserData(userId);
    const availableCryptos = await this.redisService.getAvailableCryptos();

    if (userData) {
      const message = `
С возвращением! 🚀
Ваши текущие криптовалюты: ${userData.selectedCryptos.join(', ')}

Доступные команды:
/list - Показать список выбранных криптовалют
/add <символ> - Добавить криптовалюту (например: /add ETH)
/remove <символ> - Удалить криптовалюту (например: /remove BTC)

Доступные криптовалюты: ${availableCryptos.join(', ')}
      `;
      await this.bot.sendMessage(userId, message);
      return;
    }

    // Создаем новые данные пользователя
    await this.redisService.setUserData({
      userId,
      username: msg.from.username,
      firstName: msg.from.first_name,
      selectedCryptos: [],
    });

    const message = `
Добро пожаловать в Crypto Price Bot! 🚀

Для начала работы добавьте интересующие вас криптовалюты с помощью команды /add

Доступные команды:
/list - Показать список выбранных криптовалют
/add <символ> - Добавить криптовалюту (например: /add BTC)
/remove <символ> - Удалить криптовалюту

Доступные криптовалюты: ${availableCryptos.join(', ')}
    `;

    await this.bot.sendMessage(userId, message);
  }

  private async handleList(msg: TelegramBot.Message) {
    const userId = msg.from.id;
    const userData = await this.redisService.getUserData(userId);

    if (!userData) {
      await this.bot.sendMessage(
        userId,
        'Пожалуйста, используйте /start для начала работы с ботом',
      );
      return;
    }

    if (!userData.selectedCryptos.length) {
      await this.bot.sendMessage(
        userId,
        'У вас пока нет выбранных криптовалют. Используйте /add <символ> для добавления',
      );
      return;
    }

    await this.bot.sendMessage(
      userId,
      `Ваши выбранные криптовалюты: ${userData.selectedCryptos.join(', ')}`,
    );
  }

  private async handleAdd(msg: TelegramBot.Message, match: RegExpExecArray) {
    const userId = msg.from.id;
    const symbol = match[1].toUpperCase();
    const userData = await this.redisService.getUserData(userId);
    const availableCryptos = await this.redisService.getAvailableCryptos();

    if (!userData) {
      await this.bot.sendMessage(
        userId,
        'Пожалуйста, используйте /start для начала работы с ботом',
      );
      return;
    }

    if (!availableCryptos.includes(symbol)) {
      await this.bot.sendMessage(
        userId,
        `Неподдерживаемая криптовалюта. Доступные: ${availableCryptos.join(', ')}`,
      );
      return;
    }

    if (userData.selectedCryptos.includes(symbol)) {
      await this.bot.sendMessage(userId, 'Эта криптовалюта уже в вашем списке');
      return;
    }

    // Обновляем список криптовалют пользователя
    const updatedCryptos = [...userData.selectedCryptos, symbol];
    await this.redisService.updateUserData(userId, {
      selectedCryptos: updatedCryptos,
    });

    await this.bot.sendMessage(userId, `${symbol} добавлен в ваш список`);

    try {
      // Отправляем актуальные данные
      const message = await this.createMessage(userData.selectedCryptos);

      const sentMessage = await this.bot.sendMessage(userId, message, {
        parse_mode: 'Markdown',
      });

      // Обновляем информацию о сообщении
      await this.redisService.updateUserData(userId, {
        messageId: sentMessage.message_id,
        date: sentMessage.date,
      });
    } catch (error) {
      console.error(
        `Error sending price data after adding crypto for user ${userId}: ${error.message}`,
      );
    }
  }

  async createMessage(updatedCryptos: string[]): Promise<string> {
    const prices = await this.cryptoService.getCryptoPrices(updatedCryptos);

    const messageHeader = prices
      .map((price) => {
        return `*${price.symbol}*: ${price.price.toFixed(2)}$`;
      })
      .join('|');

    const messageDetails = prices
      .map((price) => {
        const dayEmoji = price.priceChangePercent24h >= 0 ? '🟢' : '🔴';
        const monthEmoji = price.priceChangePercent30d >= 0 ? '🟢' : '🔴';
        const yearEmoji = price.priceChangePercentYear >= 0 ? '🟢' : '🔴';
        const allTimeEmoji = price.priceChangePercentAllTime >= 0 ? '🟢' : '🔴';

        return `*${price.symbol}*: ${price.price.toFixed(2)}$ | D${dayEmoji}: ${price.priceChangePercent24h.toFixed(1)}% | M${monthEmoji}: ${price.priceChangePercent30d.toFixed(1)}% | Y${yearEmoji}: ${price.priceChangePercentYear.toFixed(1)}% | A${allTimeEmoji}: ${price.priceChangePercentAllTime.toFixed(1)}%`;
      })
      .join('\n');

    return messageHeader + `\n\n` + messageDetails;
  }

  private async handleRemove(msg: TelegramBot.Message, match: RegExpExecArray) {
    const userId = msg.from.id;
    const symbol = match[1].toUpperCase();
    const userData = await this.redisService.getUserData(userId);

    if (!userData) {
      await this.bot.sendMessage(
        userId,
        'Пожалуйста, используйте /start для начала работы с ботом',
      );
      return;
    }

    if (!userData.selectedCryptos.includes(symbol)) {
      await this.bot.sendMessage(
        userId,
        'Этой криптовалюты нет в вашем списке',
      );
      return;
    }

    // Обновляем список криптовалют пользователя
    await this.redisService.updateUserData(userId, {
      selectedCryptos: userData.selectedCryptos.filter(
        (crypto) => crypto !== symbol,
      ),
    });

    await this.bot.sendMessage(userId, `${symbol} удален из вашего списка`);

    // Если список пуст, удаляем последнее сообщение с ценами
    if (userData.messageId && userData.selectedCryptos.length === 1) {
      // length === 1, потому что мы только что удалили последнюю криптовалюту
      try {
        await this.bot.deleteMessage(userId, userData.messageId);
        // Очищаем messageId в данных пользователя
        await this.redisService.updateUserData(userId, {
          messageId: undefined,
          date: undefined,
        });
      } catch (error) {
        console.error(
          `Failed to delete message for user ${userId}:`,
          error.message,
        );
      }
    }
  }
}
