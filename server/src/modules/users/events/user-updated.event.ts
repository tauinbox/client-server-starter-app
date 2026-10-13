import type { User } from '../entities/user.entity';

export class UserUpdatedEvent {
  /**
   * `previous` is the record before the write. A change can move the user out
   * of the scope of a conditional grant, and a viewer that saw the old record
   * must still learn of the change.
   */
  constructor(
    public readonly userId: string,
    public readonly previous?: User
  ) {}
}
