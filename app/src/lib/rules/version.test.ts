import { describe, expect, it } from 'vitest';
import {
	RULESET_V3_CUTOVER_ISO,
	countedVehicleTotal,
	defaultRulesVersion,
	maxCountedVehicles,
	normalizeRulesVersion,
	rulesetCutover
} from './version';

describe('defaultRulesVersion', () => {
	const cutover = rulesetCutover();

	it('uses a single America/New_York cutover instant', () => {
		expect(RULESET_V3_CUTOVER_ISO).toBe('2027-01-01T00:00:00-05:00');
		expect(cutover.toISOString()).toBe('2027-01-01T05:00:00.000Z');
	});

	it('defaults to v2 before 1 Jan 2027 in New York', () => {
		expect(defaultRulesVersion(new Date('2026-12-31T23:59:59-05:00'))).toBe(2);
		expect(defaultRulesVersion(new Date(cutover.getTime() - 1))).toBe(2);
	});

	it('defaults to v3 from the cutover onward', () => {
		expect(defaultRulesVersion(cutover)).toBe(3);
		expect(defaultRulesVersion(new Date('2027-01-01T00:00:01-05:00'))).toBe(3);
		expect(defaultRulesVersion(new Date('2027-06-01T12:00:00-04:00'))).toBe(3);
	});
});

describe('normalizeRulesVersion', () => {
	it('treats missing and unknown values as v2', () => {
		expect(normalizeRulesVersion(undefined)).toBe(2);
		expect(normalizeRulesVersion(null)).toBe(2);
		expect(normalizeRulesVersion(2)).toBe(2);
		expect(normalizeRulesVersion('2')).toBe(2);
		expect(normalizeRulesVersion('v3')).toBe(2);
		expect(normalizeRulesVersion(4)).toBe(2);
	});

	it('accepts numeric and string 3', () => {
		expect(normalizeRulesVersion(3)).toBe(3);
		expect(normalizeRulesVersion('3')).toBe(3);
	});
});

describe('G3E vehicle limits', () => {
	it('follows one vehicle per full 20 cans, capped at 3', () => {
		expect(maxCountedVehicles(19)).toBe(0);
		expect(maxCountedVehicles(25)).toBe(1);
		expect(maxCountedVehicles(50)).toBe(2);
		expect(maxCountedVehicles(60)).toBe(3);
		expect(maxCountedVehicles(70)).toBe(3);
		expect(maxCountedVehicles(200)).toBe(3);
	});

	it('does not count the first bike', () => {
		expect(countedVehicleTotal(['bike'])).toBe(0);
		expect(countedVehicleTotal(['bike', 'hot_rod'])).toBe(1);
		expect(countedVehicleTotal(['hot_rod', 'bike', 'pickup'])).toBe(2);
		expect(countedVehicleTotal(['bike', 'bike'])).toBe(1);
	});
});
