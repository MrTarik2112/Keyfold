import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';

zxcvbnOptions.setOptions({
  dictionary: common.dictionary,
  graphs: common.adjacencyGraphs,
});

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  warning: string;
  suggestions: string[];
  acceptable: boolean;
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

export function passwordStrength(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: 'Very weak', warning: '', suggestions: [], acceptable: false };
  }
  const result = zxcvbn(password);
  const score = Math.min(4, Math.max(0, result.score)) as 0 | 1 | 2 | 3 | 4;
  return {
    score,
    label: LABELS[score],
    warning: result.feedback.warning ?? '',
    suggestions: result.feedback.suggestions ?? [],
    acceptable: score >= 3 && password.length >= 12,
  };
}
