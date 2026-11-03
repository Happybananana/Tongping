/**
 * V0.6.7: personal poster score semantics.
 * Scores are 0.5..10.0, in 0.1 increments. 0 remains unavailable.
 * Boundaries: <7 red; [7,8) yellow; [8,8.5), [8.5,9), [9,9.5), [9.5,10].
 */
export function isValidPersonalRating(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= 0.5 && value <= 10
    && Math.abs(value * 10 - Math.round(value * 10)) < 1e-7;
}

export function posterScoreTone(value) {
  if (!isValidPersonalRating(value)) return 'unrated';
  return value < 7 ? 'negative' : value < 8 ? 'mixed' : 'positive';
}

export function posterScoreTier(value) {
  if (!isValidPersonalRating(value)) return 'unrated';
  if (value < 7) return 'red';
  if (value < 8) return 'yellow';
  if (value < 8.5) return 'green-80';
  if (value < 9) return 'green-85';
  if (value < 9.5) return 'green-90';
  return 'green-95';
}

export function posterScoreLabel(value) {
  const labels = {
    red: '不太喜欢',
    yellow: '尚可',
    'green-80': '喜欢',
    'green-85': '很喜欢',
    'green-90': '强烈推荐',
    'green-95': '挚爱',
    unrated: '尚未评分'
  };
  return labels[posterScoreTier(value)];
}
