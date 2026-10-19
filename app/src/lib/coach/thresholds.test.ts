import { describe, expect, it } from 'vitest';
import {
	METRICS,
	STATUS_LABEL,
	TILE_METRICS,
	comparisonSentence,
	formatAbout,
	gainPerCan,
	rateScore,
	thresholdTooltip,
	typicalBudgetLine
} from './thresholds';

describe('score thresholds', () => {
	it('uses the status words Strong, Average, and Low', () => {
		expect(STATUS_LABEL).toEqual({ good: 'Strong', ok: 'Average', weak: 'Low' });
	});

	it('puts a typical list in Average and cuts Low and Strong at the documented lines', () => {
		for (const band of Object.values(METRICS)) {
			expect(band.typical).toBeGreaterThanOrEqual(band.lowBelow);
			expect(band.typical).toBeLessThan(band.strongAt);
			expect(rateScore(band.typical, band)).toBe('ok');
			expect(rateScore(band.lowBelow - 0.001, band)).toBe('weak');
			expect(rateScore(band.lowBelow, band)).toBe('ok');
			expect(rateScore(band.strongAt - 0.001, band)).toBe('ok');
			expect(rateScore(band.strongAt, band)).toBe('good');
		}
	});

	it('explains every cutoff in the tooltip, including the words and the numbers', () => {
		for (const band of TILE_METRICS) {
			const tooltip = thresholdTooltip(band, band.typical, 50);
			expect(tooltip).toContain('Low is under');
			expect(tooltip).toContain('Average is');
			expect(tooltip).toContain('Strong is');
			expect(tooltip).toContain(formatAbout(band.lowBelow, band.decimals));
			expect(tooltip).toContain(formatAbout(band.strongAt, band.decimals));
			expect(tooltip).toContain(band.why);
			expect(tooltip).toContain('50-can list');
		}
	});

	it('compares hull per can with the typical value for this budget', () => {
		expect(comparisonSentence(0.59, METRICS.survivability, 50)).toBe(
			'Hull per can 0.59 vs about 0.5 typical on a 50-can list (about 25 hull)'
		);
		expect(typicalBudgetLine(50)).toBe('A typical 50-can list has about 15 attack dice and 25 hull.');
	});

	it('scales a score change by how much of the band it crosses, per can', () => {
		const fullBand = gainPerCan(METRICS.mobility.lowBelow, METRICS.mobility.strongAt, METRICS.mobility, 5);
		expect(fullBand).toBeCloseTo(0.2, 5);
		expect(gainPerCan(4.2, 4.9, METRICS.mobility, 5)).toBeCloseTo(0.2, 5);
		expect(gainPerCan(4.2, 4.2, METRICS.mobility, 5)).toBe(0);
		expect(gainPerCan(4.9, 4.2, METRICS.mobility, 5)).toBeLessThan(0);
	});
});
