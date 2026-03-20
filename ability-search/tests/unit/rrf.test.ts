import { describe, expect, it } from 'vitest';

import { reciprocalRankFusion, type RankedItem } from '../../src/lib/rrf.js';

describe('reciprocalRankFusion', () => {
  it('returns empty array for empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('returns empty array for empty rankings', () => {
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('handles single ranking list', () => {
    const ranking: RankedItem[] = [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ];
    const result = reciprocalRankFusion([ranking]);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
    // Scores should be 1/(60+1) and 1/(60+2)
    expect(result[0].score).toBeCloseTo(1 / 61);
    expect(result[1].score).toBeCloseTo(1 / 62);
  });

  it('boosts items appearing in multiple rankings', () => {
    const ranking1: RankedItem[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];
    const ranking2: RankedItem[] = [
      { id: 'b' },
      { id: 'a' },
      { id: 'd' },
    ];

    const result = reciprocalRankFusion([ranking1, ranking2]);

    // 'a' appears in both: rank 1 in list1, rank 2 in list2 -> 1/61 + 1/62
    // 'b' appears in both: rank 2 in list1, rank 1 in list2 -> 1/62 + 1/61
    // Both should have same combined score
    const scoreA = result.find((r) => r.id === 'a')!.score;
    const scoreB = result.find((r) => r.id === 'b')!.score;
    expect(scoreA).toBeCloseTo(scoreB);

    // 'c' only in list1: 1/63
    const scoreC = result.find((r) => r.id === 'c')!.score;
    expect(scoreC).toBeCloseTo(1 / 63);

    // 'd' only in list2: 1/63
    const scoreD = result.find((r) => r.id === 'd')!.score;
    expect(scoreD).toBeCloseTo(1 / 63);

    // Items in both lists should score higher
    expect(scoreA).toBeGreaterThan(scoreC);
  });

  it('uses custom k parameter', () => {
    const ranking: RankedItem[] = [{ id: 'a' }];
    const result = reciprocalRankFusion([ranking], 10);
    // k=10, rank 1 -> 1/(10+1) = 1/11
    expect(result[0].score).toBeCloseTo(1 / 11);
  });

  it('sorts by score descending', () => {
    const ranking1: RankedItem[] = [{ id: 'a' }, { id: 'b' }];
    const ranking2: RankedItem[] = [{ id: 'b' }, { id: 'c' }];
    const ranking3: RankedItem[] = [{ id: 'b' }, { id: 'a' }];

    const result = reciprocalRankFusion([ranking1, ranking2, ranking3]);

    // 'b' appears in all 3 lists — should be first
    expect(result[0].id).toBe('b');

    // Scores should be monotonically decreasing
    for (let i = 1; i < result.length; i++) {
      expect(result[i].score).toBeLessThanOrEqual(result[i - 1].score);
    }
  });

  it('preserves extra properties from ranked items', () => {
    const ranking: RankedItem[] = [
      { id: 'a', title: 'Alpha', source: 'file.md' },
    ];
    const result = reciprocalRankFusion([ranking]);
    expect(result[0].title).toBe('Alpha');
    expect(result[0].source).toBe('file.md');
  });
});
