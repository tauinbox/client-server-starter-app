import { MAX_NAME_LENGTH } from '@app/shared/constants';
import { oauthProfileName } from './oauth-profile-name';

describe('oauthProfileName', () => {
  it('takes the display name of the provider', () => {
    expect(
      oauthProfileName({
        displayName: ' María José García ',
        name: { givenName: 'María', familyName: 'García' }
      })
    ).toBe('María José García');
  });

  it('joins the given and the family name when no display name is sent', () => {
    expect(
      oauthProfileName({ name: { givenName: 'Jane', familyName: 'Doe' } })
    ).toBe('Jane Doe');
  });

  it('keeps a given name with no family name', () => {
    expect(oauthProfileName({ name: { givenName: 'Madonna' } })).toBe(
      'Madonna'
    );
  });

  it('keeps a family name with no given name', () => {
    expect(oauthProfileName({ name: { familyName: 'Doe' } })).toBe('Doe');
  });

  it('is empty when the provider sends no name', () => {
    expect(oauthProfileName({ displayName: '  ', name: {} })).toBe('');
    expect(oauthProfileName({})).toBe('');
  });

  it('caps the name', () => {
    expect(
      oauthProfileName({ displayName: 'x'.repeat(MAX_NAME_LENGTH + 10) })
    ).toHaveLength(MAX_NAME_LENGTH);
  });
});
