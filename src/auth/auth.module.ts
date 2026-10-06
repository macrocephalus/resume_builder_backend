import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { SESSION } from '../config/limits'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'
import { JwtSecretService } from './jwt-secret.service'
import { SessionService } from './session.service'

/**
 * Accounts and sessions, and the global guard that closes every other route to visitors. The
 * signing key is loaded at start (`JwtSecretService`), so it is passed per call, not here.
 */
@Module({
  imports: [
    JwtModule.register({
      signOptions: { algorithm: 'HS256', expiresIn: SESSION.ttlSeconds },
      verifyOptions: { algorithms: ['HS256'] },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtSecretService,
    SessionService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
