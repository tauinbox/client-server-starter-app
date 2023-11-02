import { NestFactory } from '@nestjs/core';
import { CoreModule } from './modules/core/core.module';
import { Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigModule } from '@nestjs/config';
import configuration from './modules/core/configuration';

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
  const app = await NestFactory.create(CoreModule.forRoot(), {
    cors: true,
    bufferLogs: true,
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true }));
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

  await app.listen(
    process.env.ENVIRONMENT ? Number(process.env.ENVIRONMENT) : 3000,
  );
}

bootstrap();
