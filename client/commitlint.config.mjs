import { findMentions } from './scripts/at-mentions.mjs';

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-bare-at-mention': ({ subject, body }) => {
          const logins = [
            ...findMentions(subject ?? ''),
            ...findMentions(body ?? '')
          ];

          return [
            logins.length === 0,
            `wrap code identifiers in backticks - ${logins
              .map((login) => `@${login}`)
              .join(
                ', '
              )} reaches CHANGELOG.md and the release notes as a GitHub user mention`
          ];
        }
      }
    }
  ],
  rules: {
    'no-bare-at-mention': [2, 'always']
  }
};
