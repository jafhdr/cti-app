import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { PlaybookController } from './playbook.controller';
import { PlaybookService } from './playbook.service';
import { SandboxClient } from './sandbox-client';
import { SandboxConnectorService } from './sandbox-connector.service';
import { SandboxWorker } from './sandbox-worker';

@Module({ imports: [AuthModule], controllers: [PlaybookController], providers: [PrismaService, PlaybookService, SandboxClient, SandboxConnectorService, SandboxWorker] })
export class PlaybookModule {}
