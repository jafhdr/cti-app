import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { NotificationOutboxWorker } from './notification-outbox.worker';

@Module({ imports: [AuthModule], providers: [PrismaService, NotificationOutboxWorker], exports: [NotificationOutboxWorker] })
export class NotificationsModule {}
