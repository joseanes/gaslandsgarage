import { describe, expect, it } from 'vitest';
import { libraryPhotoPath } from './model';
import { attachmentsFromData, legacyMigrationTarget, shareSource } from './library';

describe('photo library', () => {
	it('keeps a library file on the account', () => {
		expect(libraryPhotoPath('ada', 'photo1234', 'image/webp')).toBe('users/ada/photos-library/photo1234.webp');
		expect(libraryPhotoPath('ada', 'photo1234', 'image/jpeg')).toBe('users/ada/photos-library/photo1234.jpg');
	});

	it('reads attachments, including an older single car', () => {
		expect(attachmentsFromData({ attachments: [{ teamId: 'team1', vehicleId: 'car1' }, { teamId: 'team1', vehicleId: 'car1' }] })).toEqual([
			{ teamId: 'team1', vehicleId: 'car1' }
		]);
		expect(attachmentsFromData({ teamId: 'team1', vehicleId: 'car1' })).toEqual([{ teamId: 'team1', vehicleId: 'car1' }]);
		expect(attachmentsFromData({})).toEqual([]);
	});

	it('points a legacy file at the library and leaves a library file where it is', () => {
		expect(legacyMigrationTarget('ada', 'photo1234', 'users/ada/vehicle-photos/team1/car1/photo1234.webp', 'image/webp')).toBe(
			'users/ada/photos-library/photo1234.webp'
		);
		expect(legacyMigrationTarget('ada', 'photo1234', 'users/ada/photos-library/photo1234.webp', 'image/webp')).toBeNull();
		expect(legacyMigrationTarget('ada', 'photo1234', 'users/ada/vehicle-photos/team1/car1/photo1234.webp', 'image/png')).toBeNull();
	});

	it('picks the only car, and asks when several cars could be the share', () => {
		const one = [{ teamId: 'team1', vehicleId: 'car1' }];
		expect(shareSource(one, '', '')).toEqual(one[0]);
		const two = [...one, { teamId: 'team2', vehicleId: 'car2' }];
		expect(() => shareSource([], '', '')).toThrow(/Attach this photo to a car/);
		expect(() => shareSource(two, '', '')).toThrow(/Choose which car/);
		expect(shareSource(two, 'team2', 'car2')).toEqual({ teamId: 'team2', vehicleId: 'car2' });
		expect(() => shareSource(two, 'team9', 'car9')).toThrow(/Attach this photo to that car/);
	});
});
