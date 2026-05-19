import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class OffresMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OffresMigrationService.name);
  private readonly pool: Pool;

  constructor() {
    const envPath = path.join(process.cwd(), '.env');
    let dbUrl = process.env.DATABASE_URL ?? '';

    try {
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).reduce((acc, line) => {
          const m = line.match(/^([^#=]+)=(.*)$/);
          if (m) acc[m[1].trim()] = m[2].trim();
          return acc;
        }, {} as Record<string, string>);
        dbUrl ||= env['DATABASE_URL'] ?? '';
      }
    } catch { /* ignore */ }

    this.pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.runMigrations();
  }

  private async runMigrations(): Promise<void> {
    const client = await this.pool.connect().catch((err: unknown) => {
      this.logger.warn('DB migration skipped (could not connect): ' + String(err));
      return null;
    });

    if (!client) return;

    try {
      await client.query(`
        ALTER TABLE post
          ADD COLUMN IF NOT EXISTS feedback_email_sent_at TIMESTAMP WITH TIME ZONE,
          ADD COLUMN IF NOT EXISTS feedback_submitted BOOLEAN DEFAULT FALSE;
      `);
      this.logger.log('Migrations OK: feedback_email_sent_at and feedback_submitted columns ensured on post table.');
    } catch (err) {
      this.logger.warn('Migration warning: ' + String(err));
    } finally {
      client.release();
    }
  }
}
