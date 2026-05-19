import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { setServers } from 'node:dns';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';

const WEAK_JWT_SECRETS = new Set([
  'replace_with_a_strong_secret',
  'changeme',
  'secret',
  '',
]);

function assertStrongJwtSecret(): void {
  const secret = process.env.JWT_SECRET ?? '';
  if (WEAK_JWT_SECRETS.has(secret.trim())) {
    throw new Error(
      'JWT_SECRET is missing or set to a known weak placeholder. Generate a long random value (e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"`) and set it in the environment before starting the server.',
    );
  }
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters (256 bits of entropy).');
  }
}

function parseAllowedOrigins(): string[] {
  const raw = (process.env.CORS_ORIGINS ?? '').trim();
  if (!raw) {
    return ['http://localhost:4200', 'http://127.0.0.1:4200'];
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

async function bootstrap() {
  assertStrongJwtSecret();

  if (String(process.env.FORCE_PUBLIC_DNS ?? '').toLowerCase() === 'true') {
    try {
      setServers(['8.8.8.8', '8.8.4.4']);
      // eslint-disable-next-line no-console
      console.log('[bootstrap] FORCE_PUBLIC_DNS=true, using Google DNS resolvers.');
    } catch {
      // ignore if not supported in this Node environment
    }
  }
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowedOrigins = parseAllowedOrigins();
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

void bootstrap();
