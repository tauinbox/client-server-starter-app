type RuleLevel = 'off' | 'warn' | 'error';
type RestrictedSyntax = { selector: string; message: string };

declare const baseRules: {
  [rule: string]: RuleLevel | [RuleLevel, ...unknown[]];
  'no-restricted-syntax': ['error', ...RestrictedSyntax[]];
};

export declare const errorKeyLiteralSyntax: RestrictedSyntax;

export default baseRules;
