import { describe, it, expect } from 'vitest';
import { decodeDraft } from './io';
import { buildSharePayload, resolveSponsorId } from './qr';

describe('resolveSponsorId', () => {
  it('keeps a string sponsor id', () => {
    expect(resolveSponsorId('rutherford')).toBe('rutherford');
  });

  it('reads the id when a sponsor object is passed', () => {
    expect(resolveSponsorId({ id: 'mishkin' })).toBe('mishkin');
  });

  it('falls back when the sponsor is missing or blank', () => {
    expect(resolveSponsorId('')).toBe('no_sponsor');
    expect(resolveSponsorId('   ')).toBe('no_sponsor');
    expect(resolveSponsorId(undefined)).toBe('no_sponsor');
    expect(resolveSponsorId({ id: '' })).toBe('no_sponsor');
  });
});

describe('buildSharePayload', () => {
  it('encodes the selected sponsor instead of dropping it', () => {
    const payload = buildSharePayload({
      sponsor: 'idris',
      teamName: 'Orange Crush',
      maxCans: 60,
      vehicles: [
        {
          id: 'v1',
          type: 'car',
          name: 'Lead',
          weapons: ['handgun_ab12'],
          upgrades: ['armor'],
          perks: ['powder_keg'],
          weaponFacings: { handgun_ab12: 'front' }
        }
      ]
    });

    expect(payload.sponsor).toBe('idris');
    expect(payload.teamName).toBe('Orange Crush');
    expect(payload.maxCans).toBe(60);
    expect(payload.vehicles[0].perks).toEqual(['powder_keg']);

    const roundTrip = decodeDraft(
      btoa(encodeURIComponent(JSON.stringify(payload)))
    );
    expect(roundTrip?.sponsor).toBe('idris');
    expect(roundTrip?.maxCans).toBe(60);
  });

	it('keeps a version 3 team and its driver on the share payload', () => {
		const payload = buildSharePayload({
			sponsor: 'idris',
			rulesVersion: 3,
			vehicles: [
				{
					id: 'v1',
					type: 'sports_car',
					name: 'Zap',
					weapons: [],
					perks: [],
					driverArchetype: 'spark',
					driverName: 'Zap',
					secondPerkClass: 'speed'
				}
			]
		});
		expect(payload.rulesVersion).toBe(3);
		expect(payload.vehicles[0].driverName).toBe('Zap');
		expect(payload.vehicles[0].secondPerkClass).toBe('speed');
	});

	it('does not treat a string sponsor id as an object', () => {
    // Regression: "rutherford".id is undefined, which used to become no_sponsor.
    const payload = buildSharePayload({
      sponsor: 'rutherford',
      vehicles: []
    });
    expect(payload.sponsor).toBe('rutherford');
    expect(payload.sponsor).not.toBe('no_sponsor');
  });
});
