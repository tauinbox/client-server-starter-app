import { NestFactory, Reflector } from '@nestjs/core';
import { CoreModule } from './modules/core/core.module';
import { Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigModule } from '@nestjs/config';
import configuration from './modules/core/configuration';
import { FeatureService } from './modules/feature/services/feature.service';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      envFilePath: ['.env.development', '.env'],
      isGlobal: true,
    }),
  ],
})
class BootstrapModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(
    CoreModule.forRoot(),
    {
      cors: true,
      bufferLogs: true,
      logger: ['fatal', 'error', 'warn', 'log'],
    },
  );

  // here is the way how we can get instances to pass them as dependencies into class constructors (when needed)
  const reflector = app.get(Reflector);
  const featureService = app.get(FeatureService);

  app.useGlobalPipes(
    new ValidationPipe(
      // This allows to automatically transform the incoming request payloads into DTO instances before validating them
      { transform: true },
    ),
  );
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  const config = new DocumentBuilder()
    .setTitle('Swagger')
    .setDescription('Starter Project API')
    .setContact(
      'In case of any questions, feel free to ask',
      'support.url',
      'support@email',
    )
    .setVersion('1.0')
    .addServer('/')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('swagger', app, document, {
    swaggerOptions: {},
    customCss: '',
  });

  const port = process.env.APPLICATION_PORT
    ? Number(process.env.APPLICATION_PORT)
    : 3000;

  await app.listen(port);
  console.log(`Server started listening on port ${port}`);
}

bootstrap();
