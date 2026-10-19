import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);
const ownerPath = 'users/alice/vehicle-photos/team1234/veh123/photo1234.webp';

beforeAll(async () => {
	testEnv = await initializeTestEnvironment({
		projectId: 'demo-gaslands-rules',
		storage: {
			rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8'),
			host: '127.0.0.1',
			port: 9199
		}
	});
});

afterAll(async () => {
	await testEnv.cleanup();
});

beforeEach(async () => {
	await testEnv.clearStorage();
});

function file(uid: string | null, path: string) {
	const context = uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
	return ref(context.storage(), path);
}

describe('vehicle photo storage', () => {
	it('lets the owner upload and read a webp or jpeg under 1.5 MiB', async () => {
		await assertSucceeds(uploadBytes(file('alice', ownerPath), webp, { contentType: 'image/webp' }));
		await assertSucceeds(getBytes(file('alice', ownerPath)));
		const jpegPath = 'users/alice/vehicle-photos/team1234/veh123/photo1234.jpg';
		await assertSucceeds(uploadBytes(file('alice', jpegPath), webp, { contentType: 'image/jpeg' }));
	});

	it('denies other people, signed-out readers, other paths, png, and oversized files', async () => {
		await assertSucceeds(uploadBytes(file('alice', ownerPath), webp, { contentType: 'image/webp' }));
		await assertFails(getBytes(file('bob', ownerPath)));
		await assertFails(getBytes(file(null, ownerPath)));
		await assertFails(deleteObject(file('bob', ownerPath)));
		await assertFails(uploadBytes(file('alice', 'users/alice/notes/photo1234.webp'), webp, { contentType: 'image/webp' }));
		await assertFails(uploadBytes(file('alice', ownerPath.replace('.webp', '.png')), webp, { contentType: 'image/png' }));
		await assertFails(
			uploadBytes(file('alice', 'users/alice/vehicle-photos/team1234/veh123/photo9999.webp'), new Uint8Array(1_572_865), {
				contentType: 'image/webp'
			})
		);
		await assertSucceeds(deleteObject(file('alice', ownerPath)));
	});
});
