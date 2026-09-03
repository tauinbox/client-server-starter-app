import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  STEP_UP_OPERATION,
  STEP_UP_OPERATIONS,
  type StepUpOperation
} from '@app/shared/constants';

export class ReauthInitDto {
  @ApiProperty({
    description:
      'The sensitive operation the proof is for. The proof carries this value ' +
      'and the operation that consumes it demands the same value back, so one ' +
      'round trip authorizes one kind of change.',
    enum: STEP_UP_OPERATIONS,
    example: STEP_UP_OPERATION.EMAIL_CHANGE
  })
  @IsIn(STEP_UP_OPERATIONS)
  operation: StepUpOperation;
}
