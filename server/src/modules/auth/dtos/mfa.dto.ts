import {
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  Matches,
  ValidateIf
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_PASSWORD_LENGTH, TOTP_DIGITS } from '@app/shared/constants';
import type {
  MfaRecoveryCodesResponse,
  MfaRequiredResponse,
  MfaSetupResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

const CODE_DESCRIPTION = 'Code from the authenticator app';
const CODE_EXAMPLE = '123456';

/**
 * A recovery code as the user reads it: sixteen base32 characters in two
 * groups. The separator is optional because people retype it either way.
 */
const RECOVERY_CODE_PATTERN = /^[A-Za-z2-7]{8}-?[A-Za-z2-7]{8}$/;

export class MfaSetupDto {
  @ApiPropertyOptional({
    description:
      'Current password. An account that holds one must supply it. An account ' +
      'created through a provider holds none and authorizes the setup with a ' +
      're-authentication proof instead.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword?: string;
}

export class MfaEnableDto {
  @ApiProperty({ description: CODE_DESCRIPTION, example: CODE_EXAMPLE })
  @IsString()
  @Length(TOTP_DIGITS, TOTP_DIGITS)
  code: string;
}

export class MfaDisableDto {
  @ApiPropertyOptional({
    description: 'Current password, for an account that holds one',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword?: string;

  @ApiPropertyOptional({
    description:
      'Code from the authenticator app. Accepted in place of the password, ' +
      'which is the only factor an account created through a provider holds.',
    example: CODE_EXAMPLE
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @Length(TOTP_DIGITS, TOTP_DIGITS)
  code?: string;
}

export class MfaVerifyDto {
  @ApiProperty({
    description: 'The mfaToken the login response returned',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  mfaToken: string;

  @ApiProperty({ description: CODE_DESCRIPTION, example: CODE_EXAMPLE })
  @IsString()
  @Length(TOTP_DIGITS, TOTP_DIGITS)
  code: string;
}

export class MfaRecoveryDto {
  @ApiProperty({
    description: 'The mfaToken the login response returned',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  mfaToken: string;

  @ApiProperty({
    description: 'One of the recovery codes issued at enrolment',
    example: 'ABCDEFGH-IJKLMNOP'
  })
  @IsString()
  @Matches(RECOVERY_CODE_PATTERN)
  recoveryCode: string;
}

export class MfaSetupResponseDto {
  @ApiProperty({
    description: 'Base32 secret, for an authenticator that cannot scan',
    example: 'JBSWY3DPEHPK3PXP'
  })
  secret: string;

  @ApiProperty({
    description: 'otpauth URI the QR code encodes',
    example: 'otpauth://totp/Nexus:user@example.com?secret=JBSWY3DPEHPK3PXP'
  })
  otpauthUri: string;

  @ApiProperty({
    description: 'The same URI rendered as a QR code, as a data URL',
    example: 'data:image/png;base64,iVBORw0KGgo...'
  })
  qrDataUrl: string;
}

export class MfaRecoveryCodesResponseDto {
  @ApiProperty({
    description: 'Single-use recovery codes. They are readable only once.',
    example: ['ABCDEFGH-IJKLMNOP']
  })
  recoveryCodes: string[];
}

export class MfaRequiredResponseDto {
  @ApiProperty({ example: true })
  mfaRequired: true;

  @ApiProperty({
    description: 'Short-lived token that only lets its holder present a code',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  mfaToken: string;

  @ApiProperty({ description: 'Seconds until the token expires', example: 300 })
  expiresIn: number;
}

// Compile-time contract: every response this controller returns must match the
// shared wire type the client reads, key for key and type for type.
type _SetupMatchesShared = _AssertNever<
  StructuralDiff<WireType<MfaSetupResponseDto>, MfaSetupResponse>
>;
type _SharedMatchesSetup = _AssertNever<
  StructuralDiff<MfaSetupResponse, WireType<MfaSetupResponseDto>>
>;
type _CodesMatchShared = _AssertNever<
  StructuralDiff<
    WireType<MfaRecoveryCodesResponseDto>,
    MfaRecoveryCodesResponse
  >
>;
type _SharedMatchesCodes = _AssertNever<
  StructuralDiff<
    MfaRecoveryCodesResponse,
    WireType<MfaRecoveryCodesResponseDto>
  >
>;
type _RequiredMatchesShared = _AssertNever<
  StructuralDiff<WireType<MfaRequiredResponseDto>, MfaRequiredResponse>
>;
type _SharedMatchesRequired = _AssertNever<
  StructuralDiff<MfaRequiredResponse, WireType<MfaRequiredResponseDto>>
>;
