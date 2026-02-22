import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './controllers/auth.controller';
import { OAuthController } from './controllers/oauth.controller';
import { AuthService } from './services/auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { OAuthAccount } from './entities/oauth-account.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { TokenCleanupService } from './services/token-cleanup.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { OAuthAccountService } from './services/oauth-account.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { FacebookStrategy } from './strategies/facebook.strategy';
import { VkStrategy } from './strategies/vk.strategy';
import { User } from '../users/entities/user.entity';
import { PermissionService } from './services/permission.service';
import { PolicyEvaluatorService } from './services/policy-evaluator.service';
import { RoleService } from './services/role.service';
import { RolesController } from './controllers/roles.controller';

function conditionalProvider(
  envVar: string,
  strategyClass: new (configService: ConfigService) => unknown
) {
  return {
    provide: strategyClass,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): unknown => {
      if (configService.get(envVar)) {
        return new strategyClass(configService);
      }
      // Strategy not configured — guards will throw NotFoundException
      return null;
    }
  };
}

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([
      RefreshToken,
      OAuthAccount,
      Role,
      Permission,
      RolePermission,
      User
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: `${configService.get('JWT_EXPIRATION')}s`,
          algorithm: 'HS256'
        }
      })
    })
  ],
  controllers: [AuthController, OAuthController, RolesController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    RefreshTokenService,
    TokenCleanupService,
    OAuthAccountService,
    PermissionService,
    PolicyEvaluatorService,
    RoleService,
    conditionalProvider('GOOGLE_CLIENT_ID', GoogleStrategy),
    conditionalProvider('FACEBOOK_CLIENT_ID', FacebookStrategy),
    conditionalProvider('VK_CLIENT_ID', VkStrategy)
  ],
  exports: [AuthService, PermissionService, RoleService]
})
export class AuthModule {}
