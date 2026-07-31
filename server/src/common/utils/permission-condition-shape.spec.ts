import {
  CONDITION_MAX_KEY_LENGTH,
  findConditionActionError,
  findFieldMatchShapeError,
  findIdentityBoundBranch,
  findOwnershipShapeError,
  findUserAttrShapeError
} from '@app/shared/utils/permission-condition-shape';

// A "$"-prefixed key written by any structured branch lands in field position
// of the resolved MongoQuery, where CASL reads it as an operator: the rule then
// matches nothing (an allow grants nothing) and the SQL translator drops it (a
// deny stops denying). All three branches must reject it before that happens.
describe('permission condition shape key validation', () => {
  describe('ownership', () => {
    it.each(['$or', '$where', '$expr', '$'])(
      'rejects userField "%s"',
      (userField) => {
        expect(findOwnershipShapeError({ userField })).toContain(userField);
      }
    );

    it('accepts a plain field name', () => {
      expect(findOwnershipShapeError({ userField: 'createdBy' })).toBeNull();
    });

    it('accepts a field name containing a "$" that does not lead', () => {
      expect(findOwnershipShapeError({ userField: 'a$b' })).toBeNull();
    });
  });

  describe('fieldMatch', () => {
    it.each(['$or', '$where', '$in'])('rejects the key "%s"', (key) => {
      expect(findFieldMatchShapeError({ [key]: ['x'] })).toContain(key);
    });

    it('rejects a "$" key mixed with a valid one', () => {
      expect(
        findFieldMatchShapeError({ status: ['active'], $or: ['x'] })
      ).toContain('$or');
    });

    it('accepts plain field keys', () => {
      expect(findFieldMatchShapeError({ status: ['active'] })).toBeNull();
    });
  });

  describe('userAttr', () => {
    it.each(['$or', '$expr'])('rejects the key "%s"', (key) => {
      expect(findUserAttrShapeError({ [key]: 'id' })).toContain(key);
    });

    it('rejects a "$"-prefixed attribute name', () => {
      expect(findUserAttrShapeError({ ownerId: '$or' })).toContain('$or');
    });

    it('accepts a plain key and attribute name', () => {
      expect(findUserAttrShapeError({ ownerId: 'id' })).toBeNull();
    });
  });

  describe('identity-bound branches on a create grant', () => {
    it.each(['ownership', 'userAttr'])(
      'rejects %s combined with the create action',
      (branch) => {
        const conditions =
          branch === 'ownership'
            ? { ownership: { userField: 'createdBy' } }
            : { userAttr: { ownerId: 'id' } };

        expect(findConditionActionError('create', conditions)).toContain(
          `conditions.${branch}`
        );
        expect(findIdentityBoundBranch(conditions)).toBe(branch);
      }
    );

    it.each(['update', 'delete', 'read'])(
      'accepts ownership on the %s action',
      (action) => {
        expect(
          findConditionActionError(action, {
            ownership: { userField: 'createdBy' }
          })
        ).toBeNull();
      }
    );

    it('accepts fieldMatch and custom on the create action', () => {
      expect(
        findConditionActionError('create', { fieldMatch: { locale: ['ru'] } })
      ).toBeNull();
      expect(
        findConditionActionError('create', { custom: '{"locale":"ru"}' })
      ).toBeNull();
    });

    it('ignores a null branch and a non-object condition', () => {
      expect(
        findConditionActionError('create', { ownership: null })
      ).toBeNull();
      expect(findIdentityBoundBranch(null)).toBeNull();
    });
  });

  describe('existing key rules stay in force', () => {
    it('rejects a prototype-pollution key', () => {
      expect(findFieldMatchShapeError({ ['__proto__']: ['x'] })).toContain(
        '__proto__'
      );
    });

    it('rejects an over-long key', () => {
      expect(
        findFieldMatchShapeError({
          ['a'.repeat(CONDITION_MAX_KEY_LENGTH + 1)]: ['x']
        })
      ).toContain(String(CONDITION_MAX_KEY_LENGTH));
    });
  });
});
